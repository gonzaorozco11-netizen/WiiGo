import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarMail, plantilla } from "@/lib/mail";
import { baseUrlPublica, urlTienda } from "@/lib/urlPublica";
import { fechaHoraArgentina } from "@/lib/horarios";
import { leerMailsResumen, PARAMETRO_MAILS_RESUMEN } from "@/lib/resumenTurno";

// Los pedidos de la tienda online (partes 3 y 4, Gonzalo 2026-11-16).
//
// El cliente arma el pedido en app.wiigo.com.ar/tienda, entra con su DNI y
// elige cómo paga:
//   - TRANSFERENCIA al alias de Mercado Pago, a precio de góndola. El equipo
//     ve la plata y la confirma (sin link de pago: la comisión es cara).
//   - AL_RETIRAR, en la caja: efectivo (precio de efectivo), QR o posnet.
// El equipo lo mueve en «Pedidos online» en tres pasos: 1 Nuevos → 2 Armando
// → 3 Listos. Al cliente le llega un mail en cada paso, y lo sigue en la tienda.
//
// La venta (canal ONLINE) se crea recién al entregar, con lo que se llevó de
// verdad: si faltó algo, la venta, el stock y los puntos ya salen bien, y lo
// que haya que devolver de una transferencia queda anotado en el pedido.
// Tablas: sql/tienda-pedidos.sql.

export const FALTA_SQL_ONLINE = "Falta correr sql/tienda-pedidos.sql en Supabase.";

export type EstadoOnline = "NUEVO" | "ARMANDO" | "LISTO" | "ENTREGADO" | "CANCELADO";
/** TARJETA (18/11): débito, crédito o dinero en cuenta por Nave (lib/nave.ts, sql/tienda-pago-tarjeta.sql). */
export type PagoOnline = "TRANSFERENCIA" | "AL_RETIRAR" | "TARJETA";
/** Se paga antes de armarlo (transferencia o tarjeta): si falta algo o se cancela, hay que devolver. */
export const pagaAntes = (pago: PagoOnline) => pago === "TRANSFERENCIA" || pago === "TARJETA";
export const ESTADOS_ABIERTOS: EstadoOnline[] = ["NUEVO", "ARMANDO", "LISTO"];

// Lo que el cliente necesita para transferir. El alias sale de Configuración
// (MP_ALIAS_TRANSFERENCIA, el mismo de la caja); lo demás son los datos de la
// cuenta que pasó Gonzalo.
export const CUENTA_TRANSFERENCIA = {
  alias: "wiigo.bienestar",
  cvu: "0000003100030560010001",
  titular: "NUOVO IMPERO S.A.S.",
  link: "https://mpago.la/2JN6J7p",
};

export async function datosTransferencia(supabase: SupabaseClient) {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", "MP_ALIAS_TRANSFERENCIA").maybeSingle();
  const alias = (data?.valor as string | null)?.trim();
  return { ...CUENTA_TRANSFERENCIA, alias: alias || CUENTA_TRANSFERENCIA.alias };
}

/** El código de retiro: WG- y cuatro letras o números que no se confunden (sin 0/O, 1/I/L). */
export function codigoRetiro() {
  const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const n = crypto.getRandomValues(new Uint32Array(4));
  return `WG-${Array.from(n, (x) => letras[x % letras.length]).join("")}`;
}

// La palabra secreta para retirar (Gonzalo, 16/11, «como Mercado Libre»): en
// la estación el cliente dice su DNI y una palabra fácil. Sale del código del
// pedido con una clave que solo tiene el servidor: no hace falta guardarla, y
// la tablet nunca la ve (solo pregunta si la que dijo el cliente es correcta).
// Palabras cortas, sin tilde ni ñ, que se escriben sin dudar.
const PALABRAS = [
  "MANGO", "KIWI", "COCO", "PERA", "UVA", "MIEL", "AVENA", "CHIA", "NUEZ", "CACAO",
  "MENTA", "CANELA", "PALTA", "BANANA", "CEREZA", "DURAZNO", "CIRUELA", "FRUTILLA", "QUINOA", "TRIGO",
  "ARROZ", "OLIVA", "SEMILLA", "HOJA", "SOL", "LUNA", "MAR", "RIO", "NUBE", "FLOR",
  "ROCA", "PLAYA", "MONTE", "BOSQUE", "VIENTO", "ROBLE", "PINO", "OLIVO", "TIGRE", "PUMA",
  "ZORRO", "PANDA", "KOALA", "BALLENA", "GATO", "PERRO", "LORO", "BUHO", "OSO", "LOBO",
  "AZUL", "VERDE", "ROJO", "NARANJA", "LILA", "CIELO", "ARENA", "LAGO", "ISLA", "VOLCAN",
  "PIANO", "GUITARRA", "TAMBOR", "FLAUTA", "RADIO", "LIBRO", "MAPA", "BARCO", "TREN", "AVION",
  "COMETA", "PLANETA", "ESTRELLA", "TRUENO", "LLUVIA", "NIEVE", "VERANO", "PRIMAVERA", "FUEGO", "GIRASOL",
];

export function palabraSecreta(codigo: string): string {
  const h = createHmac("sha256", `${process.env.AUTH_SECRET ?? ""}|palabra-retiro-v1`).update(codigo).digest();
  return PALABRAS[h.readUInt32BE(0) % PALABRAS.length];
}

/** Compara sin mayúsculas, tildes ni espacios: «mango », «Mangó» y «MANGO» valen igual. */
export function palabraCoincide(codigo: string, dicha: string): boolean {
  const limpia = dicha.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z]/g, "").toUpperCase();
  return limpia.length > 0 && limpia === palabraSecreta(codigo);
}

/** Sin pagar se guarda hasta el día siguiente a las 21 de Argentina. */
export function venceDe(desde = new Date()) {
  const hoy = fechaHoraArgentina(desde).fecha;
  return new Date(new Date(`${hoy}T21:00:00-03:00`).getTime() + 24 * 3600_000).toISOString();
}

export const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export type ItemOnline = {
  idItem: string;
  idVariante: string;
  idProducto: string;
  idMarca: string | null;
  nombre: string;
  variante: string | null;
  cantidad: number;
  /** null = estaban todos. */
  hay: number | null;
  precioLista: number;
  precioEfectivo: number;
  armado: boolean;
};

export type FilaPedidoOnline = {
  id_pedido: string;
  numero: number;
  codigo: string;
  id_cliente: string;
  id_local: string | null;
  nombre: string;
  dni: string;
  email: string | null;
  pago: PagoOnline;
  pago_ok_at: string | null;
  estado: EstadoOnline;
  total_lista: number;
  total_efectivo: number;
  devolver: number;
  devuelto_at: string | null;
  motivo_cancelacion: string | null;
  creado: string;
  aceptado_at: string | null;
  listo_at: string | null;
  entregado_at: string | null;
  cancelado_at: string | null;
  vence: string;
  id_venta: string | null;
  /** Pago con tarjeta por Nave (sql/tienda-pago-tarjeta.sql; sin correrlo no vienen). */
  nave_pedido_id?: string | null;
  nave_pago_id?: string | null;
  nave_forma?: string | null;
  pedidos_online_items?: Record<string, unknown>[] | null;
};

export function itemsDe(fila: FilaPedidoOnline): ItemOnline[] {
  return (fila.pedidos_online_items ?? []).map((i) => ({
    idItem: i.id_item as string,
    idVariante: i.id_variante as string,
    idProducto: i.id_producto as string,
    idMarca: (i.id_marca as string | null) ?? null,
    nombre: i.nombre as string,
    variante: (i.variante as string | null) ?? null,
    cantidad: Number(i.cantidad),
    hay: i.hay == null ? null : Number(i.hay),
    precioLista: Number(i.precio_lista),
    precioEfectivo: Number(i.precio_efectivo),
    armado: Boolean(i.armado),
  }));
}

export const cuantosHay = (i: Pick<ItemOnline, "cantidad" | "hay">) => (i.hay == null ? i.cantidad : i.hay);

/** Los totales con lo que hay (si faltó algo, ya descontado). */
export function totalesDe(items: ItemOnline[]) {
  const lista = items.reduce((t, i) => t + cuantosHay(i) * i.precioLista, 0);
  const efectivo = items.reduce((t, i) => t + cuantosHay(i) * i.precioEfectivo, 0);
  const original = items.reduce((t, i) => t + i.cantidad * i.precioLista, 0);
  return { lista, efectivo, original, falto: original - lista };
}

export const COLUMNAS_PEDIDO =
  "*, pedidos_online_items(id_item, id_variante, id_producto, id_marca, nombre, variante, cantidad, hay, precio_lista, precio_efectivo, armado)";

/**
 * El paso que ve el cliente (0 a 4): Recibido, Aceptado, Armando, Listo, Retirado.
 * El equipo tiene tres columnas; el cliente ve «Armando» cuando ya tildaron algo.
 */
export function pasoCliente(estado: EstadoOnline, items: ItemOnline[]) {
  if (estado === "NUEVO") return 0;
  if (estado === "ARMANDO") return items.some((i) => i.armado || i.hay != null) ? 2 : 1;
  if (estado === "LISTO") return 3;
  if (estado === "ENTREGADO") return 4;
  return -1;
}

/**
 * Lo que ya está EN UNA BOLSA de un pedido online (tildado, o lo que se encontró
 * al marcar «Falta») y todavía no se entregó. Sigue en el stock del sistema
 * hasta la entrega, pero ya no está en la góndola: el conteo del turno lo
 * descuenta para no dar diferencias falsas (Gonzalo, 16/11, opción A).
 * Si la tabla no está o falla, devuelve vacío: el conteo sigue como siempre.
 */
export async function enBolsasOnline(supabase: SupabaseClient, idLocal: string, idsVariante: string[]): Promise<Map<string, { n: number; pedidos: number[] }>> {
  const bolsas = new Map<string, { n: number; pedidos: number[] }>();
  if (idsVariante.length === 0) return bolsas;
  const { data, error } = await supabase
    .from("pedidos_online_items")
    .select("id_variante, cantidad, hay, armado, pedidos_online!inner(numero, estado, id_local)")
    .in("id_variante", idsVariante)
    .in("pedidos_online.estado", ["ARMANDO", "LISTO"])
    .eq("pedidos_online.id_local", idLocal);
  if (error) return bolsas;
  for (const f of data ?? []) {
    const n = f.armado ? Number(f.cantidad) || 0 : Number(f.hay ?? 0) || 0;
    if (n <= 0) continue;
    const ped = f.pedidos_online as unknown as { numero: number };
    const b = bolsas.get(f.id_variante as string) ?? { n: 0, pedidos: [] };
    b.n += n;
    if (!b.pedidos.includes(ped.numero)) b.pedidos.push(ped.numero);
    bolsas.set(f.id_variante as string, b);
  }
  return bolsas;
}

/**
 * Lo que no encontraron armando un pedido online desde `desde` («Falta», o el
 * pedido cancelado por «No hay nada»), con cuándo pasó. El stock no se toca:
 * el conteo del turno lo pide para que alguien lo cuente de verdad.
 * Si la tabla no está o falla, devuelve vacío.
 */
export async function faltasOnlineRecientes(supabase: SupabaseClient, idLocal: string, desde: string): Promise<{ idVariante: string; cuando: string }[]> {
  const { data, error } = await supabase
    .from("pedidos_online_items")
    .select("id_variante, cantidad, hay, pedidos_online!inner(id_local, listo_at, cancelado_at, creado)")
    .not("hay", "is", null)
    .eq("pedidos_online.id_local", idLocal)
    .gte("pedidos_online.creado", desde);
  if (error) return [];
  const faltas: { idVariante: string; cuando: string }[] = [];
  for (const f of data ?? []) {
    if (Number(f.hay) >= Number(f.cantidad)) continue;
    const p = f.pedidos_online as unknown as { listo_at: string | null; cancelado_at: string | null; creado: string };
    faltas.push({ idVariante: f.id_variante as string, cuando: p.listo_at ?? p.cancelado_at ?? p.creado });
  }
  return faltas;
}

/** Cuánto de cada variante está comprometido en pedidos online abiertos (todavía no salió del stock). */
export async function reservadoPorVariante(supabase: SupabaseClient, idsVariante: string[], salvoPedido?: string): Promise<Map<string, number>> {
  const reservado = new Map<string, number>();
  if (idsVariante.length === 0) return reservado;
  const { data, error } = await supabase
    .from("pedidos_online_items")
    .select("id_variante, cantidad, hay, id_pedido, pedidos_online!inner(estado)")
    .in("id_variante", idsVariante)
    .in("pedidos_online.estado", ESTADOS_ABIERTOS);
  if (error) return reservado;
  for (const r of data ?? []) {
    if (salvoPedido && r.id_pedido === salvoPedido) continue;
    const n = r.hay == null ? Number(r.cantidad) : Number(r.hay);
    reservado.set(r.id_variante as string, (reservado.get(r.id_variante as string) ?? 0) + n);
  }
  return reservado;
}

/**
 * Los que vencieron sin pagar se cancelan solos (el día siguiente a las 21).
 * Una transferencia ya confirmada no se cancela sola: esa plata hay que
 * devolverla o entregar el pedido, lo decide el equipo.
 * Lo corre el cron de las 21:05 (api/cron/aplicar-cambios) y, por las dudas,
 * cada vez que alguien mira la lista.
 */
export async function vencerPedidosOnline(supabase: SupabaseClient): Promise<number> {
  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from("pedidos_online")
    .update({ estado: "CANCELADO", cancelado_at: ahora, motivo_cancelacion: "No se retiró a tiempo (venció)" })
    .in("estado", ESTADOS_ABIERTOS)
    .is("pago_ok_at", null)
    .lt("vence", ahora)
    .select("id_pedido");
  if (error) return 0;
  // Con tarjeta y sin pagar (19/11): el link de Nave dura 30 min; a los 40 se cancela
  // y la mercadería vuelve a estar disponible (no esperar al día siguiente).
  const { data: tarjeta } = await supabase
    .from("pedidos_online")
    .update({ estado: "CANCELADO", cancelado_at: ahora, motivo_cancelacion: MOTIVO_TARJETA_SIN_PAGAR })
    .eq("estado", "NUEVO")
    .eq("pago", "TARJETA")
    .is("pago_ok_at", null)
    .lt("creado", new Date(Date.now() - 40 * 60_000).toISOString())
    .select("id_pedido");
  const todos = [...(data ?? []), ...(tarjeta ?? [])];
  for (const p of todos) await avisarCliente(supabase, p.id_pedido as string, "CANCELADO");
  return todos.length;
}

/** El motivo con que se cancela solo un pedido con tarjeta que no se pagó (ver arriba). */
export const MOTIVO_TARJETA_SIN_PAGAR = "No se pagó con tarjeta a tiempo";

/* ---------------- mails ---------------- */

export type AvisoCliente = "RECIBIDO" | "PAGO_OK" | "ACEPTADO" | "LISTO" | "ENTREGADO" | "CANCELADO";

const PIE = "WiiGo · Estaciones de Bienestar · Arístides Villanueva 256, Mendoza · Lunes a sábado de 9 a 13 y de 17 a 21";
/** La estación en Google Maps (la misma búsqueda que usa la tienda en public/tienda/app.js). */
const MAPA_ESTACION = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Arístides Villanueva 256, Mendoza, Argentina");

function escapar(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

/** Un mail al cliente con lo que pasó con su pedido. Nunca tira: el mail es lo accesorio. */
export async function avisarCliente(supabase: SupabaseClient, idPedido: string, tipo: AvisoCliente): Promise<void> {
  try {
    const { data } = await supabase.from("pedidos_online").select(COLUMNAS_PEDIDO).eq("id_pedido", idPedido).maybeSingle();
    const p = data as FilaPedidoOnline | null;
    if (!p?.email) return;
    const items = itemsDe(p);
    const t = totalesDe(items);
    const base = baseUrlPublica("https://app.wiigo.com.ar");
    const tienda = urlTienda();
    const boton = { texto: "Seguir mi pedido", url: `${tienda}?pedido=${encodeURIComponent(p.codigo)}` };
    const nombre = escapar(p.nombre.split(" ")[0] ?? p.nombre);
    const faltaron = items.filter((i) => i.hay != null && i.hay < i.cantidad);
    const textoFaltas = faltaron
      .map((i) => `${escapar(i.nombre)}${i.variante ? ` — ${escapar(i.variante)}` : ""}: ${i.hay === 0 ? "no había" : `había ${i.hay} de ${i.cantidad}`}`)
      .join("<br>");
    const pagaAlRetirar = p.pago === "AL_RETIRAR";
    const conTarjeta = p.pago === "TARJETA";

    let asunto = "";
    let html = "";
    let texto = "";
    if (tipo === "RECIBIDO") {
      const cuenta = await datosTransferencia(supabase);
      asunto = `Recibimos tu pedido #${p.numero}`;
      html = plantilla({
        titulo: `¡Gracias, ${nombre}!`,
        bajada: `Recibimos tu pedido #${p.numero}.`,
        destacado: palabraSecreta(p.codigo),
        detalle: ["Tu palabra secreta para retirar. En la estación decí tu DNI y esta palabra."],
        franja: pagaAlRetirar
          ? { titulo: "Pagás al retirar", texto: `En efectivo ${pesos(t.efectivo)} · con tarjeta o QR ${pesos(t.lista)}. Te lo guardamos hasta mañana a las 21.` }
          : conTarjeta
            ? { titulo: `Pagá ${pesos(t.lista)} con tarjeta`, texto: `Si no terminaste el pago, tocá «Seguir mi pedido» y después «Pagar con tarjeta». Apenas entra, armamos tu pedido.` }
            : { titulo: `Transferí ${pesos(t.lista)}`, texto: `Alias <b>${escapar(cuenta.alias)}</b> · CVU ${cuenta.cvu} · ${cuenta.titular}.<br>En el concepto poné «Pedido #${p.numero}». Apenas la vemos, armamos tu pedido.` },
        boton,
        tono: pagaAlRetirar ? "verde" : "ambar",
        pie: PIE,
        base,
      });
      texto = `Recibimos tu pedido #${p.numero}. Para retirar: tu DNI y la palabra secreta ${palabraSecreta(p.codigo)}. ${pagaAlRetirar ? `Pagás al retirar: efectivo ${pesos(t.efectivo)} o tarjeta/QR ${pesos(t.lista)}.` : conTarjeta ? `Pagá ${pesos(t.lista)} con tarjeta desde «Seguir mi pedido».` : `Transferí ${pesos(t.lista)} al alias ${cuenta.alias} (CVU ${cuenta.cvu}).`} ${boton.url}`;
    } else if (tipo === "PAGO_OK") {
      asunto = conTarjeta ? `Recibimos tu pago · pedido #${p.numero}` : `Recibimos tu transferencia · pedido #${p.numero}`;
      html = plantilla({
        titulo: conTarjeta ? "¡Listo el pago!" : "¡Llegó tu transferencia!",
        bajada: `Pedido #${p.numero} · ${pesos(t.lista)}`,
        cuerpo: conTarjeta ? "Tu pago con tarjeta entró. El equipo toma tu pedido y empieza a armarlo." : "Ya la vimos en la cuenta. El equipo toma tu pedido y empieza a armarlo.",
        boton,
        pie: PIE,
        base,
      });
      texto = `${conTarjeta ? "Recibimos tu pago con tarjeta" : "Recibimos tu transferencia"} del pedido #${p.numero}. ${boton.url}`;
    } else if (tipo === "ACEPTADO") {
      asunto = `Estamos armando tu pedido #${p.numero}`;
      html = plantilla({ titulo: "¡Manos a la obra!", bajada: `El equipo aceptó tu pedido #${p.numero} y lo está armando.`, cuerpo: "Te avisamos apenas esté listo para retirar.", boton, pie: PIE, base });
      texto = `Estamos armando tu pedido #${p.numero}. ${boton.url}`;
    } else if (tipo === "LISTO") {
      asunto = `Tu pedido #${p.numero} está listo para retirar`;
      const devolver = Number(p.devolver) || 0;
      html = plantilla({
        titulo: "¡Está listo!",
        emoji: "🛍️",
        bajada: `Tu pedido #${p.numero} te espera en la estación.`,
        destacado: palabraSecreta(p.codigo),
        detalle: ["En la estación decí tu DNI y esta palabra secreta.",pagaAlRetirar ? `A pagar: efectivo ${pesos(t.efectivo)} · tarjeta o QR ${pesos(t.lista)}` : "Ya está pago."],
        franja: faltaron.length
          ? {
              titulo: "No encontramos todo",
              texto: `${textoFaltas}<br>${devolver > 0 ? `Te devolvemos <b>${pesos(devolver)}</b> ${conTarjeta ? "a la misma tarjeta" : "por transferencia"}.` : `El total quedó en <b>${pesos(t.lista)}</b>.`}`,
            }
          : undefined,
        tono: faltaron.length ? "ambar" : "verde",
        boton,
        // La dirección abre el mapa (Gonzalo, 16/11). Google Maps: en el celu abre la app si la tiene.
        nota: `<a href="${MAPA_ESTACION}" style="color:#3f5536;font-weight:bold">📍 Arístides Villanueva 256 · Cómo llegar</a><br>Lunes a sábado de 9 a 13 y de 17 a 21.`,
        pie: PIE,
        base,
      });
      texto = `Tu pedido #${p.numero} está listo. Para retirar: tu DNI y la palabra secreta ${palabraSecreta(p.codigo)}.${faltaron.length ? ` Faltó: ${faltaron.map((i) => i.nombre).join(", ")}.` : ""} ${boton.url}`;
    } else if (tipo === "ENTREGADO") {
      const { data: venta } = p.id_venta ? await supabase.from("ventas").select("puntos_generados").eq("id_venta", p.id_venta).maybeSingle() : { data: null };
      const puntos = Number(venta?.puntos_generados ?? 0);
      asunto = `¡Gracias por tu compra en WiiGo!`;
      html = plantilla({
        titulo: `¡Gracias, ${nombre}!`,
        bajada: `Retiraste tu pedido #${p.numero}.`,
        destacado: puntos > 0 ? `+${puntos} puntos` : undefined,
        detalle: puntos > 0 ? ["Ya están en tu cuenta del WiiGo Club."] : undefined,
        boton: { texto: "Volver a la tienda", url: tienda },
        pie: PIE,
        base,
      });
      texto = `Retiraste tu pedido #${p.numero}.${puntos > 0 ? ` Sumaste ${puntos} puntos en el WiiGo Club.` : ""}`;
    } else {
      const devolver = Number(p.devolver) || 0;
      asunto = `Se canceló tu pedido #${p.numero}`;
      html = plantilla({
        titulo: "Tu pedido se canceló",
        tono: "ambar",
        bajada: `Pedido #${p.numero}${p.motivo_cancelacion ? ` · ${escapar(p.motivo_cancelacion)}` : ""}`,
        cuerpo:
          devolver > 0
            ? conTarjeta
              ? `Ya habías pagado: te devolvemos <b>${pesos(devolver)}</b> a la misma tarjeta (puede tardar unos días en verse).`
              : `Ya habías transferido: te devolvemos <b>${pesos(devolver)}</b> a la misma cuenta.`
            : "Si querés, armalo de nuevo cuando quieras.",
        boton: { texto: "Ir a la tienda", url: tienda },
        pie: PIE,
        base,
      });
      texto = `Se canceló tu pedido #${p.numero}.${devolver > 0 ? ` Te devolvemos ${pesos(devolver)}.` : ""}`;
    }
    const r = await enviarMail({ para: [p.email], asunto, html, texto });
    if (!r.ok) console.error(`[pedidos-online] no salió el mail ${tipo} del pedido ${p.numero}:`, r.error);
  } catch (e) {
    console.error("[pedidos-online] mail al cliente:", e);
  }
}

/** Un pedido nuevo: mail a los mails del Dueño (Configuración → Resumen por mail). */
export async function avisarPedidoNuevoAlDueno(supabase: SupabaseClient, idPedido: string): Promise<void> {
  try {
    const [{ data: cfg }, { data }] = await Promise.all([
      supabase.from("configuracion").select("valor").eq("parametro", PARAMETRO_MAILS_RESUMEN).maybeSingle(),
      supabase.from("pedidos_online").select(COLUMNAS_PEDIDO).eq("id_pedido", idPedido).maybeSingle(),
    ]);
    const mails = leerMailsResumen(cfg?.valor as string | null);
    const p = data as FilaPedidoOnline | null;
    if (!p || mails.length === 0) return;
    const items = itemsDe(p);
    const t = totalesDe(items);
    const base = baseUrlPublica("https://app.wiigo.com.ar");
    const asunto = `🛒 Pedido online #${p.numero} · ${pesos(t.lista)}`;
    await enviarMail({
      para: mails,
      asunto,
      html: plantilla({
        titulo: `Pedido online #${p.numero}`,
        bajada: `${escapar(p.nombre)} · ${p.pago === "TRANSFERENCIA" ? "paga por transferencia" : p.pago === "TARJETA" ? "paga con tarjeta (Nave)" : "paga al retirar"}`,
        destacado: pesos(t.lista),
        detalle: items.map((i) => `${i.cantidad} × ${escapar(i.nombre)}${i.variante ? ` — ${escapar(i.variante)}` : ""}`),
        boton: base ? { texto: "Ver pedidos online", url: `${base}/pedidos-online` } : undefined,
        base,
      }),
      texto: `Pedido online #${p.numero} de ${p.nombre}: ${pesos(t.lista)}. ${base}/pedidos-online`,
    });
  } catch (e) {
    console.error("[pedidos-online] mail al dueño:", e);
  }
}
