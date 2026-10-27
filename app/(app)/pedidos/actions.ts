"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { esRolInterno } from "@/lib/rolesInternos";
import { enviarMail, plantilla } from "@/lib/mail";
import { baseUrlPublica } from "@/lib/urlPublica";
import { registrarActividad } from "@/lib/profesionalSesion";
import { DIAS_GUARDADO, preciosVigentes, type EstadoPedido } from "@/lib/pedidosProfesional";

// Módulo Pedidos: lo que las profesionales arman para sus pacientes y el
// equipo prepara en el local. Tres pasos y nada más (lo recomendado a
// Gonzalo el 2026-10-26): NUEVO → LISTO para retirar → ENTREGADO, que se
// cierra solo al cobrarlo en la caja.

const FALTA_SQL = "Falta correr sql/profesionales-pedidos.sql en Supabase.";

async function sesionQueVe() {
  const s = await obtenerSesionConPantallas();
  return s && esRolInterno(s.rol) && puedeVerPantalla(s, "pedidos") ? s : null;
}

export type ItemPedido = { idItem: string; idVariante: string; nombre: string; cantidad: number; precioLista: number; precioEfectivo: number; armado: boolean };
export type PedidoEquipo = {
  idPedido: string;
  numero: number;
  estado: EstadoPedido;
  creado: string;
  listoAt: string | null;
  guardarHasta: string | null;
  vencido: boolean;
  preciosVigentes: boolean;
  paciente: { nombre: string; apellido: string; dni: string; telefono: string | null };
  profesional: { nombre: string; foto: string | null };
  // Lo armó para ella y lo paga con su saldo (sql/profesionales-pedido-propio.sql).
  paraProfesional: boolean;
  notaFalta: string | null;
  items: ItemPedido[];
  totalLista: number;
  totalEfectivo: number;
  direccion: string | null;
};

export async function listarPedidos(): Promise<{ disponible: boolean; activos: PedidoEquipo[]; cerrados: PedidoEquipo[] }> {
  const sesion = await sesionQueVe();
  if (!sesion) return { disponible: true, activos: [], cerrados: [] };
  const supabase = getSupabaseServerClient();
  // Con "*": para_profesional puede no estar todavía, y una columna que falta
  // nombrada a mano rompería toda la lista.
  const columnas = "*, pedidos_profesional_items(id_item, id_variante, nombre, cantidad, precio_lista, precio_efectivo, armado)";
  const [activosRes, cerradosRes] = await Promise.all([
    supabase.from("pedidos_profesional").select(columnas).in("estado", ["NUEVO", "LISTO"]).order("creado"),
    supabase.from("pedidos_profesional").select(columnas).in("estado", ["ENTREGADO", "CANCELADO", "DEVUELTO"]).order("creado", { ascending: false }).limit(15),
  ]);
  if (activosRes.error) return { disponible: false, activos: [], cerrados: [] };

  const filas = [...(activosRes.data ?? []), ...(cerradosRes.data ?? [])];
  const idsProf = [...new Set(filas.map((f) => f.id_profesional as string))];
  const idsLocal = [...new Set(filas.map((f) => f.id_local as string).filter(Boolean))];
  const [profRes, localRes] = await Promise.all([
    supabase.from("profesionales").select("id_profesional, nombre, apellido, foto").in("id_profesional", idsProf.length ? idsProf : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("locales").select("id_local, direccion").in("id_local", idsLocal.length ? idsLocal : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const prof = new Map((profRes.data ?? []).map((p) => [p.id_profesional as string, p]));
  const direccion = new Map((localRes.data ?? []).map((l) => [l.id_local as string, (l.direccion as string | null) ?? null]));
  const ahora = Date.now();

  const armar = (f: (typeof filas)[number]): PedidoEquipo => {
    const items = ((f.pedidos_profesional_items as Record<string, unknown>[] | null) ?? []).map((i) => ({
      idItem: i.id_item as string,
      idVariante: i.id_variante as string,
      nombre: i.nombre as string,
      cantidad: Number(i.cantidad),
      precioLista: Number(i.precio_lista),
      precioEfectivo: Number(i.precio_efectivo),
      armado: Boolean(i.armado),
    }));
    const p = prof.get(f.id_profesional as string);
    return {
      idPedido: f.id_pedido as string,
      numero: Number(f.numero),
      estado: f.estado as EstadoPedido,
      creado: f.creado as string,
      listoAt: (f.listo_at as string | null) ?? null,
      guardarHasta: (f.guardar_hasta as string | null) ?? null,
      vencido: f.estado === "LISTO" && Boolean(f.guardar_hasta) && new Date(f.guardar_hasta as string).getTime() < ahora,
      preciosVigentes: preciosVigentes(f.creado as string, ahora),
      paciente: {
        nombre: f.paciente_nombre as string,
        apellido: f.paciente_apellido as string,
        dni: f.paciente_dni as string,
        telefono: (f.paciente_telefono as string | null) ?? null,
      },
      profesional: { nombre: p ? [p.nombre, p.apellido].filter(Boolean).join(" ") : "Profesional", foto: (p?.foto as string | null) ?? null },
      paraProfesional: f.para_profesional === true,
      notaFalta: (f.nota_falta as string | null) ?? null,
      items,
      totalLista: items.reduce((t, i) => t + i.precioLista * i.cantidad, 0),
      totalEfectivo: items.reduce((t, i) => t + i.precioEfectivo * i.cantidad, 0),
      direccion: direccion.get(f.id_local as string) ?? null,
    };
  };

  return { disponible: true, activos: (activosRes.data ?? []).map(armar), cerrados: (cerradosRes.data ?? []).map(armar) };
}

/** Cuántos pedidos nuevos hay, para el número rojo del menú. */
export async function contarPedidosNuevos(): Promise<number> {
  const sesion = await sesionQueVe();
  if (!sesion) return 0;
  const supabase = getSupabaseServerClient();
  const { count, error } = await supabase.from("pedidos_profesional").select("id_pedido", { count: "exact", head: true }).eq("estado", "NUEVO");
  return error ? 0 : count ?? 0;
}

export async function marcarItemArmado(idItem: string, armado: boolean): Promise<{ error: string | null }> {
  if (!(await sesionQueVe())) return { error: "No tenés permiso para Pedidos." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("pedidos_profesional_items").update({ armado }).eq("id_item", idItem);
  return { error: error ? FALTA_SQL : null };
}

export async function marcarListo(idPedido: string): Promise<{ error: string | null; guardarHasta?: string }> {
  if (!(await sesionQueVe())) return { error: "No tenés permiso para Pedidos." };
  const supabase = getSupabaseServerClient();
  const guardarHasta = new Date(Date.now() + DIAS_GUARDADO * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("pedidos_profesional")
    .update({ estado: "LISTO", listo_at: new Date().toISOString(), guardar_hasta: guardarHasta, nota_falta: null })
    .eq("id_pedido", idPedido)
    .eq("estado", "NUEVO")
    .select("id_profesional, numero, paciente_nombre")
    .maybeSingle();
  if (error) return { error: FALTA_SQL };
  if (!data) return { error: "Ese pedido ya no estaba para armar." };
  await registrarActividad(supabase, data.id_profesional as string, `El pedido N.º ${data.numero} de ${data.paciente_nombre} quedó listo para retirar`);
  revalidatePath("/pedidos");
  return { error: null, guardarHasta };
}

/**
 * Al armarlo faltó algo: se le avisa a la profesional (en su espacio y por
 * mail) para que lo cambie por otro. El pedido sigue NUEVO.
 */
export async function avisarFalta(idPedido: string, nota: string): Promise<{ error: string | null }> {
  if (!(await sesionQueVe())) return { error: "No tenés permiso para Pedidos." };
  const texto = nota.trim().slice(0, 300);
  if (!texto) return { error: "Escribí qué falta." };
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("pedidos_profesional")
    .update({ nota_falta: texto })
    .eq("id_pedido", idPedido)
    .select("id_profesional, numero, paciente_nombre, paciente_apellido")
    .maybeSingle();
  if (error || !data) return { error: FALTA_SQL };

  const idProfesional = data.id_profesional as string;
  await registrarActividad(supabase, idProfesional, `En el pedido N.º ${data.numero} falta: ${texto}`);
  const [{ data: p }, { data: u }] = await Promise.all([
    supabase.from("profesionales").select("nombre, email").eq("id_profesional", idProfesional).maybeSingle(),
    supabase.from("usuarios").select("email, estado").eq("id_profesional", idProfesional).eq("rol", "profesional").maybeSingle(),
  ]);
  const para = ((p?.email as string | null) || (u?.estado === "ACTIVO" ? (u?.email as string | null) : null) || "").trim();
  if (para) {
    const base = baseUrlPublica();
    const asunto = `Falta algo en el pedido de ${data.paciente_nombre}`;
    const r = await enviarMail({
      para: [para],
      asunto,
      html: plantilla({
        titulo: asunto,
        tono: "ambar",
        bajada: `Pedido N.º ${data.numero} para ${data.paciente_nombre} ${data.paciente_apellido}.`,
        franja: { titulo: "Lo que falta", texto },
        cuerpo: "Si querés, armale otro pedido con un reemplazo. El resto se lo preparamos igual.",
        boton: base ? { texto: "Ver mis pedidos", url: `${base}/mi-espacio/pedidos` } : undefined,
        base,
      }),
      texto: `${asunto}\n\nPedido N.º ${data.numero}. Falta: ${texto}${base ? `\n\n${base}/mi-espacio/pedidos` : ""}`,
    });
    await supabase.from("avisos_profesional").insert({ id_profesional: idProfesional, tipo: "FALTA", referencia: idPedido, asunto, para, ok: r.ok, error: r.error });
  }
  revalidatePath("/pedidos");
  return { error: null };
}

export async function cerrarPedido(idPedido: string, estado: "CANCELADO" | "DEVUELTO"): Promise<{ error: string | null }> {
  if (!(await sesionQueVe())) return { error: "No tenés permiso para Pedidos." };
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("pedidos_profesional")
    .update({ estado })
    .eq("id_pedido", idPedido)
    .in("estado", ["NUEVO", "LISTO"])
    .select("id_profesional, numero, paciente_nombre")
    .maybeSingle();
  if (error) return { error: FALTA_SQL };
  if (data) {
    await registrarActividad(
      supabase,
      data.id_profesional as string,
      estado === "DEVUELTO" ? `${data.paciente_nombre} no retiró el pedido N.º ${data.numero}` : `Se canceló el pedido N.º ${data.numero} de ${data.paciente_nombre}`
    );
  }
  revalidatePath("/pedidos");
  return { error: null };
}

/** Lo llama la caja cuando el pedido se cobró. */
export async function marcarPedidoEntregado(idPedido: string, idVenta: string): Promise<{ error: string | null }> {
  const s = await obtenerSesionConPantallas();
  if (!s || !esRolInterno(s.rol) || !(puedeVerPantalla(s, "pos") || puedeVerPantalla(s, "pedidos"))) return { error: "Sin permiso." };
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("pedidos_profesional")
    .update({ estado: "ENTREGADO", entregado_at: new Date().toISOString(), id_venta: idVenta })
    .eq("id_pedido", idPedido)
    .in("estado", ["NUEVO", "LISTO"])
    .select("id_profesional, numero, paciente_nombre")
    .maybeSingle();
  if (data) await registrarActividad(supabase, data.id_profesional as string, `${data.paciente_nombre} retiró el pedido N.º ${data.numero}`);
  revalidatePath("/pedidos");
  return { error: null };
}
