"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { esRolInterno } from "@/lib/rolesInternos";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { calcularPrecio, mercaderiaDe, MEDIOS, type Granel, type Medio, type Descuenta } from "@/lib/calculoPrecio";
import { CLAVES_PRECIOS } from "@/lib/configPrecios";
import { nombreConTamano } from "@/lib/nombreProducto";
import { cargarDatosPrecios } from "@/lib/datosPrecios";
import { calcularTablero } from "@/app/(app)/resultado-mes/actions";

// Módulo Precios: lo que compra WiiGo (marcas PROPIAS). Todo se guarda solo
// mientras se escribe; lo único que cambia lo que se cobra en el local es
// "Pasar a la venta", y ese recalcula todo acá con lib/calculoPrecio.ts.

type Resultado = { error: string | null };
const FALTA_SQL = "Falta correr sql/precios.sql en Supabase.";

async function sesionDePrecios() {
  const s = await obtenerSesionConPantallas();
  return s && esRolInterno(s.rol) && puedeVerPantalla(s, "precios") ? s : null;
}

// Acepta 14508.74, "14.508,74" y "14.508". Devuelve undefined si es inválido.
const numeroONull = (v: unknown, min = 0, max = Infinity) => {
  if (v === null || v === undefined || v === "") return null;
  let t = String(v).trim();
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/** Lo que cuesta la etiqueta de cada bolsita (Costos de compra → Bolsitas y etiquetas). */
async function costoEtiqueta(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", CLAVES_PRECIOS.etiqueta).maybeSingle();
  const n = Number(data?.valor ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * costos_extra de cada producto embolsado = bolsita + etiqueta. Es lo que
 * miran Rentabilidad y el resto del sistema; se rehace cuando cambia una de
 * las dos.
 */
async function sincronizarBolsitas(supabase: ReturnType<typeof getSupabaseServerClient>, idEnvase?: string) {
  const etiqueta = await costoEtiqueta(supabase);
  let q = supabase.from("envases").select("id_envase, costo");
  if (idEnvase) q = q.eq("id_envase", idEnvase);
  const { data: envases } = await q;
  for (const e of envases ?? []) {
    await supabase.from("productos").update({ costos_extra: Number(e.costo) + etiqueta }).eq("id_envase", e.id_envase);
  }
}

const unidadGranel = (u: unknown): Granel["unidad"] => (u === "BULTO" || u === "CAJA" ? u : "KG");
function granelDeFila(id: string, g: { costo_neto: unknown; unidad: unknown; kg_bulto: unknown }): Granel {
  return { id, nombre: "", costo: Number(g.costo_neto), unidad: unidadGranel(g.unidad), kgBulto: g.kg_bulto == null ? null : Number(g.kg_bulto) };
}

/** Rehace el costo por unidad (costo_informado) de todos los productos que salen de un granel. */
async function recalcularHijos(supabase: ReturnType<typeof getSupabaseServerClient>, g: Granel, ahora: string) {
  const { data: hijos } = await supabase.from("productos").select("id_producto, peso_neto_g").eq("id_granel", g.id);
  for (const h of hijos ?? []) {
    const merc = mercaderiaDe(g, Number(h.peso_neto_g ?? 0) || null);
    if (merc != null) {
      await supabase.from("productos").update({ costo_informado: Math.round(merc * 100) / 100, costo_actualizado_el: ahora }).eq("id_producto", h.id_producto);
    }
  }
}

/** El producto tiene que ser de una marca propia: las de consignación ponen su precio. */
async function productoPropio(supabase: ReturnType<typeof getSupabaseServerClient>, idProducto: string) {
  const { data } = await supabase.from("productos").select("id_producto, id_marca, marcas(tipo_comercializacion)").eq("id_producto", idProducto).maybeSingle();
  const marca = data?.marcas as unknown as { tipo_comercializacion: string } | null;
  return data && marca?.tipo_comercializacion === "PROPIA" ? data : null;
}

export type CambiosProducto = {
  margen?: string | number | null;
  descuentoEfectivo?: string | number | null;
  idGranel?: string | null;
  gramos?: string | number | null;
  idEnvase?: string | null;
  iva?: string | number | null;
  costo?: string | number | null;
  competencia?: string | number | null;
};

export async function guardarProductoPrecio(idProducto: string, cambios: CambiosProducto): Promise<Resultado> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  const supabase = getSupabaseServerClient();
  if (!(await productoPropio(supabase, idProducto))) return { error: "Ese producto no es de una marca propia." };

  const update: Record<string, unknown> = {};
  const ahora = new Date().toISOString();
  if ("margen" in cambios) {
    const n = numeroONull(cambios.margen, 0, 95);
    if (n === undefined) return { error: "El margen va entre 0 y 95 %." };
    update.margen_objetivo = n;
  }
  if ("descuentoEfectivo" in cambios) {
    const n = numeroONull(cambios.descuentoEfectivo, 0, 60);
    if (n === undefined) return { error: "El descuento por efectivo va entre 0 y 60 %." };
    update.descuento_efectivo = n;
  }
  if ("iva" in cambios) {
    const n = numeroONull(cambios.iva, 0, 27);
    if (n === undefined || n === null) return { error: "Elegí el IVA del producto." };
    update.iva_porcentaje = n;
  }
  if ("competencia" in cambios) {
    const n = numeroONull(cambios.competencia, 0);
    if (n === undefined) return { error: "El precio de la competencia tiene que ser un número." };
    update.precio_competencia = n;
  }
  if ("costo" in cambios) {
    const n = numeroONull(cambios.costo, 0);
    if (n === undefined || n === null || n <= 0) return { error: "El costo tiene que ser mayor a 0." };
    update.costo_informado = n;
    update.costo_actualizado_el = ahora;
  }
  if ("idEnvase" in cambios) {
    if (cambios.idEnvase) {
      const { data: env } = await supabase.from("envases").select("costo").eq("id_envase", cambios.idEnvase).maybeSingle();
      if (!env) return { error: "No encontré esa bolsita." };
      update.id_envase = cambios.idEnvase;
      // La bolsita y la etiqueta también quedan en costos_extra, que es lo que mira el resto del sistema.
      update.costos_extra = Number(env.costo) + (await costoEtiqueta(supabase));
    } else {
      update.id_envase = null;
      update.costos_extra = 0;
    }
  }
  if ("idGranel" in cambios) update.id_granel = cambios.idGranel || null;
  if ("gramos" in cambios) {
    const n = numeroONull(cambios.gramos, 1, 100000);
    if (n === undefined) return { error: "Los gramos tienen que ser un número." };
    update.peso_neto_g = n;
    // El tamaño del nombre sigue al peso: "Almendra Non Pareil 250 g".
    const { data: actual } = await supabase.from("productos").select("nombre").eq("id_producto", idProducto).maybeSingle();
    if (actual?.nombre) update.nombre = nombreConTamano(actual.nombre as string, n);
  }
  // Si sale de un granel, su costo por unidad (costo_informado) se recalcula:
  // es el que usan Rentabilidad y las liquidaciones.
  if ("idGranel" in cambios || "gramos" in cambios) {
    const { data: actual } = await supabase.from("productos").select("id_granel, peso_neto_g").eq("id_producto", idProducto).maybeSingle();
    const idGranel = "idGranel" in cambios ? (cambios.idGranel || null) : (actual?.id_granel as string | null);
    const gramos = "gramos" in cambios ? (update.peso_neto_g as number | null) : Number(actual?.peso_neto_g ?? 0) || null;
    if (idGranel) {
      const { data: g } = await supabase.from("costos_granel").select("costo_neto, unidad, kg_bulto").eq("id_granel", idGranel).maybeSingle();
      const merc = g ? mercaderiaDe(granelDeFila(idGranel, g), gramos) : null;
      if (merc != null) {
        update.costo_informado = Math.round(merc * 100) / 100;
        update.costo_actualizado_el = ahora;
      }
    }
  }
  if (Object.keys(update).length === 0) return { error: null };
  const { error } = await supabase.from("productos").update(update).eq("id_producto", idProducto);
  if (error) return { error: error.message.includes("column") ? FALTA_SQL : "No se pudo guardar. Probá de nuevo." };
  revalidatePath("/precios");
  return { error: null };
}

export async function guardarRubroPrecio(idSubcategoria: string, cambios: { margen?: string | number | null; descuentoEfectivo?: string | number | null }): Promise<Resultado> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  const supabase = getSupabaseServerClient();
  const { data: sub } = await supabase.from("subcategorias").select("id_subcategoria, marcas(tipo_comercializacion)").eq("id_subcategoria", idSubcategoria).maybeSingle();
  if ((sub?.marcas as unknown as { tipo_comercializacion: string } | null)?.tipo_comercializacion !== "PROPIA") return { error: "Ese rubro no es de una marca propia." };
  const update: Record<string, unknown> = {};
  if ("margen" in cambios) {
    const n = numeroONull(cambios.margen, 0, 95);
    if (n === undefined) return { error: "El margen va entre 0 y 95 %." };
    update.margen_objetivo = n;
  }
  if ("descuentoEfectivo" in cambios) {
    const n = numeroONull(cambios.descuentoEfectivo, 0, 60);
    if (n === undefined) return { error: "El descuento por efectivo va entre 0 y 60 %." };
    update.descuento_efectivo = n;
  }
  const { error } = await supabase.from("subcategorias").update(update).eq("id_subcategoria", idSubcategoria);
  if (error) return { error: FALTA_SQL };
  revalidatePath("/precios");
  return { error: null };
}

export type DatosGranel = { nombre: string; idProveedor: string | null; costo: string | number; unidad: Granel["unidad"]; kgBulto: string | number | null };

/** Lo que viene a granel. Un costo nuevo recalcula el costo de todos los tamaños que salen de él. */
export async function guardarGranel(idGranel: string | null, datos: DatosGranel): Promise<Resultado & { id?: string }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  const nombre = String(datos.nombre ?? "").trim().slice(0, 120);
  const costo = numeroONull(datos.costo, 0);
  const unidad = unidadGranel(datos.unidad);
  const kgBulto = unidad === "KG" ? null : numeroONull(datos.kgBulto, 0.001);
  if (!nombre) return { error: "Poné el nombre." };
  if (costo === undefined || costo === null || costo <= 0) return { error: "El costo tiene que ser mayor a 0." };
  if (unidad === "BULTO" && !kgBulto) return { error: "Si viene por bolsa, poné cuántos kg trae." };
  if (unidad === "CAJA" && !kgBulto) return { error: "Si viene por caja, poné cuántas unidades trae." };

  const supabase = getSupabaseServerClient();
  const ahora = new Date().toISOString();
  let id = idGranel;
  if (id) {
    const { data: actual } = await supabase.from("costos_granel").select("costo_neto").eq("id_granel", id).maybeSingle();
    if (!actual) return { error: "No encontré ese producto a granel." };
    const cambioCosto = Number(actual.costo_neto) !== costo;
    const { error } = await supabase
      .from("costos_granel")
      .update({
        nombre,
        id_proveedor: datos.idProveedor || null,
        costo_neto: costo,
        unidad,
        kg_bulto: kgBulto,
        ...(cambioCosto ? { costo_anterior: Number(actual.costo_neto), costo_actualizado_el: ahora } : {}),
      })
      .eq("id_granel", id);
    if (error) return { error: FALTA_SQL };
  } else {
    const { data, error } = await supabase
      .from("costos_granel")
      .insert({ nombre, id_proveedor: datos.idProveedor || null, costo_neto: costo, unidad, kg_bulto: kgBulto })
      .select("id_granel")
      .single();
    if (error || !data) return { error: FALTA_SQL };
    id = data.id_granel as string;
  }

  // El costo por unidad de cada tamaño, para Rentabilidad y las liquidaciones.
  if (id) await recalcularHijos(supabase, { id, nombre, costo, unidad, kgBulto: kgBulto ?? null }, ahora);
  revalidatePath("/precios");
  return { error: null, id: id ?? undefined };
}

export async function guardarEnvase(idEnvase: string | null, datos: { nombre: string; costo: string | number }): Promise<Resultado & { id?: string }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  const nombre = String(datos.nombre ?? "").trim().slice(0, 120);
  const costo = numeroONull(datos.costo, 0);
  if (!nombre) return { error: "Poné el nombre de la bolsita." };
  if (costo === undefined || costo === null) return { error: "El costo tiene que ser un número." };
  const supabase = getSupabaseServerClient();
  let id = idEnvase;
  if (id) {
    const { error } = await supabase.from("envases").update({ nombre, costo }).eq("id_envase", id);
    if (error) return { error: FALTA_SQL };
    // Los productos que la usan llevan su costo en costos_extra.
    await sincronizarBolsitas(supabase, id);
  } else {
    const { data, error } = await supabase.from("envases").insert({ nombre, costo }).select("id_envase").single();
    if (error || !data) return { error: FALTA_SQL };
    id = data.id_envase as string;
  }
  revalidatePath("/precios");
  return { error: null, id: id ?? undefined };
}

export type CambiosConfig = Partial<{
  ivaGeneral: number;
  iibb: number;
  cheque: number;
  sircreb: number;
  sircrebDescontable: boolean;
  comisionQr: number;
  comisionDebito: number;
  comisionCredito: number;
  descuenta: Record<Medio, Descuenta>;
  escenario: Medio;
  margenDefecto: number;
  gastosFijos: number;
  ventas: number;
  colchon: number;
  redondeo: number;
  merma: number;
  etiqueta: number;
  descuentoEfectivo: number;
  tolerancia: number;
}>;

const LIMITES: Partial<Record<keyof CambiosConfig, [number, number]>> = {
  ivaGeneral: [0, 27], iibb: [0, 20], cheque: [0, 5], sircreb: [0, 20], comisionQr: [0, 20], comisionDebito: [0, 20], comisionCredito: [0, 30],
  margenDefecto: [0, 95], gastosFijos: [0, 1e12], ventas: [0, 1e13], colchon: [0, 50], redondeo: [1, 10000], merma: [0, 30], etiqueta: [0, 1e6], descuentoEfectivo: [0, 60], tolerancia: [0, 50],
};

/**
 * Configuración del módulo. Los impuestos, las comisiones y el redondeo son
 * los mismos de la pantalla Configuración: cambiarlos acá los cambia en todo
 * el sistema, así que piden el mismo permiso.
 */
export async function guardarConfigPrecios(cambios: CambiosConfig): Promise<Resultado> {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.EDITAR_CONFIGURACION)) return { error: "No tenés permiso para editar la Configuración." };
  const supabase = getSupabaseServerClient();
  const filas: { parametro: string; valor: string }[] = [];
  for (const [clave, valor] of Object.entries(cambios) as [keyof CambiosConfig, unknown][]) {
    const parametro = CLAVES_PRECIOS[clave as keyof typeof CLAVES_PRECIOS];
    if (!parametro) continue;
    if (clave === "descuenta") {
      const d = valor as Record<Medio, Descuenta>;
      if (!MEDIOS.every((m) => d?.[m.clave] && typeof d[m.clave].iva === "boolean")) return { error: "Las tildes de los medios de pago vinieron mal." };
      filas.push({ parametro, valor: JSON.stringify(d) });
    } else if (clave === "sircrebDescontable") {
      filas.push({ parametro, valor: valor ? "true" : "false" });
    } else if (clave === "escenario") {
      if (!MEDIOS.some((m) => m.clave === valor)) return { error: "Ese medio de pago no existe." };
      filas.push({ parametro, valor: String(valor) });
    } else {
      const n = Number(valor);
      const [min, max] = LIMITES[clave] ?? [0, Infinity];
      if (!Number.isFinite(n) || n < min || n > max) return { error: "Revisá ese número: está fuera de lo razonable." };
      filas.push({ parametro, valor: String(n) });
    }
  }
  if (filas.length === 0) return { error: null };
  const ahora = new Date().toISOString();
  const { error } = await supabase.from("configuracion").upsert(
    filas.map((f) => ({ ...f, fecha_actualizacion: ahora })),
    { onConflict: "parametro" }
  );
  if (error) return { error: "No se pudo guardar la configuración." };
  if ("etiqueta" in cambios) await sincronizarBolsitas(supabase);
  revalidatePath("/precios");
  return { error: null };
}

/**
 * Gastos fijos y ventas de los últimos 3 meses cerrados, del Estado de
 * Resultados (promedio de los meses que tienen ventas). Las ventas se guardan
 * con IVA, como las carga Gonzalo a mano.
 */
export async function traerGastosYVentas(): Promise<Resultado & { gastos?: number; ventas?: number; meses?: string[] }> {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.EDITAR_CONFIGURACION)) return { error: "No tenés permiso para editar la Configuración." };
  const hoy = new Date();
  const periodos = [1, 2, 3].map((atras) => {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - atras, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  try {
    const tableros = await Promise.all(periodos.map((p) => calcularTablero(p)));
    const conVentas = tableros.map((t, i) => ({ t, p: periodos[i] })).filter(({ t }) => t.ventasNetas > 0);
    if (conVentas.length === 0) return { error: "Todavía no hay meses cerrados con ventas para sacar el promedio. Cargalos a mano." };
    const gastos = conVentas.reduce((a, { t }) => a + t.totalGastosFijos, 0) / conVentas.length;
    const ventasNetas = conVentas.reduce((a, { t }) => a + t.ventasNetas, 0) / conVentas.length;
    const supabase = getSupabaseServerClient();
    const { data: iva } = await supabase.from("configuracion").select("valor").eq("parametro", CLAVES_PRECIOS.ivaGeneral).maybeSingle();
    const ventas = ventasNetas * (1 + (Number(iva?.valor ?? 21) || 21) / 100);
    const r = await guardarConfigPrecios({ gastosFijos: Math.round(gastos), ventas: Math.round(ventas) });
    if (r.error) return r;
    return { error: null, gastos: Math.round(gastos), ventas: Math.round(ventas), meses: conVentas.map((c) => c.p) };
  } catch {
    return { error: "No se pudo leer el Estado de Resultados. Cargalos a mano." };
  }
}

/**
 * Pasa a la venta el precio que da la cuenta: cambia el precio de tarjeta y
 * el de efectivo en todo el sistema (caja, tótem, asesor, pedidos), deja el
 * cambio en el historial y una tarea de cartel por local.
 */
export async function pasarALaVenta(ids: string[]): Promise<Resultado & { cambiados?: number }> {
  const sesion = await sesionDePrecios();
  if (!sesion) return { error: "No tenés permiso para Precios." };
  if (!Array.isArray(ids) || ids.length === 0) return { error: "No elegiste ningún producto." };
  const supabase = getSupabaseServerClient();
  const datos = await cargarDatosPrecios(supabase);
  if (!datos.disponible) return { error: FALTA_SQL };

  const granel = new Map(datos.granel.map((g) => [g.id, g]));
  const envases = new Map(datos.envases.map((e) => [e.id, e]));
  const { data: locales } = await supabase.from("locales").select("id_local").eq("estado", "ACTIVO");
  const ahora = new Date();
  const vence = new Date(ahora.getTime() + 24 * 3600 * 1000).toISOString();
  let cambiados = 0;

  for (const p of datos.productos.filter((x) => ids.includes(x.id))) {
    const r = calcularPrecio(p, datos.config, granel, envases);
    if (!r.ok) continue;
    const cambiaLista = r.publico !== p.precioHoy;
    const cambiaEfectivo = r.efectivo !== (p.efectivoHoy ?? p.precioHoy);
    if (!cambiaLista && !cambiaEfectivo) continue;
    const { error } = await supabase
      .from("productos")
      .update({ precio_venta: r.publico, precio_efectivo: r.efectivo, fecha_actualizacion: ahora.toISOString() })
      .eq("id_producto", p.id);
    if (error) continue;
    cambiados++;
    if (cambiaLista) {
      await supabase.from("historial_precios").insert({
        id_producto: p.id,
        precio_anterior: p.precioHoy,
        precio_nuevo: r.publico,
        cambiado_por: sesion.idUsuario,
        motivo: "Módulo Precios",
      });
    }
    // El cartel de góndola: uno por local, porque es físico.
    if ((locales ?? []).length > 0) {
      await supabase.from("tareas_etiqueta").insert(
        (locales ?? []).map((l) => ({
          id_producto: p.id,
          id_local: l.id_local,
          tipo: "CAMBIO_PRECIO",
          estado: "PENDIENTE",
          precio_anterior: p.precioHoy,
          precio_nuevo: r.publico,
          vence_el: vence,
        }))
      );
    }
  }
  revalidatePath("/precios");
  revalidatePath("/productos");
  revalidatePath("/carteles");
  return { error: null, cambiados };
}
