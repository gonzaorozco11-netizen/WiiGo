"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { localDeSesion } from "@/lib/fraccionado";
import { inventarioAbierto, ZONAS_INVENTARIO } from "@/lib/inventario";
import { fechaHoraArgentina } from "@/lib/horarios";
import { minMaxAlColgar } from "@/lib/minimosGancho";

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

// ===================== Dónde está cada producto =====================

/** Pone el producto en ese lugar (sale de donde estaba; lo que había ahí queda sin lugar). */
async function aplicarLugar(supabase: ReturnType<typeof getSupabaseServerClient>, idLocal: string, idModulo: string, fila: number, columna: number, idProducto: string) {
  await supabase.from("gondola_lugares").delete().eq("id_local", idLocal).eq("id_producto", idProducto);
  await supabase.from("gondola_lugares").delete().eq("id_modulo", idModulo).eq("fila", fila).eq("columna", columna);
  const r = await supabase
    .from("gondola_lugares")
    .insert({ id_modulo: idModulo, id_local: idLocal, fila, columna, id_producto: idProducto, puesto: true, actualizado_el: new Date().toISOString() });
  // Colgado en un gancho: mínimo 5 y máximo 8 (lib/minimosGancho.ts).
  if (!r.error) await minMaxAlColgar(supabase, idModulo, idProducto);
  return r;
}

async function lugarDeProducto(supabase: ReturnType<typeof getSupabaseServerClient>, idLocal: string, idProducto: string) {
  const { data } = await supabase.from("gondola_lugares").select("id_modulo, fila, columna").eq("id_local", idLocal).eq("id_producto", idProducto).maybeSingle();
  return data as { id_modulo: string; fila: number; columna: number } | null;
}

/** «✓ Sí, está acá»: el plano coincide. Si figuraba «falta poner», pasa a puesto. */
export async function confirmarUbicacion(idProducto: string, texto: string): Promise<{ error?: string; ok?: true }> {
  const c = await contexto();
  if ("error" in c) return { error: c.error };
  const lugar = await lugarDeProducto(c.supabase, c.idLocal, idProducto);
  if (!lugar) return { error: "Ese producto no tiene lugar en la góndola." };
  await c.supabase.from("gondola_lugares").update({ puesto: true, motivo_falta: null }).eq("id_modulo", lugar.id_modulo).eq("fila", lugar.fila).eq("columna", lugar.columna);
  const inv = await inventarioAbierto(c.supabase, c.idLocal);
  const { error } = await c.supabase.from("inventario_ubicaciones").insert({
    id_inventario: inv && inv !== "SIN_SQL" ? inv.id : null,
    id_local: c.idLocal,
    id_producto: idProducto,
    accion: "CONFIRMADO",
    hacia: texto,
    quien: c.sesion.nombre,
  });
  if (error) return { error: "Falta correr sql/inventario-ubicaciones.sql en Supabase." };
  revalidatePath("/inventario");
  return { ok: true };
}

/**
 * Dónde está de verdad. Si no tenía lugar, queda ubicado ahí. Si tenía otro,
 * el plano no se toca: le queda a Gonzalo para decidir (dejarlo o moverlo).
 */
export async function ubicarProducto(
  idProducto: string,
  idModulo: string,
  fila: number,
  columna: number,
  hacia: string,
  desde: string | null
): Promise<{ error?: string; ok?: true; pendiente?: boolean }> {
  if (!Number.isInteger(fila) || !Number.isInteger(columna) || fila < 0 || columna < 0) return { error: "Ese lugar no existe." };
  const c = await contexto();
  if ("error" in c) return { error: c.error };
  const { supabase, idLocal } = c;
  const { data: modulo } = await supabase.from("gondola_modulos").select("id_local, filas").eq("id_modulo", idModulo).maybeSingle();
  const filas = Array.isArray(modulo?.filas) ? (modulo!.filas as { lugares?: number }[]) : [];
  if (!modulo || modulo.id_local !== idLocal || fila >= filas.length || columna >= Math.round(Number(filas[fila]?.lugares) || 6)) return { error: "Ese lugar no existe en el mueble." };
  const { data: ocupa } = await supabase.from("gondola_lugares").select("id_producto, productos(nombre)").eq("id_modulo", idModulo).eq("fila", fila).eq("columna", columna).maybeSingle();
  if (ocupa && ocupa.id_producto !== idProducto) {
    const nombre = (ocupa.productos as unknown as { nombre: string } | null)?.nombre ?? "otro producto";
    return { error: `Ese lugar es de ${nombre}. Si de verdad está ahí, avisale a Gonzalo.` };
  }

  const actual = await lugarDeProducto(supabase, idLocal, idProducto);
  const inv = await inventarioAbierto(supabase, idLocal);
  const base = { id_inventario: inv && inv !== "SIN_SQL" ? inv.id : null, id_local: idLocal, id_producto: idProducto, hacia, id_modulo: idModulo, fila, columna, quien: c.sesion.nombre };

  if (!actual) {
    const r = await aplicarLugar(supabase, idLocal, idModulo, fila, columna, idProducto);
    if (r.error) return { error: "No se pudo guardar el lugar. Probá de nuevo." };
    await supabase.from("inventario_ubicaciones").insert({ ...base, accion: "NUEVO" });
    revalidatePath("/inventario");
    revalidatePath("/gondola");
    return { ok: true };
  }
  if (actual.id_modulo === idModulo && actual.fila === fila && actual.columna === columna) return confirmarUbicacion(idProducto, hacia);

  const { error } = await supabase.from("inventario_ubicaciones").insert({ ...base, accion: "MOVIDO", desde, estado: "PENDIENTE" });
  if (error) return { error: "Falta correr sql/inventario-ubicaciones.sql en Supabase." };
  revalidatePath("/inventario");
  return { ok: true, pendiente: true };
}

/** Gonzalo decide un «está en otro lugar»: dejarlo ahí (se actualiza el plano) o que lo muevan a su lugar. */
export async function resolverUbicacion(idUbicacion: string, dejarloAhi: boolean): Promise<{ error?: string; ok?: true }> {
  const c = await contexto();
  if ("error" in c) return { error: c.error };
  if (c.sesion.rol !== "admin") return { error: "Esto lo decide Gonzalo." };
  const { supabase, idLocal } = c;
  const { data: u } = await supabase.from("inventario_ubicaciones").select("*").eq("id_ubicacion", idUbicacion).maybeSingle();
  if (!u || u.estado !== "PENDIENTE") return { error: "Ya estaba resuelto." };
  if (dejarloAhi) {
    const r = await aplicarLugar(supabase, idLocal, u.id_modulo as string, Number(u.fila), Number(u.columna), u.id_producto as string);
    if (r.error) return { error: "No se pudo actualizar el plano." };
  } else {
    // Queda en su lugar del plano, marcado «falta poner» con la indicación: así lo ve el equipo en Góndola.
    const lugar = await lugarDeProducto(supabase, idLocal, u.id_producto as string);
    if (lugar) {
      await supabase
        .from("gondola_lugares")
        .update({ puesto: false, motivo_falta: `Moverlo acá: está en ${u.hacia}` })
        .eq("id_modulo", lugar.id_modulo)
        .eq("fila", lugar.fila)
        .eq("columna", lugar.columna);
    }
  }
  await supabase.from("inventario_ubicaciones").update({ estado: dejarloAhi ? "APLICADA" : "DESCARTADA" }).eq("id_ubicacion", idUbicacion);
  revalidatePath("/inventario");
  revalidatePath("/gondola");
  return { ok: true };
}

/** «Terminé mi parte»: firma lo que contó (los lugares y cuántos productos). */
export async function firmarInventario(firma: string | null): Promise<{ error?: string; ok?: true }> {
  if (!firmaValida(firma)) return { error: "Firmá con el dedo en el recuadro." };
  const c = await contexto();
  if ("error" in c) return { error: c.error };
  const inv = await inventarioAbierto(c.supabase, c.idLocal);
  if (!inv || inv === "SIN_SQL") return { error: "No hay un inventario abierto." };
  // Se firma por tanda: lo contado desde la última firma (antes se firmaba una
  // sola vez y lo que contaban después en otro módulo quedaba sin firmar).
  const { data: firmasMias } = await c.supabase
    .from("inventario_firmas")
    .select("firmado_en")
    .eq("id_inventario", inv.id)
    .eq("nombre", c.sesion.nombre)
    .order("firmado_en", { ascending: false })
    .limit(1);
  let consulta = c.supabase.from("inventario_conteos").select("id_variante, zona").eq("id_inventario", inv.id).eq("contado_por", c.sesion.nombre);
  if (firmasMias?.[0]) consulta = consulta.gt("contado_en", firmasMias[0].firmado_en as string);
  const { data: mios } = await consulta;
  if (!mios?.length) return { error: firmasMias?.[0] ? "Ya firmaste todo lo que contaste." : "Todavía no contaste nada." };
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
