import type { SupabaseClient } from "@supabase/supabase-js";

// Quién es paciente de quién (tabla pacientes_profesional, ver
// sql/profesionales-pacientes.sql). La regla que aprobó Gonzalo el
// 2026-10-26:
//
// - El paciente tiene el descuento del código (el % que pone cada marca para
//   el paciente) solo en su primera compra. Después es un cliente WiiGo
//   común, con sus puntos del Club.
// - La profesional suma su % por todo lo que compre ese paciente durante los
//   meses que diga Configuración (6 al empezar), aunque no diga el código: se
//   lo reconoce por el DNI.
// - Se registra de tres formas: cuando ella le arma un pedido, desde "Sumar
//   paciente" en su espacio, o en la caja si dice el código y da su DNI.
// - Si otra profesional lo registra, pasa a la nueva. Nunca suman dos a la vez.
// - Si la misma profesional lo vuelve a registrar (un pedido nuevo), los
//   meses vuelven a contar desde ese día.
// - Cambiar los meses vale para los que se registran desde ese día: los que
//   ya estaban mantienen su fecha.

export const PARAM_MESES_VINCULO = "PROFESIONAL_MESES_VINCULO";
export const MESES_VINCULO_DEFECTO = 6;

export type OrigenPaciente = "PEDIDO" | "ESPACIO" | "CAJA";

export type VinculoActivo = {
  idVinculo: string;
  idProfesional: string;
  hasta: string;
  bienvenidaUsada: boolean;
};

export async function mesesVinculo(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", PARAM_MESES_VINCULO).maybeSingle();
  const n = Number(data?.valor);
  return Number.isInteger(n) && n > 0 && n <= 60 ? n : MESES_VINCULO_DEFECTO;
}

/**
 * El vínculo vigente de un cliente, si tiene. "sin-tabla" quiere decir que
 * todavía no se corrió el SQL: ahí el código funciona como siempre.
 */
export async function vinculoActivo(supabase: SupabaseClient, idCliente: string | null): Promise<VinculoActivo | null | "sin-tabla"> {
  if (!idCliente) return null;
  const { data, error } = await supabase
    .from("pacientes_profesional")
    .select("id_vinculo, id_profesional, hasta, bienvenida_usada")
    .eq("id_cliente", idCliente)
    .is("cerrado_at", null)
    .gt("hasta", new Date().toISOString())
    .order("desde", { ascending: false })
    .limit(1);
  if (error) return "sin-tabla";
  const v = data?.[0];
  return v
    ? { idVinculo: v.id_vinculo as string, idProfesional: v.id_profesional as string, hasta: v.hasta as string, bienvenidaUsada: Boolean(v.bienvenida_usada) }
    : null;
}

/**
 * Registra (o renueva) a un cliente como paciente de una profesional. Si era
 * de otra, se le cierra ese vínculo.
 */
export async function registrarPaciente(
  supabase: SupabaseClient,
  p: { idProfesional: string; idCliente: string; origen: OrigenPaciente; bienvenidaUsada?: boolean }
): Promise<{ error: string | null; hasta?: string }> {
  const meses = await mesesVinculo(supabase);
  const hasta = new Date();
  hasta.setMonth(hasta.getMonth() + meses);

  const actual = await vinculoActivo(supabase, p.idCliente);
  if (actual === "sin-tabla") return { error: "sin-tabla" };

  if (actual && actual.idProfesional === p.idProfesional) {
    // La misma profesional: vuelven a contar los meses, y la bienvenida queda
    // como estaba (si ya la usó, no se la vuelve a dar).
    const { error } = await supabase
      .from("pacientes_profesional")
      .update({ hasta: hasta.toISOString(), ...(p.bienvenidaUsada ? { bienvenida_usada: true } : {}) })
      .eq("id_vinculo", actual.idVinculo);
    return { error: error?.message ?? null, hasta: hasta.toISOString() };
  }

  if (actual) {
    await supabase.from("pacientes_profesional").update({ cerrado_at: new Date().toISOString() }).eq("id_vinculo", actual.idVinculo);
  }
  const { error } = await supabase.from("pacientes_profesional").insert({
    id_profesional: p.idProfesional,
    id_cliente: p.idCliente,
    origen: p.origen,
    hasta: hasta.toISOString(),
    bienvenida_usada: Boolean(p.bienvenidaUsada),
  });
  return { error: error?.message ?? null, hasta: hasta.toISOString() };
}

export async function marcarBienvenidaUsada(supabase: SupabaseClient, idVinculo: string) {
  await supabase.from("pacientes_profesional").update({ bienvenida_usada: true }).eq("id_vinculo", idVinculo);
}

/** Busca al cliente por DNI y, si no está, lo crea con los datos que dio. */
export async function clientePorDni(
  supabase: SupabaseClient,
  d: { nombre: string; apellido: string; dni: string; telefono: string | null }
): Promise<string | null> {
  const { data: cliente } = await supabase.from("clientes").select("id_cliente, telefono").eq("dni", d.dni).maybeSingle();
  if (cliente) {
    if (!cliente.telefono && d.telefono) await supabase.from("clientes").update({ telefono: d.telefono }).eq("id_cliente", cliente.id_cliente);
    return cliente.id_cliente as string;
  }
  const { data: nuevo } = await supabase
    .from("clientes")
    .insert({ nombre: d.nombre, apellido: d.apellido, dni: d.dni, telefono: d.telefono, estado: "ACTIVO" })
    .select("id_cliente")
    .single();
  return (nuevo?.id_cliente as string | undefined) ?? null;
}
