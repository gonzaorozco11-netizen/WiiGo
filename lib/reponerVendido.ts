// «Se vendió uno, traé uno» (Gonzalo, 2026-11-16).
//
// Cada unidad de una marca que sale de WiiGo (caja, tótem o tienda online) le
// suma «1 para traer», y se va acumulando hasta que la marca lo trae. Es otra
// cuenta que la de Recomendado (lib/reposicionSugerida.ts), que mira cuánto se
// vende por semana: esta repone exactamente lo vendido, así la góndola queda
// como estaba. Las dos conviven en el portal (Reponer); no se pisan.
//
// La cuenta, por variante, desde CONTAR_DESDE:
//
//   para traer = vendidas − devueltas que volvieron a la góndola − ya recibidas − ya mandadas
//
// - Vendidas: renglones de ventas PAGADAS del local.
// - Devueltas: solo las que VUELVEN a la góndola. Lo que no vuelve (abierto,
//   vencido) igual hay que reponerlo.
// - Recibidas: lo que entró de la marca en recepciones de órdenes nacidas
//   desde CONTAR_DESDE (mismo corte para los dos lados, así lo de antes no
//   cuenta ni de un lado ni del otro).
// - Mandadas: lo pedido en un envío abierto (o esperando aprobación) que
//   todavía no llegó. Con eso el renglón pasa a «Ya lo mandaste».
// Nunca negativo: si la marca trajo de más, no tiene que traer hasta que se venda.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ESTADOS_ABIERTOS } from "@/lib/estadosOrden";

/**
 * Desde cuándo se cuenta: 01/11/2026, 00:00 de Mendoza. Se prendió el 16/11
 * contando desde ese día, pero Gonzalo lo pasó al 1/11 (17/11): «todavía no
 * ha repuesto nada», así que todo lo vendido en el mes es para traer. Lo de
 * antes no se pide.
 */
export const CONTAR_DESDE = "2026-11-01T03:00:00.000Z";

export type VendidoVariante = {
  idVariante: string;
  vendidas: number;
  devueltas: number;
  recibidas: number;
  mandadas: number;
  /** Lo que hay que traer ahora. */
  traer: number;
  /** Ventas por día, de la más nueva a la más vieja: «hoy», «ayer», «sáb»… */
  dias: { dia: string; n: number }[];
};

const PROPUESTA = "PROPUESTA";

function diaArgentina(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}
function etiquetaDia(fecha: string, hoy: string): string {
  if (fecha === hoy) return "hoy";
  const ayer = new Date(new Date(`${hoy}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  if (fecha === ayer) return "ayer";
  const d = new Date(`${fecha}T12:00:00Z`);
  const dif = Math.round((new Date(`${hoy}T12:00:00Z`).getTime() - d.getTime()) / 86400000);
  if (dif < 7) return d.toLocaleDateString("es-AR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "numeric", timeZone: "UTC" });
}

/**
 * Lo vendido para reponer de una marca en un local, por variante (solo las que
 * tienen algo vendido desde el corte). Nunca tira: si algo falla, esa parte
 * cuenta como cero.
 */
export async function vendidoParaReponer(supabase: SupabaseClient, idMarca: string, idLocal: string): Promise<Map<string, VendidoVariante>> {
  const salida = new Map<string, VendidoVariante>();
  if (!idMarca || !idLocal) return salida;
  try {
    const hoy = diaArgentina(new Date().toISOString());

    // Vendidas (y cuándo).
    const { data: ventas } = await supabase
      .from("ventas")
      .select("id_venta, fecha")
      .eq("estado", "PAGADA")
      .eq("id_local", idLocal)
      .gte("fecha", CONTAR_DESDE)
      .range(0, 9999);
    const fechaDe = new Map((ventas ?? []).map((v) => [v.id_venta as string, v.fecha as string]));
    const idsVenta = [...fechaDe.keys()];
    const vendidas = new Map<string, number>();
    const porDia = new Map<string, Map<string, number>>();
    // Los renglones vendidos desde el corte: una devolución solo descuenta si es de uno de estos.
    const renglonesVendidos = new Set<string>();
    for (let i = 0; i < idsVenta.length; i += 200) {
      const { data } = await supabase
        .from("detalle_ventas")
        .select("id_detalle, id_venta, id_variante, cantidad")
        .in("id_venta", idsVenta.slice(i, i + 200))
        .eq("id_marca", idMarca);
      for (const r of data ?? []) {
        renglonesVendidos.add(r.id_detalle as string);
        const id = r.id_variante as string, n = Number(r.cantidad) || 0;
        vendidas.set(id, (vendidas.get(id) ?? 0) + n);
        const dia = diaArgentina(fechaDe.get(r.id_venta as string) ?? new Date().toISOString());
        const m = porDia.get(id) ?? new Map<string, number>();
        m.set(dia, (m.get(dia) ?? 0) + n);
        porDia.set(id, m);
      }
    }
    if (vendidas.size === 0) return salida;

    // Devueltas que volvieron a la góndola (si la tabla de devoluciones no está, cero).
    const devueltas = new Map<string, number>();
    try {
      const { data: devs } = await supabase.from("devoluciones").select("id_devolucion").eq("destino", "VUELVE").gte("fecha", CONTAR_DESDE);
      const idsDev = (devs ?? []).map((d) => d.id_devolucion as string);
      for (let i = 0; i < idsDev.length; i += 200) {
        const { data } = await supabase
          .from("detalle_devoluciones")
          .select("id_detalle, id_variante, cantidad")
          .in("id_devolucion", idsDev.slice(i, i + 200))
          .eq("id_marca", idMarca);
        for (const r of data ?? []) {
          if (!renglonesVendidos.has(r.id_detalle as string)) continue; // devolución de algo vendido antes del corte
          devueltas.set(r.id_variante as string, (devueltas.get(r.id_variante as string) ?? 0) + (Number(r.cantidad) || 0));
        }
      }
    } catch {
      /* sin devoluciones */
    }

    // Recibidas y mandadas: órdenes de la marca nacidas desde el corte.
    const { data: ordenes } = await supabase
      .from("ordenes_reposicion")
      .select("id_orden, estado")
      .eq("id_marca", idMarca)
      .eq("id_local", idLocal)
      .gte("fecha", CONTAR_DESDE);
    const idsOrden = (ordenes ?? []).map((o) => o.id_orden as string);
    const abiertas = new Set((ordenes ?? []).filter((o) => [...ESTADOS_ABIERTOS, PROPUESTA].includes(o.estado as string)).map((o) => o.id_orden as string));
    const recibidas = new Map<string, number>();
    const mandadas = new Map<string, number>();
    if (idsOrden.length > 0) {
      const { data: renglones } = await supabase
        .from("detalle_reposicion")
        .select("id_orden, id_variante, cantidad_solicitada, cantidad_recibida")
        .in("id_orden", idsOrden);
      for (const r of renglones ?? []) {
        const id = r.id_variante as string;
        const rec = Number(r.cantidad_recibida) || 0;
        recibidas.set(id, (recibidas.get(id) ?? 0) + rec);
        if (abiertas.has(r.id_orden as string)) {
          const falta = (Number(r.cantidad_solicitada) || 0) - rec;
          if (falta > 0) mandadas.set(id, (mandadas.get(id) ?? 0) + falta);
        }
      }
    }

    for (const [id, vend] of vendidas) {
      const dev = devueltas.get(id) ?? 0, rec = recibidas.get(id) ?? 0, man = mandadas.get(id) ?? 0;
      const neto = vend - dev - rec;
      if (neto <= 0) continue; // ya repuesto (o trajo de más)
      const dias = [...(porDia.get(id) ?? new Map()).entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .slice(0, 4)
        .map(([dia, n]) => ({ dia: etiquetaDia(dia, hoy), n }));
      salida.set(id, { idVariante: id, vendidas: vend, devueltas: dev, recibidas: rec, mandadas: man, traer: Math.max(0, neto - man), dias });
    }
  } catch {
    // Un número que no se pudo calcular no puede voltear el portal.
  }
  return salida;
}

/** Total de unidades para traer (para el número del menú y el mail). */
export function totalParaTraer(m: Map<string, VendidoVariante>): number {
  let t = 0;
  for (const v of m.values()) t += v.traer;
  return t;
}
