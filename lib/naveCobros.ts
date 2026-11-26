import type { SupabaseClient } from "@supabase/supabase-js";
import { consultarPagoNave, consultarPedidoNave, cuentaPosnet, type CuentaNave } from "@/lib/nave";
import { traerPosnets } from "@/lib/navePosnet";

// Lo que Nave descontó de verdad en cada cobro (Gonzalo, 26/11: «que registre exacto lo que
// me retienen»). Se guarda en cobros_digitales, la misma tabla que Mercado Pago, con
// proveedor NAVE: así las liquidaciones, el Inicio y Cobros digitales lo usan sin nada aparte.
//
// Nave no tiene una lista de cobros: se le pregunta pago por pago (GET /payments/{id}), así que
// solo se puede con los cobros que inició el sistema y de los que se guardó el id:
//   · la tienda online con tarjeta (pedidos_online.nave_pago_id, cuando el pedido ya es venta);
//   · el posnet conectado a la caja (ventas.id_orden_mp = «nave:<n>:<id del cobro>»).
// El posnet marcado a mano sigue estimado.
//
// El detalle está en lifecycle[type=CLEARING].data (visto con el pedido #1021, 26/11):
// gross_amount, commission.gross_amount (con IVA), taxes[] (retenciones de IVA, Ganancias e
// IIBB con su jurisdicción), net_amount y settlement_date. Hasta que Nave hace el clearing
// (segundos o días) no hay dato: se vuelve a preguntar en la próxima corrida.
// El impuesto a los débitos y créditos lo cobra el banco, no Nave: ese sigue estimado.

/** Jurisdicciones de Ingresos Brutos (Convenio Multilateral) con el nombre que entiende nombreDescuento. */
const JURISDICCIONES: Record<string, string> = {
  "901": "caba", "902": "buenos_aires", "903": "catamarca", "904": "cordoba", "905": "corrientes", "906": "chaco",
  "907": "chubut", "908": "entre_rios", "909": "formosa", "910": "jujuy", "911": "la_pampa", "912": "la_rioja",
  "913": "mendoza", "914": "misiones", "915": "neuquen", "916": "rio_negro", "917": "salta", "918": "san_juan",
  "919": "san_luis", "920": "santa_cruz", "921": "santa_fe", "922": "santiago_del_estero", "923": "tierra_del_fuego", "924": "tucuman",
};

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === "object" ? (x as Obj) : {});
const monto = (x: unknown) => {
  const n = Number(obj(x).value ?? x);
  return Number.isFinite(n) ? Math.abs(n) : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** La fila de cobros_digitales de un pago de Nave, o null si Nave todavía no hizo el clearing. */
export function filaCobroNave(pago: Obj, idVenta: string): Obj | null {
  const ciclo = (Array.isArray(pago.lifecycle) ? pago.lifecycle : []).map(obj);
  const clearing = ciclo.find((l) => l.type === "CLEARING" && l.status === "COMPLETED");
  if (!clearing) return null;
  const d = obj(clearing.data);
  const bruto = monto(d.gross_amount);
  if (bruto <= 0) return null;

  const impuestos = (Array.isArray(d.taxes) ? d.taxes : []).map(obj).flatMap((t) => {
    const valor = monto(t.amount);
    if (valor <= 0) return [];
    const id = String(t.id ?? "").toUpperCase();
    const datos = obj(t.data);
    if (id === "IIBB") {
      const prov = JURISDICCIONES[String(datos.jurisdiction ?? "")];
      return [{ nombre: prov ? `iibb_${prov}` : "iibb", monto: r2(valor) }];
    }
    if (id === "IVA") return [{ nombre: "retencion_iva", monto: r2(valor) }];
    if (id === "EARNINGS" || id === "GANANCIAS") return [{ nombre: "retencion_ganancias", monto: r2(valor) }];
    return [{ nombre: id.toLowerCase() || "impuesto", monto: r2(valor) }];
  });

  const medio = obj(pago.payment_method);
  const tipoTarjeta = String(medio.card_type ?? "").toUpperCase();
  const entrada = String(pago.payment_input ?? "").toLowerCase();
  const autorizado = ciclo.find((l) => l.type === "AUTHORIZATION");
  return {
    proveedor: "NAVE",
    id_externo: String(pago.id),
    tipo: "payment",
    fecha: String(clearing.creation_date ?? pago.creation_date),
    fecha_operacion: String(autorizado?.creation_date ?? pago.creation_date ?? clearing.creation_date),
    referencia: (pago.external_payment_id as string | null) ?? null,
    id_venta: idVenta,
    medio: (medio.card_brand as string | null) ?? (entrada || null),
    medio_tipo: tipoTarjeta === "DEBIT" ? "debit_card" : tipoTarjeta === "CREDIT" ? "credit_card" : entrada === "wallet" ? "digital_wallet" : null,
    billetera: entrada === "wallet" ? "Billetera (MODO / app del banco)" : null,
    bruto: r2(bruto),
    comision: r2(monto(obj(d.commission).gross_amount)),
    financiacion: 0,
    impuestos: r2(impuestos.reduce((s, i) => s + i.monto, 0)),
    detalle_impuestos: impuestos.length ? impuestos : null,
    credito: r2(monto(d.net_amount)),
    debito: 0,
    crudo: d,
    reporte: "API Nave",
  };
}

/** Pregunta a Nave por un pago y guarda lo que descontó. */
export async function guardarCobroNave(
  supabase: SupabaseClient,
  idPagoNave: string,
  idVenta: string,
  cuenta?: CuentaNave
): Promise<"GUARDADO" | "ESPERANDO" | "NO_APROBADO"> {
  const pago = await consultarPagoNave(idPagoNave, cuenta);
  if (pago.estado !== "APROBADO") return "NO_APROBADO";
  const fila = filaCobroNave(pago.datos, idVenta);
  if (!fila) return "ESPERANDO";
  const { error } = await supabase.from("cobros_digitales").upsert(fila, { onConflict: "proveedor,id_externo,tipo,fecha" });
  if (error) throw new Error(`No se pudo guardar el cobro de Nave: ${error.message}`);
  return "GUARDADO";
}

/**
 * Los cobros de Nave de los últimos días que todavía no tienen su detalle real, y los guarda.
 * La corre el cron de la mañana de Cobros digitales.
 */
export async function sincronizarNave(supabase: SupabaseClient, dias = 45): Promise<{ guardados: number; esperando: number; errores: string[] }> {
  const desde = new Date(Date.now() - dias * 86400e3).toISOString();
  const candidatos: { idVenta: string; idPago?: string; idCobro?: string; numeroPosnet?: number }[] = [];

  // Tienda online con tarjeta: el pedido ya entregado tiene su venta.
  const { data: pedidos } = await supabase
    .from("pedidos_online")
    .select("id_venta, nave_pago_id")
    .not("nave_pago_id", "is", null)
    .not("id_venta", "is", null)
    .gte("creado", desde)
    .range(0, 999);
  for (const p of pedidos ?? []) candidatos.push({ idVenta: p.id_venta as string, idPago: p.nave_pago_id as string });

  // Posnet conectado a la caja.
  const { data: ventasPosnet } = await supabase
    .from("ventas")
    .select("id_venta, id_orden_mp")
    .eq("estado", "PAGADA")
    .like("id_orden_mp", "nave:%")
    .gte("fecha", desde)
    .range(0, 1999);
  for (const v of ventasPosnet ?? []) {
    const m = /^nave:(\d+):([\w-]+)$/.exec((v.id_orden_mp as string | null) ?? "");
    if (m) candidatos.push({ idVenta: v.id_venta as string, idCobro: m[2], numeroPosnet: Number(m[1]) });
  }
  if (!candidatos.length) return { guardados: 0, esperando: 0, errores: [] };

  // Los que ya tienen su detalle no se vuelven a preguntar.
  const ya = new Set<string>();
  const ids = candidatos.map((c) => c.idVenta);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("cobros_digitales").select("id_venta").eq("proveedor", "NAVE").in("id_venta", ids.slice(i, i + 200));
    (data ?? []).forEach((f) => ya.add(f.id_venta as string));
  }

  const posnets = await traerPosnets(supabase);
  let guardados = 0;
  let esperando = 0;
  const errores: string[] = [];
  for (const c of candidatos.filter((x) => !ya.has(x.idVenta))) {
    try {
      let cuenta: CuentaNave | undefined;
      let idPago = c.idPago ?? null;
      if (c.idCobro) {
        // Un posnet de prueba no cuenta para las liquidaciones.
        const posnet = posnets.find((p) => p.numero === c.numeroPosnet);
        if (posnet?.entorno === "sandbox") continue;
        cuenta = cuentaPosnet("produccion") ?? undefined;
        if (!cuenta) continue;
        idPago = (await consultarPedidoNave(c.idCobro, cuenta)).idPago;
      }
      if (!idPago) continue;
      const r = await guardarCobroNave(supabase, idPago, c.idVenta, cuenta);
      if (r === "GUARDADO") guardados++;
      else if (r === "ESPERANDO") esperando++;
    } catch (e) {
      errores.push(`${c.idVenta}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { guardados, esperando, errores };
}
