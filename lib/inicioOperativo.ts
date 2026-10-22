import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina, minutosDeHora } from "@/lib/horarios";

// El Inicio del operativo en la tablet del local (pedido de Gonzalo,
// 2026-10-22): arriba un botón grande con lo que toca hacer AHORA, y abajo
// los accesos de todos los días con un número cuando hay algo pendiente.
//
//   Botón grande, según el momento:
//     no fichó (o ya fichó la salida)  → Fichar entrada
//     fichó y la caja está cerrada     → Abrir caja
//     pasó su hora de salida           → Cerrar caja y fichar salida (o Fichar salida)
//     trabajando                       → Vender
//
//   Cada acceso aparece solo si la persona tiene esa pantalla habilitada.
//   Sin montos: el operativo ve cuántas ventas hubo, no cuánta plata entró.

export type AccesoRapido = {
  clave: string;
  titulo: string;
  detalle: string;
  href: string;
  icono: string;
  /** Algo pendiente: el número va en rojo. */
  badge: number | null;
  badgeTono: "rojo" | "ambar";
  /** Sin caja abierta no se puede cobrar. */
  deshabilitado: boolean;
};

export type InicioOperativo = {
  principal: { titulo: string; detalle: string; href: string; icono: string; tono: "verde" | "azul" | "naranja" };
  estado: { texto: string; tono: "ok" | "ojo" }[];
  accesos: AccesoRapido[];
  ventasHoy: number;
  productosHoy: number;
};

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export async function armarInicioOperativo(
  supabase: SupabaseClient,
  sesion: { idUsuario: string; nombre: string },
  puede: (clave: string) => boolean,
  pendientes: { recibir: number; etiquetas: number }
): Promise<InicioOperativo> {
  const ahora = fechaHoraArgentina();
  const inicioDeHoy = `${ahora.fecha}T00:00:00-03:00`;

  const { data: usuario } = await supabase.from("usuarios").select("id_persona").eq("id_usuario", sesion.idUsuario).maybeSingle();
  const idPersona = (usuario?.id_persona as string | null) ?? null;
  const [personaRes, fichajesRes, ventasRes, pedidosRes] = await Promise.all([
    idPersona ? supabase.from("personas").select("id_local, id_horario").eq("id_persona", idPersona).maybeSingle() : Promise.resolve({ data: null }),
    idPersona
      ? supabase.from("fichajes").select("tipo, fecha_hora, id_horario").eq("id_persona", idPersona).gte("fecha_hora", inicioDeHoy).order("fecha_hora", { ascending: true })
      : Promise.resolve({ data: [] as { tipo: string; fecha_hora: string; id_horario: string | null }[] }),
    puede("pos") || puede("ventas")
      ? supabase.from("ventas").select("id_venta").eq("estado", "PAGADA").gte("fecha", inicioDeHoy)
      : Promise.resolve({ data: [] as { id_venta: string }[] }),
    puede("cobros-efectivo")
      ? supabase.from("ventas").select("id_venta", { count: "exact", head: true }).eq("estado", "PENDIENTE_PAGO")
      : Promise.resolve({ count: 0 }),
  ]);
  const persona = personaRes.data as { id_local: string | null; id_horario: string | null } | null;
  const fichajes = (fichajesRes.data ?? []) as { tipo: string; fecha_hora: string; id_horario: string | null }[];

  // La caja: la del local de la persona (si no tiene local, cualquiera abierta).
  let cajaQuery = supabase.from("turnos").select("*").eq("estado", "ABIERTO");
  if (persona?.id_local) cajaQuery = cajaQuery.eq("id_local", persona.id_local);
  const [{ data: cajas }, { data: local }] = await Promise.all([
    cajaQuery,
    persona?.id_local ? supabase.from("locales").select("*").eq("id_local", persona.id_local).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const caja = ((cajas ?? [])[0] as Record<string, unknown> | undefined) ?? null;
  const cajaAbierta = Boolean(caja);
  const cajaMia = Boolean(caja) && ((Boolean(caja!.id_usuario_apertura) && caja!.id_usuario_apertura === sesion.idUsuario) || caja!.usuario_apertura === sesion.nombre);
  const fondo = Number((local as Record<string, unknown> | null)?.fondo_cambio ?? 20000) || 0;

  // El fichaje de hoy.
  const ultimo = fichajes[fichajes.length - 1];
  const adentro = ultimo?.tipo === "ENTRADA";
  const entradaHoy = [...fichajes].reverse().find((f) => f.tipo === "ENTRADA");
  const idHorario = (adentro ? entradaHoy?.id_horario : null) ?? persona?.id_horario ?? null;
  const { data: horario } = idHorario
    ? await supabase.from("horarios_trabajo").select("nombre, hora_entrada, hora_salida, dias_semana").eq("id_horario", idHorario).maybeSingle()
    : { data: null };
  const horaEntrada = (horario?.hora_entrada as string | undefined)?.slice(0, 5) ?? null;
  const horaSalida = (horario?.hora_salida as string | undefined)?.slice(0, 5) ?? null;
  const yaEsHoraDeSalir = adentro && horaSalida !== null && ahora.minutosDelDia >= minutosDeHora(horaSalida);
  const trabajaHoy = ((horario?.dias_semana as number[] | null) ?? []).includes(ahora.diaSemanaISO);

  // Ventas de hoy: cantidad de ventas y de productos (sin montos).
  const idsVenta = ((ventasRes.data ?? []) as { id_venta: string }[]).map((v) => v.id_venta);
  let productosHoy = 0;
  for (let i = 0; i < idsVenta.length; i += 500) {
    const { data } = await supabase.from("detalle_ventas").select("cantidad").in("id_venta", idsVenta.slice(i, i + 500));
    productosHoy += (data ?? []).reduce((a, d) => a + Number(d.cantidad ?? 0), 0);
  }

  // ---------- El botón grande ----------
  const puedeFichar = puede("ficha-asistencia") && idPersona !== null;
  let principal: InicioOperativo["principal"];
  if (puedeFichar && !adentro) {
    principal = {
      titulo: "Fichar entrada",
      detalle: ultimo?.tipo === "SALIDA" ? "Si volvés por otro turno, fichá de nuevo" : horaEntrada && trabajaHoy ? `Tu turno empieza a las ${horaEntrada}` : "Marcá tu entrada al llegar",
      href: "/ficha-asistencia",
      icono: "🚪",
      tono: "verde",
    };
  } else if (yaEsHoraDeSalir && puedeFichar) {
    principal = cajaMia
      ? { titulo: "Cerrar caja y fichar salida", detalle: "Arqueo, sobres, foto y firma", href: "/ficha-asistencia", icono: "🔒", tono: "naranja" }
      : { titulo: "Fichar salida", detalle: `Tu turno terminó a las ${horaSalida}`, href: "/ficha-asistencia", icono: "🚶", tono: "naranja" };
  } else if (!cajaAbierta && puede("turnos")) {
    principal = { titulo: "Abrir caja", detalle: `Con el sobre de cambio de ${pesos(fondo)}`, href: "/turnos", icono: "💵", tono: "verde" };
  } else if (puede("pos")) {
    principal = { titulo: "Vender", detalle: "Abrí el punto de venta", href: "/pos", icono: "🛒", tono: "azul" };
  } else {
    principal = { titulo: "Mis tareas", detalle: "Lo que tenés pendiente hoy", href: "/mis-tareas", icono: "✅", tono: "azul" };
  }

  // ---------- Cómo viene ----------
  const estado: InicioOperativo["estado"] = [];
  if (puedeFichar) {
    if (adentro && entradaHoy) {
      const hora = fechaHoraArgentina(entradaHoy.fecha_hora).hora;
      estado.push({ texto: `✓ Fichaste ${hora}${horario?.nombre ? ` · ${horario.nombre}${horaSalida ? ` hasta ${horaSalida}` : ""}` : ""}`, tono: "ok" });
    } else estado.push({ texto: "Todavía no fichaste", tono: "ojo" });
  }
  if (puede("turnos")) estado.push(cajaAbierta ? { texto: cajaMia ? "💵 Tu caja abierta" : `💵 Caja abierta por ${caja!.usuario_apertura ?? "otra persona"}`, tono: "ok" } : { texto: "💵 Caja cerrada", tono: "ojo" });

  // ---------- Los accesos ----------
  const pedidos = "count" in pedidosRes ? pedidosRes.count ?? 0 : 0;
  const accesos: AccesoRapido[] = [];
  const agregar = (a: Omit<AccesoRapido, "badgeTono"> & { badgeTono?: AccesoRapido["badgeTono"] }) => accesos.push({ badgeTono: "rojo", ...a });
  if (puede("cobros-efectivo"))
    agregar({ clave: "cobrar", titulo: "Cobrar pedidos", detalle: "Los que armaron en el tótem y pagan en caja", href: "/cobros-efectivo", icono: "📲", badge: pedidos || null, deshabilitado: !cajaAbierta });
  if (puede("compras-recepcion"))
    agregar({ clave: "recibir", titulo: "Recibir mercadería", detalle: "Cuando llega un pedido de una marca", href: "/compras/recepcion", icono: "📥", badge: pendientes.recibir || null, badgeTono: "ambar", deshabilitado: false });
  if (puede("codigos") || puede("carteles"))
    agregar({
      clave: "etiquetas",
      titulo: "Etiquetas y carteles",
      detalle: "Imprimir códigos de barras y precios de góndola",
      href: puede("codigos") ? "/codigos" : "/carteles",
      icono: "🏷️",
      badge: pendientes.etiquetas || null,
      badgeTono: "ambar",
      deshabilitado: false,
    });
  // Solo con la pantalla Stock (que también permite ajustar cantidades: se
  // habilita a propósito, no se asume).
  if (puede("stock"))
    agregar({ clave: "stock", titulo: "Precio y stock", detalle: "Buscar un producto: cuánto sale y cuánto hay", href: "/stock", icono: "🔎", badge: null, deshabilitado: false });
  if (puede("ventas"))
    agregar({ clave: "devolucion", titulo: "Devolución o cambio", detalle: "Buscar la venta y devolver", href: "/ventas", icono: "↩️", badge: null, deshabilitado: false });
  if (puede("turnos"))
    agregar({ clave: "caja", titulo: "Mi caja", detalle: "Ver tu turno de caja y sus ventas", href: "/turnos", icono: "💵", badge: null, deshabilitado: false });

  return { principal, estado, accesos: accesos.slice(0, 6), ventasHoy: idsVenta.length, productosHoy };
}
