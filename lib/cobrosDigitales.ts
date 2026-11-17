// Cobros digitales (Gonzalo, 2026-11-17): cada pago que entra sin efectivo,
// con lo que el medio de pago descontó DE VERDAD (comisión con IVA, impuesto
// a los débitos y créditos, SIRCREB cuando lo hubo, lo que sea) y lo que quedó.
//
// De dónde sale: el «reporte de liberaciones» de Mercado Pago (lib/mercadopago.ts).
// Cada fila se guarda tal cual en `cobros_digitales` (sql/cobros-digitales.sql) y
// nunca se recalcula: si las tasas cambian, lo guardado sigue diciendo lo que pasó.
// MODO pagado con el QR entra por Mercado Pago. Nave (posnet) va aparte, más adelante.
//
// La cuenta de cada cobro se arma con las filas del mismo movimiento (SOURCE_ID):
// el pago y, si Mercado Pago los informó en filas separadas, sus impuestos. Lo que
// queda al final es siempre la suma real de lo acreditado menos lo debitado: si
// algún descuento no se pudo identificar, aparece como «Otros ajustes», pero el
// neto nunca se inventa.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COLUMNAS_LIBERACIONES_BASE,
  COLUMNAS_LIBERACIONES_EXTRA,
  bajarReporteLiberacionesMp,
  configurarLiberacionesMp,
  listarReportesLiberacionesMp,
  pedirReporteLiberacionesMp,
} from "@/lib/mercadopago";

// ---------------------------------------------------------------- lectura del CSV

/** CSV con comillas, separado por coma o punto y coma (lo que venga en el encabezado). */
export function leerCsv(texto: string): Record<string, string>[] {
  const limpio = texto.replace(/^﻿/, "");
  const primera = limpio.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some((x) => x !== "")) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x !== "")) filas.push(fila);
  const [cab, ...resto] = filas;
  if (!cab) return [];
  const claves = cab.map((h) => h.trim().toUpperCase());
  return resto.map((f) => Object.fromEntries(claves.map((k, i) => [k, (f[i] ?? "").trim()])));
}

/** "1234.56", "-1.234,56", "1,234.56" → número. Vacío → 0. */
export function numero(s: string | undefined | null): number {
  if (!s) return 0;
  let t = s.replace(/[^\d,.\-]/g, "");
  const coma = t.lastIndexOf(","), punto = t.lastIndexOf(".");
  if (coma > punto) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fechaIso = (s: string | undefined) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ---------------------------------------------------------------- nombres de los descuentos

const PROVINCIAS = ["buenos_aires", "caba", "catamarca", "chaco", "chubut", "cordoba", "corrientes", "entre_rios", "formosa", "jujuy", "la_pampa", "la_rioja", "mendoza", "misiones", "neuquen", "rio_negro", "salta", "san_juan", "san_luis", "santa_cruz", "santa_fe", "santiago_del_estero", "tierra_del_fuego", "tucuman"];

/** Cómo se llama en pantalla cada impuesto o movimiento que informa Mercado Pago. */
export function nombreDescuento(crudo: string): string {
  const s = crudo.toLowerCase();
  if (/credit_debit|withholding_(payer|collector|payout|shipping)|debitos|creditos|ley_25413/.test(s)) return "Impuesto a los débitos y créditos";
  const prov = PROVINCIAS.find((p) => s.includes(p));
  if (/iibb|ibcf|ibex|sircreb|gross_income|ingresos_brutos|withdholding/.test(s) || prov) {
    const nombreProv = prov ? prov.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) : s.includes("ibcf") ? "CABA" : "";
    return `Retenciones impositivas${nombreProv ? ` (Ingresos Brutos ${nombreProv})` : " (Ingresos Brutos)"}`;
  }
  if (/\biva\b|tax_iva|vat/.test(s)) return "Percepción de IVA";
  if (/ganancia|profit|income_tax/.test(s)) return "Ganancias";
  if (s === "refund" || s.includes("refund")) return "Devolución al cliente";
  if (s.includes("chargeback")) return "Contracargo";
  if (s.includes("dispute") || s.includes("mediation")) return "Reclamo del cliente";
  if (s.includes("shipping")) return "Envío";
  if (s.includes("fee")) return "Cargo de Mercado Pago";
  return crudo;
}

/** TAXES_DISAGGREGATED viene en JSON sin forma documentada: se busca cada nombre con su monto. */
export function impuestosSeparados(json: string | undefined): { nombre: string; monto: number }[] {
  if (!json) return [];
  let dato: unknown;
  try { dato = JSON.parse(json); } catch { return []; }
  const salida: { nombre: string; monto: number }[] = [];
  const NOMBRES = ["detail", "type", "name", "tax_type", "description", "financial_entity", "concept", "tax"];
  const MONTOS = ["amount", "value", "total", "tax_amount"];
  const recorrer = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(recorrer); return; }
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const kNombre = NOMBRES.find((k) => typeof o[k] === "string");
      const kMonto = MONTOS.find((k) => o[k] !== undefined && Number.isFinite(Number(o[k])));
      if (kNombre && kMonto) { salida.push({ nombre: String(o[kNombre]), monto: Math.abs(Number(o[kMonto])) }); return; }
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "number" || (typeof v === "string" && /^-?[\d.,]+$/.test(v))) salida.push({ nombre: k, monto: Math.abs(numero(String(v))) });
        else recorrer(v);
      }
    }
  };
  recorrer(dato);
  return salida.filter((i) => i.monto > 0);
}

// ---------------------------------------------------------------- importar

type FilaGuardada = Record<string, unknown>;

/** Lee un reporte de Mercado Pago y guarda sus filas. Devuelve cuántas guardó. */
export async function importarReporteMp(supabase: SupabaseClient, nombre: string): Promise<number> {
  const texto = await bajarReporteLiberacionesMp(nombre);
  const filas = leerCsv(texto).filter((f) => (f.RECORD_TYPE ?? "").toLowerCase() === "release" && f.SOURCE_ID);

  // El QR manda el id de la venta como referencia: se cruza directo.
  const refs = [...new Set(filas.map((f) => f.EXTERNAL_REFERENCE).filter((r) => r && ES_UUID.test(r)))];
  const existentes = new Set<string>();
  for (let i = 0; i < refs.length; i += 200) {
    const { data } = await supabase.from("ventas").select("id_venta").in("id_venta", refs.slice(i, i + 200));
    (data ?? []).forEach((v) => existentes.add(v.id_venta as string));
  }

  const aGuardar: FilaGuardada[] = [];
  for (const f of filas) {
    const fecha = fechaIso(f.DATE);
    if (!fecha) continue;
    const detalle = impuestosSeparados(f.TAXES_DISAGGREGATED);
    aGuardar.push({
      proveedor: "MERCADO_PAGO",
      id_externo: f.SOURCE_ID,
      tipo: (f.DESCRIPTION || "movimiento").toLowerCase(),
      fecha,
      fecha_operacion: fechaIso(f.TRANSACTION_APPROVAL_DATE) ?? fechaIso(f.TRANSACTION_DATE),
      referencia: f.EXTERNAL_REFERENCE || null,
      id_venta: f.EXTERNAL_REFERENCE && existentes.has(f.EXTERNAL_REFERENCE) ? f.EXTERNAL_REFERENCE : null,
      medio: f.PAYMENT_METHOD || null,
      medio_tipo: f.PAYMENT_METHOD_TYPE || null,
      billetera: f.POI_WALLET_NAME || f.POI_BANK_NAME || null,
      bruto: numero(f.GROSS_AMOUNT),
      comision: Math.abs(numero(f.MP_FEE_AMOUNT)),
      financiacion: Math.abs(numero(f.FINANCING_FEE_AMOUNT)),
      impuestos: Math.abs(numero(f.TAXES_AMOUNT)),
      detalle_impuestos: detalle.length ? detalle : f.TAX_DETAIL ? [{ nombre: f.TAX_DETAIL, monto: Math.abs(numero(f.TAXES_AMOUNT)) }] : null,
      credito: Math.abs(numero(f.NET_CREDIT_AMOUNT)),
      debito: Math.abs(numero(f.NET_DEBIT_AMOUNT)),
      crudo: f,
      reporte: nombre,
    });
  }

  for (let i = 0; i < aGuardar.length; i += 300) {
    const { error } = await supabase
      .from("cobros_digitales")
      .upsert(aGuardar.slice(i, i + 300), { onConflict: "proveedor,id_externo,tipo,fecha" });
    if (error) throw new Error(`No se pudieron guardar los cobros: ${error.message}`);
  }
  await cruzarSinReferencia(supabase);
  await supabase.from("cobros_digitales_reportes").upsert({ nombre, proveedor: "MERCADO_PAGO", filas: aGuardar.length }, { onConflict: "nombre" });
  return aGuardar.length;
}

/**
 * Las transferencias al alias (Vender → Transferencia) no traen el id de la venta:
 * se cruzan con una venta por Mercado Pago del mismo monto, cobrada hasta 3 horas
 * antes o después, que todavía no tenga su cobro. Si hay dos candidatas, no se
 * elige ninguna: queda «sin venta» para revisar a mano.
 */
async function cruzarSinReferencia(supabase: SupabaseClient) {
  const { data: sueltos } = await supabase
    .from("cobros_digitales")
    .select("id_cobro, bruto, fecha_operacion, fecha")
    .eq("proveedor", "MERCADO_PAGO")
    .eq("tipo", "payment")
    .is("id_venta", null)
    .gt("bruto", 0)
    .order("fecha", { ascending: false })
    .limit(200);
  for (const c of sueltos ?? []) {
    const cuando = new Date((c.fecha_operacion as string) ?? (c.fecha as string));
    const desde = new Date(cuando.getTime() - 3 * 3600e3).toISOString();
    const hasta = new Date(cuando.getTime() + 3 * 3600e3).toISOString();
    const { data: candidatas } = await supabase
      .from("ventas")
      .select("id_venta")
      .eq("medio_pago", "MERCADO_PAGO")
      .eq("estado", "PAGADA")
      .eq("total", Number(c.bruto))
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .limit(3);
    const libres: string[] = [];
    for (const v of candidatas ?? []) {
      const { count } = await supabase.from("cobros_digitales").select("id_cobro", { head: true, count: "exact" }).eq("id_venta", v.id_venta);
      if (!count) libres.push(v.id_venta as string);
    }
    if (libres.length === 1) await supabase.from("cobros_digitales").update({ id_venta: libres[0] }).eq("id_cobro", c.id_cobro);
  }
}

export type ResultadoSincronizar = { leidos: number; filas: number; pedido: boolean; esperando: number; avisos: string[]; enMercadoPago: string[]; respuestaPedido: string };

/**
 * Lo que hace el cron cada noche y el botón «Actualizar ahora»:
 * 1) deja configuradas las columnas del reporte;
 * 2) lee los reportes que ya estén listos y no se hayan leído;
 * 3) si `pedir`, pide uno nuevo de los últimos `dias` (llega en unos minutos).
 */
export async function sincronizarMp(supabase: SupabaseClient, opciones: { pedir: boolean; dias?: number }): Promise<ResultadoSincronizar> {
  const avisos: string[] = [];
  try {
    await configurarLiberacionesMp([...COLUMNAS_LIBERACIONES_BASE, ...COLUMNAS_LIBERACIONES_EXTRA]);
  } catch (e) {
    // Si alguna columna extra no existe en la cuenta, alcanza con las indispensables.
    try {
      await configurarLiberacionesMp(COLUMNAS_LIBERACIONES_BASE);
      avisos.push(`Columnas extra rechazadas (${(e as Error).message}); se usan las indispensables.`);
    } catch (e2) {
      // Sin poder configurar, se sigue igual: el reporte sale con las columnas que ya tenga la cuenta.
      avisos.push(`Configurar el reporte: ${(e2 as Error).message}.`);
    }
  }

  let reportes: Awaited<ReturnType<typeof listarReportesLiberacionesMp>> = [];
  try {
    reportes = await listarReportesLiberacionesMp();
  } catch (e) {
    avisos.push(`Listar reportes: ${(e as Error).message}.`);
  }
  const { data: leidos } = await supabase.from("cobros_digitales_reportes").select("nombre").eq("proveedor", "MERCADO_PAGO");
  const yaLeidos = new Set((leidos ?? []).map((r) => r.nombre as string));
  // Para el mensaje: qué reportes tiene Mercado Pago y en qué estado (los últimos 5).
  const enMercadoPago = reportes
    .slice(-5)
    .map((r) => `${r.file_name ?? "sin archivo"} (${r.status ?? "sin estado"}${r.begin_date ? `, ${r.begin_date.slice(0, 10)} a ${(r.end_date ?? "").slice(0, 10)}` : ""})`);
  const listos = reportes.filter((r) => r.file_name && /\.(csv|txt)$/i.test(r.file_name) && !yaLeidos.has(r.file_name) && !/deleted|error|pending|processing/i.test(r.status ?? ""));
  const esperando = reportes.filter((r) => /pending|processing/i.test(r.status ?? "")).length;

  let filas = 0, nLeidos = 0;
  for (const r of listos.slice(0, 10)) {
    try {
      filas += await importarReporteMp(supabase, r.file_name as string);
      nLeidos++;
    } catch (e) {
      avisos.push(`${r.file_name}: ${(e as Error).message}`);
    }
  }

  let pedido = false;
  let respuestaPedido = "";
  if (opciones.pedir) {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - (opciones.dias ?? 3) * 86400e3);
    try {
      const r = await pedirReporteLiberacionesMp(desde, hasta);
      respuestaPedido = JSON.stringify(r ?? null).slice(0, 300);
      pedido = true;
    } catch (e) {
      avisos.push(`Pedir el reporte: ${(e as Error).message}.`);
    }
  }
  return { leidos: nLeidos, filas, pedido, esperando, avisos, enMercadoPago, respuestaPedido };
}

// ---------------------------------------------------------------- la cuenta de cada cobro

export type LineaCobro = { nombre: string; monto: number; nota?: string };
export type RepartoMarca = {
  idMarca: string | null;
  marca: string;
  propia: boolean;
  vendido: number;
  parteMedio: number; // lo que esta marca carga de lo que sacó el medio de pago
  comisionWiigo: number; // comisión de WiiGo con su IVA si corresponde
  comisionTexto: string;
  leToca: number;
  paraVos: number;
};
export type Cobro = {
  idExterno: string;
  proveedor: string;
  fecha: string; // cuándo pagó el cliente (o, si no vino, cuándo se acreditó)
  acreditado: string;
  medio: string;
  billetera: string | null;
  idVenta: string | null;
  numeroVenta: number | null;
  canal: string | null;
  pagoCliente: number;
  lineas: LineaCobro[]; // descuentos (montos negativos) y ajustes
  sacoMedio: number; // total descontado (positivo)
  entro: number; // lo que quedó de verdad
  reparto: RepartoMarca[];
  paraVos: number;
  deMarcas: number;
  avisos: string[];
  crudo: unknown[];
};

const MEDIOS: Record<string, string> = {
  account_money: "Dinero en cuenta",
  debit_card: "Débito",
  credit_card: "Crédito",
  prepaid_card: "Prepaga",
  bank_transfer: "Transferencia",
  digital_currency: "Cuotas sin tarjeta",
  consumer_credits: "Cuotas sin tarjeta",
  digital_wallet: "Billetera",
};

type Fila = {
  id_externo: string; proveedor: string; tipo: string; fecha: string; fecha_operacion: string | null;
  id_venta: string | null; medio: string | null; medio_tipo: string | null; billetera: string | null;
  bruto: number; comision: number; financiacion: number; impuestos: number;
  detalle_impuestos: { nombre: string; monto: number }[] | null; credito: number; debito: number; crudo: unknown;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Arma la cuenta de un movimiento a partir de todas sus filas. */
function armarCobro(filas: Fila[]): Omit<Cobro, "reparto" | "paraVos" | "deMarcas" | "numeroVenta" | "canal"> & { componentes: { comision: number; iibb: number; impCred: number; otros: number } } {
  const pago = filas.find((f) => f.tipo === "payment") ?? filas[0];
  const lineas: LineaCobro[] = [];
  const comp = { comision: 0, iibb: 0, impCred: 0, otros: 0 };
  const sumar = (nombre: string, monto: number, nota?: string) => {
    if (!monto) return;
    lineas.push({ nombre, monto: -r2(monto), nota });
    if (nombre.startsWith("Comisión")) comp.comision += monto;
    else if (nombre.startsWith("Retenciones impositivas")) comp.iibb += monto;
    else if (nombre.startsWith("Impuesto a los débitos")) comp.impCred += monto;
    else comp.otros += monto;
  };

  const pagoCliente = r2(Number(pago.bruto) || 0);
  for (const f of filas) {
    if (f.tipo === "payment") {
      sumar("Comisión de Mercado Pago", Number(f.comision), "IVA incluido");
      sumar("Comisión por cuotas", Number(f.financiacion));
      const imp = Number(f.impuestos) || 0;
      const det = (f.detalle_impuestos ?? []).filter((d) => d.monto > 0);
      const sumaDet = det.reduce((s, d) => s + d.monto, 0);
      if (det.length && Math.abs(sumaDet - imp) < 1) det.forEach((d) => sumar(nombreDescuento(d.nombre), d.monto));
      else if (imp) sumar(det.length === 1 ? nombreDescuento(det[0].nombre) : "Impuestos y retenciones", imp);
    } else {
      // Filas aparte del mismo movimiento: impuestos cobrados después, devoluciones, etc.
      const neto = (Number(f.credito) || 0) - (Number(f.debito) || 0);
      if (neto < 0) sumar(nombreDescuento(f.tipo), -neto);
      else if (neto > 0) lineas.push({ nombre: nombreDescuento(f.tipo), monto: r2(neto) });
    }
  }

  // Lo que entró es la suma real de lo acreditado menos lo debitado. Si la cuenta
  // de las líneas no da, la diferencia se muestra: nunca se inventa el neto.
  const entro = r2(filas.reduce((s, f) => s + (Number(f.credito) || 0) - (Number(f.debito) || 0), 0));
  const calculado = r2(pagoCliente + lineas.reduce((s, l) => s + l.monto, 0));
  const avisos: string[] = [];
  if (Math.abs(calculado - entro) >= 1 && pagoCliente > 0) {
    const dif = r2(entro - calculado);
    lineas.push({ nombre: "Otros ajustes", monto: dif, nota: "diferencia informada por Mercado Pago" });
    if (dif < 0) comp.otros += -dif;
  }
  const sacoMedio = r2(Math.max(0, pagoCliente - entro));
  const tipoMedio = pago.medio_tipo ?? "";
  const medio = MEDIOS[tipoMedio] ?? (pago.medio ? pago.medio.replace(/_/g, " ") : "Mercado Pago");
  if (tipoMedio === "prepaid_card") avisos.push("Pagó con tarjeta prepaga: es la que más comisión cobra.");
  return {
    idExterno: pago.id_externo,
    proveedor: pago.proveedor,
    fecha: pago.fecha_operacion ?? pago.fecha,
    acreditado: pago.fecha,
    medio,
    billetera: pago.billetera,
    idVenta: filas.find((f) => f.id_venta)?.id_venta ?? null,
    pagoCliente,
    lineas,
    sacoMedio,
    entro,
    avisos,
    crudo: filas.map((f) => f.crudo),
    componentes: comp,
  };
}

/** Los cobros de un rango de fechas (por cuándo pagó el cliente), con su reparto por marca. */
export async function cobrosDelPeriodo(supabase: SupabaseClient, desde: string, hasta: string): Promise<{ cobros: Cobro[]; ventasSinCobro: { idVenta: string; numero: number; total: number; fecha: string }[] }> {
  const { data, error } = await supabase
    .from("cobros_digitales")
    .select("id_externo, proveedor, tipo, fecha, fecha_operacion, id_venta, medio, medio_tipo, billetera, bruto, comision, financiacion, impuestos, detalle_impuestos, credito, debito, crudo")
    .or(`and(fecha_operacion.gte.${desde},fecha_operacion.lt.${hasta}),and(fecha_operacion.is.null,fecha.gte.${desde},fecha.lt.${hasta})`)
    .order("fecha", { ascending: true })
    .range(0, 9999);
  if (error) throw new Error(error.message);

  // Las filas sueltas del mismo movimiento (impuestos que llegan después) pueden caer fuera del rango.
  const ids = [...new Set((data ?? []).map((f) => f.id_externo as string))];
  const extra: Fila[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: mas } = await supabase
      .from("cobros_digitales")
      .select("id_externo, proveedor, tipo, fecha, fecha_operacion, id_venta, medio, medio_tipo, billetera, bruto, comision, financiacion, impuestos, detalle_impuestos, credito, debito, crudo")
      .in("id_externo", ids.slice(i, i + 200));
    extra.push(...((mas ?? []) as Fila[]));
  }
  const porMovimiento = new Map<string, Fila[]>();
  const vistos = new Set<string>();
  for (const f of [...((data ?? []) as Fila[]), ...extra]) {
    const clave = `${f.proveedor}|${f.id_externo}|${f.tipo}|${f.fecha}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const k = `${f.proveedor}|${f.id_externo}`;
    porMovimiento.set(k, [...(porMovimiento.get(k) ?? []), f]);
  }
  // Solo los movimientos que son cobros (tienen su fila de pago); un retiro al banco no es un cobro.
  const armados = [...porMovimiento.values()].filter((fs) => fs.some((f) => f.tipo === "payment")).map(armarCobro);

  // Ventas, renglones y marcas para el reparto
  const idsVenta = [...new Set(armados.map((c) => c.idVenta).filter(Boolean) as string[])];
  const ventas = new Map<string, { numero: number; canal: string | null }>();
  const renglones = new Map<string, { idMarca: string | null; importe: number }[]>();
  for (let i = 0; i < idsVenta.length; i += 200) {
    const lote = idsVenta.slice(i, i + 200);
    const [{ data: vs }, { data: ds }] = await Promise.all([
      supabase.from("ventas").select("id_venta, numero, canal").in("id_venta", lote),
      supabase.from("detalle_ventas").select("id_venta, id_marca, subtotal, precio_unitario, cantidad").in("id_venta", lote),
    ]);
    (vs ?? []).forEach((v) => ventas.set(v.id_venta as string, { numero: v.numero as number, canal: (v.canal as string | null) ?? null }));
    (ds ?? []).forEach((d) => {
      const lista = renglones.get(d.id_venta as string) ?? [];
      lista.push({ idMarca: (d.id_marca as string | null) ?? null, importe: Number(d.subtotal ?? Number(d.precio_unitario) * Number(d.cantidad)) || 0 });
      renglones.set(d.id_venta as string, lista);
    });
  }
  const { data: marcas } = await supabase
    .from("marcas")
    .select("id_marca, nombre, tipo_comercializacion, royalty_porcentaje, iva_royalty_porcentaje, trasladar_iva_comision, trasladar_comision_cobro, trasladar_sircreb, trasladar_imp_creditos");
  const marcaPorId = new Map((marcas ?? []).map((m) => [m.id_marca as string, m]));

  const cobros: Cobro[] = armados.map((c) => {
    const v = c.idVenta ? ventas.get(c.idVenta) : undefined;
    const lineasVenta = c.idVenta ? renglones.get(c.idVenta) ?? [] : [];
    const porMarca = new Map<string, number>();
    lineasVenta.forEach((l) => porMarca.set(l.idMarca ?? "", (porMarca.get(l.idMarca ?? "") ?? 0) + l.importe));
    const totalVenta = [...porMarca.values()].reduce((s, x) => s + x, 0);
    const reparto: RepartoMarca[] = [];
    let deMarcas = 0;
    if (totalVenta > 0) {
      for (const [idMarca, vendido] of porMarca) {
        const m = marcaPorId.get(idMarca);
        const propia = !m || m.tipo_comercializacion === "PROPIA";
        const peso = vendido / totalVenta;
        // Cada marca carga con su parte de lo que sacó el medio de pago, según lo que tenga pactado.
        const parteMedio = propia
          ? r2(c.sacoMedio * peso)
          : r2(
              (m.trasladar_comision_cobro ? c.componentes.comision * peso : 0) +
                (m.trasladar_sircreb ? c.componentes.iibb * peso : 0) +
                (m.trasladar_imp_creditos ? c.componentes.impCred * peso : 0)
            );
        const royalty = Number(m?.royalty_porcentaje) || 0;
        const ivaRoyalty = m?.trasladar_iva_comision ? Number(m?.iva_royalty_porcentaje) || 0 : 0;
        const comisionWiigo = propia ? 0 : r2(vendido * (royalty / 100) * (1 + ivaRoyalty / 100));
        const leToca = propia ? 0 : r2(vendido - parteMedio - comisionWiigo);
        deMarcas += leToca;
        reparto.push({
          idMarca: idMarca || null,
          marca: (m?.nombre as string) ?? "Sin marca",
          propia,
          vendido: r2(vendido),
          parteMedio,
          comisionWiigo,
          comisionTexto: propia ? "" : `${royalty} %${ivaRoyalty ? " + IVA" : ""}`,
          leToca,
          paraVos: 0,
        });
      }
      // Para vos: tus productos menos su parte de los descuentos, y tus comisiones.
      reparto.forEach((q) => {
        q.paraVos = q.propia ? r2(q.vendido - q.parteMedio) : q.comisionWiigo;
      });
      // Lo que sacó el medio de pago y no se le traslada a ninguna marca lo pagás
      // vos: va en su propio renglón para que se vea y la suma cierre con lo que entró.
      const sumaVos = reparto.reduce((s, q) => s + q.paraVos, 0);
      const sinTrasladar = r2(c.entro - deMarcas - sumaVos);
      if (Math.abs(sinTrasladar) >= 0.01) {
        reparto.push({
          idMarca: null,
          marca: "Descuentos que no se trasladan a las marcas",
          propia: true,
          vendido: 0,
          parteMedio: r2(-sinTrasladar),
          comisionWiigo: 0,
          comisionTexto: "",
          leToca: 0,
          paraVos: sinTrasladar,
        });
      }
    }
    const { componentes: _c, ...resto } = c;
    void _c;
    return {
      ...resto,
      numeroVenta: v?.numero ?? null,
      canal: v?.canal ?? null,
      reparto: reparto.sort((a, b) => b.vendido - a.vendido),
      paraVos: r2(c.entro - deMarcas),
      deMarcas: r2(deMarcas),
    };
  });

  // Ventas cobradas por Mercado Pago en el período que no aparecen en ningún reporte.
  // Solo desde el primer cobro guardado: antes de eso no se leyó nada y no se puede
  // decir que falte (Gonzalo, 17/11: sin reportes aparecían todas las ventas).
  const { data: primero } = await supabase
    .from("cobros_digitales")
    .select("fecha_operacion")
    .eq("proveedor", "MERCADO_PAGO")
    .eq("tipo", "payment")
    .not("fecha_operacion", "is", null)
    .order("fecha_operacion", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!primero?.fecha_operacion) {
    cobros.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    return { cobros, ventasSinCobro: [] };
  }
  const desdeCubierto = (primero.fecha_operacion as string) > desde ? (primero.fecha_operacion as string) : desde;
  const { data: ventasMp } = await supabase
    .from("ventas")
    .select("id_venta, numero, total, fecha")
    .eq("medio_pago", "MERCADO_PAGO")
    .eq("estado", "PAGADA")
    .gte("fecha", desdeCubierto)
    .lt("fecha", hasta)
    .range(0, 4999);
  const conCobro = new Set(cobros.map((c) => c.idVenta).filter(Boolean));
  // Lo de las últimas 48 h puede no haberse liberado todavía: no se marca como faltante.
  const limite = Date.now() - 48 * 3600e3;
  const ventasSinCobro = (ventasMp ?? [])
    .filter((v) => !conCobro.has(v.id_venta as string) && new Date(v.fecha as string).getTime() < limite)
    .map((v) => ({ idVenta: v.id_venta as string, numero: v.numero as number, total: Number(v.total) || 0, fecha: v.fecha as string }));

  cobros.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return { cobros, ventasSinCobro };
}
