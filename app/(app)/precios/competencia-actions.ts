"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { esRolInterno } from "@/lib/rolesInternos";
import { COMERCIOS, mejorCandidato, type Comercio } from "@/lib/competencia";
import { actualizarCompetencia, filaAItem } from "@/lib/competenciaLeer";
import { nombreBase } from "@/lib/nombreProducto";

// La competencia de Mendoza en Precios: se lee sola cada lunes (cron), y
// Gonzalo solo confirma o descarta el equivalente que propone el sistema.

const FALTA_SQL = "Falta correr sql/precios-competencia.sql en Supabase.";

async function sesionDePrecios() {
  const s = await obtenerSesionConPantallas();
  return s && esRolInterno(s.rol) && puedeVerPantalla(s, "precios") ? s : null;
}
const esComercio = (c: string): c is Comercio => COMERCIOS.some((x) => x.clave === c);

/** "Actualizar ahora": lo mismo que hace el cron del lunes. */
export async function actualizarCompetenciaAhora(): Promise<{ error: string | null; texto?: string }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("competencia_items").select("id_item", { head: true, count: "exact" });
  if (error) return { error: FALTA_SQL };
  const r = await actualizarCompetencia(supabase);
  revalidatePath("/precios");
  const fallaron = COMERCIOS.filter((c) => r.comercios[c.clave]?.error).map((c) => c.nombre);
  return {
    error: null,
    texto: `Listo: ${COMERCIOS.map((c) => `${c.nombre} ${r.comercios[c.clave]?.leidos ?? 0}`).join(" · ")}.${fallaron.length ? ` No se pudo leer: ${fallaron.join(", ")}.` : ""}`,
  };
}

export async function confirmarEquivalente(idProducto: string, comercio: string): Promise<{ error: string | null }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  if (!esComercio(comercio)) return { error: "Ese comercio no existe." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("competencia_vinculos")
    .update({ estado: "CONFIRMADO", actualizado_el: new Date().toISOString() })
    .eq("id_producto", idProducto)
    .eq("comercio", comercio)
    .not("id_item", "is", null);
  if (error) return { error: FALTA_SQL };
  revalidatePath("/precios");
  return { error: null };
}

/** "No es el mismo": se descarta y se propone el siguiente más parecido (si hay). */
export async function descartarEquivalente(idProducto: string, comercio: string): Promise<{ error: string | null }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  if (!esComercio(comercio)) return { error: "Ese comercio no existe." };
  const supabase = getSupabaseServerClient();
  const { data: v, error } = await supabase.from("competencia_vinculos").select("id_item, rechazados").eq("id_producto", idProducto).eq("comercio", comercio).maybeSingle();
  if (error) return { error: FALTA_SQL };
  const rechazados = [...new Set([...((v?.rechazados as string[] | null) ?? []), ...(v?.id_item ? [v.id_item as string] : [])])];
  const [{ data: prod }, { data: items }] = await Promise.all([
    supabase.from("productos").select("nombre, peso_neto_g").eq("id_producto", idProducto).maybeSingle(),
    supabase.from("competencia_items").select("*").eq("comercio", comercio).eq("disponible", true),
  ]);
  const siguiente = prod ? mejorCandidato({ nombre: nombreBase(prod.nombre as string), gramos: Number(prod.peso_neto_g) || null }, (items ?? []).map(filaAItem), rechazados) : null;
  await supabase
    .from("competencia_vinculos")
    .upsert({ id_producto: idProducto, comercio, id_item: siguiente?.id ?? null, estado: "PROPUESTO", rechazados, actualizado_el: new Date().toISOString() }, { onConflict: "id_producto,comercio" });
  revalidatePath("/precios");
  return { error: null };
}
