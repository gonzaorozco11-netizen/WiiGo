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

    const { error } = await supabase
      .from("reclamos_proveedor")
      .update({
        estado: "ACREDITADO",
        nc_numero: params.numero.trim(),
        nc_fecha: params.fecha,
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
    if (error) return { error: friendlyDbError(error) };

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
