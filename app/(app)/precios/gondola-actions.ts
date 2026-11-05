"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { esRolInterno } from "@/lib/rolesInternos";

// Precios → Góndola: en qué lugar de qué módulo va cada producto. La pantalla
// asesora lo lee para decirle al cliente dónde está (Gonzalo, 2026-10-29).

const FALTA_SQL = "Falta correr sql/gondola.sql en Supabase.";

async function sesionDePrecios() {
  const s = await obtenerSesionConPantallas();
  return s && esRolInterno(s.rol) && puedeVerPantalla(s, "precios") ? s : null;
}

/**
 * Corre un módulo un lugar a la izquierda (-1) o a la derecha (+1), con todo
 * lo que tiene adentro: los productos están atados al módulo, no al número.
 * Así, si en el local se cambia un mueble de lugar, se cambia acá igual
 * (Gonzalo, 2026-11-02). Devuelve el orden nuevo de los módulos.
 */
export async function moverModulo(idModulo: string, direccion: -1 | 1): Promise<{ error: string | null; orden?: string[] }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  if (direccion !== -1 && direccion !== 1) return { error: "Movimiento inválido." };
  const supabase = getSupabaseServerClient();

  const { data: modulo, error: e1 } = await supabase.from("gondola_modulos").select("id_local").eq("id_modulo", idModulo).maybeSingle();
  if (e1) return { error: FALTA_SQL };
  if (!modulo) return { error: "No encontré ese módulo." };
  // Solo se reordenan los módulos de ganchos: las islas y la estantería tienen
  // su lugar fijo en el local. Sin sql/gondola-local-entero.sql no hay tipo y
  // todo es módulo.
  let todos: { id_modulo: string; orden: number; tipo?: string }[] | null = null;
  const conTipo = await supabase.from("gondola_modulos").select("id_modulo, orden, tipo").eq("id_local", modulo.id_local).order("orden");
  if (conTipo.error) {
    const sinTipo = await supabase.from("gondola_modulos").select("id_modulo, orden").eq("id_local", modulo.id_local).order("orden");
    if (sinTipo.error) return { error: "No se pudo leer la góndola. Probá de nuevo." };
    todos = sinTipo.data;
  } else {
    todos = conTipo.data;
  }
  if (!todos) return { error: "No se pudo leer la góndola. Probá de nuevo." };
  const esteTipo = todos.find((m) => m.id_modulo === idModulo)?.tipo ?? "MODULO";
  if (esteTipo !== "MODULO") return { error: "Las islas y la estantería no se mueven: tienen su lugar fijo en el local." };

  const ids = todos.filter((m) => (m.tipo ?? "MODULO") === "MODULO").map((m) => m.id_modulo as string);
  const i = ids.indexOf(idModulo);
  const j = i + direccion;
  if (j < 0 || j >= ids.length) return { error: direccion < 0 ? "Ya es el primero de la izquierda." : "Ya es el último de la derecha." };
  [ids[i], ids[j]] = [ids[j], ids[i]];

  const e3 = await guardarOrden(supabase, ids);
  if (e3) return { error: e3 };
  revalidatePath("/precios");
  revalidatePath("/asesor", "layout");
  return { error: null, orden: ids };
}

/**
 * Numera los módulos 1, 2, 3… en el orden de `ids`. Va en dos pasadas porque
 * la tabla no deja dos módulos del mismo local con el mismo número: primero
 * se corren todos a 1001, 1002… y después a su número final.
 */
async function guardarOrden(supabase: ReturnType<typeof getSupabaseServerClient>, ids: string[]): Promise<string | null> {
  for (const [paso, base] of [[0, 1000], [1, 0]] as const) {
    for (let k = 0; k < ids.length; k++) {
      const { error } = await supabase.from("gondola_modulos").update({ orden: base + k + 1 }).eq("id_modulo", ids[k]);
      if (error) return paso === 0 ? "No se pudo mover. Probá de nuevo." : "Quedó a medio mover. Recargá la página y revisá el orden.";
    }
  }
  return null;
}

/**
 * Pone un producto en un lugar (o lo deja libre, con idProducto null). Si el
 * producto estaba en otro lugar del mismo local, se mueve: está en uno solo.
 * Lo que había en ese lugar queda sin lugar.
 */
export async function ponerEnLugar(idModulo: string, fila: number, columna: number, idProducto: string | null): Promise<{ error: string | null }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  if (!Number.isInteger(fila) || !Number.isInteger(columna) || fila < 0 || columna < 0) return { error: "Ese lugar no existe." };
  const supabase = getSupabaseServerClient();

  const { data: modulo, error: e1 } = await supabase.from("gondola_modulos").select("id_modulo, id_local, filas").eq("id_modulo", idModulo).maybeSingle();
  if (e1) return { error: FALTA_SQL };
  if (!modulo) return { error: "No encontré ese módulo." };
  const filas = Array.isArray(modulo.filas) ? (modulo.filas as { lugares?: number }[]) : [];
  if (fila >= filas.length || columna >= Math.round(Number(filas[fila]?.lugares) || 6)) return { error: "Ese lugar no existe en el módulo." };
  const idLocal = modulo.id_local as string;

  if (idProducto) {
    const { data: prod } = await supabase.from("productos").select("id_producto").eq("id_producto", idProducto).eq("estado", "ACTIVO").maybeSingle();
    if (!prod) return { error: "No encontré ese producto." };
    // Si estaba en otro lado, se mueve.
    await supabase.from("gondola_lugares").delete().eq("id_local", idLocal).eq("id_producto", idProducto);
  }
  // Lo que había en el lugar queda sin lugar.
  const { error: e2 } = await supabase.from("gondola_lugares").delete().eq("id_modulo", idModulo).eq("fila", fila).eq("columna", columna);
  if (e2) return { error: "No se pudo guardar. Probá de nuevo." };
  if (idProducto) {
    const { error: e3 } = await supabase
      .from("gondola_lugares")
      .insert({ id_modulo: idModulo, id_local: idLocal, fila, columna, id_producto: idProducto, actualizado_el: new Date().toISOString() });
    if (e3) return { error: "No se pudo guardar. Probá de nuevo." };
  }
  revalidatePath("/precios");
  revalidatePath("/asesor", "layout");
  return { error: null };
}

/**
 * Marca un lugar como puesto (el producto está en la góndola) o planificado
 * (el lugar es suyo, pero todavía falta ponerlo), con el motivo opcional.
 * La pantalla asesora solo guía al cliente hasta lo puesto (Gonzalo, 2026-11-05).
 */
export async function marcarPuestoLugar(
  idModulo: string,
  fila: number,
  columna: number,
  puesto: boolean,
  motivo: string | null
): Promise<{ error: string | null }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  if (!Number.isInteger(fila) || !Number.isInteger(columna)) return { error: "Ese lugar no existe." };
  const motivoLimpio = puesto ? null : (motivo ?? "").trim().slice(0, 60) || null;
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("gondola_lugares")
    .update({ puesto, motivo_falta: motivoLimpio, actualizado_el: new Date().toISOString() })
    .eq("id_modulo", idModulo)
    .eq("fila", fila)
    .eq("columna", columna)
    .select("id_producto");
  if (error) return { error: /puesto|motivo_falta/.test(error.message) ? "Falta correr sql/gondola-puesto.sql en Supabase." : "No se pudo guardar. Probá de nuevo." };
  if (!data?.length) return { error: "En ese lugar no hay ningún producto." };
  revalidatePath("/precios");
  revalidatePath("/asesor", "layout");
  return { error: null };
}
