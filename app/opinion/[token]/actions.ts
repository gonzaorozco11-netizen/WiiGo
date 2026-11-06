"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { INTENTOS_DNI, LARGO_OPINION, nombreParaMostrar, type ComoAparece } from "@/lib/opinionesPacientes";

// La única acción de la página pública /opinion/<token> (sin login: la abre el
// paciente desde el WhatsApp de su profesional). Todo sale del token: no recibe
// ni el id de la profesional ni el del paciente.

type Datos = { dni3: string; texto: string; como: ComoAparece; detalle: string; acepta: boolean };
export type ResultadoOpinion = { error: string | null; bloqueado?: boolean; nombre?: string };

const COMO: ComoAparece[] = ["NOMBRE", "INICIALES", "ANONIMO"];

export async function enviarOpinionPaciente(token: string, d: Datos): Promise<ResultadoOpinion> {
  const texto = String(d.texto ?? "").replace(/\s+/g, " ").trim();
  const detalle = String(d.detalle ?? "").replace(/\s+/g, " ").trim().slice(0, 50) || null;
  const como = COMO.includes(d.como) ? d.como : "NOMBRE";
  if (!/^\d{3}$/.test(String(d.dni3 ?? ""))) return { error: "Poné los últimos 3 números de tu DNI." };
  if (texto.length < LARGO_OPINION.minimo) return { error: `Escribí un poco más: al menos ${LARGO_OPINION.minimo} letras.` };
  if (texto.length > LARGO_OPINION.maximo) return { error: `Es un poco larga: hasta ${LARGO_OPINION.maximo} letras.` };
  if (!d.acepta) return { error: "Falta que aceptes que se muestre en el local." };

  const supabase = getSupabaseServerClient();
  const { data: p } = await supabase
    .from("pedidos_opinion")
    .select("id_pedido, id_profesional, id_cliente, vence_el, usado_el, intentos, clientes(nombre, apellido, dni)")
    .eq("token", String(token ?? "").slice(0, 64))
    .maybeSingle();
  if (!p) return { error: "Este link no existe. Pedile uno nuevo a tu profesional.", bloqueado: true };
  if (p.usado_el) return { error: "Con este link ya dejaste tu opinión. ¡Gracias!", bloqueado: true };
  if (new Date(p.vence_el as string) < new Date()) return { error: "Este link venció. Pedile uno nuevo a tu profesional.", bloqueado: true };
  if ((p.intentos as number) >= INTENTOS_DNI) return { error: "Por seguridad este link se bloqueó. Pedile uno nuevo a tu profesional.", bloqueado: true };

  const c = p.clientes as unknown as { nombre: string; apellido: string | null; dni: string | null } | null;
  if (!c?.dni || c.dni.replace(/\D/g, "").slice(-3) !== d.dni3) {
    const intentos = (p.intentos as number) + 1;
    await supabase.from("pedidos_opinion").update({ intentos }).eq("id_pedido", p.id_pedido);
    if (intentos >= INTENTOS_DNI) return { error: "Por seguridad este link se bloqueó. Pedile uno nuevo a tu profesional.", bloqueado: true };
    return { error: `Esos números no coinciden con tu DNI. Te ${INTENTOS_DNI - intentos === 1 ? "queda 1 intento" : `quedan ${INTENTOS_DNI - intentos} intentos`}.` };
  }

  // Se marca usado primero y solo si nadie lo usó en el medio: así no salen dos.
  const ahora = new Date().toISOString();
  const { data: marcado } = await supabase.from("pedidos_opinion").update({ usado_el: ahora }).eq("id_pedido", p.id_pedido).is("usado_el", null).select("id_pedido");
  if (!marcado || marcado.length === 0) return { error: "Con este link ya dejaste tu opinión. ¡Gracias!", bloqueado: true };

  const { error } = await supabase.from("opiniones_profesional").insert({
    id_profesional: p.id_profesional,
    id_cliente: p.id_cliente,
    nombre: nombreParaMostrar(c.nombre, c.apellido, como),
    detalle,
    texto,
    origen: "PACIENTE",
    estado: "PENDIENTE",
    // No sale en la pantalla hasta que Gonzalo la aprueba.
    publico: false,
    orden: 0,
    permiso_at: ahora,
  });
  if (error) {
    await supabase.from("pedidos_opinion").update({ usado_el: null }).eq("id_pedido", p.id_pedido);
    return { error: "No se pudo enviar. Probá de nuevo en un rato." };
  }
  return { error: null, nombre: (c.nombre ?? "").split(/\s+/)[0] };
}
