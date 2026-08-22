"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import {
  saldoCuentaComercial,
  historialCuentaComercial,
  yaTieneCargoDelPeriodo,
  registrarMovimientoComercial,
} from "@/lib/cuentaComercialMarca";
import { saldosRetencionPorMarca } from "@/lib/retencionesMarca";
import {
  type CuentaMarca,
  historialCompensaciones,
  totalCompensadoLiquidaciones,
  registrarCompensacion,
} from "@/lib/compensacionesMarca";
import { calcularRendicion, historialLiquidaciones } from "@/app/(app)/liquidaciones/actions";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";

async function sesionActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return readSessionToken(token, process.env.AUTH_SECRET ?? "");
}

// Fee, gasto fijo, pagos y compensaciones mueven plata real que la marca le
// debe a WiiGo — antes exigía ser Dueño siempre; ahora también puede
// hacerlo un operativo cuyo Rol (Usuarios → Roles) incluya la pantalla
// "situacion-marca". Ver la situación (lecturas) queda abierto a cualquiera
// logueado, igual que antes.
async function requireAdmin() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "situacion-marca")) {
    return "No tenés permiso para hacer esto.";
  }
  return null;
}

function text(formData: FormData, name: string) {
  const s = String(formData.get(name) ?? "").trim();
  return s.length ? s : null;
}

function number(formData: FormData, name: string) {
  const raw = formData.get(name);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function mesActual() {
  return new Date().toISOString().slice(0, 7); // "2026-08"
}

// ===================== VENTAS DEL PERÍODO =====================

export async function resumenVentasMarca(idMarca: string) {
  const supabase = getSupabaseServerClient();
  const inicioMes = new Date();
  inicioMes.setDate(1);
  const inicioMesISO = inicioMes.toISOString().slice(0, 10);

  const { data: detalle } = await supabase
    .from("detalle_ventas")
    .select("id_venta, subtotal, precio_unitario, cantidad")
    .eq("id_marca", idMarca);
  const idsVenta = [...new Set((detalle ?? []).map((d) => d.id_venta))];
  if (idsVenta.length === 0) return { esteMes: 0, historico: 0 };

  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta, fecha")
    .in("id_venta", idsVenta)
    .eq("estado", "PAGADA");
  const fechaPorVenta = new Map((ventas ?? []).map((v) => [v.id_venta, v.fecha as string]));

  let esteMes = 0;
  let historico = 0;
  for (const d of detalle ?? []) {
    const fecha = fechaPorVenta.get(d.id_venta);
    if (!fecha) continue; // la venta no está pagada (o fue anulada)
    const monto = d.subtotal ?? d.precio_unitario * d.cantidad;
    historico += monto;
    if (fecha >= inicioMesISO) esteMes += monto;
  }
  return { esteMes, historico };
}

// ===================== CONDICIÓN COMERCIAL (gasto fijo mensual) =====================

export async function condicionComercialVigente(idMarca: string) {
  const supabase = getSupabaseServerClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("condiciones_comerciales_marca")
    .select("*")
    .eq("id_marca", idMarca)
    .eq("estado", "ACTIVA")
    .lte("fecha_desde", hoy)
    .or(`fecha_hasta.is.null,fecha_hasta.gte.${hoy}`)
    .order("fecha_desde", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(friendlyDbError(error));
  return data;
}

// Con historial: cierra la vigencia anterior e inserta una fila nueva —
// nunca se pisa, así un cargo ya generado conserva el monto que tenía en
// su momento aunque después cambies la condición.
export async function guardarCondicionComercial(idMarca: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const idLocal = text(formData, "id_local");
  const metros = number(formData, "metros_ocupados");
  const valorM2 = number(formData, "valor_por_m2");
  const montoDirecto = number(formData, "monto_mensual");
  const montoMensual = montoDirecto ?? (metros && valorM2 ? metros * valorM2 : null);
  if (!montoMensual || montoMensual <= 0) {
    return { error: "Cargá un monto mensual mayor a 0 (directo, o metros × valor por m²)." };
  }

  try {
    const supabase = getSupabaseServerClient();
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    await supabase
      .from("condiciones_comerciales_marca")
      .update({ fecha_hasta: ayer })
      .eq("id_marca", idMarca)
      .eq("estado", "ACTIVA")
      .is("fecha_hasta", null);

    const { error } = await supabase.from("condiciones_comerciales_marca").insert({
      id_marca: idMarca,
      id_local: idLocal,
      metros_ocupados: metros,
      valor_por_m2: valorM2,
      monto_mensual: montoMensual,
      fecha_desde: hoy,
      estado: "ACTIVA",
      observaciones: text(formData, "observaciones"),
    });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/situacion-marca");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo guardar la condición comercial" };
  }
}

// Genera el cargo del mes actual si todavía no existe uno para esta marca
// — evita cobrarlo dos veces. Requiere una condición comercial vigente.
export async function generarCargoMensual(idMarca: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();
    const condicion = await condicionComercialVigente(idMarca);
    if (!condicion) return { error: "Esta marca no tiene una condición comercial vigente configurada." };

    const periodo = mesActual();
    const yaExiste = await yaTieneCargoDelPeriodo(supabase, idMarca, "GASTO_FIJO_MENSUAL", periodo);
    if (yaExiste) return { error: `Ya se generó el cargo de ${periodo} para esta marca.` };

    const sesion = await sesionActual();
    await registrarMovimientoComercial(supabase, {
      idMarca,
      idLocal: condicion.id_local,
      tipoCargo: "GASTO_FIJO_MENSUAL",
      importe: condicion.monto_mensual,
      periodo,
      usuario: sesion?.nombre ?? null,
      observaciones: `Gasto fijo mensual de ${periodo}${condicion.metros_ocupados ? ` (${condicion.metros_ocupados} m² × $${condicion.valor_por_m2})` : ""}`,
    });

    revalidatePath("/situacion-marca");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo generar el cargo" };
  }
}

// ===================== FEE DE INGRESO =====================

export async function listarFeesIngreso(idMarca: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("fees_ingreso_marca")
    .select("*")
    .eq("id_marca", idMarca)
    .order("fecha_creacion", { ascending: false });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function registrarFeeIngreso(idMarca: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const monto = number(formData, "monto");
  if (!monto || monto <= 0) return { error: "El monto tiene que ser mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await sesionActual();
    const idLocal = text(formData, "id_local");

    const { data: fee, error } = await supabase
      .from("fees_ingreso_marca")
      .insert({
        id_marca: idMarca,
        id_local: idLocal,
        monto,
        fecha_pactada: text(formData, "fecha_pactada"),
        estado: "PENDIENTE",
        observaciones: text(formData, "observaciones"),
        usuario: sesion?.nombre ?? null,
      })
      .select("id_fee")
      .single();
    if (error) return { error: friendlyDbError(error) };

    await registrarMovimientoComercial(supabase, {
      idMarca,
      idLocal,
      tipoCargo: "FEE_INGRESO",
      importe: monto,
      idFee: fee.id_fee,
      usuario: sesion?.nombre ?? null,
      observaciones: "Fee de ingreso — pago único",
    });

    revalidatePath("/situacion-marca");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar el fee de ingreso" };
  }
}

export async function marcarFeePagado(idFee: string, idMarca: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await sesionActual();

    const { data: fee, error: errorFee } = await supabase
      .from("fees_ingreso_marca")
      .select("monto, estado")
      .eq("id_fee", idFee)
      .maybeSingle();
    if (errorFee) return { error: friendlyDbError(errorFee) };
    if (!fee) return { error: "No se encontró el fee" };
    if (fee.estado !== "PENDIENTE") return { error: "Este fee ya no está pendiente" };

    const { error } = await supabase
      .from("fees_ingreso_marca")
      .update({
        estado: "PAGADO",
        fecha_pago: new Date().toISOString().slice(0, 10),
        medio_pago: text(formData, "medio_pago"),
      })
      .eq("id_fee", idFee);
    if (error) return { error: friendlyDbError(error) };

    await registrarMovimientoComercial(supabase, {
      idMarca,
      tipoCargo: "PAGO",
      importe: -fee.monto,
      idFee,
      usuario: sesion?.nombre ?? null,
      observaciones: "Pago del fee de ingreso",
    });

    revalidatePath("/situacion-marca");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo marcar como pagado" };
  }
}

// ===================== PAGO / CARGO MANUAL =====================

// Para saldar el total o una parte del saldo comercial (transferencia,
// efectivo, etc.) sin atarlo a un fee puntual — o para cargar algo puntual
// que no encaja en fee/gasto fijo (una promoción, un servicio).
export async function registrarPagoComercial(idMarca: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const monto = number(formData, "monto");
  if (!monto || monto <= 0) return { error: "El monto tiene que ser mayor a 0" };
  const tipo = text(formData, "tipo") === "cargo" ? "OTRO_CARGO" : "PAGO";

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await sesionActual();
    await registrarMovimientoComercial(supabase, {
      idMarca,
      tipoCargo: tipo,
      importe: tipo === "PAGO" ? -monto : monto,
      usuario: sesion?.nombre ?? null,
      observaciones: text(formData, "descripcion") ?? (tipo === "PAGO" ? "Pago manual" : "Cargo manual"),
    });
    revalidatePath("/situacion-marca");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar el movimiento" };
  }
}

// ===================== LECTURA (cuenta comercial + retenciones) =====================

export async function saldoComercialAction(idMarca: string) {
  const supabase = getSupabaseServerClient();
  return saldoCuentaComercial(supabase, idMarca);
}

export async function historialComercialAction(idMarca: string) {
  const supabase = getSupabaseServerClient();
  const movimientos = await historialCuentaComercial(supabase, idMarca);
  return movimientos.map((m) => ({
    idMovimiento: m.id_movimiento as string,
    tipoCargo: m.tipo_cargo as string,
    importe: m.importe as number,
    saldoNuevo: m.saldo_nuevo as number,
    periodo: m.periodo as string | null,
    usuario: m.usuario as string | null,
    observaciones: m.observaciones as string | null,
    fecha: m.fecha as string,
  }));
}

// ===================== COMPENSACIÓN ENTRE CUENTAS (Fase 4) =====================

// Liquidaciones no tiene ledger propio: el "pendiente" sale de sumar lo que
// todavía no se liquidó (calcularRendicion) más lo ya liquidado pero sin
// comprobante subido, menos lo que ya se compensó contra esta cuenta.
export async function saldoLiquidacionesPendiente(idMarca: string) {
  const supabase = getSupabaseServerClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const [rendicion, historial, compensado] = await Promise.all([
    calcularRendicion(idMarca, "2000-01-01", hoy),
    historialLiquidaciones(idMarca),
    totalCompensadoLiquidaciones(supabase, idMarca),
  ]);
  const pendienteSinComprobante = historial.reduce((acc, l) => acc + (l.comprobante_path ? 0 : l.neto_a_transferir ?? 0), 0);
  return rendicion.resumen.netoARendir + pendienteSinComprobante - compensado;
}

async function saldoDeCuenta(idMarca: string, cuenta: CuentaMarca): Promise<number> {
  const supabase = getSupabaseServerClient();
  if (cuenta === "COMERCIAL") return saldoCuentaComercial(supabase, idMarca);
  if (cuenta === "RETENCIONES") {
    const saldos = await saldosRetencionPorMarca(supabase, idMarca);
    return saldos.reduce((acc, s) => acc + s.saldo, 0);
  }
  return saldoLiquidacionesPendiente(idMarca);
}

export async function saldosCuentasAction(idMarca: string) {
  const [liquidaciones, comercial, retenciones] = await Promise.all([
    saldoDeCuenta(idMarca, "LIQUIDACIONES"),
    saldoDeCuenta(idMarca, "COMERCIAL"),
    saldoDeCuenta(idMarca, "RETENCIONES"),
  ]);
  return { liquidaciones, comercial, retenciones };
}

export async function historialCompensacionesAction(idMarca: string) {
  const supabase = getSupabaseServerClient();
  const rows = await historialCompensaciones(supabase, idMarca);
  return rows.map((r) => ({
    idCompensacion: r.id_compensacion as string,
    cuentaA: r.cuenta_a as CuentaMarca,
    cuentaB: r.cuenta_b as CuentaMarca,
    importe: r.importe as number,
    usuario: r.usuario as string | null,
    observaciones: r.observaciones as string | null,
    fecha: r.fecha as string,
  }));
}

// Nunca confía en el monto máximo que mandó el cliente — lo recalcula acá
// a partir del saldo real de las dos cuentas elegidas, en el momento.
export async function registrarCompensacionAction(idMarca: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const cuentaA = text(formData, "cuenta_a") as CuentaMarca | null;
  const cuentaB = text(formData, "cuenta_b") as CuentaMarca | null;
  const importe = number(formData, "importe");
  if (!cuentaA || !cuentaB || cuentaA === cuentaB) return { error: "Elegí dos cuentas distintas para cruzar." };
  if (!importe || importe <= 0) return { error: "El monto tiene que ser mayor a 0." };

  try {
    const supabase = getSupabaseServerClient();
    const [saldoA, saldoB] = await Promise.all([saldoDeCuenta(idMarca, cuentaA), saldoDeCuenta(idMarca, cuentaB)]);
    const maximo = Math.min(saldoA, saldoB);
    if (importe > maximo) {
      return { error: `No podés compensar más de $${Math.round(maximo).toLocaleString("es-AR")} — es lo más chico entre las dos cuentas.` };
    }

    const sesion = await sesionActual();
    await registrarCompensacion(supabase, {
      idMarca,
      cuentaA,
      cuentaB,
      importe,
      usuario: sesion?.nombre ?? null,
      observaciones: text(formData, "observaciones"),
    });

    revalidatePath("/situacion-marca");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la compensación" };
  }
}
