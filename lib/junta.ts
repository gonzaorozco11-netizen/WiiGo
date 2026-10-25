// La Junta: seis encargados con IA que opinan sobre el negocio con los
// números reales. Solo leen y opinan: no tocan nada del sistema.
//
// Cómo se arma cada consulta:
//   1. Se juntan los datos del negocio en un texto (los mismos que ve el Dueño
//      en el Inicio, el Tablero y RR.HH.). Va primero y marcado como fijo:
//      los seis lo reciben igual y Anthropic lo cobra más barato desde la
//      segunda consulta.
//   2. Cada encargado tiene sus instrucciones: de qué es experto y qué le
//      importa. Contesta corto y, si tiene un número para mostrar, una lámina
//      para la pantalla del fondo.
//   3. Con toda la junta, después de los seis, la secretaría arma el resumen.
//
// Se paga por uso (ANTHROPIC_API_KEY, la misma de Aprender): una pregunta a
// toda la junta son siete consultas.

import { pedirJson, pedirTexto, type ParteSistema } from "@/lib/ia";
import { armarTablero } from "@/lib/tablero";
import { armarInicioDueno } from "@/lib/inicioDueno";
import { armarDashboardRrhh } from "@/app/(app)/rrhh/actions";
import { fechaHoraArgentina } from "@/lib/horarios";
import { getSupabaseServerClient } from "@/lib/supabase";
import { tareasParaJunta, type TareaVista } from "@/lib/tareasEquipo";
import { ENCARGADOS, textoLegible, type Encargado, type IdEncargado, type Lamina, type MensajeJunta } from "@/lib/juntaPersonajes";

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Los números del negocio, en texto, para que los lean los encargados. */
export async function datosDelNegocio(): Promise<string> {
  const ahora = fechaHoraArgentina();
  const partes: string[] = [`# Datos de WiiGo (hoy ${ahora.fecha}, ${ahora.hora.slice(0, 5)} hs, hora de Mendoza)`];

  const [tablero, rrhh] = await Promise.all([
    armarTablero().catch(() => null),
    armarDashboardRrhh().catch(() => null),
  ]);

  // Sin sesión (el cron de los reportes) armarTablero no devuelve nada: las
  // ventas del mes se leen directo, que no necesitan permisos.
  const d = tablero?.dueno ?? (await armarInicioDueno(getSupabaseServerClient()).catch(() => null));
  if (d) {
    const variacion = d.vendidoMesAnteriorTramo > 0 ? Math.round((d.vendidoMes / d.vendidoMesAnteriorTramo - 1) * 100) : null;
    partes.push(
      "## Ventas",
      `- Hoy: ${pesos(d.hoy.vendido)} en ${d.hoy.tickets} ventas.`,
      `- ${d.mesNombre} (del 1 al ${d.diaDeHoy}): ${pesos(d.vendidoMes)} en ${d.ticketsMes} ventas, ticket promedio ${pesos(d.ticketPromedio)}, ${d.unidadesMes} unidades.`,
      `- Mismos días de ${d.mesAnteriorNombre}: ${pesos(d.vendidoMesAnteriorTramo)}${variacion === null ? "" : ` (${variacion >= 0 ? "+" : ""}${variacion}%)`}.`,
      d.proyeccion ? `- Al ritmo actual, el mes cerraría en ${pesos(d.proyeccion)}.` : "- Todavía es temprano en el mes para proyectar.",
      d.promedioDiario ? `- Promedio por día con ventas: ${pesos(d.promedioDiario)}.` : "",
      d.parteEfectivo !== null ? `- Cobrado en efectivo: ${pct(d.parteEfectivo)} de lo vendido en el mes.` : "",
      `- Comisión de WiiGo sobre las marcas en consignación, en el mes: ${pesos(d.comisionMarcas)}.`,
      `- Por día de la semana (últimas 8 semanas): ${d.porDiaSemana.map((x) => `${x.etiqueta} ${pesos(x.vendido)}`).join(", ")}.`,
      d.horaPico !== null ? `- Hora con más ventas: ${d.horaPico} hs.` : "",
      "## Marcas en el mes",
      ...d.marcas
        .filter((m) => m.vendido > 0)
        .slice(0, 15)
        .map(
          (m) =>
            `- ${m.nombre}${m.propia ? " (marca propia)" : ""}: ${pesos(m.vendido)}, ${pct(m.parte)} del total, ${m.unidades} u.` +
            (m.variacion === null ? "" : `, ${m.variacion >= 0 ? "+" : ""}${m.variacion}% contra el mes anterior`)
        ),
    );
    const sinVenta = d.marcas.filter((m) => m.vendido === 0 && !m.sinProductos).map((m) => m.nombre);
    if (sinVenta.length) partes.push(`- Marcas activas sin ventas en el mes: ${sinVenta.join(", ")}.`);
    if (d.productos.length) {
      partes.push("## Productos que más facturan en el mes", ...d.productos.map((p) => `- ${p.nombre} (${p.marca}): ${pesos(p.vendido)}, ${p.unidades} u.`));
    }
  } else {
    partes.push("## Ventas", "- No se pudieron leer las ventas en este momento.");
  }

  if (tablero && (tablero.urgentes.length || tablero.seguimiento.length)) {
    partes.push(
      "## Pendientes que marca el sistema",
      ...tablero.urgentes.map((i) => `- URGENTE · ${i.titulo}: ${i.detalle} (${i.valor})`),
      ...tablero.seguimiento.map((i) => `- ${i.titulo}: ${i.detalle} (${i.valor})`),
    );
  }

  if (rrhh) {
    partes.push(
      `## Equipo (${rrhh.periodo})`,
      `- Costo del equipo en el mes: ${pesos(rrhh.costoTotal)}.`,
      `- Ingresos netos de WiiGo (sin IVA): ${pesos(rrhh.ingresos.total)} = comisión ${pesos(rrhh.ingresos.comision)} + venta propia ${pesos(rrhh.ingresos.ventaPropia)} + fees de marcas ${pesos(rrhh.ingresos.fees)}.`,
      rrhh.porcentajeIngresos !== null
        ? `- El equipo cuesta el ${Math.round(rrhh.porcentajeIngresos)}% de los ingresos netos (sano: hasta 35%, mirar: hasta 45%). Para llegar al 35% harían falta ${pesos(rrhh.ingresoParaMeta)} de ingresos netos.`
        : "",
      ...rrhh.turnos.map(
        (t) => `- ${/^turno/i.test(t.nombre) ? t.nombre : `Turno ${t.nombre}`} (${t.horario}, ${t.quien.join(" y ") || "sin asignar"}): cuesta ${pesos(t.cuesta)}, vende ${pesos(t.vende)}, le deja a WiiGo ${pesos(t.ingreso)}.`
      ),
      ...rrhh.grupos.flatMap((g) => g.gente.map((p) => `- ${p.nombre} (${g.nombre}): ${p.estado.texto}.`)),
      ...(rrhh.hoy
        ? [
            rrhh.hoy.trabajando.length ? `- Trabajando ahora: ${rrhh.hoy.trabajando.map((t) => `${t.nombre} desde las ${t.desde}`).join(", ")}.` : "- Ahora no hay nadie fichado.",
            rrhh.hoy.sinFichar.length ? `- Sin fichar hoy: ${rrhh.hoy.sinFichar.join(", ")}.` : "",
          ]
        : []),
      ...rrhh.avisos.map((a) => `- Aviso de RR.HH.: ${a.titulo}. ${a.detalle}`),
    );
  }

  // Las tareas que ya tiene el equipo: para no repetirlas y para seguirlas.
  const { tareas } = await tareasParaJunta(getSupabaseServerClient()).catch(() => ({ tareas: [] as TareaVista[] }));
  const activas = tareas.filter((t) => t.estadoTarea === "ACTIVA");
  const propuestas = tareas.filter((t) => t.estadoTarea === "PROPUESTA");
  if (activas.length || propuestas.length) {
    partes.push(
      "## Tareas del equipo",
      ...activas.map((t) => `- ${t.titulo} (${t.para}, ${t.cuando}): ${t.situacion === "HECHA" ? `hecha por ${t.hecha?.nombre}` : t.situacion === "VENCIDA" ? "VENCIDA sin hacer" : "pendiente"}.`),
      ...propuestas.map((t) => `- Propuesta esperando que Gonzalo la apruebe: ${t.titulo} (${t.para}, ${t.cuando}).`),
    );
  }

  return partes.filter(Boolean).join("\n");
}

export const NEGOCIO = `Sos parte de la junta de WiiGo, una mesa de seis encargados que asesoran al dueño.

WiiGo es una "Estación de Bienestar": un concepto nuevo que creó WiiGo (no se presenta como dietética). La primera estación está en Arístides Villanueva 256, Mendoza, y la visión es ser referente del retail saludable y llegar a todo el país con más estaciones. Reúne marcas saludables, con trayectoria o nuevas, con tres diferenciales: sinergia entre marcas (precio y calidad), tecnología (tótem de autocompra con QR de Mercado Pago o efectivo, pantallas asesoras) y profesionales de la salud (las nutricionistas aparecen en las pantallas asesoras y el cliente saca turno; no están en el local). Hay venta en el local y pronto tienda online con retiro o envío. El cliente se registra con su DNI y suma puntos WiiGo.

Cómo gana plata: la mayoría de las marcas están en consignación. WiiGo cobra un royalty sobre lo que vende cada marca (hoy 5%) y aparte un plan mensual (fee). También vende su marca propia, WiiGo Dietética (productos fraccionados en el local). Cada producto tiene precio de lista y precio en efectivo.

El equipo: dos operativos en el local por turnos, que atienden, asesoran, reponen, limpian y generan contenido. Administración: Agostina. Finanzas: Nicanor. Marketing: Martina. Contador: Agustín. (Son personas reales; vos sos un asesor y no las reemplazás.)

El dueño se llama Gonzalo. No es programador. Quiere que le hablen directo y simple, sin jerga, y que le avisen lo estratégico que no está viendo.

Reglas para contestar:
- Hablás en español rioplatense, de vos, como una persona de la mesa. Corto: entre 2 y 4 oraciones, salvo que Gonzalo pida detalle.
- Usás solo los números de "Datos de WiiGo". Si un dato no está, lo decís y decís qué habría que cargar para tenerlo. Nunca inventás números.
- Solo opinás y proponés. No podés cambiar nada del sistema, ni mandar mensajes, ni pagar nada.
- En temas legales o de impuestos orientás, y decís que lo confirme con Agustín.
- Terminás con una recomendación concreta, no con una lista de opciones.`;

const ENFOQUE: Record<IdEncargado, string> = {
  lola: "Sos Lola, encargada de Marketing. Creativa y práctica. Pensás en que conozcan a WiiGo y al concepto de Estación de Bienestar: Instagram y contenido (que generan los operativos en el local, siempre aprobado por WiiGo), clientes nuevos, que dejen su DNI (el canje de puntos todavía está apagado: no prometas canjes), eventos y degustaciones con las marcas, y la tienda online. Proponés acciones baratas y medibles.",
  bruno: "Sos Bruno, encargado de Finanzas. Cuidás cada peso y siempre preguntás cuánto rinde. Mirás lo que le queda a WiiGo (comisión, venta propia, fees), los gastos fijos, el costo del equipo contra los ingresos netos, el efectivo y Mercado Pago, y si una idea paga lo que cuesta. Hacés las cuentas con los números que hay y decís el punto de equilibrio cuando sirve.",
  ines: "Sos Inés, encargada de Contabilidad e impuestos. Prolija. Mirás que todo se facture, IVA, ingresos brutos, vencimientos, los papeles de las marcas y de los empleados. WiiGo es NUOVO IMPERO SAS, responsable inscripta en IVA. Orientás con claridad y siempre recomendás confirmar con Agustín, el contador.",
  facu: "Sos Facu, encargado de Ventas. Vivís en el salón: ticket promedio, cuántas ventas, horarios y días fuertes, qué se vende y qué no, la góndola (son 5 módulos), el tótem y la experiencia del cliente. Proponés cosas concretas para vender más: ubicación, combos, productos de impulso, cómo asesorar.",
  carmen: "Sos Carmen, encargada de Personal. Mirás al equipo: turnos, fichaje y tardanzas, que cumplan el manual, el clima, la capacitación y que el costo del equipo sea sano. Sos cálida pero firme. En temas laborales legales orientás y recomendás confirmarlos con Agustín.",
  julian: "Sos Julián, encargado de Marcas. Sos el comercial con las marcas en consignación: cuáles rinden y cuáles no, a cuáles reponer, qué categorías faltan, qué marcas nuevas sumar, cómo negociar degustaciones o exhibición, y cuándo conviene liberar espacio de una marca que no vende.",
};

// Texto normal y la lámina aparte, en la última línea: si la respuesta se
// cortara, lo escrito igual se lee bien (con JSON, un corte lo arruinaba todo).
const FORMATO_ENCARGADO = `Cómo contestar:
- Escribí lo que le decís a Gonzalo como texto normal: sin JSON, sin títulos, sin viñetas, sin negritas. Entre 2 y 4 oraciones, como máximo 90 palabras.
- Si tenés un número real que valga la pena mostrar en la pantalla de la sala, agregá al final UNA sola línea que empiece con LAMINA: y un JSON en esa misma línea, así:
LAMINA: {"titulo": "título corto", "grande": "el número o la frase corta", "detalle": "una línea que lo explica"}
Para comparar varios valores (por ejemplo, ventas por día), en vez de "grande" usá "barras": [{"etiqueta": "Lun", "valor": 123}], hasta 8.
- Si no tenés un número para mostrar, no agregues esa línea.
- Si conviene darle una tarea concreta al equipo del local (o Gonzalo te pide tareas), agregá al final una línea por tarea, como máximo 3, así:
TAREA: {"titulo": "qué hay que hacer, corto y claro", "para": "todos", "cuando": "AAAA-MM-DD", "repite": null, "motivo": "por qué, en una línea"}
"para" es "todos", el nombre de un turno o el nombre de una persona del equipo, tal como aparecen en los Datos. "cuando" es la fecha para la que tiene que estar, o null. Si se repite cada semana, "repite" es el día ("viernes") y "cuando" va null. Solo tareas que pueda hacer el equipo del local, no Gonzalo. Gonzalo las aprueba antes de que le lleguen a nadie; en tu texto podés decir que le dejás la propuesta.`;

/** Lo que se habló antes en este hilo, para que sigan la conversación. */
function conversacionPrevia(historial: MensajeJunta[]) {
  if (!historial.length) return "";
  const nombre = (autor: MensajeJunta["autor"]) =>
    autor === "gonzalo" ? "Gonzalo" : autor === "resumen" ? "Resumen de la junta" : ENCARGADOS.find((e) => e.id === autor)?.nombre ?? autor;
  return `Lo que se habló hasta ahora:\n${historial.map((m) => `${nombre(m.autor)}: ${m.texto}${m.puntos?.length ? ` (${m.puntos.join("; ")})` : ""}`).join("\n")}\n\n`;
}

export function leerLamina(x: unknown): Lamina | null {
  if (!x || typeof x !== "object") return null;
  const l = x as Record<string, unknown>;
  const titulo = typeof l.titulo === "string" ? l.titulo.slice(0, 60) : "";
  if (!titulo) return null;
  const barras = Array.isArray(l.barras)
    ? l.barras
        .map((b) => b as Record<string, unknown>)
        .filter((b) => typeof b.etiqueta === "string" && Number.isFinite(Number(b.valor)))
        .slice(0, 8)
        .map((b) => ({ etiqueta: String(b.etiqueta).slice(0, 8), valor: Number(b.valor) }))
    : undefined;
  const grande = typeof l.grande === "string" ? l.grande.slice(0, 40) : undefined;
  if (!grande && !barras?.length) return null;
  return { titulo, grande, detalle: typeof l.detalle === "string" ? l.detalle.slice(0, 120) : undefined, barras: barras?.length ? barras : undefined };
}

/** Lo que propone un encargado como tarea, tal cual lo escribió. */
export type TareaPropuesta = { titulo: string; para?: string; cuando?: string | null; repite?: string | null; motivo?: string };

function jsonDeLinea(linea: string): unknown {
  const inicio = linea.indexOf("{");
  const fin = linea.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) return null;
  try {
    return JSON.parse(linea.slice(inicio, fin + 1));
  } catch {
    return null;
  }
}

export function leerTarea(x: unknown): TareaPropuesta | null {
  if (!x || typeof x !== "object") return null;
  const t = x as Record<string, unknown>;
  const titulo = typeof t.titulo === "string" ? t.titulo.trim().slice(0, 140) : "";
  if (!titulo) return null;
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const cuando = texto(t.cuando);
  return {
    titulo,
    para: texto(t.para) ?? undefined,
    cuando: cuando && /^\d{4}-\d{2}-\d{2}$/.test(cuando) ? cuando : null,
    repite: texto(t.repite),
    motivo: texto(t.motivo)?.slice(0, 240) ?? undefined,
  };
}

/**
 * Lee lo que contestó un encargado: el texto, la lámina (LAMINA: {...}) y las
 * tareas que propone (TAREA: {...}), cada una en su línea. Si una de esas
 * líneas viene rota, se pierde solo esa.
 */
function leerOpinion(texto: string): { respuesta: string; lamina: Lamina | null; tareas: TareaPropuesta[] } {
  const lineas = texto.split("\n");
  let lamina: Lamina | null = null;
  const tareas: TareaPropuesta[] = [];
  const cuerpo: string[] = [];
  for (const linea of lineas) {
    const l = linea.trim().replace(/^[-*]\s*/, "");
    if (l.startsWith("LAMINA:")) lamina = leerLamina(jsonDeLinea(l)) ?? lamina;
    else if (l.startsWith("TAREA:")) {
      const t = leerTarea(jsonDeLinea(l));
      if (t && tareas.length < 3) tareas.push(t);
    } else cuerpo.push(linea);
  }
  const respuesta = textoLegible(cuerpo.join("\n").replace(/```[a-z]*|```/gi, "").replace(/\*\*/g, ""));
  if (!respuesta) throw new Error("La inteligencia artificial no devolvió ninguna respuesta.");
  return { respuesta, lamina, tareas };
}

async function opinar(e: Encargado, datos: string, previo: string, pregunta: string, conJunta: boolean) {
  const sistema: ParteSistema[] = [
    { texto: `${NEGOCIO}\n\n${datos}`, fija: true },
    { texto: `${ENFOQUE[e.id]}\n\n${FORMATO_ENCARGADO}` },
  ];
  const pedido = `${previo}${conJunta ? "Gonzalo le lleva este tema a toda la junta. Opiná desde tu área, sin repetir lo que dirían los demás" : "Gonzalo te habla a vos"}:\n${pregunta}`;
  return leerOpinion(await pedirTexto(sistema, pedido, 1200));
}

export type RespuestaJunta = {
  respuestas: { autor: IdEncargado; texto: string; lamina: Lamina | null; tareas: TareaPropuesta[] }[];
  resumen: { texto: string; puntos: string[]; lamina: Lamina | null } | null;
};

/** Le pregunta a un encargado, o a los seis y arma el resumen. */
export async function consultar(destino: IdEncargado | "junta", pregunta: string, historial: MensajeJunta[]): Promise<RespuestaJunta> {
  const datos = await datosDelNegocio();
  const previo = conversacionPrevia(historial);

  if (destino !== "junta") {
    const e = ENCARGADOS.find((x) => x.id === destino)!;
    const r = await opinar(e, datos, previo, pregunta, false);
    return { respuestas: [{ autor: e.id, texto: r.respuesta, lamina: r.lamina, tareas: r.tareas }], resumen: null };
  }

  // El primero solo y después los otros cinco a la vez: así el primero deja
  // guardados los datos del negocio y los demás los leen de ahí, más rápido,
  // más barato y sin pasarse del límite por minuto de la cuenta. Si a uno le
  // falla, la junta sigue con los demás.
  const errores: string[] = [];
  const preguntarA = (e: Encargado) =>
    opinar(e, datos, previo, pregunta, true)
      .then((r) => ({ autor: e.id, texto: r.respuesta, lamina: r.lamina, tareas: r.tareas }))
      .catch((err: unknown) => {
        const motivo = err instanceof Error ? err.message : String(err);
        console.error(`[junta] ${e.nombre} no pudo responder: ${motivo}`);
        errores.push(motivo);
        return null;
      });
  const [primero, ...resto] = ENCARGADOS;
  const opiniones = [await preguntarA(primero), ...(await Promise.all(resto.map(preguntarA)))];
  const respuestas = opiniones.filter((o): o is NonNullable<typeof o> => o !== null);
  if (!respuestas.length) throw new Error(`La junta no pudo responder. ${errores[0] ?? "Probá de nuevo en un minuto."}`);

  const sistema: ParteSistema[] = [
    { texto: `${NEGOCIO}\n\n${datos}`, fija: true },
    {
      texto: `Sos la secretaría de la junta: no opinás, juntás lo que dijeron los encargados y lo dejás claro para que Gonzalo decida. Marcá en qué coinciden y en qué no, y qué conviene hacer.
Respondé SOLO con un JSON: {"resumen": "una o dos oraciones", "puntos": ["acción concreta 1", "acción concreta 2"], "lamina": {"titulo": "Resumen de la junta", "grande": "la decisión en pocas palabras", "detalle": "una línea"}}. Entre 2 y 4 puntos.`,
    },
  ];
  const dichos = respuestas.map((r) => `${ENCARGADOS.find((e) => e.id === r.autor)!.nombre} (${ENCARGADOS.find((e) => e.id === r.autor)!.area}): ${r.texto}`).join("\n");
  let resumen: RespuestaJunta["resumen"] = null;
  try {
    const r = (await pedirJson(sistema, `${previo}Tema de Gonzalo: ${pregunta}\n\nLo que dijo cada uno:\n${dichos}`, 1200)) as {
      resumen?: unknown;
      puntos?: unknown;
      lamina?: unknown;
    };
    resumen = {
      texto: typeof r.resumen === "string" ? r.resumen : "",
      puntos: Array.isArray(r.puntos) ? r.puntos.filter((p): p is string => typeof p === "string").slice(0, 4) : [],
      lamina: leerLamina(r.lamina),
    };
  } catch {
    // Sin resumen igual quedan las seis opiniones.
  }
  return { respuestas, resumen };
}
