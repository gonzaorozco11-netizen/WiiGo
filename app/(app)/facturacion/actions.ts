"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { obtenerConfigArca } from "@/lib/arca/config";
import { TIPO_COMPROBANTE } from "@/lib/arca/wsfe";
import { emitirFacturaParaVenta, type DatosReceptor } from "@/lib/arca/emitir";
import { generarParClaves, leerDatosCertificado, estadoCredenciales } from "@/lib/arca/credenciales";
import { obtenerEmisor } from "@/lib/arca/emisor-db";
import { cifrar } from "@/lib/arca/cripto";

// Emisión de facturas. A propósito NO se dispara sola desde el cobro por
// ahora: Gonzalo eligió ir directo a producción sin pasar por homologación,
// así que las primeras facturas se emiten a mano y se verifican en ARCA antes
// de activar el automático desde Configuración.

async function requireFacturar(): Promise<string | null> {
  const sesion = await obtenerSesionConPermisos();
  // Permiso propio y no el de Configuración: emitir una factura es un acto
  // fiscal irreversible, y se puede querer dárselo a quien factura sin darle
  // acceso a todos los parámetros del sistema. Los admin lo tienen siempre.
  if (!tienePermiso(sesion, PERMISOS.EMITIR_FACTURAS)) {
    return "No tenés permiso para emitir facturas.";
  }
  return null;
}

export async function emitirFacturaDeVenta(
  idVenta: string,
  receptor: DatosReceptor
): Promise<{ error: string | null; numero?: string }> {
  const permisoError = await requireFacturar();
  if (permisoError) return { error: permisoError };

  try {
    const resultado = await emitirFacturaParaVenta(idVenta, receptor);
    if (resultado.error) return resultado;

    revalidatePath("/ventas");
    revalidatePath("/cobros-efectivo");
    return resultado;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo emitir la factura" };
  }
}

// ===================== CERTIFICADO =====================

/**
 * Genera la clave privada (que queda guardada cifrada) y devuelve el CSR para
 * que Gonzalo lo descargue y lo suba a ARCA.
 *
 * Si ya había un certificado cargado, se pisa: es el camino para renovarlo
 * cuando vence.
 */
export async function generarCsrArca(alias: string): Promise<{ error: string | null; csr?: string }> {
  const permisoError = await requireFacturar();
  if (permisoError) return { error: permisoError };

  const aliasLimpio = (alias || "wiigo").trim().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 30) || "wiigo";

  try {
    const emisor = await obtenerEmisor();
    if (!emisor.cuit || emisor.cuit.replace(/\D/g, "").length !== 11) {
      return { error: "Antes de generar el certificado, cargá bien el CUIT en los datos fiscales." };
    }

    const { clavePrivadaPem, csrPem } = await generarParClaves(emisor.razonSocial, emisor.cuit, aliasLimpio);

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("arca_credenciales").upsert(
      {
        id: "arca",
        clave_privada_cifrada: cifrar(clavePrivadaPem),
        certificado_pem: null, // el anterior deja de servir con una clave nueva
        alias: aliasLimpio,
        vence: null,
        cuit_certificado: null,
        actualizado: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) return { error: error.message };

    revalidatePath("/configuracion");
    return { error: null, csr: csrPem };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo generar el certificado" };
  }
}

/** Guarda el .crt que devuelve ARCA, validando que corresponda a la clave. */
export async function guardarCertificadoArca(formData: FormData): Promise<{ error: string | null; info?: string }> {
  const permisoError = await requireFacturar();
  if (permisoError) return { error: permisoError };

  const archivo = formData.get("certificado") as File | null;
  if (!archivo || archivo.size === 0) return { error: "Elegí el archivo del certificado que descargaste de ARCA." };

  try {
    const contenido = (await archivo.text()).trim();
    if (!contenido.includes("BEGIN CERTIFICATE")) {
      return { error: "Ese archivo no parece un certificado. Tiene que ser el .crt (o .pem) que descargaste de ARCA." };
    }

    const datos = leerDatosCertificado(contenido);

    const estado = await estadoCredenciales();
    if (!estado.tieneClave) {
      return { error: "Primero generá el pedido de certificado (paso 2) — sin la clave privada, el certificado no sirve." };
    }

    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("arca_credenciales")
      .update({
        certificado_pem: contenido,
        vence: datos.vence,
        cuit_certificado: datos.cuit,
        actualizado: new Date().toISOString(),
      })
      .eq("id", "arca");
    if (error) return { error: error.message };

    revalidatePath("/configuracion");
    return {
      error: null,
      info: `Certificado cargado. Titular CUIT ${datos.cuit ?? "?"}, vence el ${new Date(datos.vence).toLocaleDateString("es-AR")}.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo leer el certificado" };
  }
}

/** Prueba de conexión: pide el último comprobante autorizado, sin emitir nada. */
export async function probarConexionArca(): Promise<{ error: string | null; mensaje?: string }> {
  const permisoError = await requireFacturar();
  if (permisoError) return { error: permisoError };

  try {
    const config = await obtenerConfigArca();
    const { ultimoComprobante } = await import("@/lib/arca/wsfe");
    const ultimoB = await ultimoComprobante(config.puntoVenta, TIPO_COMPROBANTE.FACTURA_B);
    return {
      error: null,
      mensaje: `Conexión OK. Punto de venta ${config.puntoVenta}: la última Factura B autorizada es la N° ${ultimoB}. La próxima será la ${ultimoB + 1}.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo conectar con ARCA" };
  }
}
