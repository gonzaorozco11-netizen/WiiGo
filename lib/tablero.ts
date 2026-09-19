import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { fechaHoraArgentina } from "@/lib/horarios";
import { ESTADOS_ABIERTOS } from "@/lib/estadosOrden";

// Tablero de inicio.
//
// Dos reglas lo sostienen:
//
// 1. **Nada se carga a mano.** Cada tarjeta sale de algo que el sistema ya
//    sabe que está pendiente. Si el problema se resuelve, la tarjeta
//    desaparece sola: nadie tiene que marcarla como hecha, y por eso el
//    tablero no puede quedar mintiendo.
//
// 2. **Cada tarjeta depende de la pantalla, no de un rol.** El sistema no
//    tiene roles más allá de admin (ver lib/roles.ts): el acceso se define
//    por Áreas, que se traducen en pantallas. Así que si alguien no ve
//    Proveedores, tampoco recibe sus tarjetas — y el día que se le habilite,
//    le aparecen solas. No hay ninguna lista de "qué ve cada rol" que
//    mantener sincronizada.
//
// Las consultas de las pantallas que la persona NO puede ver ni se lanzan:
// además de no mostrarlas, no se gasta el viaje a la base.

export type ItemTablero = {
  color: "rojo" | "ambar" | "azul";
  titulo: string;
  detalle: string;
  valor: string;
  href: string;
};

export type KpiTablero = {
  etiqueta: string;
  valor: string;
  pie: string;
  tono?: "rojo" | "verde";
};

export type Tablero = {
  nombre: string;
  fecha: string;
  urgentes: ItemTablero[];
  seguimiento: ItemTablero[];
  kpis: KpiTablero[];
};

function pesos(v: number) {
  return `$${Math.round(v).toLocaleString("es-AR")}`;
}

function plural(n: number, singular: string, plural_: string) {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/** Cuenta sin traer las filas: para un contador no hace falta el contenido. */
type Contador = { count: number | null };
const CERO: Contador = { count: 0 };

export async function armarTablero(): Promise<Tablero | null> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const puede = (clave: string) => puedeVerPantalla(sesion, clave);
  const esAdmin = sesion.rol === "admin";

  const ahora = fechaHoraArgentina();
  const hoyISO = ahora.fecha;
  const ahoraISO = new Date().toISOString();
  const inicioDeHoy = `${hoyISO}T00:00:00-03:00`;
  // Una semana: el corte a partir del cual no tener la factura del proveedor
  // ya es un olvido y no una espera razonable.
  const haceUnaSemana = new Date(Date.now() - 7 * 86400000).toISOString();

  // Todo junto: son independientes entre sí, y encadenarlas sumaría un viaje
  // a la base por cada una.
  const [
    solicitudes,
    escaladas,
    etiquetas,
    etiquetasVencidas,
    precioEstaNoche,
    ncVenta,
    ncDevolucion,
    aDevolver,
    ordenesPendientes,
    ordenesProveedor,
    sinCostear,
    turnosAbiertos,
    sinStock,
    ventasHoy,
    liquidacionesSinFactura,
    fichajesHoy,
  ] = await Promise.all([
    puede("aprobaciones")
      ? supabase.from("solicitudes_marca").select("id_solicitud", { count: "exact", head: true }).eq("estado", "PENDIENTE")
      : CERO,
    puede("aprobaciones") && esAdmin
      ? supabase
          .from("solicitudes_marca")
          .select("id_solicitud", { count: "exact", head: true })
          .eq("estado", "PENDIENTE")
          .filter("alertas->>escalaADuenio", "eq", "true")
      : CERO,
    puede("aprobaciones")
      ? supabase.from("tareas_etiqueta").select("id_tarea", { count: "exact", head: true }).in("estado", ["PENDIENTE", "VENCIDA"])
      : CERO,
    puede("aprobaciones")
      ? supabase
          .from("tareas_etiqueta")
          .select("id_tarea", { count: "exact", head: true })
          .in("estado", ["PENDIENTE", "VENCIDA"])
          .lt("vence_el", ahoraISO)
      : CERO,
    puede("aprobaciones")
      ? supabase
          .from("solicitudes_marca")
          .select("id_solicitud", { count: "exact", head: true })
          .eq("estado", "APROBADA")
          .gte("vigencia_desde", ahoraISO)
      : CERO,
    puede("ventas")
      ? supabase.from("ventas").select("id_venta", { count: "exact", head: true }).eq("nc_estado", "PENDIENTE")
      : CERO,
    puede("ventas")
      ? supabase.from("devoluciones").select("id_devolucion", { count: "exact", head: true }).eq("nc_estado", "PENDIENTE")
      : CERO,
    // La mercadería a devolver se entrega en Compras → Recepción desde que
    // se retiró "Abastecimiento (marcas)": el permiso que la habilita pasó a
    // ser el de esa pantalla.
    puede("compras-recepcion")
      ? supabase.from("detalle_devoluciones").select("id_detalle_dev", { count: "exact", head: true }).is("devuelto_a_marca_el", null)
      : CERO,
    // Abiertas = sin llegar + llegadas a medias. Un pedido a medias todavía
    // tiene mercadería en la calle, así que sigue contando como pendiente.
    puede("compras-recepcion")
      ? supabase.from("ordenes_reposicion").select("id_orden", { count: "exact", head: true }).in("estado", ESTADOS_ABIERTOS)
      : CERO,
    puede("compras-recepcion") || puede("proveedores")
      ? supabase
          .from("ordenes_compra_proveedor")
          .select("id_orden", { count: "exact", head: true })
          .in("estado", ESTADOS_ABIERTOS)
      : CERO,
    puede("compras-costeo") || puede("proveedores")
      ? supabase.from("recepciones_proveedor").select("id_recepcion", { count: "exact", head: true }).eq("facturada", false)
      : CERO,
    puede("turnos")
      ? supabase.from("turnos").select("id_turno", { count: "exact", head: true }).eq("estado", "ABIERTO")
      : CERO,
    puede("stock")
      ? supabase.from("stock").select("id_stock", { count: "exact", head: true }).lte("cantidad", 0)
      : CERO,
    puede("ventas") || puede("pos")
      ? supabase.from("ventas").select("total, medio_pago").eq("estado", "PAGADA").gte("fecha", inicioDeHoy)
      : { data: [] as { total: number | null; medio_pago: string | null }[] },
    // Liquidaciones a proveedor que todavía no tienen su factura. Cada una es
    // crédito fiscal parado: hasta que no se carga, ese IVA no entra en IVA a
    // pagar. Se piden con más de una semana a propósito — el día que liquidás
    // el proveedor todavía no te mandó nada, y una tarea ahí sería ruido.
    puede("proveedores")
      ? supabase
          .from("liquidaciones_proveedor")
          .select("id_liquidacion, id_proveedor, monto_final, fecha_hasta")
          .is("factura_numero", null)
          .lte("fecha", haceUnaSemana)
          .order("fecha_hasta", { ascending: true })
          .limit(20)
      : { data: [] as { id_liquidacion: string; id_proveedor: string; monto_final: number | null; fecha_hasta: string }[] },
    // El fichaje se mira siempre que la persona tenga esa pantalla: es lo
    // primero que hay que hacer al llegar.
    puede("ficha-asistencia") ? fichajesDeHoy(supabase, sesion.idUsuario, hoyISO) : Promise.resolve(null),
  ]);

  const n = (c: { count: number | null }) => c.count ?? 0;

  const urgentes: ItemTablero[] = [];
  const seguimiento: ItemTablero[] = [];

  // ---------- Fichaje ----------
  // Va primero de todo: antes se redirigía a la pantalla de fichar para que
  // nadie se olvidara. Ahora se ve el día entero, pero esto queda arriba y en
  // rojo para que siga siendo lo primero.
  if (fichajesHoy?.faltaFichar) {
    urgentes.push({
      color: "rojo",
      titulo: "Fichá tu entrada",
      detalle: fichajesHoy.horario ? `Tu horario de hoy arranca ${fichajesHoy.horario}` : "Todavía no marcaste la entrada de hoy",
      valor: "→",
      href: "/ficha-asistencia",
    });
  }

  // ---------- Aprobaciones ----------
  if (n(etiquetasVencidas) > 0) {
    urgentes.push({
      color: "rojo",
      titulo: `${plural(n(etiquetasVencidas), "etiqueta vencida", "etiquetas vencidas")}`,
      detalle: "El precio nuevo ya está activo y el cartel de góndola dice el viejo",
      valor: String(n(etiquetasVencidas)),
      href: "/aprobaciones",
    });
  }

  const etiquetasPorHacer = n(etiquetas) - n(etiquetasVencidas);
  if (etiquetasPorHacer > 0) {
    urgentes.push({
      color: "ambar",
      titulo: `Cambiar ${plural(etiquetasPorHacer, "etiqueta", "etiquetas")}`,
      detalle: "Antes de que entre el precio nuevo esta noche",
      valor: String(etiquetasPorHacer),
      href: "/aprobaciones",
    });
  }

  if (n(escaladas) > 0) {
    urgentes.push({
      color: "rojo",
      titulo: `${plural(n(escaladas), "solicitud se salió", "solicitudes se salieron")} de la política`,
      detalle: "Administración no las puede aprobar: las tenés que ver vos",
      valor: String(n(escaladas)),
      href: "/aprobaciones",
    });
  }

  const solicitudesComunes = n(solicitudes) - n(escaladas);
  if (solicitudesComunes > 0) {
    urgentes.push({
      color: "ambar",
      titulo: `${plural(solicitudesComunes, "solicitud de marca esperando", "solicitudes de marcas esperando")}`,
      detalle: "Cambios de precio, promos y contenido que mandaron las marcas",
      valor: String(solicitudesComunes),
      href: "/aprobaciones",
    });
  }

  if (n(precioEstaNoche) > 0) {
    seguimiento.push({
      color: "azul",
      titulo: `${plural(n(precioEstaNoche), "cambio de precio entra", "cambios de precio entran")} esta noche`,
      detalle: "Se aplican solos con el local cerrado",
      valor: String(n(precioEstaNoche)),
      href: "/aprobaciones",
    });
  }

  // ---------- Facturas de liquidación que no llegaron ----------
  // El número que se muestra es la PLATA, no la cantidad: "falta una factura"
  // no mueve a nadie, "$16.695 de IVA parado" sí. Es lo único que hace que
  // alguien levante el teléfono y se lo reclame al proveedor.
  const liqSinFactura = liquidacionesSinFactura.data ?? [];
  if (liqSinFactura.length > 0) {
    const total = liqSinFactura.reduce((a, l) => a + ((l.monto_final as number) ?? 0), 0);
    // El IVA sale del total con la alícuota general: es un orden de magnitud
    // para que se entienda qué está en juego, no el número de la declaración.
    const ivaAproximado = Math.round(total - total / 1.21);
    urgentes.push({
      color: "ambar",
      titulo: `${plural(liqSinFactura.length, "liquidación sin factura", "liquidaciones sin factura")}`,
      detalle: `Unos $${ivaAproximado.toLocaleString("es-AR")} de IVA que todavía no podés computar`,
      valor: String(liqSinFactura.length),
      href: "/proveedores",
    });
  }

  // ---------- Notas de crédito ----------
  const nc = n(ncVenta) + n(ncDevolucion);
  if (nc > 0) {
    urgentes.push({
      color: "rojo",
      titulo: `${plural(nc, "nota de crédito no salió", "notas de crédito no salieron")}`,
      detalle: "ARCA las rechazó: esas facturas siguen vivas hasta que se emitan",
      valor: String(nc),
      href: "/ventas",
    });
  }

  // ---------- Abastecimiento ----------
  if (n(aDevolver) > 0) {
    seguimiento.push({
      color: "ambar",
      titulo: "Mercadería para devolverle a las marcas",
      detalle: "Productos que volvieron fallados o vencidos y están apartados",
      valor: String(n(aDevolver)),
      href: "/compras/recepcion",
    });
  }

  const porRecepcionar = n(ordenesPendientes) + n(ordenesProveedor);
  if (porRecepcionar > 0) {
    seguimiento.push({
      color: "azul",
      titulo: `${plural(porRecepcionar, "pedido por recepcionar", "pedidos por recepcionar")}`,
      detalle: "Mercadería que pediste y todavía no llegó o no se cargó",
      valor: String(porRecepcionar),
      href: "/compras/recepcion",
    });
  }

  // Costear es la etapa que más se olvida, porque en el momento no se rompe
  // nada: lo que se rompe es la liquidación del mes y el margen de todas las
  // pantallas. Por eso va en urgente y no en seguimiento.
  if (n(sinCostear) > 0) {
    urgentes.push({
      color: "ambar",
      titulo: `${plural(n(sinCostear), "recepción sin costear", "recepciones sin costear")}`,
      detalle: "Sin el costo cargado, la liquidación de ese proveedor sale mal",
      valor: String(n(sinCostear)),
      href: "/compras/costeo",
    });
  }

  // ---------- Stock ----------
  if (n(sinStock) > 0) {
    seguimiento.push({
      color: "ambar",
      titulo: `${plural(n(sinStock), "producto en cero", "productos en cero")}`,
      detalle: "El tótem no los va a ofrecer hasta que entre mercadería",
      valor: String(n(sinStock)),
      href: "/stock",
    });
  }

  // ---------- Números ----------
  const kpis: KpiTablero[] = [];

  if (puede("turnos")) {
    kpis.push({
      etiqueta: "Turno de caja",
      valor: n(turnosAbiertos) > 0 ? "Abierto" : "Cerrado",
      pie: n(turnosAbiertos) > 0 ? "se puede vender" : "hay que abrirlo para cobrar",
      tono: n(turnosAbiertos) > 0 ? "verde" : "rojo",
    });
  }

  const filasVentas = ("data" in ventasHoy ? ventasHoy.data : []) ?? [];
  if (puede("ventas") || puede("pos")) {
    const total = filasVentas.reduce((a, v) => a + (v.total ?? 0), 0);
    const efectivo = filasVentas
      .filter((v) => v.medio_pago === "EFECTIVO")
      .reduce((a, v) => a + (v.total ?? 0), 0);
    kpis.push({ etiqueta: "Ventas de hoy", valor: pesos(total), pie: plural(filasVentas.length, "ticket", "tickets") });
    kpis.push({ etiqueta: "Cobrado en efectivo", valor: pesos(efectivo), pie: "hoy" });
  }

  if (puede("aprobaciones")) {
    kpis.push({
      etiqueta: "Esperando respuesta",
      valor: String(n(solicitudes)),
      pie: "solicitudes de marcas",
      tono: n(solicitudes) > 0 ? "rojo" : undefined,
    });
  }

  return {
    nombre: sesion.nombre,
    fecha: new Date(`${hoyISO}T12:00:00-03:00`).toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
    urgentes,
    seguimiento,
    kpis,
  };
}

/**
 * ¿Marcó la entrada de hoy?
 *
 * Solo aplica a quien está vinculado a una Persona en Organización: sin eso
 * no hay a quién asociarle la marcación (mismo criterio que
 * ficha-asistencia/actions.ts).
 */
async function fichajesDeHoy(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  idUsuario: string,
  hoyISO: string
): Promise<{ faltaFichar: boolean; horario: string | null } | null> {
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("id_persona")
    .eq("id_usuario", idUsuario)
    .maybeSingle();
  if (!usuario?.id_persona) return null;

  const { count } = await supabase
    .from("fichajes")
    .select("id_fichaje", { count: "exact", head: true })
    .eq("id_persona", usuario.id_persona)
    .gte("fecha_hora", `${hoyISO}T00:00:00-03:00`);

  return { faltaFichar: (count ?? 0) === 0, horario: null };
}
