// Un profesional puede pagar sus propias compras con el saldo que acumuló
// vendiendo cada marca — siempre por marca, nunca mezclando (los puntos de
// Bloom no sirven para pagar productos de Animal Fitt). Se identifica con su
// DNI (como cualquier cliente) y confirma con un PIN propio de 6 dígitos —
// el DNI solo no alcanza, cualquiera podría saberlo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyPassword } from "@/lib/auth";

export type SaldoMarca = { idMarca: string; nombreMarca: string; saldo: number; tipoRecompensa: string };

export async function buscarProfesionalPorDni(supabase: SupabaseClient, dni: string) {
  const dniLimpio = dni.trim();
  if (!dniLimpio) return null;

  const { data: profesional } = await supabase
    .from("profesionales")
    .select("id_profesional, nombre, apellido, pin_hash")
    .eq("dni", dniLimpio)
    .eq("estado", "ACTIVO")
    .maybeSingle();
  if (!profesional) return null;

  const saldos = await saldosPorMarca(supabase, profesional.id_profesional);
  return {
    idProfesional: profesional.id_profesional as string,
    nombre: `${profesional.nombre}${profesional.apellido ? ` ${profesional.apellido}` : ""}`,
    tienePin: !!profesional.pin_hash,
    saldosPorMarca: saldos.filter((s) => s.saldo > 0),
  };
}

// Saldo = todo lo que generó vendiendo esa marca (detalle_referidos_profesionales,
// vía sus propios referidos) menos todo lo que ya canjeó/cobró de esa marca.
export async function saldosPorMarca(supabase: SupabaseClient, idProfesional: string): Promise<SaldoMarca[]> {
  const { data: referidos } = await supabase
    .from("referidos_profesionales")
    .select("id_referido")
    .eq("id_profesional", idProfesional);
  const idsReferido = (referidos ?? []).map((r) => r.id_referido);

  const { data: detalle } = await supabase
    .from("detalle_referidos_profesionales")
    .select("id_marca, recompensa_profesional")
    .in("id_referido", idsReferido.length > 0 ? idsReferido : ["00000000-0000-0000-0000-000000000000"]);

  const { data: movimientos } = await supabase
    .from("movimientos_profesional_marca")
    .select("id_marca, monto")
    .eq("id_profesional", idProfesional);

  const { data: marcas } = await supabase.from("marcas").select("id_marca, nombre");
  const { data: configs } = await supabase.from("config_profesionales_marca").select("id_marca, tipo_recompensa_profesional");
  const tipoPorMarca = new Map((configs ?? []).map((c) => [c.id_marca, c.tipo_recompensa_profesional]));
  const nombrePorMarca = new Map((marcas ?? []).map((m) => [m.id_marca, m.nombre]));

  const generadoPorMarca = new Map<string, number>();
  for (const d of detalle ?? []) {
    generadoPorMarca.set(d.id_marca, (generadoPorMarca.get(d.id_marca) ?? 0) + (d.recompensa_profesional ?? 0));
  }
  const gastadoPorMarca = new Map<string, number>();
  for (const m of movimientos ?? []) {
    gastadoPorMarca.set(m.id_marca, (gastadoPorMarca.get(m.id_marca) ?? 0) + (m.monto ?? 0));
  }

  return [...generadoPorMarca.entries()].map(([idMarca, generado]) => ({
    idMarca,
    nombreMarca: nombrePorMarca.get(idMarca) ?? "Marca",
    saldo: generado - (gastadoPorMarca.get(idMarca) ?? 0),
    tipoRecompensa: tipoPorMarca.get(idMarca) ?? "DINERO",
  }));
}

export async function verificarPinProfesional(supabase: SupabaseClient, idProfesional: string, pin: string) {
  if (!pin || pin.length < 4) return false;
  const { data } = await supabase.from("profesionales").select("pin_hash").eq("id_profesional", idProfesional).maybeSingle();
  if (!data?.pin_hash) return false;
  return verifyPassword(pin, data.pin_hash);
}

// Se llama con las marcas que el profesional eligió pagar con puntos y los
// productos reales de la venta — recalcula el monto exacto por marca a
// partir de la venta (nunca confía en un monto mandado desde el cliente).
// Si el saldo no alcanza para cubrir todo, aplica lo que haya disponible
// como descuento parcial y el resto se paga por el medio de pago normal —
// no es todo-o-nada.
export async function calcularDescuentoCanje(
  supabase: SupabaseClient,
  idProfesional: string,
  marcasElegidas: string[],
  items: { idMarca: string | null; importe: number }[]
): Promise<{ error: string | null; descuentoTotal: number; porMarca: { idMarca: string; monto: number }[] }> {
  if (marcasElegidas.length === 0) return { error: null, descuentoTotal: 0, porMarca: [] };

  const subtotalPorMarca = new Map<string, number>();
  for (const item of items) {
    if (!item.idMarca || !marcasElegidas.includes(item.idMarca)) continue;
    subtotalPorMarca.set(item.idMarca, (subtotalPorMarca.get(item.idMarca) ?? 0) + item.importe);
  }

  const saldos = await saldosPorMarca(supabase, idProfesional);
  const saldoPorMarca = new Map(saldos.map((s) => [s.idMarca, s.saldo]));

  const porMarca: { idMarca: string; monto: number }[] = [];
  let descuentoTotal = 0;
  for (const [idMarca, monto] of subtotalPorMarca) {
    const saldo = saldoPorMarca.get(idMarca) ?? 0;
    const montoAplicado = Math.min(monto, saldo);
    if (montoAplicado <= 0) continue;
    porMarca.push({ idMarca, monto: montoAplicado });
    descuentoTotal += montoAplicado;
  }

  return { error: null, descuentoTotal, porMarca };
}

export async function registrarCanje(
  supabase: SupabaseClient,
  params: { idProfesional: string; idVenta: string | null; porMarca: { idMarca: string; monto: number }[]; usuario: string | null }
) {
  if (params.porMarca.length === 0) return;
  const filas = params.porMarca.map((m) => ({
    id_profesional: params.idProfesional,
    id_marca: m.idMarca,
    tipo: "CANJE",
    monto: m.monto,
    id_venta: params.idVenta,
    usuario: params.usuario,
  }));
  await supabase.from("movimientos_profesional_marca").insert(filas);
}
