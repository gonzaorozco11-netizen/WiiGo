"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { limpiarCodigoBarras, esCodigoInterno } from "@/lib/codigos";
import { mayorCodigoInterno } from "@/lib/codigosVariante";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { CLAVE_SIN_CODIGO, CLAVE_PRODUCTOS_SIN_CODIGO, cargarMarcasSinCodigo, cargarProductosSinCodigo } from "@/lib/marcasSinCodigo";
import { PARAMETRO_CODIGOS_IMPRESOS, cargarCodigosImpresos } from "@/lib/codigosImpresos";

/**
 * Anota que estos productos ya tienen su sticker (al confirmar «Sí, salió bien»,
 * al marcar «Ya tienen sticker», o lo que traía guardado la tablet). Así dejan
 * de figurar en «Sin sticker todavía» en cualquier aparato. Se queda con la
 * fecha más nueva de cada uno.
 */
export async function anotarCodigosImpresos(fechas: Record<string, string>) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "codigos")) return { error: "No tenés permiso para esta pantalla." };
  const supabase = getSupabaseServerClient();
  const actual = await cargarCodigosImpresos(supabase);
  let cambios = 0;
  for (const [id, fecha] of Object.entries(fechas)) {
    if (!/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(Date.parse(fecha))) continue;
    if (!actual[id] || actual[id] < fecha) {
      actual[id] = fecha;
      cambios++;
    }
  }
  if (cambios === 0) return { ok: true as const };
  const { error } = await supabase.from("configuracion").upsert(
    {
      parametro: PARAMETRO_CODIGOS_IMPRESOS,
      valor: JSON.stringify(actual),
      descripcion: "Códigos de barras: qué productos ya tienen su sticker impreso (id_variante → fecha)",
      fecha_actualizacion: new Date().toISOString(),
    },
    { onConflict: "parametro" }
  );
  if (error) return { error: friendlyDbError(error) };
  return { ok: true as const };
}

/**
 * Guarda el código que trae el envase de un producto.
 *
 * Se usa desde la pantalla de Códigos de barras, escaneando de a uno. Lo único
 * delicado es que dos productos no terminen con el mismo código: si pasa, el
 * cliente escanea uno en el tótem y se le carga el otro.
 */
export async function guardarCodigoBarras(idVariante: string, codigo: string) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "codigos")) return { error: "No tenés permiso para cargar códigos." };
  const supabase = getSupabaseServerClient();
  const limpio = limpiarCodigoBarras(codigo);

  // El equipo del local carga el código que falta, pero uno ya cargado lo
  // cambia solo el Dueño (Gonzalo, 2026-11-07): un código pisado por error
  // hace que la caja cobre otro producto.
  if (sesion?.rol !== "admin") {
    const { data: actual } = await supabase.from("variantes_producto").select("codigo_barras").eq("id_variante", idVariante).maybeSingle();
    const ya = (actual?.codigo_barras as string | null)?.trim();
    if (ya && !esCodigoInterno(ya)) return { error: "Ese producto ya tiene su código cargado. Si está mal, avisale a Gonzalo." };
  }

  if (!limpio) return { error: "El código vino vacío." };
  if (limpio.length < 6) return { error: "Ese código es muy corto para ser el de un envase." };
  if (esCodigoInterno(limpio)) {
    return {
      error:
        "Ese es un código de los que genera WiiGo, no uno de fábrica. Si el envase no trae el suyo, dejálo como está y se le imprime etiqueta.",
    };
  }

  const { data: choques } = await supabase
    .from("variantes_producto")
    .select("id_variante, nombre, productos(nombre)")
    .eq("codigo_barras", limpio)
    .limit(2);

  const otro = (choques ?? []).find(
    (v: { id_variante: string }) => v.id_variante !== idVariante
  ) as { nombre: string; productos?: { nombre?: string } | { nombre?: string }[] } | undefined;

  if (otro) {
    const prod = Array.isArray(otro.productos) ? otro.productos[0] : otro.productos;
    const quien = [prod?.nombre, otro.nombre !== "Único" ? otro.nombre : null].filter(Boolean).join(" — ");
    return { error: `Ese código ya lo tiene ${quien || "otro producto"}. Fijate si no escaneaste el envase equivocado.` };
  }

  // Se guarda el código WiiGo que tenía, para devolvérselo si el de fábrica
  // estaba mal: las etiquetas que ya se imprimieron con ese número siguen
  // andando (Gonzalo, 2026-11-09, Almendra Guara escaneada por error).
  const { data: antes } = await supabase.from("variantes_producto").select("codigo_barras").eq("id_variante", idVariante).maybeSingle();
  const anterior = (antes?.codigo_barras as string | null)?.trim();
  if (anterior && esCodigoInterno(anterior)) await recordarCodigoInterno(supabase, idVariante, anterior);

  const { error } = await supabase
    .from("variantes_producto")
    .update({ codigo_barras: limpio })
    .eq("id_variante", idVariante);
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/codigos");
  revalidatePath("/productos");
  return { ok: true as const };
}

/** configuracion → id_variante: el código WiiGo que tenía antes de cargarle uno de fábrica. */
const CLAVE_ANTERIORES = "CODIGOS_INTERNOS_ANTERIORES";

async function leerAnteriores(supabase: ReturnType<typeof getSupabaseServerClient>): Promise<Record<string, string>> {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", CLAVE_ANTERIORES).maybeSingle();
  try {
    return JSON.parse((data?.valor as string | undefined) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

async function recordarCodigoInterno(supabase: ReturnType<typeof getSupabaseServerClient>, idVariante: string, codigo: string) {
  const mapa = await leerAnteriores(supabase);
  mapa[idVariante] = codigo;
  await supabase.from("configuracion").upsert(
    {
      parametro: CLAVE_ANTERIORES,
      valor: JSON.stringify(mapa),
      descripcion: "El código WiiGo que tenía cada producto antes de cargarle el de fábrica: si se saca, vuelve ese (pantalla Códigos de barras).",
      fecha_actualizacion: new Date().toISOString(),
    },
    { onConflict: "parametro" }
  );
}

/** Una marca pasa a imprimir el código WiiGo (sus envases no traen) o vuelve a escanearse. */
export async function marcarMarcaSinCodigo(idMarca: string, sinCodigo: boolean) {
  const sesion = await obtenerSesionConPantallas();
  if (sesion?.rol !== "admin") return { error: "Esto lo cambia solo Gonzalo." };

  const supabase = getSupabaseServerClient();
  const marcas = await cargarMarcasSinCodigo(supabase);
  if (sinCodigo) marcas.add(idMarca);
  else marcas.delete(idMarca);

  const { error } = await supabase.from("configuracion").upsert(
    {
      parametro: CLAVE_SIN_CODIGO,
      valor: JSON.stringify([...marcas]),
      descripcion: "Marcas cuyos envases no traen código de barras: se les imprime el de WiiGo (pantalla Códigos de barras).",
      fecha_actualizacion: new Date().toISOString(),
    },
    { onConflict: "parametro" }
  );
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/codigos");
  return { ok: true as const };
}

/** Un producto suelto que viene cerrado pero sin código: pasa a Imprimir códigos (o vuelve a escanearse). */
export async function marcarProductoSinCodigo(idProducto: string, sinCodigo: boolean) {
  const sesion = await obtenerSesionConPantallas();
  if (sesion?.rol !== "admin") return { error: "Esto lo cambia solo Gonzalo." };

  const supabase = getSupabaseServerClient();
  const productos = await cargarProductosSinCodigo(supabase);
  if (sinCodigo) productos.add(idProducto);
  else productos.delete(idProducto);

  const { error } = await supabase.from("configuracion").upsert(
    {
      parametro: CLAVE_PRODUCTOS_SIN_CODIGO,
      valor: JSON.stringify([...productos]),
      descripcion: "Productos que vienen cerrados pero sin código de barras: se les imprime el de WiiGo (pantalla Códigos de barras).",
      fecha_actualizacion: new Date().toISOString(),
    },
    { onConflict: "parametro" }
  );
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/codigos");
  return { ok: true as const };
}

/**
 * Vuelve a poner el código interno de WiiGo.
 *
 * Para cuando alguien escaneó el envase equivocado, o cuando se decide
 * etiquetar igual un producto que traía código propio (envases importados con
 * códigos que el lector de la tienda no toma, por ejemplo).
 */
export async function volverAEtiquetaWiigo(idVariante: string) {
  const sesion = await obtenerSesionConPantallas();
  if (sesion?.rol !== "admin") return { error: "Un código ya cargado lo saca solo Gonzalo." };
  const supabase = getSupabaseServerClient();

  const { data: existentes } = await supabase.from("variantes_producto").select("codigo_barras");

  // Primero el código WiiGo que tenía antes, si nadie más lo usa: así las
  // etiquetas ya impresas de ese producto siguen andando.
  const anteriores = await leerAnteriores(supabase);
  const anterior = anteriores[idVariante];
  const ocupado = (existentes ?? []).some((e) => (e.codigo_barras as string | null)?.trim() === anterior);
  // Si no, el número sigue al mayor que haya, como en productos/actions.ts:
  // así dos productos nunca comparten etiqueta. Solo el rango interno: los de
  // fábrica no cuentan (ver mayorCodigoInterno).
  const nuevo = anterior && esCodigoInterno(anterior) && !ocupado ? anterior : String(mayorCodigoInterno(existentes ?? []) + 1);

  const { error } = await supabase.from("variantes_producto").update({ codigo_barras: nuevo }).eq("id_variante", idVariante);
  if (error) return { error: friendlyDbError(error) };
  if (anterior) {
    delete anteriores[idVariante];
    await supabase.from("configuracion").update({ valor: JSON.stringify(anteriores), fecha_actualizacion: new Date().toISOString() }).eq("parametro", CLAVE_ANTERIORES);
  }

  revalidatePath("/codigos");
  revalidatePath("/productos");
  return { ok: true as const, codigo: nuevo };
}
