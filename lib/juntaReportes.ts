// Reportes de la Junta: el diario (cómo fue ayer) y el semanal (los lunes,
// cómo fue la semana y qué harían). Los arma el cron a la mañana, los manda
// por mail al Dueño y quedan guardados en la Junta.
//
// Corre sin sesión (lo llama el cron), así que no usa armarTablero ni RR.HH.:
// lee las ventas, los clientes, las tareas y las tardanzas directo de la base.
// Compara siempre con lo comparable: ayer contra el mismo día de la semana
// anterior, y la semana contra la anterior.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";
import { devueltoParcialPorVenta, devueltoPorDetalle, netearRenglon } from "@/lib/devueltoPorDetalle";
import { pedirJson } from "@/lib/ia";
import { NEGOCIO, leerTarea, type TareaPropuesta } from "@/lib/junta";
import { ENCARGADOS, ES_ENCARGADO, type IdEncargado } from "@/lib/juntaPersonajes";
import { diaDeTexto, equipoParaTareas, resolverPara, tareasParaJunta } from "@/lib/tareasEquipo";
import { enviarMail } from "@/lib/mail";
import { armarMailReporte } from "@/lib/juntaReporteMail";

export type TipoReporte = "DIARIO" | "SEMANAL";

export type Periodo = {
  vendido: number;
  ventas: number;
  ticket: number;
  /** Diario: lo vendido por hora (de 9 a 21). Semanal: por día, de lunes a domingo. */
  barras: { etiqueta: string; valor: number }[];
  marcas: { nombre: string; vendido: number }[];
  productos: { nombre: string; marca: string; vendido: number; unidades: number }[];
  clientesNuevos: number;
};

export type DatosReporte = {
  tipo: TipoReporte;
  titulo: string;
  bajada: string;
  /** Contra qué se compara: "el sábado anterior", "la semana anterior". */
  contra: string;
  actual: Periodo;
  anterior: Periodo;
  tareas: { hechas: number; vencidas: number; pendientes: number };
  tardanzas: number;
};

export type Redaccion = {
  titular: string;
  encargados: { id: IdEncargado; texto: string }[];
  acciones: string[];
  tareas: TareaPropuesta[];
};

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const PAGINA = 1000;
const TANDA = 400;

function sumarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diaDe = (iso: string) => DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

async function todas<T>(armar: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await armar(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return filas;
  }
}

/** Ventas de un rango de días (desde inclusive, hasta exclusive), en hora argentina y sin lo devuelto. */
async function periodo(supabase: SupabaseClient, desde: string, hasta: string, porHora: boolean): Promise<Periodo> {
  const ventas = await todas<{ id_venta: string; fecha: string; total: number | null }>((a, b) =>
    supabase
      .from("ventas")
      .select("id_venta, fecha, total")
      .eq("estado", "PAGADA")
      .gte("fecha", `${desde}T00:00:00-03:00`)
      .lt("fecha", `${hasta}T00:00:00-03:00`)
      .order("fecha", { ascending: true })
      .range(a, b)
  );
  const ids = ventas.map((v) => v.id_venta);
  type Renglon = { id_detalle: string; id_venta: string; id_marca: string | null; id_variante: string | null; cantidad: number | null; subtotal: number | null; precio_unitario: number | null };
  const renglones: Renglon[] = [];
  for (let i = 0; i < ids.length; i += TANDA) {
    const tanda = ids.slice(i, i + TANDA);
    renglones.push(
      ...(await todas<Renglon>((a, b) =>
        supabase.from("detalle_ventas").select("id_detalle, id_venta, id_marca, id_variante, cantidad, subtotal, precio_unitario").in("id_venta", tanda).order("id_detalle").range(a, b)
      ))
    );
  }
  const [devVenta, devRenglon, clientes] = await Promise.all([
    devueltoParcialPorVenta(supabase, ids),
    devueltoPorDetalle(supabase, renglones.map((r) => r.id_detalle)),
    supabase.from("clientes").select("id_cliente", { count: "exact", head: true }).gte("fecha_alta", `${desde}T00:00:00-03:00`).lt("fecha_alta", `${hasta}T00:00:00-03:00`),
  ]);

  const barras = porHora
    ? Array.from({ length: 13 }, (_, i) => ({ etiqueta: String(9 + i), valor: 0 }))
    : DIAS_CORTOS.map((d) => ({ etiqueta: d, valor: 0 }));
  let vendido = 0;
  for (const v of ventas) {
    const neto = Math.max((v.total ?? 0) - (devVenta.get(v.id_venta) ?? 0), 0);
    vendido += neto;
    const f = fechaHoraArgentina(v.fecha);
    if (porHora) {
      const h = Number(f.hora.slice(0, 2));
      const i = Math.min(Math.max(h - 9, 0), 12);
      barras[i].valor += neto;
    } else barras[f.diaSemanaISO - 1].valor += neto;
  }

  const porMarca = new Map<string, number>();
  const porVariante = new Map<string, { idMarca: string; vendido: number; unidades: number }>();
  for (const r of renglones) {
    if (!r.id_marca) continue;
    const n = netearRenglon(r.cantidad, r.subtotal ?? (r.precio_unitario ?? 0) * (r.cantidad ?? 0), devRenglon.get(r.id_detalle));
    porMarca.set(r.id_marca, (porMarca.get(r.id_marca) ?? 0) + n.subtotal);
    if (r.id_variante) {
      const p = porVariante.get(r.id_variante) ?? { idMarca: r.id_marca, vendido: 0, unidades: 0 };
      p.vendido += n.subtotal;
      p.unidades += n.cantidad;
      porVariante.set(r.id_variante, p);
    }
  }
  const topVariantes = [...porVariante.entries()].filter(([, p]) => p.vendido > 0).sort((a, b) => b[1].vendido - a[1].vendido).slice(0, 5);
  const idsMarca = [...porMarca.keys()];
  const [{ data: marcas }, { data: vars }] = await Promise.all([
    idsMarca.length ? supabase.from("marcas").select("id_marca, nombre").in("id_marca", idsMarca) : Promise.resolve({ data: [] as { id_marca: string; nombre: string }[] }),
    topVariantes.length ? supabase.from("variantes_producto").select("id_variante, id_producto, nombre").in("id_variante", topVariantes.map(([id]) => id)) : Promise.resolve({ data: [] as { id_variante: string; id_producto: string; nombre: string }[] }),
  ]);
  const nombreMarca = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const idsProd = [...new Set((vars ?? []).map((v) => v.id_producto as string))];
  const { data: prods } = idsProd.length ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProd) : { data: [] as { id_producto: string; nombre: string }[] };
  const nombreProd = new Map((prods ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
  const varPorId = new Map((vars ?? []).map((v) => [v.id_variante as string, v]));

  const ventasN = ventas.length;
  return {
    vendido: Math.round(vendido),
    ventas: ventasN,
    ticket: ventasN ? Math.round(vendido / ventasN) : 0,
    barras: barras.map((b) => ({ ...b, valor: Math.round(b.valor) })),
    marcas: [...porMarca.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, v]) => ({ nombre: nombreMarca.get(id) ?? "Marca", vendido: Math.round(v) })),
    productos: topVariantes.map(([id, p]) => {
      const v = varPorId.get(id);
      const base = (v && nombreProd.get(v.id_producto as string)) ?? "Producto";
      return { nombre: base + (v?.nombre && v.nombre !== "Único" ? ` — ${v.nombre}` : ""), marca: nombreMarca.get(p.idMarca) ?? "", vendido: Math.round(p.vendido), unidades: p.unidades };
    }),
    clientesNuevos: clientes.count ?? 0,
  };
}

/** Junta los números del reporte. `hoy` es el día en que se arma (el reporte habla de antes). */
export async function datosDelReporte(supabase: SupabaseClient, tipo: TipoReporte, hoy = fechaHoraArgentina()): Promise<DatosReporte> {
  let desde: string, hasta: string, desdeAnt: string, hastaAnt: string, titulo: string, bajada: string, contra: string;
  if (tipo === "DIARIO") {
    desde = sumarDias(hoy.fecha, -1);
    hasta = hoy.fecha;
    desdeAnt = sumarDias(desde, -7);
    hastaAnt = sumarDias(hasta, -7);
    titulo = `Así fue el ${diaDe(desde)} ${ddmm(desde)}`;
    bajada = `Reporte diario de la Junta · ${diaDe(hoy.fecha)} ${ddmm(hoy.fecha)}`;
    contra = `el ${diaDe(desde)} anterior`;
  } else {
    // La semana que terminó: de lunes a domingo.
    hasta = sumarDias(hoy.fecha, -(hoy.diaSemanaISO - 1));
    desde = sumarDias(hasta, -7);
    hastaAnt = desde;
    desdeAnt = sumarDias(desde, -7);
    titulo = `La semana del ${ddmm(desde)} al ${ddmm(sumarDias(hasta, -1))}`;
    bajada = "Reporte semanal de la Junta";
    contra = "la semana anterior";
  }
  const porHora = tipo === "DIARIO";
  const [actual, anterior, tareasJ, tardanzas] = await Promise.all([
    periodo(supabase, desde, hasta, porHora),
    periodo(supabase, desdeAnt, hastaAnt, porHora),
    tareasParaJunta(supabase).catch(() => ({ tareas: [] })),
    supabase.from("sanciones").select("id_sancion", { count: "exact", head: true }).gte("creado_en", `${desde}T00:00:00-03:00`).lt("creado_en", `${hasta}T00:00:00-03:00`),
  ]);
  const activas = tareasJ.tareas.filter((t) => t.estadoTarea === "ACTIVA");
  return {
    tipo,
    titulo,
    bajada,
    contra,
    actual,
    anterior,
    tareas: {
      hechas: activas.filter((t) => t.situacion === "HECHA").length,
      vencidas: activas.filter((t) => t.situacion === "VENCIDA").length,
      pendientes: activas.filter((t) => t.situacion === "PENDIENTE").length,
    },
    tardanzas: tardanzas.error ? 0 : tardanzas.count ?? 0,
  };
}

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;

function resumenParaIA(d: DatosReporte) {
  const a = d.actual;
  const b = d.anterior;
  const linea = (p: Periodo) => `${pesos(p.vendido)} en ${p.ventas} ventas, ticket ${pesos(p.ticket)}, ${p.clientesNuevos} clientes nuevos con DNI`;
  return [
    `# ${d.titulo}`,
    `- Período: ${linea(a)}.`,
    `- Contra ${d.contra}: ${linea(b)}.`,
    `- ${d.tipo === "DIARIO" ? "Por hora" : "Por día"}: ${a.barras.map((x) => `${x.etiqueta} ${pesos(x.valor)}`).join(", ")}.`,
    `- Marcas que más vendieron: ${a.marcas.map((m) => `${m.nombre} ${pesos(m.vendido)}`).join(", ") || "ninguna"}.`,
    `- Productos que más vendieron: ${a.productos.map((p) => `${p.nombre} (${p.marca}) ${pesos(p.vendido)}, ${p.unidades} u.`).join("; ") || "ninguno"}.`,
    `- Tareas del equipo: ${d.tareas.hechas} hechas, ${d.tareas.vencidas} vencidas, ${d.tareas.pendientes} pendientes.`,
    `- Llamados de atención por tardanza en el período: ${d.tardanzas}.`,
  ].join("\n");
}

/** Lo que escriben los encargados: en una sola consulta, para que el reporte sea parejo y barato. */
export async function redactarReporte(d: DatosReporte, contexto: string): Promise<Redaccion> {
  const personajes = ENCARGADOS.map((e) => `- ${e.id}: ${e.nombre}, ${e.area}. ${e.rasgo}`).join("\n");
  const semanal = d.tipo === "SEMANAL";
  const sistema = `${NEGOCIO}

Esta vez no estás en el chat: escribís el reporte ${semanal ? "semanal de los lunes" : "diario de cada mañana"} que le llega a Gonzalo por mail. Hablan los encargados, cada uno desde su área:
${personajes}

Cómo escribirlo:
- "titular": una frase corta que resuma ${semanal ? "la semana" : "el día"} (máximo 12 palabras).
- "encargados": solo los que tienen algo útil para decir, ${semanal ? "entre 3 y 6" : "entre 2 y 4"}. Cada texto, 1 o 2 oraciones, con números reales de los datos. Nunca inventes números.
- "acciones": ${semanal ? "lo que harían o mejorarían esta semana, entre 2 y 4 acciones concretas" : "lo que Gonzalo tiene que resolver hoy, entre 1 y 3 cosas concretas"}.
- "tareas": ${semanal ? "hasta 4 tareas para el equipo del local para esta semana (Gonzalo las aprueba antes)" : "como mucho 1 tarea para el equipo, solo si hace falta de verdad; si no, lista vacía"}. Cada una: {"de": "id del encargado que la propone", "titulo": "...", "para": "todos" o el nombre de un turno o persona, "cuando": "AAAA-MM-DD" o null, "repite": null o el día, "motivo": "..."}.
Respondé SOLO con un JSON: {"titular": "...", "encargados": [{"id": "facu", "texto": "..."}], "acciones": ["..."], "tareas": []}`;
  const r = (await pedirJson([{ texto: sistema }], `${contexto}\n\n${resumenParaIA(d)}`, 2500)) as Record<string, unknown>;
  const encargados = Array.isArray(r.encargados)
    ? r.encargados
        .map((x) => x as Record<string, unknown>)
        .filter((x) => typeof x.id === "string" && ES_ENCARGADO(x.id) && typeof x.texto === "string" && x.texto.trim())
        .map((x) => ({ id: x.id as IdEncargado, texto: (x.texto as string).trim() }))
    : [];
  const tareas = Array.isArray(r.tareas)
    ? r.tareas.flatMap((x) => {
        const t = leerTarea(x);
        const de = (x as Record<string, unknown>)?.de;
        return t ? [{ ...t, de: typeof de === "string" && ES_ENCARGADO(de) ? de : "admin" }] : [];
      })
    : [];
  return {
    titular: typeof r.titular === "string" ? r.titular.trim() : "",
    encargados,
    acciones: Array.isArray(r.acciones) ? r.acciones.filter((x): x is string => typeof x === "string").slice(0, 4) : [],
    tareas: tareas.slice(0, semanal ? 4 : 1),
  };
}

const faltaTabla = (m: string) => /junta_reportes|schema cache|does not exist/i.test(m);

/**
 * Arma, guarda y manda un reporte. No lo repite: si ya hay uno de ese tipo
 * para hoy, no hace nada (salvo que se pida `forzar`, desde la Junta).
 */
export async function generarReporte(
  supabase: SupabaseClient,
  tipo: TipoReporte,
  opciones: { forzar?: boolean; contexto: string; base: string }
): Promise<{ ok: boolean; mensaje: string; idReporte?: string }> {
  const hoy = fechaHoraArgentina();
  if (!opciones.forzar) {
    const { data, error } = await supabase.from("junta_reportes").select("id_reporte").eq("tipo", tipo).eq("fecha", hoy.fecha).limit(1);
    if (error && faltaTabla(error.message)) return { ok: false, mensaje: "Falta correr sql/junta-reportes.sql en Supabase." };
    if (data?.length) return { ok: true, mensaje: "Ya estaba hecho." };
  }

  const datos = await datosDelReporte(supabase, tipo, hoy);
  const redaccion = await redactarReporte(datos, opciones.contexto);

  // Las tareas que proponen quedan esperando aprobación, como las del chat.
  if (redaccion.tareas.length) {
    const equipo = await equipoParaTareas(supabase);
    await supabase.from("tareas_equipo").insert(
      redaccion.tareas.map((t) => {
        const repite = diaDeTexto(t.repite);
        return {
          titulo: t.titulo,
          motivo: t.motivo ?? null,
          propuesta_por: (t as TareaPropuesta & { de?: string }).de ?? "admin",
          ...resolverPara(t.para, equipo),
          repite_dia: repite,
          vence: repite ? null : t.cuando ?? null,
          estado: "PROPUESTA",
        };
      })
    );
  }

  const html = armarMailReporte(datos, redaccion, opciones.base);
  const { data: conf } = await supabase.from("configuracion").select("valor").eq("parametro", "JUNTA_REPORTE_MAIL").maybeSingle();
  const para = String(conf?.valor ?? "")
    .split(/[,\s;]+/)
    .filter((x) => x.includes("@"));
  const textoPlano = [
    datos.titulo,
    redaccion.titular,
    ...redaccion.encargados.map((e) => `${ENCARGADOS.find((x) => x.id === e.id)?.nombre}: ${e.texto}`),
    ...redaccion.acciones.map((a, i) => `${i + 1}. ${a}`),
  ].join("\n");
  const envio = para.length
    ? await enviarMail({ para, asunto: `${datos.titulo} · ${redaccion.titular || "Junta WiiGo"}`, html, texto: textoPlano })
    : { ok: false, error: "No hay mail cargado en JUNTA_REPORTE_MAIL." };

  const { data: fila, error } = await supabase
    .from("junta_reportes")
    .insert({
      tipo,
      fecha: hoy.fecha,
      titulo: datos.titulo,
      titular: redaccion.titular,
      datos,
      redaccion,
      html,
      enviado_a: envio.ok ? para.join(", ") : null,
      error: envio.ok ? null : envio.error,
    })
    .select("id_reporte")
    .single();
  if (error) return { ok: false, mensaje: faltaTabla(error.message) ? "Falta correr sql/junta-reportes.sql en Supabase." : error.message };
  return { ok: true, mensaje: envio.ok ? `Enviado a ${para.join(", ")}.` : `Guardado, pero no se pudo mandar el mail: ${envio.error}`, idReporte: fila.id_reporte as string };
}
