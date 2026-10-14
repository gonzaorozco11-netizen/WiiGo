import { getSupabaseServerClient } from "@/lib/supabase";
import { enviarMail, plantilla } from "@/lib/mail";
import { baseUrlPublica } from "@/lib/urlPublica";
import { fechaHoraArgentina } from "@/lib/horarios";
import { TOPE_DIARIO, avisoPrendido, type TipoAviso } from "@/lib/avisosMarca";

// Mandar los avisos.
//
// Esto se llama ESPERÁNDOLO, no desde `after()`. Se probó con after —el mail
// sale después de contestarle al cajero, que suena mejor— y se perdió: de dos
// ventas seguidas llegó la primera y la segunda se evaporó sin dejar rastro.
// La tarea de after corre cuando la respuesta ya se fue, y si Vercel apaga la
// función antes, nadie se entera. Un aviso que a veces sale es peor que no
// tenerlo: la marca deja de confiar y vuelve a entrar a mirar igual.
//
// El costo es medio segundo en la venta, y la venta ya espera a ARCA, que es
// otra llamada por red. CORTE es el techo: si Resend tarda más que eso, se
// abandona y se registra, pero el cajero nunca queda esperando.
//
// Nada de acá tira. Cada función está envuelta: si falla una consulta, si
// Resend contesta mal, si no hay clave configurada, se registra y se sigue.
// La venta ya pasó; el mail es lo accesorio.

/** Lo máximo que una venta puede esperar por los avisos. */
const CORTE_MS = 2500;

/** Corre algo con techo de tiempo. Nunca tira. */
export async function conCorte(tarea: () => Promise<void>): Promise<void> {
  try {
    await Promise.race([
      tarea(),
      new Promise<void>((listo) => setTimeout(listo, CORTE_MS)),
    ]);
  } catch {
    // Ya está registrado adentro.
  }
}

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
    .gte("enviado_el", `${hoy}T00:00:00`);
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
 * vendió, y que con esa venta se le terminó un producto.
 */
export async function avisarVenta(idVenta: string, idLocal: string): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();

    const { data: renglones } = await supabase
      .from("detalle_ventas")
      .select("id_marca, id_variante, cantidad, subtotal, precio_unitario")
      .eq("id_venta", idVenta);
    if (!renglones || renglones.length === 0) return;

    const idsMarca = [...new Set(renglones.map((r) => r.id_marca as string).filter(Boolean))];
    const marcas = await marcasPara(supabase, idsMarca);
    if (marcas.size === 0) return;

    const nombres = await nombresDeVariante(
      supabase,
      [...new Set(renglones.map((r) => r.id_variante as string))]
    );

    const base = baseUrlPublica();
    const hoy = fechaHoraArgentina().fecha;

    for (const idMarca of idsMarca) {
      const marca = marcas.get(idMarca);
      if (!marca || marca.mails.length === 0) continue;

      const suyos = renglones.filter((r) => r.id_marca === idMarca);

      if (avisoPrendido(marca.avisos, "venta") && (await sePuedeMandar(supabase, idMarca, "venta", idVenta))) {
        await avisarQueVendio(supabase, marca, suyos, nombres, idVenta, idLocal, hoy, base);
      }

      if (avisoPrendido(marca.avisos, "agotado")) {
        await avisarAgotados(supabase, marca, suyos, nombres, idLocal, base);
      }
    }
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
      ],
      franja,
      cuerpo: lista,
      boton: { texto: "Ver cómo venís este mes", url: `${base}/portal` },
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

/** Cuántas ventas y cuánta plata lleva hoy esta marca en este local. */
async function loDeHoy(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  idMarca: string,
  idLocal: string,
  hoy: string
): Promise<{ ventas: number; monto: number }> {
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta")
    .eq("estado", "PAGADA")
    .eq("id_local", idLocal)
    .gte("fecha", `${hoy}T00:00:00`)
    .lte("fecha", `${hoy}T23:59:59`);

  const ids = (ventas ?? []).map((v) => v.id_venta as string);
  if (ids.length === 0) return { ventas: 0, monto: 0 };

  const { data: renglones } = await supabase
    .from("detalle_ventas")
    .select("id_venta, subtotal")
    .eq("id_marca", idMarca)
    .in("id_venta", ids);

  const distintas = new Set((renglones ?? []).map((r) => r.id_venta as string));
  return {
    ventas: distintas.size,
    monto: (renglones ?? []).reduce((a, r) => a + ((r.subtotal as number) ?? 0), 0),
  };
}

async function nombresDeVariante(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  ids: string[]
): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  if (ids.length === 0) return salida;

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_variante", ids);

  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto as string))];
  const { data: productos } = idsProducto.length
    ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProducto)
    : { data: [] as Record<string, unknown>[] };
  const nombreProducto = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));

  for (const v of variantes ?? []) {
    const prod = nombreProducto.get(v.id_producto as string) ?? "Producto";
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
  try {
    const supabase = getSupabaseServerClient();

    const { data: s } = await supabase
      .from("solicitudes_marca")
      .select("id_solicitud, id_marca, tipo, estado, motivo")
      .eq("id_solicitud", idSolicitud)
      .maybeSingle();
    if (!s) return;

    const marcas = await marcasPara(supabase, [s.id_marca as string]);
    const marca = marcas.get(s.id_marca as string);
    if (!marca || marca.mails.length === 0) return;
    if (!avisoPrendido(marca.avisos, "solicitud")) return;
    if (!(await sePuedeMandar(supabase, marca.idMarca, "solicitud", idSolicitud))) return;

    const aprobada = s.estado === "APROBADA" || s.estado === "APLICADA";
    const base = baseUrlPublica();
    const asunto = aprobada ? "Te aprobamos lo que mandaste" : "No pudimos aprobar lo que mandaste";

    // El motivo del rechazo entra en el bloque de arriba, no en una franja de
    // color: es lo único que la marca necesita leer, y leerlo acá le ahorra
    // entrar al portal a buscarlo.
    const cuerpo = aprobada
      ? ""
      : `<p style="margin:0 0 12px;padding:12px 14px;background:#f9ebe8;border:1px solid #e8c4bd;border-radius:10px;color:#8e392d">${s.motivo ?? "Escribinos y lo vemos."}</p>
         <p style="margin:0;color:#5e6659;font-size:14px">Corregí eso y volvé a mandarlo: no hace falta que cargues todo de nuevo.</p>`;

    await mandar(
      supabase,
      marca,
      "solicitud",
      idSolicitud,
      asunto,
      plantilla({
        base,
        tono: aprobada ? "verde" : "ambar",
        emoji: aprobada ? "✅" : "📝",
        titulo: aprobada ? "¡Listo! Te lo aprobamos" : "No pudimos aprobarlo",
        bajada: aprobada
          ? "Lo que mandaste ya está activo en la góndola."
          : "Esta vez no se pudo, y acá abajo está el motivo.",
        cuerpo,
        boton: { texto: "Ver mis solicitudes", url: `${base}/portal/cambios` },
        pie: `Te escribimos porque tenés prendido «Te respondimos una solicitud». <a href="${base}/portal/avisos" style="color:#8d9587">Cambiar mis avisos</a> · WiiGo, Mendoza`,
      }),
      `${asunto}. ${aprobada ? "" : s.motivo ?? ""} Entrá a ${base}/portal/cambios`
    );
  } catch {
    // La solicitud ya quedó resuelta; el mail es lo accesorio.
  }
}
