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
 * El sobre: cabecera, cuerpo y pie, iguales en todos los avisos.
 *
 * Tabla y estilos inline, que es lo único que entienden todos los clientes de
 * mail: Outlook no soporta flex ni clases, y un mail que se ve roto en el
 * trabajo de la marca es peor que no mandarlo.
 */
export function plantilla(params: {
  titulo: string;
  cuerpo: string;
  /** Un solo botón. Dos botones en un mail es ninguno. */
  boton?: { texto: string; url: string };
  pie?: string;
}): string {
  const boton = params.boton
    ? `<tr><td style="padding:4px 0 8px"><a href="${params.boton.url}" style="display:inline-block;background:#536243;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:10px">${params.boton.texto}</a></td></tr>`
    : "";

  const pie = params.pie
    ? `<tr><td style="padding:18px 0 0;border-top:1px solid #eef1e9;color:#8d9587;font-size:12px;line-height:1.5">${params.pie}</td></tr>`
    : "";

  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#f3f5f0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f0;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e8dd;border-radius:14px">
<tr><td style="padding:22px 26px 0">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:bold;color:#536243;letter-spacing:-0.5px">WiiGo</span>
</td></tr>
<tr><td style="padding:14px 26px 0">
  <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:21px;font-weight:bold;color:#2a2f26;line-height:1.25">${params.titulo}</h1>
</td></tr>
<tr><td style="padding:12px 26px 22px;font-family:Arial,Helvetica,sans-serif;color:#2a2f26;font-size:15px;line-height:1.6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding-bottom:14px">${params.cuerpo}</td></tr>
    ${boton}
    ${pie}
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
