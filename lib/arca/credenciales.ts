import forge from "node-forge";
import { getSupabaseServerClient } from "@/lib/supabase";
import { descifrar } from "@/lib/arca/cripto";

// Credenciales para hablar con ARCA (ex AFIP).
//
// La clave privada se genera acá mismo (ver generarParClaves) y se guarda
// CIFRADA en la tabla `arca_credenciales`. El certificado que devuelve ARCA
// se sube desde Configuración. Así Gonzalo no tiene que exportar nada desde
// Windows ni pegar archivos en variables de entorno.
//
// Lo único que vive en variables de entorno es AUTH_SECRET, que es la llave
// con la que se cifra. Sin ella, lo guardado en la base no sirve.

export type CredencialesArca = { certificadoPem: string; clavePrivadaPem: string };

export type EstadoCredenciales = {
  tieneClave: boolean;
  tieneCertificado: boolean;
  alias: string | null;
  vence: string | null;
  cuitCertificado: string | null;
};

// Producción a propósito: Gonzalo eligió no pasar por homologación.
export const URLS_ARCA = {
  wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
  wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
} as const;

const FILA = "arca";

export async function obtenerCredencialesArca(): Promise<CredencialesArca> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("arca_credenciales")
    .select("clave_privada_cifrada, certificado_pem")
    .eq("id", FILA)
    .maybeSingle();

  if (!data?.clave_privada_cifrada) {
    throw new Error("Todavía no generaste el certificado. Andá a Configuración → Facturación electrónica.");
  }
  if (!data.certificado_pem) {
    throw new Error("Falta subir el certificado (.crt) que te dio ARCA. Está en Configuración → Facturación electrónica.");
  }

  return {
    clavePrivadaPem: descifrar(data.clave_privada_cifrada as string),
    certificadoPem: data.certificado_pem as string,
  };
}

export async function estadoCredenciales(): Promise<EstadoCredenciales> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("arca_credenciales")
    .select("clave_privada_cifrada, certificado_pem, alias, vence, cuit_certificado")
    .eq("id", FILA)
    .maybeSingle();

  return {
    tieneClave: !!data?.clave_privada_cifrada,
    tieneCertificado: !!data?.certificado_pem,
    alias: (data?.alias as string) ?? null,
    vence: (data?.vence as string) ?? null,
    cuitCertificado: (data?.cuit_certificado as string) ?? null,
  };
}

/**
 * Genera la clave privada y el pedido de certificado (CSR) que hay que subir
 * a ARCA. La clave queda guardada cifrada; el CSR se le devuelve al usuario
 * para que lo descargue.
 *
 * El "subject" tiene el formato que exige ARCA: país, razón social, un nombre
 * cualquiera (alias) y el CUIT en serialNumber.
 */
export async function generarParClaves(razonSocial: string, cuit: string, alias: string) {
  const claves = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = claves.publicKey;
  csr.setSubject([
    { name: "countryName", value: "AR" },
    { name: "organizationName", value: razonSocial },
    { name: "commonName", value: alias },
    { shortName: "serialNumber", value: `CUIT ${cuit.replace(/\D/g, "")}` },
  ]);
  csr.sign(claves.privateKey, forge.md.sha256.create());

  const clavePrivadaPem = forge.pki.privateKeyToPem(claves.privateKey);
  const csrPem = forge.pki.certificationRequestToPem(csr);

  return { clavePrivadaPem, csrPem };
}

/** Lee del certificado el CUIT y la fecha de vencimiento, para mostrarlos. */
export function leerDatosCertificado(certificadoPem: string) {
  const cert = forge.pki.certificateFromPem(certificadoPem);
  const serialNumber = cert.subject.getField({ shortName: "serialNumber" })?.value as string | undefined;
  const commonName = cert.subject.getField("CN")?.value as string | undefined;
  return {
    cuit: serialNumber ? serialNumber.replace(/\D/g, "") : null,
    alias: commonName ?? null,
    vence: cert.validity.notAfter.toISOString(),
  };
}
