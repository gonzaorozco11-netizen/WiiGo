"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { precioSuelto, validarPrecioCombo, validarGrupos, limpiarGrupos } from "@/lib/combosGestion";

// Pantalla Combos del sistema (Gonzalo, 16/11): lo mismo que la marca en su
// portal, pero directo y para todas las marcas. Sin SQL.

async function puede(): Promise<boolean> {
  const sesion = await obtenerSesionConPantallas();
  return puedeVerPantalla(sesion, "combos");
}

function refrescar() {
  revalidatePath("/combos");
  revalidatePath("/portal/combos");
}

export async function guardarPrecioCombo(idCombo: string, precio: number, precioEfectivo: number | null): Promise<{ error: string | null }> {
  if (!(await puede())) return { error: "No tenés permiso para cambiar combos." };
  const supabase = getSupabaseServerClient();
  const { data: combo } = await supabase.from("combos").select("grupos").eq("id_combo", idCombo).maybeSingle();
  if (!combo) return { error: "No encontré ese combo." };
  const mal = validarPrecioCombo(precio, precioEfectivo, await precioSuelto(supabase, limpiarGrupos(combo.grupos)));
  if (mal) return { error: mal };
  const { error } = await supabase.from("combos").update({ precio, precio_efectivo: precioEfectivo }).eq("id_combo", idCombo);
  if (error) return { error: friendlyDbError(error) };
  refrescar();
  return { error: null };
}

export async function cambiarEstadoCombo(idCombo: string, estado: "ACTIVO" | "PAUSADO" | "BORRADO"): Promise<{ error: string | null }> {
  if (!(await puede())) return { error: "No tenés permiso para cambiar combos." };
  if (!["ACTIVO", "PAUSADO", "BORRADO"].includes(estado)) return { error: "Estado no válido." };
  const { error } = await getSupabaseServerClient().from("combos").update({ estado }).eq("id_combo", idCombo);
  if (error) return { error: friendlyDbError(error) };
  refrescar();
  return { error: null };
}

export async function subirFotoComboAdmin(formData: FormData): Promise<{ url?: string; error?: string }> {
  if (!(await puede())) return { error: "No tenés permiso." };
  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) return { error: "Elegí una foto primero." };
  if (!archivo.type.startsWith("image/")) return { error: "Eso no es una imagen." };
  if (archivo.size > 8 * 1024 * 1024) return { error: "La foto no puede pesar más de 8 MB." };
  const supabase = getSupabaseServerClient();
  const extension = (archivo.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `combos/combo-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from("fotos-productos").upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
  if (error) return { error: error.message };
  return { url: supabase.storage.from("fotos-productos").getPublicUrl(path).data.publicUrl };
}

export async function cambiarFotoCombo(idCombo: string, url: string | null): Promise<{ error: string | null }> {
  if (!(await puede())) return { error: "No tenés permiso." };
  if (url && !/^https:\/\//.test(url)) return { error: "Foto no válida." };
  const { error } = await getSupabaseServerClient().from("combos").update({ imagen: url }).eq("id_combo", idCombo);
  if (error) return { error: friendlyDbError(error) };
  refrescar();
  return { error: null };
}

export async function crearCombo(entrada: {
  idMarca: string;
  nombre: string;
  grupos: { cantidad: number; productos: string[] }[];
  precio: number;
  precioEfectivo: number | null;
  imagen: string | null;
}): Promise<{ error: string | null }> {
  if (!(await puede())) return { error: "No tenés permiso para crear combos." };
  const supabase = getSupabaseServerClient();
  const nombre = String(entrada.nombre ?? "").trim().slice(0, 80);
  if (nombre.length < 3) return { error: "Ponele un nombre al combo." };
  const { data: marca } = await supabase.from("marcas").select("id_marca, nombre").eq("id_marca", entrada.idMarca).maybeSingle();
  if (!marca) return { error: "Elegí la marca." };
  const grupos = limpiarGrupos(entrada.grupos);
  const malGrupos = await validarGrupos(supabase, grupos, marca.id_marca as string);
  if (malGrupos) return { error: malGrupos };
  const mal = validarPrecioCombo(entrada.precio, entrada.precioEfectivo, await precioSuelto(supabase, grupos));
  if (mal) return { error: mal };
  const { data: ultimo } = await supabase.from("combos").select("orden").order("orden", { ascending: false }).limit(1);
  const { error } = await supabase.from("combos").insert({
    nombre,
    marca: marca.nombre,
    id_marca: marca.id_marca,
    precio: entrada.precio,
    precio_efectivo: entrada.precioEfectivo,
    imagen: entrada.imagen && /^https:\/\//.test(entrada.imagen) ? entrada.imagen : null,
    grupos,
    orden: (Number(ultimo?.[0]?.orden) || 0) + 1,
    estado: "ACTIVO",
  });
  if (error) return { error: friendlyDbError(error) };
  refrescar();
  return { error: null };
}
