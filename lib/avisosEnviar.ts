import { getSupabaseServerClient } from "@/lib/supabase";
import { enviarMail, plantilla } from "@/lib/mail";
import { baseUrlPublica } from "@/lib/urlPublica";
import { fechaHoraArgentina } from "@/lib/horarios";
import { TOPE_DIARIO, avisoPrendido, type TipoAviso } from "@/lib/avisosMarca";
import { avisarProfesionalPorVenta } from "@/lib/avisosProfesional";
import { avisarVentaAlDueno } from "@/lib/resumenTurno";
import { vendidoParaReponer, totalParaTraer } from "@/lib/reponerVendido";

// Mandar los avisos.
//
// Dos intentos fallidos antes de llegar acá, los dos por lo mismo, y los dos
// perdiendo mails en silencio:
//
//   1. `after()`. La tarea corre cuando la respuesta ya se fue; si Vercel
//      apaga la función antes de que termine, nadie se entera.
//   2. Esperarlo adentro de la venta con un techo de 2500 ms. Medido después:
//      la cadena tardaba 2973 ms SOLO en consultar la base —siete consultas
//      una atrás de la otra— así que se abandonaba antes de llamar a Resend y
//      no quedaba ni registro del intento. De tres ventas seguidas llegó una.
//
// Ahora los avisos de venta corren en su propio pedido (/api/avisos/venta,
// que dispara la pantalla apenas la venta se cerró). Nadie los espera, así que
// no hay techo que los corte, y el cajero no espera por un mail.
//
// Y las consultas dejaron de ir en fila: lo que no depende de lo anterior va
// junto, y las dos parejas que eran dos viajes cada una ahora son uno solo con
// join. De siete viajes seriales a tres.
//
// Nada de acá tira. Cada función está envuelta: si falla una consulta, si
// Resend contesta mal, si no hay clave configurada, se registra y se sigue.
// La venta ya pasó; el mail es lo accesorio.

type Marca = { idMarca: string; nombre: string; avisos: Record<string, unknown>; mails: string[] };

function pesos(v: number) {
  return `$${Math.round(v).toLocaleString("es-AR")}`;
}

/** Los datos de aviso de varias marcas, en una consulta. */
async function marcasPara(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  ids: string[]
): Promise<Map<string, Marca>> {
  const salida = new Map<string, Marca>();
  if (ids.length === 0) return salida;

  // Las columnas se agregan con sql/avisos-marca.sql. Si todavía no se corrió,
  // esto falla y no se manda nada — que es exactamente lo que queremos.
  const { data, error } = await supabase
    .from("marcas")
    .select("id_marca, nombre, avisos, avisos_mails")
    .in("id_marca", ids);
  if (error) return salida;

  for (const m of data ?? []) {
    salida.set(m.id_marca as string, {
      idMarca: m.id_marca as string,
      nombre: (m.nombre as string) ?? "tu marca",
      avisos: (m.avisos as Record<string, unknown>) ?? {},
      mails: ((m.avisos_mails as string[] | null) ?? []).filter(Boolean),
    });
  }
  return salida;
}

/**
 * ¿Se puede mandar este aviso, o ya se mandaron demasiados hoy?
 *
 * También corta el repetido: con la misma `referencia` no se manda dos veces
 * en el día. Sin eso, dos ventas seguidas del mismo producto agotado serían
 * dos mails iguales.
 */
async function sePuedeMandar(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  idMarca: string,
  tipo: TipoAviso,
  referencia: string | null
): Promise<boolean> {
  const hoy = fechaHoraArgentina().fecha;
  const { data, error } = await supabase
    .from("avisos_enviados")
    .select("referencia")
    .eq("id_marca", idMarca)
    .eq("tipo", tipo)
    .eq("ok", true)
    // Las 00:00 de Argentina son las 03:00 UTC. Sin la zona, la base lo leía en
    // UTC y el «día» del tope arrancaba a las 21:00 del día anterior.
    .gte("enviado_el", `${hoy}T03:00:00Z`);
  if (error) return false;

  const mandados = data ?? [];
  if (referencia && mandados.some((m) => m.referencia === referencia)) return false;

  // Cuando frena el tope queda anotado. Un aviso que no sale y no deja rastro
  // es media hora de buscar por qué no llegó un mail: ya pasó.
  if (mandados.length >= (TOPE_DIARIO[tipo] ?? 5)) {
    await supabase.from("avisos_enviados").insert({
      id_marca: idMarca,
      tipo,
      referencia,
      asunto: "No se mandó: tope del día alcanzado",
      ok: false,
      error: `Ya iban ${mandados.length} de tipo ${tipo} hoy.`,
    });
    return false;
  }
  return true;
}

async function registrar(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  fila: {
    idMarca: string;
    tipo: TipoAviso;
    referencia: string | null;
    asunto: string;
    destinatarios: string[];
    ok: boolean;
    error: string | null;
  }
) {
  await supabase.from("avisos_enviados").insert({
    id_marca: fila.idMarca,
    tipo: fila.tipo,
    referencia: fila.referencia,
    asunto: fila.asunto,
    destinatarios: fila.destinatarios,
    ok: fila.ok,
    error: fila.error,
  });
}

/** Mandar, registrar y no tirar nunca. */
async function mandar(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  marca: Marca,
  tipo: TipoAviso,
  referencia: string | null,
  asunto: string,
  html: string,
  texto: string
) {
  const r = await enviarMail({ para: marca.mails, asunto, html, texto });
  await registrar(supabase, {
    idMarca: marca.idMarca,
    tipo,
    referencia,
    asunto,
    destinatarios: marca.mails,
    ok: r.ok,
    error: r.error,
  });
}

/**
 * Una venta recién cerrada: avisar a cada marca que vendió algo.
 *
 * Dos avisos distintos salen de acá, porque pasan en el mismo momento: que
 * vendió, y que con esa venta se le terminó un producto. Y si la venta fue
 * con el código de una profesional, a ella: «¡Un paciente usó tu código!».
 * Van a la par: el de una no espera al de la otra.
 */
export async function avisarVenta(idVenta: string, idLocal: string): Promise<void> {
  // Y al dueño, si lo tiene prendido en Configuración → Ventas por mail.
  await Promise.all([avisarMarcasPorVenta(idVenta, idLocal), avisarProfesionalPorVenta(idVenta), avisarVentaAlDueno(idVenta)]);
}

async function avisarMarcasPorVenta(idVenta: string, idLocal: string): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();

    const { data: renglones } = await supabase
      .from("detalle_ventas")
      .select("id_marca, id_variante, cantidad, subtotal, precio_unitario")
      .eq("id_venta", idVenta);
    if (!renglones || renglones.length === 0) return;

    const idsMarca = [...new Set(renglones.map((r) => r.id_marca as string).filter(Boolean))];

    // Las dos no dependen una de la otra: juntas son un viaje, no dos.
    const [marcas, nombres] = await Promise.all([
      marcasPara(supabase, idsMarca),
      nombresDeVariante(supabase, [...new Set(renglones.map((r) => r.id_variante as string))]),
    ]);
    if (marcas.size === 0) return;

    const base = baseUrlPublica();
    const hoy = fechaHoraArgentina().fecha;

    // Cada marca es independiente de las demás: si una tarda, no puede
    // demorar el aviso de otra.
    await Promise.all(
      idsMarca.map(async (idMarca) => {
        const marca = marcas.get(idMarca);
        if (!marca || marca.mails.length === 0) return;

        const suyos = renglones.filter((r) => r.id_marca === idMarca);

        await Promise.all([
          (async () => {
            if (!avisoPrendido(marca.avisos, "venta")) return;
            if (!(await sePuedeMandar(supabase, idMarca, "venta", idVenta))) return;
            await avisarQueVendio(supabase, marca, suyos, nombres, idVenta, idLocal, hoy, base);
          })(),
          (async () => {
            if (!avisoPrendido(marca.avisos, "agotado")) return;
            await avisarAgotados(supabase, marca, suyos, nombres, idLocal, base);
          })(),
        ]);
      })
    );
  } catch {
    // Silencio a propósito: la venta ya está cerrada y cobrada.
  }
}

async function avisarQueVendio(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  marca: Marca,
  suyos: Record<string, unknown>[],
  nombres: Map<string, string>,
  idVenta: string,
  idLocal: string,
  hoy: string,
  base: string
) {
  const montoVenta = suyos.reduce((a, r) => a + ((r.subtotal as number) ?? 0), 0);
  const unidades = suyos.reduce((a, r) => a + ((r.cantidad as number) ?? 0), 0);
  const principal = nombres.get(suyos[0].id_variante as string) ?? "tu producto";

  // El total del día es lo que convierte el aviso en algo lindo de recibir:
  // una venta suelta es un dato, "van siete hoy" es que la marca se mueve.
  const dia = await loDeHoy(supabase, marca.idMarca, idLocal, hoy);

  const hora = fechaHoraArgentina().hora;

  // «Se vendió uno, traé uno» (16/11): cuánto lleva para traer de este producto y en total.
  let reponer = "";
  try {
    const vend = await vendidoParaReponer(supabase, marca.idMarca, idLocal);
    const total = totalParaTraer(vend);
    if (total > 0) {
      const deEste = vend.get(suyos[0].id_variante as string)?.traer ?? 0;
      reponer = `🔁 ${suyos.length === 1 && deEste > 0 ? `Ya van ${deEste} de este para traer · ` : ""}${total} en total para traer`;
    }
  } catch {
    // Sin la línea, el aviso sale igual.
  }

  // La lista solo cuando hay más de un renglón. Con uno solo repite lo que ya
  // dice el bloque de arriba, y un mail que se repite se lee como relleno.
  const lista =
    suyos.length > 1
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${suyos
          .map((r) => {
            const n = nombres.get(r.id_variante as string) ?? "Producto";
            return `<tr><td style="padding:7px 0;border-top:1px solid #eef1e9">${n}</td><td style="padding:7px 0;border-top:1px solid #eef1e9;text-align:right;white-space:nowrap">${r.cantidad} × ${pesos((r.precio_unitario as number) ?? 0)}</td></tr>`;
          })
          .join("")}</table>`
      : "";

  const asunto =
    unidades === 1
      ? `🎉 ¡Vendiste! ${principal} — ${pesos(montoVenta)}`
      : `🎉 ¡Vendiste ${unidades} unidades! — ${pesos(montoVenta)}`;

  // La racha es lo que convierte una venta suelta en un día que se mueve. Con
  // una sola venta todavía no hay racha que contar, así que se dice otra cosa
  // en vez de inventar un número.
  const franja =
    dia.ventas > 1
      ? {
          titulo: `🔥 Van ${dia.ventas} ventas tuyas hoy`,
          texto: `Sumaron <strong>${pesos(dia.monto)}</strong>.`,
        }
      : {
          titulo: "Es tu primera venta de hoy",
          texto: "A medida que sumes te vamos contando cómo viene el día.",
        };

  const texto = `¡Vendiste! ${principal}. ${pesos(montoVenta)}. Hoy van ${dia.ventas} ventas tuyas, ${pesos(dia.monto)}.`;

  await mandar(
    supabase,
    marca,
    "venta",
    idVenta,
    asunto,
    plantilla({
      base,
      tono: "verde",
      emoji: "🎉",
      titulo: `¡Vendiste, ${marca.nombre}!`,
      bajada: "Recién se lo llevaron de tu góndola.",
      destacado: pesos(montoVenta),
      detalle: [
        `<strong style="color:#2a2f26">${suyos.length > 1 ? `${suyos.length} productos tuyos` : principal}</strong>`,
        `${unidades} ${unidades === 1 ? "unidad" : "unidades"} · hoy ${hora}`,
        ...(reponer ? [`<strong style="color:#a34713">${reponer}</strong>`] : []),
      ],
      franja,
      cuerpo: lista,
      boton: reponer ? { texto: "Ver qué reponer", url: `${base}/portal/reponer` } : { texto: "Ver cómo venís este mes", url: `${base}/portal` },
      nota: "Lo que te queda de cada venta sale en tu próxima liquidación.",
      pie: `Te escribimos porque tenés prendido «Cada vez que vendés algo». <a href="${base}/portal/avisos" style="color:#8d9587">Cambiar mis avisos</a> · WiiGo, Mendoza`,
    }),
    texto
  );
}

async function avisarAgotados(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  marca: Marca,
  suyos: Record<string, unknown>[],
  nombres: Map<string, string>,
  idLocal: string,
  base: string
) {
  const ids = suyos.map((r) => r.id_variante as string);
  const { data: stock } = await supabase
    .from("stock")
    .select("id_variante, cantidad")
    .eq("id_local", idLocal)
    .in("id_variante", ids);

  const agotados = (stock ?? [])
    .filter((s) => ((s.cantidad as number) ?? 0) <= 0)
    .map((s) => s.id_variante as string);
  if (agotados.length === 0) return;

  // La referencia junta las variantes agotadas: si en la misma venta se
  // terminan dos, es un solo mail.
  const referencia = agotados.slice().sort().join(",");
  if (!(await sePuedeMandar(supabase, marca.idMarca, "agotado", referencia))) return;

  const uno = agotados.length === 1;
  const hora = fechaHoraArgentina().hora;

  const lista = uno
    ? ""
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${agotados
        .map(
          (id) =>
            `<tr><td style="padding:7px 0;border-top:1px solid #eef1e9">${nombres.get(id) ?? "Producto"}</td></tr>`
        )
        .join("")}</table>`;

  const asunto = uno
    ? `Se agotó ${nombres.get(agotados[0]) ?? "un producto tuyo"}`
    : `Se agotaron ${agotados.length} productos tuyos`;

  // Mismo molde que el de venta —franja con el logo, bloque grande, un botón—
  // pero en ámbar y sin emoji de fiesta. Si este mail también festejara, "se
  // agotó" se leería como buena noticia y nadie iría a reponer.
  //
  // Lo grande acá es el PRODUCTO y no la plata: el dato que mueve a mandar
  // mercadería es cuál se cayó.
  await mandar(
    supabase,
    marca,
    "agotado",
    referencia,
    asunto,
    plantilla({
      base,
      tono: "ambar",
      emoji: "📦",
      titulo: "Te quedaste sin stock",
      bajada: "Mientras no esté en la góndola, no se vende.",
      destacado: uno ? (nombres.get(agotados[0]) ?? "Un producto tuyo") : `${agotados.length} productos`,
      destacadoChico: uno,
      detalle: [`Se agotó hoy ${hora}`],
      cuerpo: lista,
      boton: { texto: "Avisar que lo repongo", url: `${base}/portal/productos` },
      nota: "En el portal te decimos cuánto conviene mandar, calculado con lo que venías vendiendo. Si mandás eso o menos, queda aprobado solo.",
      pie: `Te escribimos porque tenés prendido «Se agotó un producto tuyo». <a href="${base}/portal/avisos" style="color:#8d9587">Cambiar mis avisos</a> · WiiGo, Mendoza`,
    }),
    `${asunto}. Entrá a ${base}/portal/productos para armar el envío.`
  );
}

/**
 * Cuántas ventas y cuánta plata lleva hoy esta marca en este local.
 *
 * Un solo viaje: antes eran dos —traer las ventas del día y después sus
 * renglones— y esos 500 ms de más eran parte de por qué el aviso no llegaba.
 */
async function loDeHoy(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  idMarca: string,
  idLocal: string,
  hoy: string
): Promise<{ ventas: number; monto: number }> {
  const { data } = await supabase
    .from("detalle_ventas")
    .select("id_venta, subtotal, ventas!inner(estado, id_local, fecha)")
    .eq("id_marca", idMarca)
    .eq("ventas.estado", "PAGADA")
    .eq("ventas.id_local", idLocal)
    // El día de Argentina: de las 03:00 UTC a las 03:00 UTC del día siguiente.
    .gte("ventas.fecha", `${hoy}T03:00:00Z`)
    .lt("ventas.fecha", new Date(Date.parse(`${hoy}T03:00:00Z`) + 86400000).toISOString());

  const renglones = data ?? [];
  return {
    ventas: new Set(renglones.map((r) => r.id_venta as string)).size,
    monto: renglones.reduce((a, r) => a + ((r.subtotal as number) ?? 0), 0),
  };
}

/** El nombre que ve la marca: producto, y la variante si no es la única. */
async function nombresDeVariante(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  ids: string[]
): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  if (ids.length === 0) return salida;

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, nombre, productos!inner(nombre)")
    .in("id_variante", ids);

  for (const v of variantes ?? []) {
    const prod = ((v.productos as { nombre?: string } | null)?.nombre as string) ?? "Producto";
    const vari = (v.nombre as string) ?? "";
    salida.set(v.id_variante as string, vari && vari !== "Único" ? `${prod} — ${vari}` : prod);
  }
  return salida;
}

/**
 * Una solicitud que acaba de resolverse.
 *
 * El motivo del rechazo va adentro del mail y no solo en el portal: si la
 * marca tiene que entrar a buscarlo, no entra, y la semana que viene vuelve a
 * mandar lo mismo.
 */
export async function avisarSolicitudResuelta(idSolicitud: string): Promise<void> {
  // Ya no manda un mail por cada solicitud (17/11): el 16/11 Gonzalo aprobó 16
  // de Animalfit en un minuto, salieron 10 mails y 6 se frenaron por el tope.
  // Ahora las respuestas salen juntas, en un solo mail por marca, desde el cron
  // /api/cron/avisos-solicitudes (avisarSolicitudesAgrupadas). Queda la función
  // para no tocar a quienes la llaman.
  void idSolicitud;
}

/** Cuánto se espera después de la última respuesta antes de mandar el mail: así un lote de aprobaciones sale junto. */
const ESPERA_LOTE_MS = 3 * 60 * 1000;
const PREFIJO_LOTE = "lote-hasta:";

const NOMBRE_TIPO: Record<string, string> = {
  PRECIO: "Precio",
  PRODUCTO_NUEVO: "Producto nuevo",
  DESCRIPCION: "Descripción",
  FICHA: "Información nutricional",
  NOMBRE: "Nombre",
  FOTO: "Foto",
  COMBO_PRECIO: "Precio de combo",
  COMBO_NUEVO: "Combo nuevo",
  BAJA: "Baja",
};

function escaparHtml(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Las respuestas a solicitudes, juntas: un mail por marca con todo lo que se
 * aprobó o no desde el último mail. Lo llama el cron cada 10 minutos. Espera a
 * que pasen 3 minutos de la última respuesta, para no partir un lote al medio.
 *
 * Hasta dónde se avisó queda en la `referencia` del último mail mandado
 * («lote-hasta:<fecha>»): el próximo arranca desde ahí y no se pierde ni se
 * repite ninguna.
 */
export async function avisarSolicitudesAgrupadas(): Promise<{ marcas: number; solicitudes: number }> {
  const supabase = getSupabaseServerClient();
  const ahora = Date.now();
  const corte = new Date(ahora - ESPERA_LOTE_MS).toISOString();
  // La primera vez (sin mails de lote todavía) se mira solo el último día: lo
  // de antes ya se avisó con el sistema viejo.
  const piso = new Date(ahora - 24 * 3600 * 1000).toISOString();

  const { data: resueltas } = await supabase
    .from("solicitudes_marca")
    .select("id_solicitud, id_marca, id_producto, tipo, estado, motivo, datos, resuelta_el")
    .in("estado", ["APROBADA", "APLICADA", "RECHAZADA"])
    .gt("resuelta_el", piso)
    .order("resuelta_el");
  const porMarca = new Map<string, NonNullable<typeof resueltas>>();
  for (const s of resueltas ?? []) {
    const id = s.id_marca as string;
    porMarca.set(id, [...(porMarca.get(id) ?? []), s]);
  }

  let marcasAvisadas = 0;
  let total = 0;
  const marcas = await marcasPara(supabase, [...porMarca.keys()]);
  for (const [idMarca, lista] of porMarca) {
    try {
      // Si la última respuesta es de hace menos de 3 minutos, todavía puede
      // estar aprobando: se espera al próximo cron.
      const ultima = lista[lista.length - 1].resuelta_el as string;
      if (ultima > corte) continue;

      const { data: previo } = await supabase
        .from("avisos_enviados")
        .select("referencia")
        .eq("id_marca", idMarca)
        .eq("tipo", "solicitud")
        .eq("ok", true) // si el mail falló, el próximo cron lo vuelve a intentar
        .like("referencia", `${PREFIJO_LOTE}%`)
        .order("enviado_el", { ascending: false })
        .limit(1);
      const desde = (previo?.[0]?.referencia as string | undefined)?.slice(PREFIJO_LOTE.length) ?? piso;
      const nuevas = lista.filter((s) => (s.resuelta_el as string) > desde);
      if (nuevas.length === 0) continue;
      const referencia = `${PREFIJO_LOTE}${ultima}`;

      const marca = marcas.get(idMarca);
      // Sin mail o con el aviso apagado: se anota igual el lote, para no
      // mandarlo de golpe el día que lo prenda.
      if (!marca || marca.mails.length === 0 || !avisoPrendido(marca.avisos, "solicitud")) {
        await registrar(supabase, { idMarca, tipo: "solicitud", referencia, asunto: "Sin mandar: aviso apagado o sin mail", destinatarios: [], ok: true, error: null });
        continue;
      }
      if (!(await sePuedeMandar(supabase, idMarca, "solicitud", referencia))) continue;

      const idsProd = [...new Set(nuevas.map((s) => s.id_producto as string | null).filter((x): x is string => Boolean(x)))];
      const { data: prods } = idsProd.length
        ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProd)
        : { data: [] };
      const nombreProd = new Map((prods ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
      const deQue = (s: (typeof nuevas)[number]) => {
        const datos = (s.datos as Record<string, unknown> | null) ?? {};
        const nombre = nombreProd.get(s.id_producto as string) ?? (datos.nombre as string | undefined) ?? "";
        return `${NOMBRE_TIPO[s.tipo as string] ?? "Solicitud"}${nombre ? ` · ${nombre}` : ""}`;
      };
      const aprobadas = nuevas.filter((s) => s.estado !== "RECHAZADA");
      const rechazadas = nuevas.filter((s) => s.estado === "RECHAZADA");

      const base = baseUrlPublica();
      const asunto =
        rechazadas.length === 0
          ? aprobadas.length === 1
            ? "Te aprobamos lo que mandaste"
            : `Te aprobamos ${aprobadas.length} cosas que mandaste`
          : aprobadas.length === 0
            ? rechazadas.length === 1
              ? "No pudimos aprobar lo que mandaste"
              : `No pudimos aprobar ${rechazadas.length} cosas que mandaste`
            : `Te respondimos ${nuevas.length} cosas: ${aprobadas.length} aprobadas, ${rechazadas.length} sin aprobar`;

      const renglon = (texto: string, color: string) =>
        `<li style="margin:0 0 6px;color:${color}">${escaparHtml(texto)}</li>`;
      // El motivo de cada rechazo va adentro del mail: si la marca tiene que
      // entrar a buscarlo, no entra, y la semana que viene manda lo mismo.
      const cuerpo = [
        aprobadas.length
          ? `<p style="margin:0 0 6px;font-weight:700;color:#2f4a26">✅ Aprobado (${aprobadas.length})</p><ul style="margin:0 0 14px;padding-left:18px">${aprobadas.map((s) => renglon(deQue(s), "#2f3a2b")).join("")}</ul>`
          : "",
        rechazadas.length
          ? `<p style="margin:0 0 6px;font-weight:700;color:#8e392d">📝 No se pudo aprobar (${rechazadas.length})</p><ul style="margin:0 0 10px;padding-left:18px">${rechazadas
              .map((s) => `<li style="margin:0 0 8px;color:#2f3a2b">${escaparHtml(deQue(s))}<br><span style="color:#8e392d">${escaparHtml((s.motivo as string | null) ?? "Escribinos y lo vemos.")}</span></li>`)
              .join("")}</ul><p style="margin:0;color:#5e6659;font-size:14px">Corregí eso y volvé a mandarlo: no hace falta que cargues todo de nuevo.</p>`
          : "",
      ].join("");

      await mandar(
        supabase,
        marca,
        "solicitud",
        referencia,
        asunto,
        plantilla({
          base,
          tono: rechazadas.length ? "ambar" : "verde",
          emoji: rechazadas.length ? "📝" : "✅",
          titulo: rechazadas.length ? "Te respondimos lo que mandaste" : "¡Listo! Te lo aprobamos",
          bajada: aprobadas.length ? "Lo aprobado ya está activo en la góndola (los precios, en el próximo cambio de carteles)." : "Esta vez no se pudo: acá abajo está el motivo de cada uno.",
          cuerpo,
          boton: { texto: "Ver mis solicitudes", url: `${base}/portal/cambios` },
          pie: `Te escribimos porque tenés prendido «Te respondimos una solicitud». <a href="${base}/portal/avisos" style="color:#8d9587">Cambiar mis avisos</a> · WiiGo, Mendoza`,
        }),
        `${asunto}. ${aprobadas.map(deQue).join(", ")}${rechazadas.length ? `. Sin aprobar: ${rechazadas.map((s) => `${deQue(s)} (${(s.motivo as string | null) ?? ""})`).join(", ")}` : ""}. Entrá a ${base}/portal/cambios`
      );
      marcasAvisadas++;
      total += nuevas.length;
    } catch {
      // Una marca que falla no frena a las demás; el próximo cron la reintenta.
    }
  }
  return { marcas: marcasAvisadas, solicitudes: total };
}
