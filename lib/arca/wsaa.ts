import forge from "node-forge";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerCredencialesArca, URLS_ARCA } from "@/lib/arca/credenciales";
import { postSoap } from "@/lib/arca/http";

// WSAA: el portero de ARCA. Antes de poder facturar hay que pedirle un
// "ticket de acceso" (token + sign) firmando un XML con el certificado.
//
// El ticket dura 12 horas y ARCA rechaza pedir uno nuevo mientras el anterior
// siga vigente. Por eso se guarda en la base (tabla `arca_tokens`) y se
// reutiliza: sin ese cacheo, cada venta pediría un ticket nuevo y ARCA
// empezaría a rechazar los pedidos.

const SERVICIO = "wsfe";
// Se renueva un rato antes de que venza, para que no caduque justo entre que
// se pide y se usa.
const MARGEN_MS = 10 * 60 * 1000;

export type TicketAcceso = { token: string; sign: string; expira: string };

function xmlLoginTicketRequest() {
  const ahora = Date.now();
  // ARCA rechaza tickets con fechas muy separadas del reloj de su servidor.
  const desde = new Date(ahora - 10 * 60 * 1000).toISOString();
  const hasta = new Date(ahora + 12 * 60 * 60 * 1000).toISOString();
  const unico = Math.floor(ahora / 1000);

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${unico}</uniqueId>
    <generationTime>${desde}</generationTime>
    <expirationTime>${hasta}</expirationTime>
  </header>
  <service>${SERVICIO}</service>
</loginTicketRequest>`;
}

// El XML va firmado en formato CMS (PKCS#7) y codificado en base64. Es lo
// único que ARCA acepta para autenticar.
async function firmarCms(xml: string) {
  const { certificadoPem, clavePrivadaPem } = await obtenerCredencialesArca();
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(xml, "utf8");
  p7.addCertificate(certificadoPem);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(clavePrivadaPem),
    certificate: certificadoPem,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  p7.sign({ detached: false });
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

function entre(texto: string, etiqueta: string) {
  const m = texto.match(new RegExp(`<${etiqueta}>([\\s\\S]*?)</${etiqueta}>`));
  return m ? m[1] : null;
}

function desescapar(texto: string) {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function pedirTicketNuevo(): Promise<TicketAcceso> {
  const cms = await firmarCms(xmlLoginTicketRequest());

  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  let res: { ok: boolean; status: number; texto: string };
  try {
    // postSoap y no fetch: ARCA usa TLS viejo y hace falta un agente especial
    // (ver lib/arca/http.ts).
    res = await postSoap(URLS_ARCA.wsaa, sobre, { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" });
  } catch (err) {
    const causa = err instanceof Error ? ` (${err.message})` : "";
    throw new Error(`No se pudo conectar con ARCA para autenticar${causa}. Probá de nuevo en unos minutos.`);
  }

  const texto = res.texto;

  const falla = entre(texto, "faultstring");
  if (falla) throw new Error(`ARCA rechazó la autenticación: ${falla}`);
  if (!res.ok) throw new Error(`ARCA respondió ${res.status} al autenticar.`);

  const respuesta = entre(texto, "loginCmsReturn");
  if (!respuesta) throw new Error("ARCA no devolvió el ticket de acceso.");

  const ticketXml = desescapar(respuesta);
  const token = entre(ticketXml, "token");
  const sign = entre(ticketXml, "sign");
  const expira = entre(ticketXml, "expirationTime");
  if (!token || !sign || !expira) throw new Error("El ticket de ARCA vino incompleto.");

  return { token, sign, expira };
}

export async function obtenerTicketAcceso(): Promise<TicketAcceso> {
  const supabase = getSupabaseServerClient();

  const { data: guardado } = await supabase
    .from("arca_tokens")
    .select("token, sign, expira")
    .eq("servicio", SERVICIO)
    .maybeSingle();

  if (guardado && new Date(guardado.expira as string).getTime() - MARGEN_MS > Date.now()) {
    return { token: guardado.token as string, sign: guardado.sign as string, expira: guardado.expira as string };
  }

  const ticket = await pedirTicketNuevo();

  await supabase.from("arca_tokens").upsert(
    { servicio: SERVICIO, token: ticket.token, sign: ticket.sign, expira: ticket.expira, actualizado: new Date().toISOString() },
    { onConflict: "servicio" }
  );

  return ticket;
}
