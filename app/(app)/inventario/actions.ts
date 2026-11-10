"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { localDeSesion } from "@/lib/fraccionado";
import { inventarioAbierto, ZONAS_INVENTARIO } from "@/lib/inventario";
import { fechaHoraArgentina } from "@/lib/horarios";

// Inventario general del local (lib/inventario.ts). Devuelven { error } como
// dato: Next 16 esconde el mensaje de un throw en producción.

const firmaValida = (firma: unknown): firma is string =>
  typeof firma === "string" && firma.length < 200_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(firma);

/** Quien puede contar: el que tiene Inventario o el conteo del turno. */
async function contexto() {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !(puedeVerPantalla(sesion, "inventario") || puedeVerPantalla(sesion, "conteo"))) return { error: "No tenés habilitado el inventario." } as const;
  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) return { error: "Tu usuario no tiene un local asignado." } as const;
  return { sesion, supabase, idLocal } as const;
}

export async function empezarInventario(): Promise<{ error?: string; ok?: true }> {
  const c = await contexto();
  if ("error" in c) return { error: c.error };
  if (c.sesion.rol !== "admin") return { error: "El inventario lo abre Gonzalo." };
  const ya = await inventarioAbierto(c.supabase, c.idLocal);
  if (ya === "SIN_SQL") return { error: "Falta correr sql/inventario.sql en Supabase." };
  if (ya) return { ok: true };
  const { error } = await c.supabase.from("inventarios").insert({ id_local: c.idLocal, creado_por: c.sesion.nombre });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/inventario");
  return { ok: true };
}

/** Lo que hay de un producto en un lugar. Se puede corregir: pisa lo anterior de ese lugar. */
export async function guardarConteoInventario(idVariante: string, zona: string, cantidad: number): Promise<{ error?: string; ok?: true }> {
  const n = Math.round(Number(cantidad));
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999) return { error: "Poné cuántos hay (0 si no hay)." };
  if (!(ZONAS_INVENTARIO as readonly string[]).includes(zona)) return { error: "Elegí dónde estás contando." };
  const c = await contexto();
  if ("error" in c) return { error: c.error };
  const inv = await inventarioAbierto(c.supabase, c.idLocal);
  if (!inv || inv === "SIN_SQL") return { error: "No hay un inventario abierto." };
  const { error } = await c.supabase
    .from("inventario_conteos")
    .upsert(
      { id_inventario: inv.id, id_variante: idVariante, zona, cantidad: n, contado_por: c.sesion.nombre, contado_en: new Date().toISOString() },
      { onConflict: "id_inventario,id_variante,zona" }
    );
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/inventario");
  return { ok: true };
}

/** «Terminé mi parte»: firma lo que contó (los lugares y cuántos productos). */
export async function firmarInventario(firma: string | null): Promise<{ error?: string; ok?: true }> {
  if (!firmaValida(firma)) return { error: "Firmá con el dedo en el recuadro." };
  const c = await contexto();
  if ("error" in c) return { error: c.error };
  const inv = await inventarioAbierto(c.supabase, c.idLocal);
  if (!inv || inv === "SIN_SQL") return { error: "No hay un inventario abierto." };
  const { data: mios } = await c.supabase.from("inventario_conteos").select("id_variante, zona").eq("id_inventario", inv.id).eq("contado_por", c.sesion.nombre);
  if (!mios?.length) return { error: "Todavía no contaste nada." };
  const zonas = [...new Set(mios.map((m) => m.zona as string))].join(", ");
  const { error } = await c.supabase.from("inventario_firmas").insert({
    id_inventario: inv.id,
    id_usuario: c.sesion.idUsuario,
    nombre: c.sesion.nombre,
    zonas,
    productos: new Set(mios.map((m) => m.id_variante as string)).size,
    firma,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/inventario");
  return { ok: true };
}

/**
 * Carga el stock con lo contado: cada producto queda con la suma de todos los
 * lugares, menos lo que se vendió después de que se empezó a contar ese
 * producto (así se puede contar con el local abierto). Lo que no contó nadie
 * queda como estaba, o en 0 si se pidió.
 */
export async function cerrarInventario(noContadosEnCero: boolean): Promise<{ error?: string; ok?: true; cargados?: number; enCero?: number }> {
  const c = await contexto();
  if ("error" in c) return { error: c.error };
  if (c.sesion.rol !== "admin") return { error: "El inventario lo cierra Gonzalo." };
  const { supabase, idLocal } = c;
  const inv = await inventarioAbierto(supabase, idLocal);
  if (!inv || inv === "SIN_SQL") return { error: "No hay un inventario abierto." };

  const { data: conteos } = await supabase.from("inventario_conteos").select("id_variante, cantidad, contado_en").eq("id_inventario", inv.id).range(0, 9999);
  const porVariante = new Map<string, { total: number; desde: string }>();
  for (const x of conteos ?? []) {
    const id = x.id_variante as string;
    const prev = porVariante.get(id);
    const cuando = x.contado_en as string;
    porVariante.set(id, { total: (prev?.total ?? 0) + Number(x.cantidad), desde: prev && prev.desde < cuando ? prev.desde : cuando });
  }

  // Lo vendido desde que se empezó a contar cada producto.
  const { data: ventas } = await supabase.from("ventas").select("id_venta, fecha").eq("estado", "PAGADA").eq("id_local", idLocal).gte("fecha", inv.desde);
  const fechaVenta = new Map((ventas ?? []).map((v) => [v.id_venta as string, v.fecha as string]));
  const vendidoDespues = new Map<string, number>();
  const ids = [...fechaVenta.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: det } = await supabase.from("detalle_ventas").select("id_venta, id_variante, cantidad").in("id_venta", ids.slice(i, i + 200));
    for (const d of det ?? []) {
      const conteo = porVariante.get(d.id_variante as string);
      if (conteo && (fechaVenta.get(d.id_venta as string) ?? "") > conteo.desde) {
        vendidoDespues.set(d.id_variante as string, (vendidoDespues.get(d.id_variante as string) ?? 0) + Number(d.cantidad ?? 0));
      }
    }
  }

  const { data: stockActual } = await supabase.from("stock").select("id_variante, cantidad").eq("id_local", idLocal).range(0, 9999);
  const hay = new Map((stockActual ?? []).map((s) => [s.id_variante as string, Number(s.cantidad ?? 0)]));
  const dia = fechaHoraArgentina().fecha.split("-").reverse().slice(0, 2).join("/");
  const ahora = new Date().toISOString();
  const quien = c.sesion.nombre;
  const movimientos: Record<string, unknown>[] = [];
  const filasStock: Record<string, unknown>[] = [];

  for (const [idVariante, { total }] of porVariante) {
    const vendido = vendidoDespues.get(idVariante) ?? 0;
    const final = Math.max(0, total - vendido);
    const antes = hay.get(idVariante) ?? 0;
    filasStock.push({ id_variante: idVariante, id_local: idLocal, cantidad: final, fecha_actualizacion: ahora });
    if (final !== antes) {
      movimientos.push({
        id_variante: idVariante,
        id_local: idLocal,
        tipo: "AJUSTE",
        cantidad: final - antes,
        motivo: `Inventario del ${dia}: se contaron ${total}${vendido ? `, se vendieron ${vendido} después` : ""}`,
        usuario: quien,
      });
    }
  }

  let enCero = 0;
  if (noContadosEnCero) {
    for (const [idVariante, antes] of hay) {
      if (porVariante.has(idVariante) || antes === 0) continue;
      filasStock.push({ id_variante: idVariante, id_local: idLocal, cantidad: 0, fecha_actualizacion: ahora });
      movimientos.push({ id_variante: idVariante, id_local: idLocal, tipo: "AJUSTE", cantidad: -antes, motivo: `Inventario del ${dia}: no se encontró`, usuario: quien });
      enCero++;
    }
  }

  for (let i = 0; i < filasStock.length; i += 300) {
    const { error } = await supabase.from("stock").upsert(filasStock.slice(i, i + 300), { onConflict: "id_variante,id_local" });
    if (error) return { error: friendlyDbError(error) };
  }
  for (let i = 0; i < movimientos.length; i += 300) await supabase.from("movimientos_stock").insert(movimientos.slice(i, i + 300));

  await supabase.from("inventarios").update({ estado: "CERRADO", cerrado_por: quien, cerrado_en: ahora }).eq("id_inventario", inv.id);
  revalidatePath("/inventario");
  revalidatePath("/stock");
  return { ok: true, cargados: porVariante.size, enCero };
}
