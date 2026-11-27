"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { consumirFifo, simularConsumoFifo } from "@/lib/fifoProveedor";
import { ESTADO_GRANEL } from "@/lib/granel";
import { textoGramos } from "@/lib/gramos";
import { localDeSesion } from "@/lib/fraccionado";
import { cargarGondola, nombreCortoZona, ubicacionDe } from "@/lib/gondola";
import { PARAMETRO_CODIGOS_IMPRESOS, cargarCodigosImpresos } from "@/lib/codigosImpresos";
import { fechaHoraArgentina } from "@/lib/horarios";
import { PASO_IMPRESAS, PASO_PARA_ETIQUETAR, PASO_PEGADAS } from "@/lib/fraccionarSugerido";

// Registrar lo que se embolsó (lib/granel.ts, sql/granel-fraccionado.sql).
// Devuelven { error } como dato: Next 16 esconde el mensaje de un throw.

type Supa = ReturnType<typeof getSupabaseServerClient>;

async function cantidadEnStock(supabase: Supa, idVariante: string, idLocal: string) {
  const { data } = await supabase.from("stock").select("cantidad").eq("id_variante", idVariante).eq("id_local", idLocal).maybeSingle();
  return Number(data?.cantidad ?? 0);
}

async function sumarStock(supabase: Supa, idVariante: string, idLocal: string, delta: number) {
  const actual = await cantidadEnStock(supabase, idVariante, idLocal);
  return supabase
    .from("stock")
    .upsert({ id_variante: idVariante, id_local: idLocal, cantidad: actual + delta, fecha_actualizacion: new Date().toISOString() }, { onConflict: "id_variante,id_local" });
}

/** El granel y su proveedor, si la variante es de un producto de granel. */
async function granelDe(supabase: Supa, idVarianteGranel: string) {
  const { data } = await supabase
    .from("variantes_producto")
    .select("id_variante, productos!inner(id_producto, nombre, estado, id_granel, id_proveedor_liquidacion, costo_informado)")
    .eq("id_variante", idVarianteGranel)
    .maybeSingle();
  const p = data?.productos as unknown as {
    nombre: string;
    estado: string;
    id_granel: string | null;
    id_proveedor_liquidacion: string | null;
    costo_informado: number | null;
  } | null;
  if (!p || p.estado !== ESTADO_GRANEL || !p.id_granel) return null;
  return p;
}

/**
 * «Armé N bolsitas de este producto»: los gramos salen del granel, del lote más
 * viejo de Alifrut al más nuevo, y las bolsitas entran a la góndola con un lote
 * propio que cuesta exactamente esos gramos. Cuando se vendan, se le liquidan a
 * Alifrut a ese costo (el del día en que mandó la mercadería).
 */
export async function registrarFraccionado(
  idVarianteGranel: string,
  idVarianteBolsa: string,
  bolsitas: number,
  // Del paso a paso (sql/fraccionado-guiado.sql): el lote y el vencimiento escrito a mano.
  extra?: { lote?: string | null; vencimiento?: string | null }
): Promise<{ error?: string; ok?: true; gramos?: number; idFraccionado?: string }> {
  const n = Math.round(Number(bolsitas));
  if (!Number.isFinite(n) || n <= 0 || n > 999) return { error: "Poné cuántas bolsitas armaste." };
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "fraccionar")) return { error: "No tenés habilitado Fraccionar." };
  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) return { error: "No sé en qué local estás: tu usuario no tiene un local asignado." };

  const granel = await granelDe(supabase, idVarianteGranel);
  if (!granel) return { error: "Ese granel no existe." };
  const { data: bolsa } = await supabase
    .from("variantes_producto")
    .select("id_variante, productos!inner(nombre, id_granel, peso_neto_g, estado)")
    .eq("id_variante", idVarianteBolsa)
    .maybeSingle();
  const pb = bolsa?.productos as unknown as { nombre: string; id_granel: string | null; peso_neto_g: number | null; estado: string } | null;
  if (!pb || pb.id_granel !== granel.id_granel || pb.estado !== "ACTIVO") return { error: "Esa bolsita no sale de este granel." };
  const peso = Number(pb.peso_neto_g ?? 0);
  if (!(peso > 0)) return { error: `«${pb.nombre}» no tiene el peso neto cargado. Cargalo en Productos (por ejemplo, 250 g).` };

  const gramos = n * peso;
  const hay = await cantidadEnStock(supabase, idVarianteGranel, idLocal);
  if (gramos > hay) {
    return { error: `Para ${n} bolsitas de ${textoGramos(peso)} hacen falta ${textoGramos(gramos)} y en el depósito figuran ${textoGramos(hay)}. Si llegó más, cargalo en Compras → Recepción.` };
  }

  // Los gramos salen de los lotes de Alifrut, del más viejo al más nuevo.
  const consumo = granel.id_proveedor_liquidacion
    ? await consumirFifo(supabase, granel.id_proveedor_liquidacion, idVarianteGranel, gramos, Number(granel.costo_informado ?? 0) || null)
    : { consumos: [], costoTotal: gramos * Number(granel.costo_informado ?? 0), estimado: true };

  const quien = sesion.nombre ?? null;
  const base = { id_local: idLocal, id_variante_granel: idVarianteGranel, id_variante_bolsa: idVarianteBolsa, tipo: "FRACCIONADO", bolsitas: n, gramos, costo_total: Math.round(consumo.costoTotal * 100) / 100, usuario: quien };
  // Con sql/fraccionado-guiado.sql también el lote, el vencimiento y quién (por id). Sin el SQL, como antes.
  let { data: fila, error: e1 } = await supabase
    .from("fraccionados")
    .insert({ ...base, id_usuario: sesion.idUsuario, lote: extra?.lote ?? null, vencimiento: extra?.vencimiento || null })
    .select("id_fraccionado")
    .single();
  if (e1 && /lote|vencimiento|id_usuario|column/i.test(e1.message)) {
    ({ data: fila, error: e1 } = await supabase.from("fraccionados").insert(base).select("id_fraccionado").single());
  }
  if (e1 || !fila) return { error: e1 ? friendlyDbError(e1) : "No se pudo guardar." };

  // El lote de las bolsitas cuelga de la recepción del último lote de granel
  // que se usó, así el FIFO de la bolsita sigue el orden de llegada.
  const ultimoLote = [...consumo.consumos].reverse().find((c) => c.idDetalleRecepcion !== "ESTIMADO");
  if (ultimoLote) {
    const { data: lote } = await supabase.from("detalle_recepcion_proveedor").select("id_recepcion").eq("id_detalle", ultimoLote.idDetalleRecepcion).maybeSingle();
    if (lote?.id_recepcion) {
      await supabase.from("detalle_recepcion_proveedor").insert({
        id_recepcion: lote.id_recepcion,
        id_variante: idVarianteBolsa,
        cantidad_solicitada: 0,
        cantidad_recibida: 0,
        estado_control: "COMPLETA",
        diferencia: 0,
        cantidad_disponible_fifo: n,
        costo_unitario: Math.round((consumo.costoTotal / n) * 100) / 100,
        id_fraccionado: fila.id_fraccionado,
      });
    }
  }

  const r1 = await sumarStock(supabase, idVarianteGranel, idLocal, -gramos);
  if (r1.error) return { error: friendlyDbError(r1.error) };
  const r2 = await sumarStock(supabase, idVarianteBolsa, idLocal, n);
  if (r2.error) return { error: friendlyDbError(r2.error) };
  await supabase.from("movimientos_stock").insert([
    { id_variante: idVarianteGranel, id_local: idLocal, tipo: "FRACCIONADO", cantidad: -gramos, motivo: `Embolsado en ${n} × ${pb.nombre}`, id_referencia: fila.id_fraccionado, usuario: quien },
    { id_variante: idVarianteBolsa, id_local: idLocal, tipo: "FRACCIONADO", cantidad: n, motivo: `Fraccionado de ${granel.nombre}`, id_referencia: fila.id_fraccionado, usuario: quien },
  ]);

  revalidatePath("/fraccionar");
  revalidatePath("/codigos");
  revalidatePath("/stock");
  return { ok: true, gramos, idFraccionado: fila.id_fraccionado as string };
}

/**
 * El granel queda en lo que de verdad quedó: lo que falta contra lo que figuraba
 * es merma de fraccionado (la paga WiiGo, se le paga a Alifrut); si quedó más,
 * se corrige sin merma. Devuelve la merma en gramos (0 si no hubo).
 */
async function ajustarGranel(
  supabase: Supa,
  idLocal: string,
  idVarianteGranel: string,
  granel: { id_proveedor_liquidacion: string | null; costo_informado: number | null },
  quedan: number,
  quien: string | null,
  motivo: string
): Promise<{ error?: string; merma: number }> {
  const hay = await cantidadEnStock(supabase, idVarianteGranel, idLocal);
  const merma = hay - quedan;
  if (merma > 0) {
    const sim = granel.id_proveedor_liquidacion
      ? await simularConsumoFifo(supabase, granel.id_proveedor_liquidacion, idVarianteGranel, merma, Number(granel.costo_informado ?? 0) || null)
      : { costoTotal: merma * Number(granel.costo_informado ?? 0) };
    const { error: e1 } = await supabase.from("mermas").insert({
      id_variante: idVarianteGranel,
      id_local: idLocal,
      cantidad: merma,
      motivo: "OTRO",
      detalle: "Merma de fraccionado (gramos)",
      costo_unitario: merma > 0 ? sim.costoTotal / merma : 0,
      fecha: new Date().toISOString(),
      usuario: quien,
    });
    if (e1) return { error: friendlyDbError(e1), merma: 0 };
    await supabase.from("movimientos_stock").insert({ id_variante: idVarianteGranel, id_local: idLocal, tipo: "MERMA", cantidad: -merma, motivo, usuario: quien });
  } else if (merma < 0) {
    await supabase.from("movimientos_stock").insert({ id_variante: idVarianteGranel, id_local: idLocal, tipo: "AJUSTE", cantidad: -merma, motivo: `${motivo}: quedaba más de lo que figuraba`, usuario: quien });
  }
  if (merma !== 0) {
    const r = await sumarStock(supabase, idVarianteGranel, idLocal, -merma);
    if (r.error) return { error: friendlyDbError(r.error), merma: 0 };
  }
  return { merma: Math.max(0, merma) };
}

/**
 * «Se terminó el granel»: lo que el sistema creía que quedaba y no está es
 * merma de fraccionado. Se registra como merma (se le paga a Alifrut: el
 * acuerdo es que lo que se pierde al fraccionar es de WiiGo) y el stock del
 * granel queda en lo que de verdad quedó.
 */
export async function cerrarGranel(idVarianteGranel: string, gramosQueQuedan: number): Promise<{ error?: string; ok?: true; merma?: number }> {
  const quedan = Math.max(0, Math.round(Number(gramosQueQuedan) || 0));
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "fraccionar")) return { error: "No tenés habilitado Fraccionar." };
  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) return { error: "No sé en qué local estás: tu usuario no tiene un local asignado." };
  const granel = await granelDe(supabase, idVarianteGranel);
  if (!granel) return { error: "Ese granel no existe." };

  const hay = await cantidadEnStock(supabase, idVarianteGranel, idLocal);
  const merma = hay - quedan;
  const quien = sesion.nombre ?? null;
  const ahora = new Date().toISOString();

  if (merma > 0) {
    const sim = granel.id_proveedor_liquidacion
      ? await simularConsumoFifo(supabase, granel.id_proveedor_liquidacion, idVarianteGranel, merma, Number(granel.costo_informado ?? 0) || null)
      : { costoTotal: merma * Number(granel.costo_informado ?? 0) };
    const { error: e1 } = await supabase.from("mermas").insert({
      id_variante: idVarianteGranel,
      id_local: idLocal,
      cantidad: merma,
      motivo: "OTRO",
      detalle: "Merma de fraccionado (gramos)",
      costo_unitario: merma > 0 ? sim.costoTotal / merma : 0,
      fecha: ahora,
      usuario: quien,
    });
    if (e1) return { error: friendlyDbError(e1) };
    await supabase.from("movimientos_stock").insert({ id_variante: idVarianteGranel, id_local: idLocal, tipo: "MERMA", cantidad: -merma, motivo: "Merma de fraccionado", usuario: quien });
  } else if (merma < 0) {
    // Quedó más de lo que figuraba: se corrige, sin merma.
    await supabase.from("movimientos_stock").insert({ id_variante: idVarianteGranel, id_local: idLocal, tipo: "AJUSTE", cantidad: -merma, motivo: "Cierre de granel: quedaba más de lo que figuraba", usuario: quien });
  }
  const r = await sumarStock(supabase, idVarianteGranel, idLocal, -merma);
  if (r.error) return { error: friendlyDbError(r.error) };
  await supabase.from("fraccionados").insert({ id_local: idLocal, id_variante_granel: idVarianteGranel, tipo: "CIERRE", merma_gramos: Math.max(0, merma), gramos: 0, usuario: quien });

  revalidatePath("/fraccionar");
  revalidatePath("/stock");
  return { ok: true, merma: Math.max(0, merma) };
}

// ---------------- El paso a paso (Gonzalo, 2026-11-16) ----------------
// Siete pasos en la tablet: tamaño → preparar → cuántas y cuánto quedó → etiquetas →
// vencimiento a mano y pegarlas → sumar al stock → llevarlas a la góndola. Recién en
// «Sumar al stock» se mueve el stock. Lo que va por la mitad queda en
// fraccionados_en_curso (sql/fraccionado-guiado.sql) y el Inicio lo muestra en rojo.

export type DatosEnCurso = {
  idEnCurso?: string | null;
  idVarianteGranel: string;
  idVarianteBolsa: string;
  paso: number;
  bolsitas?: number | null;
  seTermino?: boolean | null;
  gramosQuedan?: number | null;
  vencimiento?: string | null;
};

const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;

/** Guarda por dónde va. Sin el SQL devuelve sinTabla: el paso a paso sigue igual, sin poder retomarse. */
export async function guardarEnCurso(d: DatosEnCurso): Promise<{ error?: string; id?: string; sinTabla?: true }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "fraccionar")) return { error: "No tenés habilitado Fraccionar." };
  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) return { error: "Tu usuario no tiene un local asignado." };
  const fila = {
    id_local: idLocal,
    id_usuario: sesion.idUsuario,
    usuario: sesion.nombre ?? null,
    id_variante_granel: d.idVarianteGranel,
    id_variante_bolsa: d.idVarianteBolsa,
    paso: Math.max(1, Math.min(8, Math.round(d.paso))),
    bolsitas: d.bolsitas ?? null,
    se_termino: d.seTermino ?? null,
    gramos_quedan: d.gramosQuedan == null ? null : Math.max(0, Math.round(d.gramosQuedan)),
    vencimiento: d.vencimiento && FECHA_OK.test(d.vencimiento) ? d.vencimiento : null,
    actualizado: new Date().toISOString(),
  };
  const r = d.idEnCurso
    ? await supabase.from("fraccionados_en_curso").update(fila).eq("id_en_curso", d.idEnCurso).eq("id_usuario", sesion.idUsuario).select("id_en_curso").maybeSingle()
    : await supabase.from("fraccionados_en_curso").insert(fila).select("id_en_curso").single();
  if (r.error) return /fraccionados_en_curso|schema cache|does not exist/i.test(r.error.message) ? { sinTabla: true } : { error: friendlyDbError(r.error) };
  // Si arrancaron de nuevo el mismo producto, el intento anterior que quedó antes de la
  // etiqueta ya no vale: se borra, para que el Inicio no lo muestre «sin terminar» para
  // siempre (27/11: tres intentos del 25/11 seguían en rojo con todo ya en el stock).
  if (!d.idEnCurso && r.data?.id_en_curso) {
    await supabase
      .from("fraccionados_en_curso")
      .delete()
      .eq("id_local", idLocal)
      .eq("id_variante_granel", d.idVarianteGranel)
      .eq("id_variante_bolsa", d.idVarianteBolsa)
      .lt("paso", PASO_PARA_ETIQUETAR)
      .neq("id_en_curso", r.data.id_en_curso as string);
  }
  return { id: (r.data?.id_en_curso as string | undefined) ?? d.idEnCurso ?? undefined };
}

/** «No lo hice»: se borra lo que iba por la mitad. El stock no se tocó. */
export async function descartarEnCurso(idEnCurso: string): Promise<{ error?: string }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "fraccionar")) return { error: "No tenés habilitado Fraccionar." };
  const supabase = getSupabaseServerClient();
  let q = supabase.from("fraccionados_en_curso").delete().eq("id_en_curso", idEnCurso);
  // El Dueño puede descartar el de cualquiera; los demás, solo el suyo.
  if (sesion.rol !== "admin") q = q.eq("id_usuario", sesion.idUsuario);
  const { error } = await q;
  if (error && !/fraccionados_en_curso|schema cache/i.test(error.message)) return { error: friendlyDbError(error) };
  revalidatePath("/fraccionar");
  revalidatePath("/");
  return {};
}

/**
 * Las etiquetas de estos fraccionados ya se imprimieron (19/11): quedan en
 * PASO_IMPRESAS y no se vuelven a pedir, aunque la tanda la termine otra persona.
 */
export async function marcarEtiquetasImpresas(ids: string[]): Promise<{ error?: string }> {
  return avanzarTanda(ids, PASO_PARA_ETIQUETAR, PASO_IMPRESAS, "impresas");
}

/** «Pegué las etiquetas»: falta solo sumar al stock (19/11). */
export async function marcarEtiquetasPegadas(ids: string[]): Promise<{ error?: string }> {
  return avanzarTanda(ids, PASO_IMPRESAS, PASO_PEGADAS, "pegadas");
}

/** Pasa lo de la tanda que esté en un paso anterior a `hasta`, anotando quién y cuándo. */
async function avanzarTanda(ids: string[], desde: number, hasta: number, que: "impresas" | "pegadas"): Promise<{ error?: string }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "fraccionar")) return { error: "No tenés habilitado Fraccionar." };
  const limpios = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  if (!limpios.length) return {};
  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) return { error: "Tu usuario no tiene un local asignado." };
  const ahora = new Date().toISOString();
  const base = { paso: hasta, actualizado: ahora };
  const conQuien = { ...base, [`${que}_por`]: sesion.nombre ?? null, [`${que}_en`]: ahora };
  const correr = (fila: Record<string, unknown>) =>
    supabase.from("fraccionados_en_curso").update(fila).in("id_en_curso", limpios).eq("id_local", idLocal).gte("paso", desde).lt("paso", hasta);
  let { error } = await correr(conQuien);
  // Sin sql/tanda-pasos.sql no están las columnas de quién y cuándo: se avanza igual.
  if (error && /impresas_|pegadas_/.test(error.message)) ({ error } = await correr(base));
  if (error && !/fraccionados_en_curso|schema cache/i.test(error.message)) return { error: friendlyDbError(error) };
  revalidatePath("/");
  return {};
}

/** El lote de la tanda: F + día y mes + el número de tanda del día en el local (F1611-2). */
async function loteDelDia(supabase: Supa, idLocal: string): Promise<string> {
  const hoy = fechaHoraArgentina().fecha;
  const { count } = await supabase
    .from("fraccionados")
    .select("id_fraccionado", { count: "exact", head: true })
    .eq("id_local", idLocal)
    .eq("tipo", "FRACCIONADO")
    .gte("fecha", `${hoy}T00:00:00-03:00`);
  return `F${hoy.slice(8, 10)}${hoy.slice(5, 7)}-${(count ?? 0) + 1}`;
}

/**
 * Paso 6, «Sumar al stock»: las bolsitas entran a la góndola (con su lote y el
 * vencimiento escrito), el granel queda en lo que pesaron (lo que falta es
 * merma) y las etiquetas cuentan como ya impresas (se imprimieron en el paso 4).
 */
export async function terminarFraccionado(d: {
  idEnCurso?: string | null;
  idVarianteGranel: string;
  idVarianteBolsa: string;
  bolsitas: number;
  seTermino: boolean;
  gramosQuedan: number | null;
  vencimiento: string;
}): Promise<{ error?: string; ok?: true; lote?: string; merma?: number; ubicacion?: string | null }> {
  // Sin vencimiento se puede (Gonzalo, 25/11: hay bolsas grandes sin fecha); si viene, tiene que ser una fecha.
  const vencimiento = d.vencimiento?.trim() ? d.vencimiento.trim() : null;
  if (vencimiento && !FECHA_OK.test(vencimiento)) return { error: "El vencimiento no es una fecha válida." };
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "fraccionar")) return { error: "No tenés habilitado Fraccionar." };
  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) return { error: "No sé en qué local estás: tu usuario no tiene un local asignado." };
  const granel = await granelDe(supabase, d.idVarianteGranel);
  if (!granel) return { error: "Ese granel no existe." };

  const lote = await loteDelDia(supabase, idLocal);
  const r = await registrarFraccionado(d.idVarianteGranel, d.idVarianteBolsa, d.bolsitas, { lote, vencimiento });
  if (r.error || !r.idFraccionado) return { error: r.error ?? "No se pudo guardar." };

  // Lo que quedó a granel: 0 si se terminó la bolsa; si no, lo que pesaron. Sin pesar, queda lo que figura.
  const quien = sesion.nombre ?? null;
  let merma = 0;
  let quedaron: number | null = null;
  if (d.seTermino || d.gramosQuedan != null) {
    quedaron = d.seTermino ? 0 : Math.max(0, Math.round(Number(d.gramosQuedan) || 0));
    const aj = await ajustarGranel(supabase, idLocal, d.idVarianteGranel, granel, quedaron, quien, `Merma de fraccionado (lote ${lote})`);
    if (aj.error) return { error: `Las bolsitas se sumaron, pero no se pudo ajustar el granel: ${aj.error}` };
    merma = aj.merma;
  }
  // Sin el SQL nuevo estas columnas no están: se ignora el error (la merma igual quedó en Mermas).
  await supabase.from("fraccionados").update({ merma_gramos: merma, gramos_quedaron: quedaron }).eq("id_fraccionado", r.idFraccionado);

  // Las etiquetas ya se imprimieron en el paso 4: que no vuelvan a pedirse en Códigos.
  try {
    const impresos = await cargarCodigosImpresos(supabase);
    impresos[d.idVarianteBolsa] = new Date().toISOString();
    await supabase.from("configuracion").upsert(
      {
        parametro: PARAMETRO_CODIGOS_IMPRESOS,
        valor: JSON.stringify(impresos),
        descripcion: "Códigos de barras: qué productos ya tienen su sticker impreso (id_variante → fecha)",
        fecha_actualizacion: new Date().toISOString(),
      },
      { onConflict: "parametro" }
    );
  } catch {
    // Si no se pudo anotar, solo vuelve a figurar en «Para imprimir ahora».
  }

  if (d.idEnCurso) {
    // Quién fraccionó es quien lo embolsó, no quien terminó la tanda (19/11: Tomás
    // sumó al stock lo que había embolsado Florencia a la mañana).
    const { data: ec } = await supabase.from("fraccionados_en_curso").select("usuario, id_usuario").eq("id_en_curso", d.idEnCurso).maybeSingle();
    if (ec?.id_usuario && ec.id_usuario !== sesion.idUsuario) {
      await supabase.from("fraccionados").update({ usuario: ec.usuario, id_usuario: ec.id_usuario }).eq("id_fraccionado", r.idFraccionado);
    }
    await supabase.from("fraccionados_en_curso").delete().eq("id_en_curso", d.idEnCurso);
  }
  // Si la bolsa grande se terminó, no puede quedar otro fraccionado de ella a medio hacer:
  // es un intento viejo o repetido (27/11: Mix Semillas figuraba para sumar otra vez).
  if (d.seTermino) {
    await supabase
      .from("fraccionados_en_curso")
      .delete()
      .eq("id_local", idLocal)
      .eq("id_variante_granel", d.idVarianteGranel)
      .lt("paso", PASO_PARA_ETIQUETAR);
  }

  // Dónde van en la góndola (paso 7).
  let ubicacion: string | null = null;
  try {
    const { data: v } = await supabase.from("variantes_producto").select("id_producto").eq("id_variante", d.idVarianteBolsa).maybeSingle();
    const gondola = (await cargarGondola(supabase, idLocal)) ?? [];
    const u = v?.id_producto ? ubicacionDe(gondola, v.id_producto as string) : null;
    ubicacion = u ? `${nombreCortoZona(gondola, u.modulo)} · fila ${u.fila} · lugar ${u.columna}` : null;
  } catch {
    ubicacion = null;
  }

  revalidatePath("/fraccionar");
  revalidatePath("/fraccionar/historial");
  revalidatePath("/");
  return { ok: true, lote, merma, ubicacion };
}
