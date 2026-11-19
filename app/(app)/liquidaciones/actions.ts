"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { registrarMovimientoRetencion, saldosRetencionPorMarca, historialRetencionMarca } from "@/lib/retencionesMarca";
import { obtenerSesionMarca, exigirLecturaDeMarca, exigirGestionInterna } from "@/lib/marcaSesion";
import { registrarMovimientoComercial } from "@/lib/cuentaComercialMarca";
import { devueltoPorDetalle, netearRenglon, type Devuelto } from "@/lib/devueltoPorDetalle";
import { CLAVE_COMISION_COBRO, POSNET_POR_DEFECTO, entraPorCuenta } from "@/lib/formasPago";
import { descuentosRealesPorVenta, type DescuentoReal } from "@/lib/cobrosDigitales";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cobradaAl, type Cobro, type DatoCobro } from "@/lib/fechaCobro";
import { cobroDeVentas } from "@/lib/cobroDeVentas";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

// Redondear a centavos (no a pesos enteros) en cada paso del cálculo — si se
// redondea a entero en cada línea, la suma de muchas líneas puede terminar
// desviada de lo que da calcular todo con 2 decimales y sumar al final, y
// eso es justo lo que no puede pasar cuando se compara contra lo que dice
// el proveedor o la marca.
function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

type Renglon = { id_detalle: string; id_venta: string; cantidad: number; subtotal: number | null; precio_unitario: number; id_variante: string };

/** Los renglones de una marca en esas ventas, filtrados por liquidación (ver FiltroRenglones). */
async function renglonesDeMarca(
  supabase: SupabaseClient,
  idMarca: string,
  idsVenta: string[],
  filtro?: FiltroRenglones
): Promise<Renglon[]> {
  const salida: Renglon[] = [];
  for (let i = 0; i < idsVenta.length; i += 200) {
    const tanda = idsVenta.slice(i, i + 200);
    const base = () =>
      supabase.from("detalle_ventas").select("id_detalle, id_venta, cantidad, subtotal, precio_unitario, id_variante").eq("id_marca", idMarca).in("id_venta", tanda);
    let q = base();
    if (filtro === "SIN_LIQUIDAR") q = q.is("id_liquidacion_marca", null);
    else if (filtro === "LIQUIDADOS") q = q.not("id_liquidacion_marca", "is", null);
    else if (filtro) q = q.eq("id_liquidacion_marca", filtro.liquidacion);
    let { data, error } = await q;
    // Sin la columna (SQL sin correr): todos los renglones, como antes del 19/11.
    if (error && filtro && /id_liquidacion_marca/.test(error.message)) ({ data, error } = await base());
    if (error) throw new Error(friendlyDbError(error));
    salida.push(...((data ?? []) as Renglon[]));
  }
  return salida;
}

// Coincide con `pagos.forma_pago_cliente` y con las tasas cargadas en
// Configuración — no hay una sola comisión de cobro: varía según dónde y con
// qué pagó el cliente (QR de Mercado Pago o posnet). Ver lib/formasPago.ts.
const CLAVE_COMISION_MP = CLAVE_COMISION_COBRO;
// Si la tasa del posnet no se cargó todavía, la de Nave (no 0: sería no descontarle nada a la marca).
const porDefectoCobro = (forma: string) =>
  forma === "POSNET_DEBITO" ? POSNET_POR_DEFECTO.debito : forma === "POSNET_CREDITO" ? POSNET_POR_DEFECTO.credito : 0;

async function tasasGenerales(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [
      "IMP_CREDITOS_PORCENTAJE",
      "IMP_DEBITOS_PORCENTAJE",
      "IVA_GENERAL_PORCENTAJE",
      "SIRCREB_PORCENTAJE",
      ...Object.values(CLAVE_COMISION_MP),
    ]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  return {
    impCreditos: cfg.IMP_CREDITOS_PORCENTAJE ?? 0,
    impDebitos: cfg.IMP_DEBITOS_PORCENTAJE ?? 0,
    ivaGeneral: cfg.IVA_GENERAL_PORCENTAJE ?? 21,
    sircreb: cfg.SIRCREB_PORCENTAJE ?? 0,
    mpComisionPorFormaPago: Object.fromEntries(
      Object.entries(CLAVE_COMISION_MP).map(([forma, clave]) => [forma, cfg[clave] ?? porDefectoCobro(forma)])
    ) as Record<string, number>,
  };
}

export type LineaRendicion = {
  idDetalle: string;
  fecha: string;
  numeroVenta: number;
  producto: string;
  cantidad: number;
  medioPago: string | null;
  formaPagoMp: string | null;
  ventaBruta: number;
  comisionWiigo: number;
  ivaComision: number;
  impCreditos: number;
  feeMp: number;
  sircreb: number;
  impDebitos: number;
  /**
   * Lo que la marca pone en el programa de profesionales en ese renglón: el
   * descuento que se le dio al paciente más lo que sumó la profesional (cada
   * marca define sus %, en config_profesionales_marca). Si la profesional
   * después canjea su saldo en productos de la marca, esa plata ya la puso la
   * marca acá: el canje no se vuelve a cobrar (Gonzalo, 2026-10-30).
   */
  programaProfesionales: number;
  netoARendir: number;
  /**
   * De dónde salen el costo de cobro, el impuesto a los créditos y las
   * retenciones (17/11): REAL = lo que informó Mercado Pago para esa venta (la
   * parte de esta marca); ESTIMADO = con las tasas de Configuración (posnet, o
   * Mercado Pago todavía no lo liberó); SIN_COSTO = efectivo.
   */
  dato: "REAL" | "ESTIMADO" | "SIN_COSTO";
  /**
   * Cuándo entró (o entra) la plata de esa venta (lib/fechaCobro.ts, 19/11). Solo
   * viene en la liquidación por lo cobrado (rendicionAlCorte); en el resto, null.
   */
  cobro?: string | null;
  datoCobro?: DatoCobro;
};

function vacioResumen() {
  return {
    ventaBruta: 0,
    comisionWiigo: 0,
    ivaComision: 0,
    impCreditos: 0,
    feeMp: 0,
    sircreb: 0,
    impDebitos: 0,
    programaProfesionales: 0,
    netoARendir: 0,
    netoEfectivo: 0,
    netoTransferencia: 0,
  };
}

type VentaMinima = {
  id_venta: string;
  numero: number;
  fecha: string;
  medio_pago: string | null;
  id_pago: string | null;
  /** Cuándo entró la plata (solo en la liquidación por lo cobrado). */
  cobro?: Cobro;
};

/**
 * Qué renglones de la marca tomar (19/11). La marca liquidada se marca por
 * RENGLÓN (detalle_ventas.id_liquidacion_marca), no en toda la venta: en una venta
 * con productos de dos marcas, liquidar a una dejaba afuera a la otra.
 *   - SIN_LIQUIDAR: los que no entraron en ninguna liquidación.
 *   - LIQUIDADOS: los que ya entraron en alguna (para el contracargo).
 *   - { liquidacion }: los de esa liquidación (el comprobante).
 * Sin sql/liquidar-lo-cobrado.sql corrido la columna no existe: se toman todos,
 * como antes.
 */
type FiltroRenglones = "SIN_LIQUIDAR" | "LIQUIDADOS" | { liquidacion: string };

// Motor de cálculo compartido: dada una marca y un conjunto ya filtrado de
// ventas (pendientes de rendir, o las de una liquidación ya cerrada),
// arma el detalle línea por línea con las deducciones. El royalty y el
// IVA sobre royalty salen de la ficha de la marca; las tasas generales
// (Imp. a los Créditos, comisión MP), de Configuración.
export async function construirLineas(
  supabase: SupabaseClient,
  idMarca: string,
  ventasFiltradas: VentaMinima[],
  opciones: {
    /**
     * Restar lo que el cliente devolvió de cada renglón. Es lo normal: a la
     * marca no se le rinde un producto que tiene de vuelta en la góndola, y
     * WiiGo no gana royalty por él.
     *
     * Se apaga en dos casos, los dos de ventas YA liquidadas: el comprobante
     * de una liquidación cerrada (que no puede cambiar porque después hubo
     * una devolución) y el contracargo (que ya prorratea por su cuenta lo
     * devuelto sobre el total original — restar acá también lo contaría dos
     * veces).
     */
    netearDevoluciones?: boolean;
    /** Sin esto, todos los renglones de la marca en esas ventas (lo de siempre). */
    renglones?: FiltroRenglones;
  } = {}
) {
  const { data: marca, error: errorMarca } = await supabase
    .from("marcas")
    .select(
      "nombre, royalty_porcentaje, iva_royalty_porcentaje, trasladar_iva_comision, trasladar_iva_comision_efectivo, trasladar_comision_cobro, trasladar_sircreb, trasladar_imp_creditos, trasladar_imp_debitos"
    )
    .eq("id_marca", idMarca)
    .maybeSingle();
  if (errorMarca) throw new Error(friendlyDbError(errorMarca));
  if (!marca) throw new Error("No se encontró la marca");

  if (ventasFiltradas.length === 0) return { marca: marca.nombre, lineas: [] as LineaRendicion[], resumen: vacioResumen() };

  const tasas = await tasasGenerales(supabase);
  const royalty = marca.royalty_porcentaje ?? 0;
  const ivaRoyalty = marca.trasladar_iva_comision ? marca.iva_royalty_porcentaje ?? 0 : 0;
  // El IVA del royalty puede cobrarse solo en las ventas electrónicas: hay
  // marcas con las que se negocia que en efectivo se les cobra el royalty
  // pelado. Si la columna todavía no existe (sql/iva-royalty-efectivo.sql sin
  // correr) se asume true, que es lo que el sistema hacía hasta ahora.
  const ivaRoyaltyEnEfectivo = marca.trasladar_iva_comision_efectivo ?? true;
  const ventaPorId = new Map(ventasFiltradas.map((v) => [v.id_venta, v]));

  const detalle = await renglonesDeMarca(supabase, idMarca, ventasFiltradas.map((v) => v.id_venta), opciones.renglones);

  const devueltos: Map<string, Devuelto> =
    opciones.netearDevoluciones === false
      ? new Map()
      : await devueltoPorDetalle(supabase, (detalle ?? []).map((d) => d.id_detalle as string));

  const idsVariante = [...new Set((detalle ?? []).map((d) => d.id_variante))];
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_variante", idsVariante.length > 0 ? idsVariante : ["00000000-0000-0000-0000-000000000000"]);
  const variantePorId = new Map((variantes ?? []).map((v) => [v.id_variante, v]));
  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto))];
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre")
    .in("id_producto", idsProducto.length > 0 ? idsProducto : ["00000000-0000-0000-0000-000000000000"]);
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto, p]));

  // La comisión real de Mercado Pago depende de con qué pagó el cliente
  // (débito, crédito, cuotas, etc.) — eso queda en pagos.forma_pago_cliente
  // al confirmar el cobro (ver cobros-efectivo/actions.ts), no es una tasa
  // única aplicable a toda venta por Mercado Pago.
  const idsPago = [...new Set((ventasFiltradas ?? []).map((v) => v.id_pago).filter((id): id is string => Boolean(id)))];
  const { data: pagos } = await supabase
    .from("pagos")
    .select("id_pago, forma_pago_cliente")
    .in("id_pago", idsPago.length > 0 ? idsPago : ["00000000-0000-0000-0000-000000000000"]);
  const formaPagoPorIdPago = new Map((pagos ?? []).map((p) => [p.id_pago, p.forma_pago_cliente]));

  // Lo que Mercado Pago descontó de verdad en cada venta (Cobros digitales,
  // 17/11). La venta que todavía no está en un reporte sigue con la estimación.
  const descuentosReales = await descuentosRealesPorVenta(
    supabase,
    ventasFiltradas.filter((v) => v.medio_pago === "MERCADO_PAGO").map((v) => v.id_venta)
  ).catch(() => new Map<string, DescuentoReal>());

  // El programa de profesionales de cada renglón vendido con código o a un
  // paciente: beneficio del paciente + lo que sumó la profesional. Las ventas
  // anuladas no cuentan (su referido queda ANULADO).
  const programaPorDetalle = new Map<string, number>();
  const idsDetalle = (detalle ?? []).map((d) => d.id_detalle as string);
  for (let i = 0; i < idsDetalle.length; i += 300) {
    const { data: refs } = await supabase
      .from("detalle_referidos_profesionales")
      .select("id_detalle_venta, beneficio_cliente, recompensa_profesional, referidos_profesionales!inner(estado)")
      .in("id_detalle_venta", idsDetalle.slice(i, i + 300))
      .neq("referidos_profesionales.estado", "ANULADO");
    for (const r of refs ?? []) {
      const id = r.id_detalle_venta as string;
      programaPorDetalle.set(id, (programaPorDetalle.get(id) ?? 0) + Number(r.beneficio_cliente ?? 0) + Number(r.recompensa_profesional ?? 0));
    }
  }

  const lineas: LineaRendicion[] = [];

  for (const linea of detalle ?? []) {
    const venta = ventaPorId.get(linea.id_venta);
    if (!venta) continue;

    const variante = variantePorId.get(linea.id_variante);
    const producto = variante ? productoPorId.get(variante.id_producto) : undefined;
    const nombreProducto = variante
      ? `${producto?.nombre ?? "Producto"}${variante.nombre !== "Único" ? ` — ${variante.nombre}` : ""}`
      : "Producto";

    const neto = netearRenglon(
      linea.cantidad,
      linea.subtotal ?? linea.precio_unitario * linea.cantidad,
      devueltos.get(linea.id_detalle as string)
    );
    // Devuelto entero: no hay nada que rendir por ese renglón.
    if (neto.cantidad <= 0 && neto.subtotal <= 0) continue;

    const esEfectivo = venta.medio_pago === "EFECTIVO";
    const formaPagoMp = venta.id_pago ? formaPagoPorIdPago.get(venta.id_pago) ?? null : null;
    const ventaBruta = redondear2(neto.subtotal);
    const comisionWiigo = redondear2(ventaBruta * (royalty / 100));
    const ivaComision =
      esEfectivo && !ivaRoyaltyEnEfectivo ? 0 : redondear2(comisionWiigo * (ivaRoyalty / 100));
    // El Impuesto a los Créditos es bancario: no corresponde si se le va a
    // entregar el efectivo en mano, sin pasar por una cuenta. Lo mismo la
    // comisión de Mercado Pago, que solo existe si cobró por esa vía — y
    // varía según la forma de pago real del cliente (ver arriba). Además
    // respeta el casillero "Impuesto a los créditos" de la ficha de la
    // marca — hoy todas lo tienen tildado (comportamiento sin cambios),
    // pero queda disponible por si alguna vez hace falta una excepción.
    // Real de Mercado Pago: esta marca paga su parte de lo que se descontó en el
    // cobro, según lo que vendió en él (si en la venta hubo otras marcas).
    const real = esEfectivo ? undefined : descuentosReales.get(venta.id_venta);
    const parteDelCobro = real && real.pagoCliente > 0 ? ventaBruta / real.pagoCliente : 0;
    const impCreditosLinea =
      esEfectivo || !marca.trasladar_imp_creditos
        ? 0
        : real
          ? redondear2(real.impCreditos * parteDelCobro)
          : redondear2(ventaBruta * (tasas.impCreditos / 100));
    // La comisión de Mercado Pago se cobra + IVA (ej. débito 1,39% + 21%
    // de IVA sobre esa comisión) — la tasa cargada en Configuración es la
    // base, sin IVA, así que el IVA se suma acá, no al cargar la tasa.
    const tasaMp = formaPagoMp ? tasas.mpComisionPorFormaPago[formaPagoMp] ?? 0 : 0;
    const tasaMpConIva = tasaMp * (1 + tasas.ivaGeneral / 100);
    // Mercado Pago o posnet: el costo de cobro de esa forma de pago exacta.
    const feeMp =
      !esEfectivo && marca.trasladar_comision_cobro && entraPorCuenta(venta.medio_pago)
        ? real
          ? redondear2(real.comision * parteDelCobro)
          : redondear2(ventaBruta * (tasaMpConIva / 100))
        : 0;
    // SIRCREB solo se retiene preventivamente si la marca tiene tildado
    // "trasladar SIRCREB" en su ficha — si no, WiiGo lo sigue absorbiendo
    // como hasta ahora (comportamiento sin cambios para esas marcas). El
    // sentido de retenerlo acá (en vez de dejarlo como pérdida de WiiGo o
    // de la marca) es no financiar con plata propia una retención que es de
    // un tercero: ver movimientos_retencion_marca, esto NUNCA es ganancia
    // de WiiGo, queda pendiente de compensar/devolver.
    // Lo del posnet entra a la cuenta del banco: también le retienen.
    // Con el dato real, solo lo que Mercado Pago retuvo de verdad en ese cobro
    // (casi siempre nada): la estimación lo cobraba siempre.
    const sircrebLinea =
      !esEfectivo && marca.trasladar_sircreb && entraPorCuenta(venta.medio_pago)
        ? real
          ? redondear2(real.retenciones * parteDelCobro)
          : redondear2(ventaBruta * (tasas.sircreb / 100))
        : 0;
    // Impuesto a los Débitos: al revés de los demás, hoy WiiGo lo absorbe
    // siempre (ninguna marca lo tiene tildado) — misma tasa general que el
    // resto, cargada en Configuración.
    const impDebitosLinea =
      !esEfectivo && marca.trasladar_imp_debitos ? redondear2(ventaBruta * (tasas.impDebitos / 100)) : 0;
    // Si se devolvió parte del renglón, el programa baja en la misma proporción.
    const subtotalOriginal = Number(linea.subtotal ?? linea.precio_unitario * linea.cantidad) || 0;
    const parteQueQueda = subtotalOriginal > 0 ? Math.min(1, neto.subtotal / subtotalOriginal) : 1;
    const programaLinea = redondear2((programaPorDetalle.get(linea.id_detalle as string) ?? 0) * parteQueQueda);
    const netoARendir = redondear2(
      ventaBruta - comisionWiigo - ivaComision - impCreditosLinea - feeMp - sircrebLinea - impDebitosLinea - programaLinea
    );

    lineas.push({
      idDetalle: linea.id_detalle,
      fecha: venta.fecha,
      numeroVenta: venta.numero,
      producto: nombreProducto,
      cantidad: neto.cantidad,
      medioPago: venta.medio_pago,
      formaPagoMp,
      ventaBruta,
      comisionWiigo,
      ivaComision,
      impCreditos: impCreditosLinea,
      feeMp,
      sircreb: sircrebLinea,
      impDebitos: impDebitosLinea,
      programaProfesionales: programaLinea,
      netoARendir,
      dato: esEfectivo ? "SIN_COSTO" : real ? "REAL" : "ESTIMADO",
      cobro: venta.cobro?.fecha ?? null,
      datoCobro: venta.cobro?.dato,
    });
  }

  lineas.sort((a, b) => b.fecha.localeCompare(a.fecha));

  const resumen = lineas.reduce(
    (acc, l) => ({
      ventaBruta: redondear2(acc.ventaBruta + l.ventaBruta),
      comisionWiigo: redondear2(acc.comisionWiigo + l.comisionWiigo),
      ivaComision: redondear2(acc.ivaComision + l.ivaComision),
      impCreditos: redondear2(acc.impCreditos + l.impCreditos),
      feeMp: redondear2(acc.feeMp + l.feeMp),
      sircreb: redondear2(acc.sircreb + l.sircreb),
      impDebitos: redondear2(acc.impDebitos + l.impDebitos),
      programaProfesionales: redondear2(acc.programaProfesionales + l.programaProfesionales),
      netoARendir: redondear2(acc.netoARendir + l.netoARendir),
      // Dos plata distintas: lo que se le entrega en mano (efectivo) y lo
      // que se le transfiere por banco — no se pueden mezclar en un solo
      // número porque son dos movimientos físicos distintos.
      netoEfectivo: redondear2(acc.netoEfectivo + (l.medioPago === "EFECTIVO" ? l.netoARendir : 0)),
      netoTransferencia: redondear2(acc.netoTransferencia + (l.medioPago === "EFECTIVO" ? 0 : l.netoARendir)),
    }),
    vacioResumen()
  );

  return { marca: marca.nombre, lineas, resumen };
}

/**
 * Devuelve el contracargo de una venta que se anula después de haberla
 * liquidado.
 *
 * El caso: se vende el lunes, se liquida a la marca el martes (ya cobró su
 * parte), y el cliente devuelve el miércoles. La plata volvió al cliente, pero
 * la marca ya se llevó lo suyo. Sin esto, esa diferencia la pone WiiGo.
 *
 * Se calcula con el MISMO motor que la liquidación original (construirLineas),
 * no con una fórmula repetida: si mañana cambia una tasa o una marca deja de
 * trasladar el SIRCREB, el contracargo cambia igual que la rendición. Una
 * segunda copia de esta cuenta se desincronizaría el primer día.
 *
 * Una venta puede tener productos de varias marcas, así que devuelve un
 * movimiento por marca.
 */
export async function contracargoPorAnulacion(
  idVenta: string,
  motivo: string,
  usuario: string | null,
  /**
   * Qué parte de lo vendido a cada marca se está devolviendo, de 0 a 1. Sin
   * esto se asume 1 (la venta entera). Se puede prorratear porque todas las
   * deducciones de la rendición son proporcionales a la venta bruta, así que
   * multiplicar el neto da el mismo número que recalcular línea por línea.
   */
  factorPorMarca?: Map<string, number>
): Promise<{ marcas: { idMarca: string; nombre: string; importe: number }[]; error: string | null }> {
  const supabase = getSupabaseServerClient();

  const { data: venta } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, medio_pago, id_pago, id_local, id_liquidacion")
    .eq("id_venta", idVenta)
    .maybeSingle();
  if (!venta) return { marcas: [], error: "No se encontró la venta" };

  const { data: lineas } = await supabase.from("detalle_ventas").select("id_marca").eq("id_venta", idVenta);
  const idsMarca = [...new Set((lineas ?? []).map((l) => l.id_marca as string).filter(Boolean))];
  if (idsMarca.length === 0) return { marcas: [], error: null };

  const ventaParaCalculo = {
    id_venta: venta.id_venta as string,
    numero: venta.numero as number,
    fecha: venta.fecha as string,
    medio_pago: venta.medio_pago as string | null,
    id_pago: venta.id_pago as string | null,
  };

  const resultado: { idMarca: string; nombre: string; importe: number }[] = [];

  for (const idMarca of idsMarca) {
    // Sobre la venta original entera: el factor de abajo ya dice qué parte
    // se devolvió. Si acá además se restara lo devuelto, se contaría dos veces.
    // Solo lo de esta marca que ya se le liquidó (19/11: se marca por renglón). Si
    // la venta se liquidó con la marca vieja (toda la venta), cuentan todos.
    const { marca, resumen } = await construirLineas(supabase, idMarca, [ventaParaCalculo], {
      netearDevoluciones: false,
      renglones: venta.id_liquidacion ? undefined : "LIQUIDADOS",
    });
    const factor = factorPorMarca ? factorPorMarca.get(idMarca) ?? 0 : 1;
    const importe = Math.round(resumen.netoARendir * factor * 100) / 100;
    if (importe <= 0) continue;

    // Importe positivo = la marca le debe eso a WiiGo. Se descuenta solo de
    // su próxima liquidación, que es exactamente lo que hay que hacer: no se
    // le pide plata de vuelta, se compensa contra lo que va a cobrar.
    await registrarMovimientoComercial(supabase, {
      idMarca,
      idLocal: (venta.id_local as string) ?? null,
      tipoCargo: "AJUSTE",
      importe,
      usuario,
      observaciones:
        `Devolución${factor < 1 ? " parcial" : ""} de la venta #${venta.numero} — ya estaba liquidada, se descuenta de la próxima. ${motivo}`.trim(),
    });

    resultado.push({ idMarca, nombre: marca, importe });
  }

  return { marcas: resultado, error: null };
}

// Calcula la rendición línea por línea de una marca en un rango de
// fechas, solo sobre ventas ya pagadas y todavía no incluidas en una
// liquidación cerrada (ventas.id_liquidacion IS NULL).
export async function calcularRendicion(idMarca: string, desde: string, hasta: string) {
  // Un archivo "use server" expone cada función como un endpoint POST: quien
  // esté logueado puede llamarla con el idMarca que se le ocurra. Mientras
  // esto lo usaba solo el admin no importaba, pero desde que las marcas
  // tienen usuario propio (ver lib/marcaSesion.ts) sin este control una
  // marca podría pedir la rendición de otra pasando su id.
  const sesionMarca = await obtenerSesionMarca();
  if (sesionMarca && sesionMarca.idMarca !== idMarca) {
    throw new Error("No tenés acceso a los datos de esa marca");
  }

  const supabase = getSupabaseServerClient();

  const { data: detalle, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .select("id_venta")
    .eq("id_marca", idMarca);
  if (errorDetalle) throw new Error(friendlyDbError(errorDetalle));
  const idsVenta = [...new Set((detalle ?? []).map((d) => d.id_venta))];
  if (idsVenta.length === 0) return construirLineas(supabase, idMarca, []);

  const { data: ventas, error: errorVentas } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, medio_pago, id_pago")
    .in("id_venta", idsVenta)
    .eq("estado", "PAGADA")
    .is("id_liquidacion", null)
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  if (errorVentas) throw new Error(friendlyDbError(errorVentas));

  // Lo vendido sin liquidar (por renglón desde el 19/11). Para LIQUIDAR se usa
  // rendicionAlCorte, que además mira si la plata ya entró.
  return construirLineas(supabase, idMarca, ventas ?? [], { renglones: "SIN_LIQUIDAR" });
}

/** El último momento de un día de Argentina, para comparar con ventas.fecha. */
const finDelDia = (dia: string) => `${dia}T23:59:59.999-03:00`;

/**
 * La liquidación por lo cobrado (Gonzalo, 19/11): todo lo vendido hasta el
 * `corte` (AAAA-MM-DD) que todavía no se liquidó y cuya plata YA entró al corte.
 * Lo vendido con la plata en camino (crédito del posnet, QR que Mercado Pago
 * todavía no liberó) queda en `enCamino` y pasa solo a la liquidación siguiente.
 * No hay «desde»: una venta de octubre que entró en noviembre va en noviembre.
 */
export async function rendicionAlCorte(idMarca: string, corte: string) {
  const sesionMarca = await obtenerSesionMarca();
  if (sesionMarca && sesionMarca.idMarca !== idMarca) throw new Error("No tenés acceso a los datos de esa marca");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corte)) throw new Error("Elegí la fecha de corte");

  const supabase = getSupabaseServerClient();
  const ventas = await ventasSinLiquidarHasta(supabase, idMarca, corte);
  const cobro = await cobroDeVentas(supabase, ventas);
  const conCobro = ventas.map((v) => ({ ...v, cobro: cobro.get(v.id_venta) }));
  const cobradas = conCobro.filter((v) => v.cobro && cobradaAl(v.cobro, corte));
  const enCamino = conCobro.filter((v) => !v.cobro || !cobradaAl(v.cobro, corte));

  const [ahora, despues] = await Promise.all([
    construirLineas(supabase, idMarca, cobradas, { renglones: "SIN_LIQUIDAR" }),
    construirLineas(supabase, idMarca, enCamino, { renglones: "SIN_LIQUIDAR" }),
  ]);
  return { ...ahora, corte, enCamino: { lineas: despues.lineas, resumen: despues.resumen } };
}

/** Las ventas pagadas hasta el corte con algún renglón de la marca sin liquidar. */
async function ventasSinLiquidarHasta(supabase: SupabaseClient, idMarca: string, corte: string): Promise<VentaMinima[]> {
  let { data: renglones, error } = await supabase.from("detalle_ventas").select("id_venta").eq("id_marca", idMarca).is("id_liquidacion_marca", null).range(0, 49999);
  if (error && /id_liquidacion_marca/.test(error.message)) ({ data: renglones, error } = await supabase.from("detalle_ventas").select("id_venta").eq("id_marca", idMarca).range(0, 49999));
  if (error) throw new Error(friendlyDbError(error));
  const ids = [...new Set((renglones ?? []).map((d) => d.id_venta as string))];
  const salida: VentaMinima[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: e } = await supabase
      .from("ventas")
      .select("id_venta, numero, fecha, medio_pago, id_pago")
      .in("id_venta", ids.slice(i, i + 200))
      .eq("estado", "PAGADA")
      .is("id_liquidacion", null)
      .lte("fecha", finDelDia(corte));
    if (e) throw new Error(friendlyDbError(e));
    salida.push(...((data ?? []) as VentaMinima[]));
  }
  return salida;
}

// Reconstruye el detalle línea por línea de una liquidación YA CERRADA,
// para el comprobante — las ventas quedaron estampadas con ese
// id_liquidacion al cerrarla, así que el detalle nunca cambia después.
export async function detalleLiquidacion(idLiquidacion: string) {
  const supabase = getSupabaseServerClient();

  const { data: liquidacion, error: errorLiq } = await supabase
    .from("liquidaciones")
    .select("*")
    .eq("id_liquidacion", idLiquidacion)
    .maybeSingle();
  if (errorLiq) throw new Error(friendlyDbError(errorLiq));
  if (!liquidacion) throw new Error("No se encontró la liquidación");
  // Es un endpoint: una marca solo puede pedir las suyas (ahora la ve en su portal).
  await exigirLecturaDeMarca(liquidacion.id_marca as string);

  // Desde el 19/11 la liquidación queda en cada renglón; las de antes, en la venta.
  const { data: viejas, error: errorVentas } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, medio_pago, id_pago")
    .eq("id_liquidacion", idLiquidacion);
  if (errorVentas) throw new Error(friendlyDbError(errorVentas));
  const { data: renglones } = await supabase.from("detalle_ventas").select("id_venta").eq("id_liquidacion_marca", idLiquidacion);
  const idsNuevas = [...new Set((renglones ?? []).map((r) => r.id_venta as string))];
  const { data: nuevas } = idsNuevas.length
    ? await supabase.from("ventas").select("id_venta, numero, fecha, medio_pago, id_pago").in("id_venta", idsNuevas)
    : { data: [] as VentaMinima[] };
  const ventas = (viejas ?? []).length ? viejas : nuevas;
  const cobro = await cobroDeVentas(supabase, (ventas ?? []) as VentaMinima[]);

  // Tal como se rindió: una devolución posterior no cambia un comprobante
  // ya cerrado — eso se resuelve con el contracargo, en la liquidación que
  // sigue.
  const { marca, lineas, resumen } = await construirLineas(
    supabase,
    liquidacion.id_marca,
    ((ventas ?? []) as VentaMinima[]).map((v) => ({ ...v, cobro: cobro.get(v.id_venta) })),
    {
      netearDevoluciones: false,
      renglones: (viejas ?? []).length ? undefined : { liquidacion: idLiquidacion },
    }
  );

  return { liquidacion, marca, lineas, resumen };
}

// Next.js redacta en producción el mensaje de cualquier Error que se lance
// desde una Server Action (queda solo un digest genérico en el navegador) —
// por eso esta función devuelve { error } como dato en vez de tirar throw.
//
// Desde el 19/11 cierra por lo COBRADO al corte (rendicionAlCorte) y se vuelve a
// calcular acá: no se le cree al número que mandó la pantalla. Si en el medio
// entró o se anuló algo, avisa para volver a calcular.
export async function marcarComoLiquidada(
  idMarca: string,
  corte: string,
  netoEsperado: number
): Promise<{ error: string | null }> {
  try {
    await exigirGestionInterna();
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    // Sin la columna por renglón no se puede cerrar bien (volvería a pasar lo de las dos marcas).
    const { error: sinColumna } = await supabase.from("detalle_ventas").select("id_liquidacion_marca").limit(1);
    if (sinColumna) return { error: "Falta correr sql/liquidar-lo-cobrado.sql en Supabase antes de cerrar liquidaciones." };

    const fresco = await rendicionAlCorte(idMarca, corte);
    const resumen = fresco.resumen;
    if (fresco.lineas.length === 0) return { error: "No hay nada cobrado para liquidar a ese corte." };
    if (Math.abs(resumen.netoARendir - netoEsperado) > 1) {
      return { error: "Cambió algo desde que calculaste (entró o se anuló una venta). Volvé a tocar «Calcular» y revisalo." };
    }
    const desde = fresco.lineas.reduce((min, l) => (l.fecha < min ? l.fecha : min), fresco.lineas[0].fecha).slice(0, 10);
    const hasta = corte;

    const programa = resumen.programaProfesionales ?? 0;
    const totalComisiones = redondear2(resumen.comisionWiigo + resumen.ivaComision + resumen.feeMp);
    // El programa de profesionales entra en lo descontado (sin columna propia:
    // queda anotado en las observaciones y se vuelve a ver en el comprobante).
    const totalRetenciones = redondear2(totalComisiones + resumen.impCreditos + resumen.sircreb + resumen.impDebitos + programa);

    const { data: liquidacion, error: errorLiquidacion } = await supabase
      .from("liquidaciones")
      .insert({
        id_marca: idMarca,
        fecha_desde: desde,
        fecha_hasta: hasta,
        fecha_generacion: new Date().toISOString(),
        venta_bruta: resumen.ventaBruta,
        royalty: resumen.comisionWiigo,
        iva_royalty: resumen.ivaComision,
        comision_cobro_asignada: resumen.feeMp,
        imp_creditos_asignado: resumen.impCreditos,
        sircreb_asignado: resumen.sircreb,
        imp_debitos_liquidacion: resumen.impDebitos,
        total_comisiones: totalComisiones,
        total_retenciones: totalRetenciones,
        neto_a_transferir: resumen.netoARendir,
        estado: "LIQUIDADA",
        observaciones: `Confirmado por ${usuario ?? "—"} · Efectivo entregado: $${resumen.netoEfectivo} · Transferido por banco: $${resumen.netoTransferencia}${programa > 0 ? ` · Programa de profesionales: $${programa}` : ""}`,
      })
      .select("id_liquidacion")
      .single();
    if (errorLiquidacion) return { error: friendlyDbError(errorLiquidacion) };

    // Lo retenido preventivamente NUNCA es ganancia de WiiGo — queda en la
    // cuenta corriente de retenciones de la marca, pendiente de compensar
    // o devolver más adelante (Fase 4).
    if (resumen.sircreb > 0) {
      await registrarMovimientoRetencion(supabase, {
        idMarca,
        tipoRetencion: "SIRCREB",
        tipoMovimiento: "RETENCION",
        importe: resumen.sircreb,
        idLiquidacion: liquidacion.id_liquidacion,
        usuario,
        observaciones: `Retenido preventivamente en la liquidación del ${desde} al ${hasta}`,
      });
    }

    // Marca como liquidado cada RENGLÓN de esta marca que entró (19/11), no la
    // venta entera: lo de otra marca en la misma venta queda para la suya, y lo
    // que está en camino, para la próxima.
    const ids = fresco.lineas.map((l) => l.idDetalle);
    for (let i = 0; i < ids.length; i += 200) {
      const { error: errorUpdate } = await supabase
        .from("detalle_ventas")
        .update({ id_liquidacion_marca: liquidacion.id_liquidacion })
        .in("id_detalle", ids.slice(i, i + 200))
        .is("id_liquidacion_marca", null);
      if (errorUpdate) return { error: friendlyDbError(errorUpdate) };
    }

    revalidatePath("/liquidaciones");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cerrar la liquidación" };
  }
}

export async function historialLiquidaciones(idMarca: string) {
  await exigirLecturaDeMarca(idMarca);
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("liquidaciones")
    .select("*")
    .eq("id_marca", idMarca)
    .order("fecha_generacion", { ascending: false });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

// El comprobante firmado se guarda en un bucket privado de Supabase
// Storage — nunca queda público, se ve a través de un link firmado con
// vencimiento (ver obtenerUrlComprobante).
export async function subirComprobante(idLiquidacion: string, formData: FormData): Promise<{ error: string | null }> {
  try {
    const archivo = formData.get("archivo") as File | null;
    if (!archivo || archivo.size === 0) return { error: "Elegí un archivo primero" };

    const supabase = getSupabaseServerClient();
    const extension = archivo.name.split(".").pop() ?? "pdf";
    const path = `${idLiquidacion}.${extension}`;

    const { error: errorUpload } = await supabase.storage
      .from("comprobantes-liquidacion")
      .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
    if (errorUpload) return { error: errorUpload.message };

    const { error: errorUpdate } = await supabase
      .from("liquidaciones")
      .update({ comprobante_path: path })
      .eq("id_liquidacion", idLiquidacion);
    if (errorUpdate) return { error: friendlyDbError(errorUpdate) };

    revalidatePath("/liquidaciones");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo subir el comprobante" };
  }
}

// Cuenta corriente de retenciones (SIRCREB por ahora) — nunca es plata de
// WiiGo, es lo retenido preventivamente a esta marca pendiente de
// compensar o devolver.
export async function saldosRetencionMarcaAction(idMarca: string) {
  await exigirLecturaDeMarca(idMarca);
  const supabase = getSupabaseServerClient();
  return saldosRetencionPorMarca(supabase, idMarca);
}

export async function historialRetencionMarcaAction(idMarca: string) {
  await exigirLecturaDeMarca(idMarca);
  const supabase = getSupabaseServerClient();
  const movimientos = await historialRetencionMarca(supabase, idMarca);
  return movimientos.map((m) => ({
    idMovimiento: m.id_movimiento as string,
    tipoRetencion: m.tipo_retencion as string,
    tipoMovimiento: m.tipo_movimiento as string,
    importe: m.importe as number,
    saldoNuevo: m.saldo_nuevo as number,
    usuario: m.usuario as string | null,
    observaciones: m.observaciones as string | null,
    fecha: m.fecha as string,
  }));
}

export async function obtenerUrlComprobante(path: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("comprobantes-liquidacion")
    .createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
