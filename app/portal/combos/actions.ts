"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionMarca, sesionDelPortal, motivoSinSesionMarca } from "@/lib/marcaSesion";
import { listarCombos, precioSuelto, validarPrecioCombo, validarGrupos, limpiarGrupos, type ComboGestion } from "@/lib/combosGestion";

// Portal de la marca → Mis combos (Gonzalo, 16/11).
// La marca ve sus combos, los pausa o reactiva AL INSTANTE (no cambia el precio
// de nadie), y PIDE cambiar el precio o armar uno nuevo: eso entra a
// Aprobaciones (COMBO_PRECIO / COMBO_NUEVO), igual que los precios de productos.
// El id de marca sale siempre de la sesión, nunca del navegador.

export type ProductoParaCombo = { idProducto: string; nombre: string; precio: number; precioEfectivo: number; imagen: string | null };

export async function misCombos(): Promise<{ combos: ComboGestion[]; productos: ProductoParaCombo[]; soloLectura: boolean } | null> {
  const sesion = await sesionDelPortal();
  if (!sesion) return null;
  const supabase = getSupabaseServerClient();
  const [combos, { data: productos }] = await Promise.all([
    listarCombos(supabase, { idMarca: sesion.idMarca }),
    supabase.from("productos").select("id_producto, nombre, precio_venta, precio_efectivo, imagen").eq("id_marca", sesion.idMarca).eq("estado", "ACTIVO").gt("precio_venta", 0).order("nombre"),
  ]);
  return {
    combos,
    soloLectura: sesion.soloLectura,
    productos: (productos ?? []).map((p) => ({
      idProducto: p.id_producto as string,
      nombre: p.nombre as string,
      precio: Number(p.precio_venta) || 0,
      precioEfectivo: Number(p.precio_efectivo) || Number(p.precio_venta) || 0,
      imagen: (p.imagen as string | null) ?? null,
    })),
  };
}

async function sesionQueGuarda() {
  const sesion = await obtenerSesionMarca();
  if (!sesion) throw new Error(await motivoSinSesionMarca());
  return sesion;
}

/** Pausar o volver a activar un combo suyo. Entra al instante. */
export async function pausarCombo(idCombo: string, pausar: boolean): Promise<{ error: string | null }> {
  try {
    const sesion = await sesionQueGuarda();
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("combos")
      .update({ estado: pausar ? "PAUSADO" : "ACTIVO" })
      .eq("id_combo", idCombo)
      .eq("id_marca", sesion.idMarca)
      .in("estado", pausar ? ["ACTIVO"] : ["PAUSADO"])
      .select("id_combo");
    if (error) return { error: friendlyDbError(error) };
    if (!data || data.length === 0) return { error: "Ese combo no es tuyo o ya estaba así." };
    revalidatePath("/portal/combos");
    revalidatePath("/combos");
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo cambiar el combo." };
  }
}

/** Pedir un precio nuevo para un combo suyo: va a Aprobaciones. */
export async function pedirPrecioCombo(idCombo: string, precio: number, precioEfectivo: number | null): Promise<{ error: string | null }> {
  try {
    const sesion = await sesionQueGuarda();
    const supabase = getSupabaseServerClient();
    const { data: combo } = await supabase.from("combos").select("*").eq("id_combo", idCombo).eq("id_marca", sesion.idMarca).maybeSingle();
    if (!combo || combo.estado === "BORRADO") return { error: "Ese combo no es tuyo." };
    const grupos = limpiarGrupos(combo.grupos);
    const suelto = await precioSuelto(supabase, grupos);
    const mal = validarPrecioCombo(precio, precioEfectivo, suelto);
    if (mal) return { error: mal };
    if (Number(combo.precio) === precio && (combo.precio_efectivo == null ? null : Number(combo.precio_efectivo)) === precioEfectivo) return { error: "Es el mismo precio que tiene hoy." };

    const { count } = await supabase
      .from("solicitudes_marca")
      .select("id_solicitud", { count: "exact", head: true })
      .eq("id_marca", sesion.idMarca)
      .eq("tipo", "COMBO_PRECIO")
      .eq("estado", "PENDIENTE")
      .eq("datos->>id_combo", idCombo);
    if ((count ?? 0) > 0) return { error: "Ya pediste un precio nuevo para este combo y está esperando que WiiGo lo apruebe." };

    const { error } = await supabase.from("solicitudes_marca").insert({
      id_marca: sesion.idMarca,
      tipo: "COMBO_PRECIO",
      id_producto: null,
      estado: "PENDIENTE",
      datos: { id_combo: idCombo, nombre: combo.nombre, precio, precio_efectivo: precioEfectivo, suelto: suelto.lista, suelto_efectivo: suelto.efectivo },
      datos_anteriores: { precio: Number(combo.precio), precio_efectivo: combo.precio_efectivo == null ? null : Number(combo.precio_efectivo) },
      alertas: {},
      solicitada_por: sesion.idUsuario,
    });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/portal/combos");
    revalidatePath("/aprobaciones");
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo mandar." };
  }
}

/** Sube la foto de un combo nuevo y devuelve su dirección (la usa pedirComboNuevo). */
export async function subirFotoCombo(formData: FormData): Promise<{ url?: string; error?: string }> {
  try {
    const sesion = await sesionQueGuarda();
    const archivo = formData.get("archivo") as File | null;
    if (!archivo || archivo.size === 0) return { error: "Elegí una foto primero." };
    if (!archivo.type.startsWith("image/")) return { error: "Eso no es una imagen." };
    if (archivo.size > 8 * 1024 * 1024) return { error: "La foto no puede pesar más de 8 MB." };
    const supabase = getSupabaseServerClient();
    const extension = (archivo.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
    const path = `combos/propuesta-${sesion.idMarca}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from("fotos-productos").upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
    if (error) return { error: error.message };
    return { url: supabase.storage.from("fotos-productos").getPublicUrl(path).data.publicUrl };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo subir la foto." };
  }
}

/** Pedir un combo nuevo con sus productos: va a Aprobaciones. */
export async function pedirComboNuevo(entrada: {
  nombre: string;
  grupos: { cantidad: number; productos: string[] }[];
  precio: number;
  precioEfectivo: number | null;
  imagen: string | null;
}): Promise<{ error: string | null }> {
  try {
    const sesion = await sesionQueGuarda();
    const supabase = getSupabaseServerClient();
    const nombre = String(entrada.nombre ?? "").trim().slice(0, 80);
    if (nombre.length < 3) return { error: "Ponele un nombre al combo." };
    const grupos = limpiarGrupos(entrada.grupos);
    const malGrupos = await validarGrupos(supabase, grupos, sesion.idMarca);
    if (malGrupos) return { error: malGrupos };
    const suelto = await precioSuelto(supabase, grupos);
    const mal = validarPrecioCombo(entrada.precio, entrada.precioEfectivo, suelto);
    if (mal) return { error: mal };

    // Qué lleva, en palabras, para que en Aprobaciones se lea sin abrir nada.
    const ids = [...new Set(grupos.flatMap((g) => g.productos))];
    const { data: prods } = await supabase.from("productos").select("id_producto, nombre").in("id_producto", ids);
    const nombreDe = new Map((prods ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
    const lleva = grupos.map((g) => `${g.cantidad} × ${g.productos.map((id) => nombreDe.get(id) ?? "?").join(" o ")}`).join(" + ");

    const imagen = typeof entrada.imagen === "string" && /^https:\/\//.test(entrada.imagen) ? entrada.imagen : null;
    const { error } = await supabase.from("solicitudes_marca").insert({
      id_marca: sesion.idMarca,
      tipo: "COMBO_NUEVO",
      id_producto: null,
      estado: "PENDIENTE",
      datos: { nombre, grupos, lleva, precio: entrada.precio, precio_efectivo: entrada.precioEfectivo, imagen, suelto: suelto.lista, suelto_efectivo: suelto.efectivo },
      datos_anteriores: {},
      alertas: {},
      solicitada_por: sesion.idUsuario,
    });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/portal/combos");
    revalidatePath("/aprobaciones");
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo mandar." };
  }
}

/** Los combos nuevos que pidió y esperan aprobación (para mostrarlos arriba). */
export async function combosPedidos(): Promise<{ nombre: string; lleva: string; precio: number }[]> {
  const sesion = await sesionDelPortal();
  if (!sesion) return [];
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("solicitudes_marca").select("datos").eq("id_marca", sesion.idMarca).eq("tipo", "COMBO_NUEVO").eq("estado", "PENDIENTE");
  return (data ?? []).map((s) => {
    const d = (s.datos as Record<string, unknown>) ?? {};
    return { nombre: String(d.nombre ?? ""), lleva: String(d.lleva ?? ""), precio: Number(d.precio) || 0 };
  });
}
