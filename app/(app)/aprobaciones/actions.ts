"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { exigirGestionInterna } from "@/lib/marcaSesion";
import { fechaHoraArgentina } from "@/lib/horarios";
import {
  obtenerPolitica,
  proximaVigencia,
  ETIQUETA_TIPO,
  GRUPO_DE_TIPO,
  type TipoSolicitud,
  type GrupoBandeja,
} from "@/lib/solicitudesMarca";

// Bandeja de aprobaciones — el lado de WiiGo.
//
// Todo lo que resuelve administración pasa por acá. Las marcas nunca llegan a
// estas funciones: el guard de arriba las bloquea aunque conozcan el endpoint.

export type SolicitudBandeja = {
  idSolicitud: string;
  tipo: TipoSolicitud;
  tipoEtiqueta: string;
  grupo: GrupoBandeja;
  marca: string;
  producto: string | null;
  estado: string;
  datos: Record<string, unknown>;
  datosAnteriores: Record<string, unknown>;
  alertas: Record<string, unknown>;
  solicitadaEl: string;
  vigenciaDesde: string | null;
  /** true si la política dice que esto lo tiene que ver el dueño. */
  escalaADuenio: boolean;
};

/** Lo pendiente, lo más viejo primero: lo que lleva más esperando se resuelve antes. */
export async function listarPendientes(): Promise<SolicitudBandeja[]> {
  await exigirGestionInterna();
  const supabase = getSupabaseServerClient();

  const { data } = await supabase
    .from("solicitudes_marca")
    .select("*")
    .eq("estado", "PENDIENTE")
    .order("solicitada_el", { ascending: true })
    .limit(100);

  if (!data || data.length === 0) return [];

  const idsMarca = [...new Set(data.map((s) => s.id_marca as string))];
  const idsProducto = [...new Set(data.map((s) => s.id_producto as string).filter(Boolean))];

  const [{ data: marcas }, { data: productos }] = await Promise.all([
    supabase.from("marcas").select("id_marca, nombre").in("id_marca", idsMarca),
    idsProducto.length
      ? supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProducto)
      : Promise.resolve({ data: [] }),
  ]);

  const nombreMarca = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const nombreProducto = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));

  return data.map((s) => {
    const alertas = (s.alertas as Record<string, unknown>) ?? {};
    return {
      idSolicitud: s.id_solicitud as string,
      tipo: s.tipo as TipoSolicitud,
      tipoEtiqueta: ETIQUETA_TIPO[s.tipo as TipoSolicitud] ?? (s.tipo as string),
      grupo: GRUPO_DE_TIPO[s.tipo as TipoSolicitud] ?? "CONTENIDO",
      marca: nombreMarca.get(s.id_marca as string) ?? "—",
      producto: s.id_producto ? nombreProducto.get(s.id_producto as string) ?? "—" : null,
      estado: s.estado as string,
      datos: (s.datos as Record<string, unknown>) ?? {},
      datosAnteriores: (s.datos_anteriores as Record<string, unknown>) ?? {},
      alertas,
      solicitadaEl: s.solicitada_el as string,
      vigenciaDesde: (s.vigencia_desde as string) ?? null,
      escalaADuenio: alertas.escalaADuenio === true,
    };
  });
}

async function usuarioActual() {
  const sesion = await obtenerSesionConPermisos();
  return sesion;
}

/**
 * Aprobar.
 *
 * Si la política marcó que escala al dueño, solo un admin puede resolverla —
 * administración ve la solicitud pero no puede firmarla. Es el límite que
 * hace que el dueño no tenga que mirar todo, pero sí lo que importa.
 *
 * `precioCorregido` es la contrapropuesta: en vez de rechazar y esperar que
 * la marca reenvíe, se aprueba con el precio que corresponde.
 */
export async function aprobarSolicitud(
  idSolicitud: string,
  opciones?: { precioCorregido?: number; motivo?: string }
): Promise<{ error: string | null }> {
  await exigirGestionInterna();
  const sesion = await usuarioActual();
  if (!sesion) return { error: "Sesión no válida" };

  const supabase = getSupabaseServerClient();
  const { data: solicitud } = await supabase
    .from("solicitudes_marca")
    .select("*")
    .eq("id_solicitud", idSolicitud)
    .maybeSingle();

  if (!solicitud) return { error: "No se encontró la solicitud" };
  if (solicitud.estado !== "PENDIENTE") return { error: "Esta solicitud ya fue resuelta." };

  const alertas = (solicitud.alertas as Record<string, unknown>) ?? {};
  if (alertas.escalaADuenio === true && sesion.rol !== "admin") {
    return {
      error:
        "Esta solicitud se sale de la política y la tiene que aprobar el dueño. " +
        String(alertas.motivoEscala ?? ""),
    };
  }

  const politica = await obtenerPolitica(supabase);
  const datos = { ...((solicitud.datos as Record<string, unknown>) ?? {}) };

  // Contrapropuesta: se guarda el precio que decidió administración, no el
  // que pidió la marca. Queda registrado que se cambió.
  if (opciones?.precioCorregido !== undefined && solicitud.tipo === "PRECIO") {
    if (!Number.isFinite(opciones.precioCorregido) || opciones.precioCorregido <= 0) {
      return { error: "El precio corregido tiene que ser mayor a cero." };
    }
    datos.precio = opciones.precioCorregido;
    datos.corregidoPorAdministracion = true;
  }

  // Los cambios que tocan el precio se programan con el local cerrado; el
  // resto (foto, descripción, alta) se aplican en el momento.
  const tocaPrecio = solicitud.tipo === "PRECIO" || solicitud.tipo === "DESCUENTO";
  const vigencia = tocaPrecio ? proximaVigencia(politica) : new Date();

  const { error } = await supabase
    .from("solicitudes_marca")
    .update({
      estado: "APROBADA",
      datos,
      vigencia_desde: vigencia.toISOString(),
      resuelta_por: sesion.idUsuario,
      resuelta_el: new Date().toISOString(),
      motivo: opciones?.motivo ?? null,
    })
    .eq("id_solicitud", idSolicitud)
    // Que siga PENDIENTE: si dos personas aprueban a la vez, solo una gana.
    .eq("estado", "PENDIENTE");

  if (error) return { error: friendlyDbError(error) };

  await generarTareasEtiqueta(supabase, {
    tipo: solicitud.tipo as TipoSolicitud,
    idProducto: (solicitud.id_producto as string) ?? null,
    idSolicitud,
    datos,
    datosAnteriores: (solicitud.datos_anteriores as Record<string, unknown>) ?? {},
    vigencia,
  });

  revalidatePath("/aprobaciones");
  return { error: null };
}

/**
 * Al aprobar un precio o una promo, se genera el trabajo del local: cambiar
 * el cartel de góndola.
 *
 * La tarea vence en el mismo momento en que el precio entra al sistema. No es
 * casual: si a esa hora la etiqueta no está cambiada, la tarea queda VENCIDA y
 * aparece en rojo, porque desde ahí el cartel y la caja dicen cosas distintas.
 *
 * Una promo genera DOS tareas: poner el cartel y sacarlo. La segunda es la
 * que más se olvida y la más cara — un cartel de oferta que sigue puesto
 * obliga a respetar ese precio aunque la promo haya terminado.
 */
async function generarTareasEtiqueta(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  s: {
    tipo: TipoSolicitud;
    idProducto: string | null;
    idSolicitud: string;
    datos: Record<string, unknown>;
    datosAnteriores: Record<string, unknown>;
    vigencia: Date;
  }
): Promise<void> {
  if (!s.idProducto) return;
  if (s.tipo !== "PRECIO" && s.tipo !== "DESCUENTO") return;

  const precioNuevo = typeof s.datos.precio === "number" ? (s.datos.precio as number) : null;
  const precioAnterior = typeof s.datosAnteriores.precio === "number" ? (s.datosAnteriores.precio as number) : null;

  // Una tarea por local: el cartel es físico y hay uno en cada góndola.
  const { data: locales } = await supabase.from("locales").select("id_local").eq("estado", "ACTIVO");
  const idsLocal = (locales ?? []).map((l) => l.id_local as string);
  if (idsLocal.length === 0) return;

  const filas = idsLocal.map((idLocal) => ({
    id_solicitud: s.idSolicitud,
    id_producto: s.idProducto,
    id_local: idLocal,
    tipo: s.tipo === "DESCUENTO" ? "INICIO_PROMO" : "CAMBIO_PRECIO",
    estado: "PENDIENTE",
    precio_anterior: precioAnterior,
    precio_nuevo: precioNuevo,
    vence_el: s.vigencia.toISOString(),
  }));

  // Fin de promo: vuelve el precio de lista el día que termina.
  if (s.tipo === "DESCUENTO" && typeof s.datos.hasta === "string") {
    const fin = new Date(`${s.datos.hasta}T23:59:00-03:00`);
    if (!Number.isNaN(fin.getTime())) {
      idsLocal.forEach((idLocal) => {
        filas.push({
          id_solicitud: s.idSolicitud,
          id_producto: s.idProducto,
          id_local: idLocal,
          tipo: "FIN_PROMO",
          estado: "PENDIENTE",
          precio_anterior: precioNuevo,
          precio_nuevo: precioAnterior,
          vence_el: fin.toISOString(),
        });
      });
    }
  }

  await supabase.from("tareas_etiqueta").insert(filas);
}

export async function rechazarSolicitud(idSolicitud: string, motivo: string): Promise<{ error: string | null }> {
  await exigirGestionInterna();
  const sesion = await usuarioActual();
  if (!sesion) return { error: "Sesión no válida" };

  // El motivo es obligatorio: un rechazo sin explicación termina en un
  // WhatsApp, que es justo lo que este canal viene a reemplazar.
  if (!motivo.trim()) return { error: "Escribí el motivo del rechazo: la marca lo va a leer." };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("solicitudes_marca")
    .update({
      estado: "RECHAZADA",
      resuelta_por: sesion.idUsuario,
      resuelta_el: new Date().toISOString(),
      motivo: motivo.trim(),
    })
    .eq("id_solicitud", idSolicitud)
    .eq("estado", "PENDIENTE");

  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/aprobaciones");
  return { error: null };
}

export type TareaEtiquetaPendiente = {
  idTarea: string;
  producto: string;
  precioAnterior: number | null;
  precioNuevo: number | null;
  tipo: string;
  venceEl: string;
  vencida: boolean;
};

/** Las etiquetas que el local tiene que cambiar. */
export async function listarTareasEtiqueta(idLocal?: string): Promise<TareaEtiquetaPendiente[]> {
  await exigirGestionInterna();
  const supabase = getSupabaseServerClient();

  let consulta = supabase
    .from("tareas_etiqueta")
    .select("id_tarea, id_producto, precio_anterior, precio_nuevo, tipo, vence_el, estado")
    .in("estado", ["PENDIENTE", "VENCIDA"])
    .order("vence_el", { ascending: true })
    .limit(100);
  if (idLocal) consulta = consulta.eq("id_local", idLocal);

  const { data } = await consulta;
  if (!data || data.length === 0) return [];

  const ids = [...new Set(data.map((t) => t.id_producto as string))];
  const { data: productos } = await supabase.from("productos").select("id_producto, nombre").in("id_producto", ids);
  const nombre = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));

  const ahora = Date.now();
  return data.map((t) => ({
    idTarea: t.id_tarea as string,
    producto: nombre.get(t.id_producto as string) ?? "Producto",
    precioAnterior: (t.precio_anterior as number) ?? null,
    precioNuevo: (t.precio_nuevo as number) ?? null,
    tipo: t.tipo as string,
    venceEl: t.vence_el as string,
    // Vencida = el precio ya cambió y la etiqueta no. Acá sí hay riesgo real.
    vencida: new Date(t.vence_el as string).getTime() < ahora,
  }));
}

/** El local marca que ya cambió la etiqueta. Queda quién y cuándo. */
export async function marcarEtiquetaHecha(idTarea: string): Promise<{ error: string | null }> {
  await exigirGestionInterna();
  const sesion = await usuarioActual();
  if (!sesion) return { error: "Sesión no válida" };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("tareas_etiqueta")
    .update({ estado: "HECHA", hecha_por: sesion.idUsuario, hecha_el: new Date().toISOString() })
    .eq("id_tarea", idTarea)
    .in("estado", ["PENDIENTE", "VENCIDA"]);

  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/aprobaciones");
  return { error: null };
}

/** Cuántas cosas hay esperando — para el contador del menú. */
export async function contarPendientes(): Promise<{ solicitudes: number; etiquetas: number; etiquetasVencidas: number }> {
  const sesion = await obtenerSesionConPermisos();
  if (!sesion || sesion.rol === "marca") return { solicitudes: 0, etiquetas: 0, etiquetasVencidas: 0 };

  const supabase = getSupabaseServerClient();
  const ahora = new Date().toISOString();

  const [sol, etq, venc] = await Promise.all([
    supabase.from("solicitudes_marca").select("id_solicitud", { count: "exact", head: true }).eq("estado", "PENDIENTE"),
    supabase.from("tareas_etiqueta").select("id_tarea", { count: "exact", head: true }).in("estado", ["PENDIENTE", "VENCIDA"]),
    supabase
      .from("tareas_etiqueta")
      .select("id_tarea", { count: "exact", head: true })
      .in("estado", ["PENDIENTE", "VENCIDA"])
      .lt("vence_el", ahora),
  ]);

  return {
    solicitudes: sol.count ?? 0,
    etiquetas: etq.count ?? 0,
    etiquetasVencidas: venc.count ?? 0,
  };
}

/**
 * Aplica los cambios que ya llegaron a su hora de vigencia.
 *
 * Lo llama el cron (ver app/api/cron). Es lo que hace que un precio aprobado
 * a las 15:00 entre recién a las 23:00, con el local cerrado.
 *
 * Idempotente a propósito: si el cron corre dos veces, la segunda no hace
 * nada porque la solicitud ya quedó APLICADA.
 */
export async function aplicarCambiosProgramados(): Promise<{ aplicadas: number; errores: string[] }> {
  const supabase = getSupabaseServerClient();
  const ahora = new Date().toISOString();
  const errores: string[] = [];
  let aplicadas = 0;

  const { data: pendientes } = await supabase
    .from("solicitudes_marca")
    .select("*")
    .eq("estado", "APROBADA")
    .lte("vigencia_desde", ahora)
    .limit(200);

  for (const s of pendientes ?? []) {
    try {
      if (s.tipo === "PRECIO") {
        const precio = Number((s.datos as Record<string, unknown>)?.precio);
        if (!Number.isFinite(precio) || precio <= 0) throw new Error("precio inválido");

        const { data: producto } = await supabase
          .from("productos")
          .select("precio_venta")
          .eq("id_producto", s.id_producto as string)
          .maybeSingle();
        const anterior = (producto?.precio_venta as number) ?? null;

        await supabase
          .from("productos")
          .update({ precio_venta: precio, fecha_actualizacion: new Date().toISOString() })
          .eq("id_producto", s.id_producto as string);

        await supabase.from("historial_precios").insert({
          id_producto: s.id_producto,
          precio_anterior: anterior,
          precio_nuevo: precio,
          id_solicitud: s.id_solicitud,
          cambiado_por: s.resuelta_por,
          motivo: s.motivo,
        });
      }

      await supabase
        .from("solicitudes_marca")
        .update({ estado: "APLICADA", aplicada_el: new Date().toISOString() })
        .eq("id_solicitud", s.id_solicitud)
        .eq("estado", "APROBADA");

      aplicadas++;
    } catch (err) {
      errores.push(`${s.id_solicitud}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Las etiquetas que pasaron su hora sin hacerse quedan VENCIDAS: ahí el
  // sistema ya cobra el precio nuevo y el cartel dice el viejo.
  await supabase
    .from("tareas_etiqueta")
    .update({ estado: "VENCIDA" })
    .eq("estado", "PENDIENTE")
    .lt("vence_el", ahora);

  if (aplicadas > 0) {
    revalidatePath("/aprobaciones");
    revalidatePath("/productos");
  }
  return { aplicadas, errores };
}
