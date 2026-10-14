// Mandar un mail.
//
// Por API REST y no con el paquete de Resend: es un POST con un JSON, y una
// dependencia menos es una cosa menos que se rompa en un build de Vercel.
//
// Nunca tira. Si no está configurado, si la red falla, si Resend contesta mal
// —devuelve el error y sigue. Un aviso que no sale no puede voltear una venta
// ni una aprobación: el mail es lo accesorio, lo que estaba pasando es lo
// importante.
//
// Variables en Vercel:
//   RESEND_API_KEY   la clave de resend.com (gratis hasta 3.000 por mes)
//   MAIL_DESDE       "WiiGo <avisos@tudominio.com>"; sin dominio propio sirve
//                    "WiiGo <onboarding@resend.dev>" para probar.

const URL_RESEND = "https://api.resend.com/emails";

export type ResultadoMail = { ok: boolean; error: string | null };

export function hayMailConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function enviarMail(params: {
  para: string[];
  asunto: string;
  html: string;
  /** Para el que lee en texto plano y para que no caiga en spam. */
  texto: string;
}): Promise<ResultadoMail> {
  const clave = process.env.RESEND_API_KEY?.trim();
  if (!clave) return { ok: false, error: "Falta configurar RESEND_API_KEY." };

  const destinos = params.para.map((p) => p.trim()).filter(Boolean);
  if (destinos.length === 0) return { ok: false, error: "Sin direcciones a dónde mandar." };

  const desde = process.env.MAIL_DESDE?.trim() || "WiiGo <onboarding@resend.dev>";

  try {
    const r = await fetch(URL_RESEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: desde,
        to: destinos,
        subject: params.asunto,
        html: params.html,
        text: params.texto,
      }),
    });

    if (!r.ok) {
      const cuerpo = await r.text().catch(() => "");
      return { ok: false, error: `Resend ${r.status}: ${cuerpo.slice(0, 200)}` };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo mandar el mail." };
  }
}

/**
 * Los dos tonos del sistema.
 *
 * Cambia el color del acento, nunca la estructura: la franja con el logo, el
 * número grande y el botón único están siempre en el mismo lugar, así la marca
 * reconoce de quién es el mail antes de leerlo. Verde es buena noticia, ámbar
 * es "hay algo que hacer".
 */
export type TonoMail = "verde" | "ambar";

const TONOS: Record<TonoMail, Record<string, string>> = {
  verde: {
    fondo: "#f7faf3",
    borde: "#e4e8dd",
    numero: "#3f4d33",
    franjaFondo: "#edf1e7",
    franjaBorde: "#d2d9c8",
    franjaTexto: "#4f5c43",
  },
  ambar: {
    fondo: "#fdf8ef",
    borde: "#efe4cf",
    numero: "#8a6418",
    franjaFondo: "#fbf1dd",
    franjaBorde: "#ecdcbb",
    franjaTexto: "#6b5420",
  },
};

/**
 * El sobre: franja con el logo, bloque grande, cuerpo, un botón y pie.
 *
 * Tabla y estilos inline, que es lo único que entienden todos los clientes de
 * mail: Outlook no soporta flex ni clases, y un mail que se ve roto en el
 * trabajo de la marca es peor que no mandarlo.
 *
 * El isologo va adentro del mail, en un círculo blanco arriba de todo. La foto
 * de perfil que Gmail muestra al lado del remitente NO se puede poner desde
 * acá —la decide el cliente de mail, y para que sea la nuestra hace falta BIMI,
 * que pide dominio propio y un certificado de marca que se paga por año—. El
 * círculo de arriba ocupa el lugar donde el ojo la busca, y funciona en todos
 * lados sin pagar nada.
 */
export function plantilla(params: {
  /** El titular grande, arriba de todo. */
  titulo: string;
  tono?: TonoMail;
  /** Uno solo, y solo si corresponde: ver `destacado`. */
  emoji?: string;
  /** Una línea chica abajo del título. */
  bajada?: string;
  /** Lo que se lee en dos segundos desde el celular: el monto, o el producto. */
  destacado?: string;
  /** Para un nombre largo, que no entra en el cuerpo de un monto. */
  destacadoChico?: boolean;
  /** Líneas chicas abajo del destacado. */
  detalle?: string[];
  /** La franja de color: lo que convierte el dato suelto en un motivo. */
  franja?: { titulo: string; texto: string };
  cuerpo?: string;
  /** Un solo botón. Dos botones en un mail es ninguno. */
  boton?: { texto: string; url: string };
  /** La línea gris abajo del botón. */
  nota?: string;
  pie?: string;
  /** El dominio público, para que el logo tenga URL absoluta. */
  base?: string;
}): string {
  const t = TONOS[params.tono ?? "verde"];
  const base = (params.base ?? "").replace(/\/+$/, "");

  // Sin base no hay URL absoluta posible y la imagen saldría rota: mejor el
  // círculo con la W escrita que un cuadrado con la cruz roja.
  const marca = base
    ? `<img src="${base}/wiigo-isotipo.png" width="26" alt="WiiGo" style="display:inline-block;border:0;width:26px;height:auto;vertical-align:middle">`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#536243">W</span>`;

  const encabezado = `
<tr><td style="background:#536243;padding:22px 26px 20px" align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
    <td width="46" height="46" align="center" valign="middle" style="width:46px;height:46px;background:#ffffff;border-radius:23px;line-height:46px">${marca}</td>
    <td style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:-0.5px">WiiGo</td>
  </tr></table>
</td></tr>`;

  const destacado = params.destacado
    ? `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:${
        params.destacadoChico ? "28" : "38"
      }px;font-weight:bold;letter-spacing:-1px;color:${t.numero};line-height:1.15">${params.destacado}</p>`
    : "";

  // Todas las líneas se dibujan igual; el que llama decide qué va en negrita
  // con <strong>. Una regla tipo "la primera va fuerte" se rompe sola el día
  // que un aviso manda una línea sola.
  const detalle = (params.detalle ?? [])
    .map(
      (d, i) =>
        `<p style="margin:${i === 0 ? "8" : "3"}px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5e6659;line-height:1.45">${d}</p>`
    )
    .join("");

  const cabezal = `
<tr><td align="center" style="background:${t.fondo};border-bottom:1px solid ${t.borde};padding:26px 26px 24px">
  ${params.emoji ? `<p style="margin:0 0 8px;font-size:32px;line-height:1">${params.emoji}</p>` : ""}
  <h1 style="margin:0 0 ${params.bajada ? "4" : "14"}px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#2a2f26;line-height:1.25">${params.titulo}</h1>
  ${params.bajada ? `<p style="margin:0 0 ${destacado ? "16" : "0"}px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5e6659;line-height:1.5">${params.bajada}</p>` : ""}
  ${destacado}
  ${detalle}
</td></tr>`;

  const franja = params.franja
    ? `<tr><td style="padding:18px 26px 4px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="background:${t.franjaFondo};border:1px solid ${t.franjaBorde};border-radius:12px;padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${t.franjaTexto};line-height:1.5">
      <strong style="font-size:17px;color:#2a2f26">${params.franja.titulo}</strong><br>${params.franja.texto}
    </td>
  </tr></table>
</td></tr>`
    : "";

  const cuerpo = params.cuerpo
    ? `<tr><td style="padding:18px 26px 0;font-family:Arial,Helvetica,sans-serif;color:#2a2f26;font-size:15px;line-height:1.6">${params.cuerpo}</td></tr>`
    : "";

  const boton = params.boton
    ? `<tr><td align="center" style="padding:20px 26px 0">
  <a href="${params.boton.url}" style="display:inline-block;background:#536243;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 30px;border-radius:11px">${params.boton.texto}</a>
</td></tr>`
    : "";

  const nota = params.nota
    ? `<tr><td align="center" style="padding:14px 26px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#8d9587;line-height:1.5">${params.nota}</td></tr>`
    : "";

  const pie = params.pie
    ? `<tr><td style="padding:16px 26px 20px;border-top:1px solid #eef1e9;background:#fafbf7;font-family:Arial,Helvetica,sans-serif;color:#8d9587;font-size:12px;line-height:1.55">${params.pie}</td></tr>`
    : "";

  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#f3f5f0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f0;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e8dd;border-radius:14px;overflow:hidden">
${encabezado}
${cabezal}
${franja}
${cuerpo}
${boton}
${nota}
<tr><td style="height:22px;line-height:22px">&nbsp;</td></tr>
${pie}
</table>
</td></tr>
</table>
</body></html>`;
}
