"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { registrarMovimientoProveedor } from "@/lib/cuentaProveedor";

// Cerrar un reclamo: o llegó la nota de crédito, o se decidió que no
// correspondía. No hay una tercera forma, y ninguna borra nada.

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

async function requierePermiso() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "compras-reclamos") && !puedeVerPantalla(sesion, "proveedores")) {
    return "No tenés permiso para esto.";
  }
  return null;
}

function redondear2(v: number) {
  return Math.round(v * 100) / 100;
}

function faltaLaColumna(error: { code?: string; message?: string }, columna: string): boolean {
  return (
    (error.code === "42703" || error.code === "PGRST204") && (error.message ?? "").includes(columna)
  );
}

/**
 * El papel de una nota de crédito que ya se había cargado sin adjunto.
 *
 * Existe aparte porque el orden real de las cosas no es el del formulario: la
 * nota se carga el día que el proveedor avisa el número, y el PDF aparece una
 * semana después. Sin esto, ese reclamo se quedaba sin comprobante para siempre.
 */
export async function adjuntarComprobanteNotaCredito(
  idReclamo: string,
  formData: FormData
): Promise<{ error: string | null }> {
  const sinPermiso = await requierePermiso();
  if (sinPermiso) return { error: sinPermiso };

  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) return { error: "Elegí un archivo primero." };

  try {
    const supabase = getSupabaseServerClient();
    const { data: reclamo } = await supabase
      .from("reclamos_proveedor")
      .select("id_reclamo, estado")
      .eq("id_reclamo", idReclamo)
      .maybeSingle();
    if (!reclamo) return { error: "No se encontró ese reclamo." };
    if (reclamo.estado !== "ACREDITADO") {
      return { error: "El comprobante se adjunta cuando la nota ya está cargada." };
    }

    const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "pdf";
    const path = `nc-${idReclamo}.${extension}`;
    const { error: errorUpload } = await supabase.storage
      .from("comprobantes-proveedor")
      .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
    if (errorUpload) return { error: `No se pudo subir el archivo: ${errorUpload.message}` };

    const { error } = await supabase
      .from("reclamos_proveedor")
      .update({ nc_comprobante_path: path })
      .eq("id_reclamo", idReclamo);
    if (error) {
      if (faltaLaColumna(error, "nc_comprobante_path")) {
        return { error: "Falta correr sql/comprobante-nota-credito.sql en Supabase." };
      }
      return { error: friendlyDbError(error) };
    }

    revalidatePath("/compras/reclamos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo adjuntar el comprobante" };
  }
}

/** Link firmado y con vencimiento: el bucket es privado y tiene que seguir así. */
export async function urlComprobanteNotaCredito(path: string): Promise<{ url: string | null; error: string | null }> {
  const sinPermiso = await requierePermiso();
  if (sinPermiso) return { url: null, error: sinPermiso };
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.storage
      .from("comprobantes-proveedor")
      .createSignedUrl(path, 60 * 10);
    if (error) return { url: null, error: error.message };
    return { url: data.signedUrl, error: null };
  } catch (err) {
    return { url: null, error: err instanceof Error ? err.message : "No se pudo abrir el comprobante" };
  }
}

/**
 * Llegó la nota de crédito.
 *
 * Baja la cuenta corriente por el total y el crédito fiscal por el IVA. La
 * factura original NO se toca: quedan los dos papeles y el saldo se explica
 * solo. Un comprobante no borra al otro — lo compensa.
 *
 * Lo que tampoco hace es bajarle el costo al producto. Esa plata ya se
 * repartió en la mercadería que entró, y para cuando llega la nota esa
 * mercadería puede estar vendida y liquidada: tocarla sería reescribir un mes
 * que ya cerró.
 */
export async function cargarNotaCredito(params: {
  idReclamo: string;
  numero: string;
  fecha: string;
  neto: number;
  impuestos: number;
  retenciones: number;
  descuentos: number;
  iva: number;
  /** El PDF o la foto de la nota. Opcional: el papel puede llegar después. */
  comprobante?: File | null;
}): Promise<{ error: string | null; aviso?: string }> {
  const sinPermiso = await requierePermiso();
  if (sinPermiso) return { error: sinPermiso };

  if (!params.numero.trim()) return { error: "Poné el número de la nota de crédito." };
  if (!params.fecha) return { error: "Poné la fecha de la nota." };

  const total = redondear2(
    (params.neto || 0) + (params.impuestos || 0) + (params.retenciones || 0) - (params.descuentos || 0) + (params.iva || 0)
  );
  if (total <= 0) return { error: "El total de la nota tiene que ser mayor a cero." };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    const { data: reclamo } = await supabase
      .from("reclamos_proveedor")
      .select("id_reclamo, id_proveedor, id_factura, total, estado")
      .eq("id_reclamo", params.idReclamo)
      .maybeSingle();
    if (!reclamo) return { error: "No se encontró ese reclamo." };
    if (reclamo.estado !== "PENDIENTE") {
      return { error: "Este reclamo ya estaba cerrado." };
    }

    // El adjunto va primero: si falla la subida, el reclamo todavía no se
    // cerró y se puede reintentar entero. Al revés quedaría acreditado y sin
    // papel, que es justo lo que esto viene a evitar.
    let comprobantePath: string | null = null;
    if (params.comprobante && params.comprobante.size > 0) {
      const extension = params.comprobante.name.split(".").pop()?.toLowerCase() ?? "pdf";
      const path = `nc-${params.idReclamo}.${extension}`;
      const { error: errorUpload } = await supabase.storage
        .from("comprobantes-proveedor")
        .upload(path, params.comprobante, {
          upsert: true,
          contentType: params.comprobante.type || undefined,
        });
      if (errorUpload) {
        return { error: `No se pudo subir el comprobante: ${errorUpload.message}. La nota no se cargó.` };
      }
      comprobantePath = path;
    }

    const { error } = await supabase
      .from("reclamos_proveedor")
      .update({
        estado: "ACREDITADO",
        nc_numero: params.numero.trim(),
        nc_fecha: params.fecha,
        ...(comprobantePath ? { nc_comprobante_path: comprobantePath } : {}),
        nc_neto: redondear2(params.neto || 0),
        nc_impuestos: redondear2(params.impuestos || 0),
        nc_retenciones: redondear2(params.retenciones || 0),
        nc_descuentos: redondear2(params.descuentos || 0),
        nc_iva: redondear2(params.iva || 0),
        nc_monto: total,
        resuelto_el: new Date().toISOString(),
        resuelto_por: usuario,
      })
      .eq("id_reclamo", params.idReclamo)
      // Que siga pendiente: si otro lo cerró mientras tanto, no se pisa.
      .eq("estado", "PENDIENTE");
    if (error) {
      // La columna del adjunto llegó después (sql/comprobante-nota-credito.sql).
      // Si todavía no se corrió, antes que no poder cerrar el reclamo se cierra
      // sin guardar la ruta — el archivo ya quedó subido y se puede re-enganchar
      // corriendo el SQL y volviendo a adjuntarlo.
      if (comprobantePath && faltaLaColumna(error, "nc_comprobante_path")) {
        return {
          error:
            "Falta correr sql/comprobante-nota-credito.sql en Supabase para poder guardar el adjunto. Cargá la nota sin archivo por ahora, o corré el SQL y volvé a intentar.",
        };
      }
      return { error: friendlyDbError(error) };
    }

    // La plata. En negativo: baja lo que le debés.
    await registrarMovimientoProveedor(supabase, {
      idProveedor: reclamo.id_proveedor as string,
      tipoMovimiento: "NOTA_CREDITO",
      importe: -total,
      idFactura: (reclamo.id_factura as string | null) ?? null,
      usuario,
      observaciones: `Nota de crédito ${params.numero.trim()}`,
    });

    const diferencia = redondear2(total - ((reclamo.total as number) ?? 0));
    const aviso =
      Math.abs(diferencia) >= 1
        ? `La nota vino por $${total.toLocaleString("es-AR")} y vos reclamabas $${((reclamo.total as number) ?? 0).toLocaleString(
            "es-AR"
          )}. Quedó cerrado por lo que dice el papel.`
        : undefined;

    revalidatePath("/compras/reclamos");
    revalidatePath("/proveedores");
    revalidatePath("/iva-a-pagar");
    return { error: null, aviso };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cargar la nota de crédito" };
  }
}

/**
 * El reclamo no correspondía.
 *
 * Se revisó y estaba bien facturado, o se arregló de otra forma. No borra
 * nada: queda con el motivo, para que dentro de tres meses nadie se pregunte
 * qué pasó con esos pesos.
 */
export async function descartarReclamo(
  idReclamo: string,
  motivo: string
): Promise<{ error: string | null }> {
  const sinPermiso = await requierePermiso();
  if (sinPermiso) return { error: sinPermiso };
  if (!motivo.trim()) return { error: "Contá por qué lo descartás." };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    const { data: reclamo } = await supabase
      .from("reclamos_proveedor")
      .select("motivo, estado")
      .eq("id_reclamo", idReclamo)
      .maybeSingle();
    if (!reclamo) return { error: "No se encontró ese reclamo." };
    if (reclamo.estado !== "PENDIENTE") return { error: "Este reclamo ya estaba cerrado." };

    const { error } = await supabase
      .from("reclamos_proveedor")
      .update({
        estado: "DESCARTADO",
        motivo: `${reclamo.motivo}\n— Descartado por ${usuario ?? "administración"}: ${motivo.trim()}`,
        resuelto_el: new Date().toISOString(),
        resuelto_por: usuario,
      })
      .eq("id_reclamo", idReclamo)
      .eq("estado", "PENDIENTE");
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/compras/reclamos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo descartar el reclamo" };
  }
}
