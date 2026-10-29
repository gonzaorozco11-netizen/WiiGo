"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { esRolInterno } from "@/lib/rolesInternos";
import { leerListaAlifrut, type UnidadLista } from "@/lib/listaAlifrut";
import { mercaderiaDe, type Granel } from "@/lib/calculoPrecio";
import { CLAVES_PRECIOS } from "@/lib/configPrecios";
import { generarCodigoBarrasVariante, generarSkuVariante } from "@/lib/codigosVariante";
import { pasarALaVenta } from "@/app/(app)/precios/actions";
import { CLAVES_ALIFRUT, granelDesdeItem } from "@/lib/catalogoProveedor";
import { nombreConTamano } from "@/lib/nombreProducto";

// La lista exclusiva de Alifrut adentro de Precios (Gonzalo, 2026-10-29):
// se trae pegándola (hasta que Alifrut pase un link privado), se vincula cada
// producto de WiiGo con uno de la lista, y cuando la lista cambia se aprueba
// con un clic. Ver lib/listaAlifrut.ts y sql/precios-alifrut.sql.

type Supa = ReturnType<typeof getSupabaseServerClient>;
const FALTA_SQL = "Falta correr sql/precios-alifrut.sql en Supabase.";

async function sesionDePrecios() {
  const s = await obtenerSesionConPantallas();
  return s && esRolInterno(s.rol) && puedeVerPantalla(s, "precios") ? s : null;
}

async function idAlifrut(supabase: Supa) {
  const { data } = await supabase.from("proveedores").select("id_proveedor").ilike("nombre", "%alifrut%").limit(1).maybeSingle();
  return (data?.id_proveedor as string | undefined) ?? null;
}

async function guardarConfig(supabase: Supa, valores: Record<string, string>) {
  const ahora = new Date().toISOString();
  await supabase.from("configuracion").upsert(
    Object.entries(valores).map(([parametro, valor]) => ({ parametro, valor, fecha_actualizacion: ahora })),
    { onConflict: "parametro" }
  );
}

export type ResumenLista = { leidos: number; nuevos: number; cambiaron: number; cambiaronQueUsas: number; fecha: string | null };

/** Lo que pegó Gonzalo de su lista de Alifrut: actualiza el catálogo y marca lo que cambió. */
export async function importarListaAlifrut(texto: string): Promise<{ error: string | null; resumen?: ResumenLista }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  const { fecha, items } = leerListaAlifrut(String(texto ?? ""));
  if (items.length < 10) {
    return { error: "No encontré la lista. En Alifrut abrí «Lista de precios» antes de apretar Ctrl+A y Ctrl+C." };
  }
  const supabase = getSupabaseServerClient();
  const idProveedor = await idAlifrut(supabase);
  if (!idProveedor) return { error: "No encontré a Alifrut en Proveedores. Cargalo ahí con ese nombre." };

  const { data: existentes, error } = await supabase
    .from("catalogo_proveedor")
    .select("id_item, clave, costo_neto, costo_anterior, costo_cambio_el, unidad, cantidad, unidad_revisada")
    .eq("id_proveedor", idProveedor);
  if (error) return { error: FALTA_SQL };
  const porClave = new Map((existentes ?? []).map((e) => [e.clave as string, e]));

  const ahora = new Date().toISOString();
  let nuevos = 0;
  const cambiados: string[] = [];
  const filas = items.map((it) => {
    const e = porClave.get(it.clave);
    if (!e) nuevos++;
    const cambio = e != null && Math.abs(Number(e.costo_neto) - it.costoNeto) >= 0.01;
    if (cambio) cambiados.push(e.id_item as string);
    const fijada = e?.unidad_revisada === true;
    return {
      id_proveedor: idProveedor,
      clave: it.clave,
      categoria: it.categoria,
      nombre: it.nombre,
      marca: it.marca,
      presentacion: it.presentacion,
      // Lo que Gonzalo corrigió a mano ("la caja trae 12") no se pisa.
      unidad: fijada ? e.unidad : it.unidad,
      cantidad: fijada ? e.cantidad : it.cantidad,
      unidad_revisada: fijada || it.segura,
      costo_neto: it.costoNeto,
      precio_final: it.precioFinal,
      costo_anterior: cambio ? Number(e.costo_neto) : e?.costo_anterior ?? null,
      costo_cambio_el: cambio ? ahora : e?.costo_cambio_el ?? null,
      visto_el: ahora,
    };
  });
  for (let i = 0; i < filas.length; i += 400) {
    const { error: err } = await supabase.from("catalogo_proveedor").upsert(filas.slice(i, i + 400), { onConflict: "id_proveedor,clave" });
    if (err) return { error: "No se pudo guardar la lista. Probá de nuevo." };
  }

  let cambiaronQueUsas = 0;
  if (cambiados.length) {
    const { count } = await supabase.from("costos_granel").select("id_granel", { count: "exact", head: true }).in("id_item", cambiados);
    cambiaronQueUsas = count ?? 0;
  }
  await guardarConfig(supabase, { [CLAVES_ALIFRUT.listaDel]: fecha ?? ahora.slice(0, 10), [CLAVES_ALIFRUT.traidaEl]: ahora });
  revalidatePath("/precios");
  return { error: null, resumen: { leidos: items.length, nuevos, cambiaron: cambiados.length, cambiaronQueUsas, fecha } };
}

/** Corrige cómo viene un producto ("caja de 12", "bolsa de 3 kg"). Lo que sale de él se recalcula. */
export async function guardarUnidadItem(idItem: string, unidad: UnidadLista, cantidad: number | string): Promise<{ error: string | null }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  if (!["KG", "BOLSA", "CAJA", "UNIDAD"].includes(unidad)) return { error: "Esa forma de venir no existe." };
  const n = unidad === "KG" || unidad === "UNIDAD" ? 1 : Number(String(cantidad).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return { error: unidad === "CAJA" ? "Poné cuántas unidades trae la caja." : "Poné cuántos kg trae la bolsa." };
  const supabase = getSupabaseServerClient();
  const { data: item, error } = await supabase
    .from("catalogo_proveedor")
    .update({ unidad, cantidad: n, unidad_revisada: true })
    .eq("id_item", idItem)
    .select("id_item, nombre, costo_neto, unidad, cantidad")
    .maybeSingle();
  if (error || !item) return { error: FALTA_SQL };

  const ahora = new Date().toISOString();
  const { data: graneles } = await supabase.from("costos_granel").select("id_granel, costo_neto").eq("id_item", idItem);
  for (const g of graneles ?? []) {
    const nuevo = granelDesdeItem({ ...item, costo_neto: Number(g.costo_neto) });
    await supabase.from("costos_granel").update({ unidad: nuevo.unidad, kg_bulto: nuevo.kgBulto }).eq("id_granel", g.id_granel);
    await recalcularHijos(supabase, { ...nuevo, id: g.id_granel as string }, ahora);
  }
  revalidatePath("/precios");
  return { error: null };
}

async function recalcularHijos(supabase: Supa, g: Granel, ahora: string) {
  const { data: hijos } = await supabase.from("productos").select("id_producto, peso_neto_g").eq("id_granel", g.id);
  for (const h of hijos ?? []) {
    const merc = mercaderiaDe(g, Number(h.peso_neto_g ?? 0) || null);
    if (merc != null) await supabase.from("productos").update({ costo_informado: Math.round(merc * 100) / 100, costo_actualizado_el: ahora }).eq("id_producto", h.id_producto);
  }
}

/** El costo que usa WiiGo para ese producto de Alifrut; si todavía no existe, se crea con el de la lista. */
async function granelDelItem(supabase: Supa, idItem: string) {
  const { data: ya } = await supabase.from("costos_granel").select("id_granel").eq("id_item", idItem).limit(1).maybeSingle();
  if (ya) return ya.id_granel as string;
  const { data: item } = await supabase.from("catalogo_proveedor").select("id_item, id_proveedor, nombre, marca, costo_neto, unidad, cantidad").eq("id_item", idItem).maybeSingle();
  if (!item) return null;
  const g = granelDesdeItem(item);
  const { data, error } = await supabase
    .from("costos_granel")
    .insert({ nombre: item.nombre, id_proveedor: item.id_proveedor, costo_neto: g.costo, unidad: g.unidad, kg_bulto: g.kgBulto, id_item: idItem })
    .select("id_granel")
    .single();
  return error || !data ? null : (data.id_granel as string);
}

export type Tamano = { gramos: number | null; idEnvase: string | null };

/**
 * Une un producto de Alifrut con productos de WiiGo: crea los tamaños que se
 * eligieron (quedan "Sin precio", fuera de la venta, hasta pasarlos) y/o une
 * uno que ya existe.
 */
export async function vincularItem(
  idItem: string,
  opciones: { tamanos: Tamano[]; idSubcategoria: string | null; idProductoExistente: string | null; nombre?: string | null }
): Promise<{ error: string | null; creados?: number }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  const tamanos = (opciones.tamanos ?? []).slice(0, 8);
  if (!tamanos.length && !opciones.idProductoExistente) return { error: "Elegí un tamaño o un producto tuyo." };
  const supabase = getSupabaseServerClient();
  const idGranel = await granelDelItem(supabase, idItem);
  if (!idGranel) return { error: FALTA_SQL };
  const { data: gFila } = await supabase.from("costos_granel").select("id_granel, nombre, costo_neto, unidad, kg_bulto").eq("id_granel", idGranel).single();
  if (!gFila) return { error: FALTA_SQL };
  const granel: Granel = { id: idGranel, nombre: gFila.nombre, costo: Number(gFila.costo_neto), unidad: gFila.unidad === "BULTO" || gFila.unidad === "CAJA" ? gFila.unidad : "KG", kgBulto: gFila.kg_bulto == null ? null : Number(gFila.kg_bulto) };
  const ahora = new Date().toISOString();

  if (opciones.idProductoExistente) {
    const { data: p } = await supabase.from("productos").select("id_producto, marcas(tipo_comercializacion)").eq("id_producto", opciones.idProductoExistente).maybeSingle();
    if ((p?.marcas as unknown as { tipo_comercializacion: string } | null)?.tipo_comercializacion !== "PROPIA") return { error: "Ese producto no es de WiiGo Dietética." };
    await supabase.from("productos").update({ id_granel: idGranel }).eq("id_producto", opciones.idProductoExistente);
  }

  let creados = 0;
  if (tamanos.length) {
    const { data: marca } = await supabase.from("marcas").select("id_marca").eq("tipo_comercializacion", "PROPIA").order("nombre").limit(1).maybeSingle();
    if (!marca) return { error: "No hay una marca propia cargada." };
    const { data: envases } = await supabase.from("envases").select("id_envase, costo");
    const { data: et } = await supabase.from("configuracion").select("valor").eq("parametro", CLAVES_PRECIOS.etiqueta).maybeSingle();
    const etiqueta = Number(et?.valor ?? 0) || 0;
    for (const t of tamanos) {
      const gramos = granel.unidad === "CAJA" ? null : t.gramos && t.gramos > 0 ? Math.round(t.gramos) : null;
      if (granel.unidad !== "CAJA" && !gramos) continue;
      // El nombre que eligió Gonzalo; si no puso ninguno, el de Alifrut.
      const base = String(opciones.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || (gFila.nombre as string);
      const nombre = nombreConTamano(base, gramos);
      const env = t.idEnvase ? (envases ?? []).find((e) => e.id_envase === t.idEnvase) : null;
      const merc = mercaderiaDe(granel, gramos);
      const { data: prod, error } = await supabase
        .from("productos")
        .insert({
          id_marca: marca.id_marca,
          id_subcategoria: opciones.idSubcategoria || null,
          nombre,
          peso_neto_g: gramos,
          id_granel: idGranel,
          id_envase: env ? env.id_envase : null,
          costos_extra: env ? Number(env.costo) + etiqueta : 0,
          costo_informado: merc != null ? Math.round(merc * 100) / 100 : null,
          costo_actualizado_el: ahora,
        })
        .select("id_producto")
        .single();
      if (error || !prod) return { error: `No se pudo crear «${nombre}». Probá de nuevo.`, creados };
      const sku = await generarSkuVariante(supabase, marca.id_marca as string);
      const codigo = await generarCodigoBarrasVariante(supabase);
      await supabase.from("variantes_producto").insert({ id_producto: prod.id_producto, nombre: "Único", sku, codigo_barras: codigo, stock_minimo: 3, stock_objetivo: 5 });
      creados++;
    }
  }
  await recalcularHijos(supabase, granel, ahora);
  revalidatePath("/precios");
  revalidatePath("/productos");
  return { error: null, creados };
}

/** Suelta un producto de WiiGo de su producto de Alifrut (queda con el último costo). */
export async function desvincularProducto(idProducto: string): Promise<{ error: string | null }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("productos").update({ id_granel: null }).eq("id_producto", idProducto);
  if (error) return { error: "No se pudo desvincular." };
  revalidatePath("/precios");
  return { error: null };
}

/**
 * "Actualizar": pasa el costo nuevo de Alifrut a lo que usa WiiGo, recalcula
 * todos los tamaños y los pasa a la venta (precio, historial y carteles).
 */
export async function aplicarCambiosAlifrut(idsGranel: string[]): Promise<{ error: string | null; costos?: number; precios?: number }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  if (!Array.isArray(idsGranel) || !idsGranel.length) return { error: "No elegiste ningún cambio." };
  const supabase = getSupabaseServerClient();
  const { data: graneles, error } = await supabase
    .from("costos_granel")
    .select("id_granel, costo_neto, id_item, catalogo_proveedor(id_item, nombre, costo_neto, unidad, cantidad)")
    .in("id_granel", idsGranel);
  if (error) return { error: FALTA_SQL };
  const ahora = new Date().toISOString();
  let costos = 0;
  const productos: string[] = [];
  for (const g of graneles ?? []) {
    const item = g.catalogo_proveedor as unknown as { id_item: string; nombre: string; costo_neto: number; unidad: UnidadLista; cantidad: number | null } | null;
    if (!item) continue;
    const nuevo = granelDesdeItem(item);
    if (Math.abs(nuevo.costo - Number(g.costo_neto)) < 0.01) continue;
    await supabase
      .from("costos_granel")
      .update({ costo_neto: nuevo.costo, unidad: nuevo.unidad, kg_bulto: nuevo.kgBulto, costo_anterior: Number(g.costo_neto), costo_actualizado_el: ahora })
      .eq("id_granel", g.id_granel);
    await recalcularHijos(supabase, { ...nuevo, id: g.id_granel as string }, ahora);
    costos++;
    // Los que todavía están "Sin precio" no se pasan solos: los revisa Gonzalo la primera vez.
    const { data: hijos } = await supabase.from("productos").select("id_producto").eq("id_granel", g.id_granel).eq("estado", "ACTIVO").gt("precio_venta", 0);
    productos.push(...(hijos ?? []).map((h) => h.id_producto as string));
  }
  let precios = 0;
  if (productos.length) {
    const r = await pasarALaVenta(productos);
    if (r.error) return { error: `Los costos se actualizaron, pero no se pudieron pasar los precios: ${r.error}`, costos };
    precios = r.cambiados ?? 0;
  }
  revalidatePath("/precios");
  return { error: null, costos, precios };
}
