import type { SupabaseClient } from "@supabase/supabase-js";
import { toHex, fromHex, bytesToBase64Url, base64UrlToBytes } from "@/lib/crypto";
import { enviarMail, plantilla } from "@/lib/mail";
import { baseUrlPublica } from "@/lib/urlPublica";

// La cuenta WiiGo Club de la tienda online (etapa 2, parte 2).
//
// El cliente entra con su DNI y un código de 6 números que le llega al mail:
// no hay contraseña. Es la misma fila de `clientes` que usan la caja y el
// tótem, así que los puntos y las compras son los mismos en todos lados.
// Tablas y columnas: sql/tienda-cuentas.sql.
//
// Reglas (Gonzalo, 2026-11-14):
// - DNI del Club con mail → el código va a ESE mail (no se puede cambiar desde acá).
// - DNI del Club sin mail (se sumó en la caja) → tiene que escribir el mismo
//   apellido que quedó cargado. Hasta entonces no se muestra nada de esa persona.
// - DNI nuevo → nombre, apellido, mail y cumpleaños.
// - Novedades por mail: solo si tilda la casilla (ley de datos personales).

export const COOKIE_CLIENTE = "wiigo_cliente";
const DIAS_SESION = 90;
const MINUTOS_CODIGO = 15;
const INTENTOS_CODIGO = 5;
const CODIGOS_POR_HORA = 5;

export const MAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Solo números, 7 a 9. */
export function limpiarDni(dni: unknown): string | null {
  const d = String(dni ?? "").replace(/\D/g, "");
  return /^\d{7,9}$/.test(d) ? d : null;
}

/** «fernández » → «fernandez»: para comparar apellidos sin tildes, mayúsculas ni espacios. */
export function comparable(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-zñ]/g, "");
}

/** «lucía fernández» → «Lucía Fernández». */
export function conMayuscula(s: string) {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, letra: string) => sep + letra.toUpperCase());
}

/** «lucia.fernandez@gmail.com» → «l•••z@gmail.com»: para decir a dónde fue el código sin mostrar el mail entero. */
export function ocultarMail(mail: string) {
  const i = mail.indexOf("@");
  if (i < 2) return mail;
  return `${mail.charAt(0)}•••${mail.slice(i - 1)}`;
}

/* ---------- la cookie del cliente ---------- */
// Clave PROPIA, derivada de AUTH_SECRET con otro nombre: si se firmara igual que
// la sesión del equipo (lib/session.ts), una cookie de cliente podría pasar por
// una del sistema interno. Además el formato empieza con «c1.» y lleva vencimiento.

async function claveCliente() {
  const secreto = process.env.AUTH_SECRET;
  if (!secreto) throw new Error("Falta configurar AUTH_SECRET");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`${secreto}|tienda-clientes-v1`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function firmarCliente(idCliente: string): Promise<{ token: string; maxAge: number }> {
  const maxAge = DIAS_SESION * 24 * 3600;
  const cuerpo = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ c: idCliente, exp: Math.floor(Date.now() / 1000) + maxAge })));
  const firma = await crypto.subtle.sign("HMAC", await claveCliente(), new TextEncoder().encode(`c1.${cuerpo}`));
  return { token: `c1.${cuerpo}.${toHex(firma)}`, maxAge };
}

export async function leerCliente(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 3 || partes[0] !== "c1") return null;
  const valida = await crypto.subtle
    .verify("HMAC", await claveCliente(), fromHex(partes[2]), new TextEncoder().encode(`c1.${partes[1]}`))
    .catch(() => false);
  if (!valida) return null;
  try {
    const datos = JSON.parse(new TextDecoder().decode(base64UrlToBytes(partes[1]))) as { c?: string; exp?: number };
    if (!datos.c || !datos.exp || datos.exp < Date.now() / 1000) return null;
    return datos.c;
  } catch {
    return null;
  }
}

/* ---------- el código por mail ---------- */

async function huella(dni: string, codigo: string) {
  const secreto = process.env.AUTH_SECRET ?? "";
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secreto}|codigo|${dni}|${codigo}`));
  return toHex(h);
}

function codigoNuevo() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export type DatosPendientes = { nombre?: string; apellido?: string; cumple?: string | null; promos?: boolean; nuevo?: boolean };

/** Crea un código, lo guarda (solo la huella) y lo manda. Devuelve un error para mostrar, o null. */
export async function mandarCodigo(supabase: SupabaseClient, dni: string, email: string, nombre: string | null, datos: DatosPendientes | null): Promise<string | null> {
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase.from("codigos_tienda").select("id_codigo", { count: "exact", head: true }).eq("dni", dni).gte("creado_en", haceUnaHora);
  if ((count ?? 0) >= CODIGOS_POR_HORA) return "Pediste muchos códigos seguidos. Esperá un rato y probá de nuevo.";

  const codigo = codigoNuevo();
  const { error } = await supabase.from("codigos_tienda").insert({
    dni,
    email,
    codigo_hash: await huella(dni, codigo),
    datos,
    vence_en: new Date(Date.now() + MINUTOS_CODIGO * 60_000).toISOString(),
  });
  if (error) return "No pudimos generar el código. Probá de nuevo en un momento.";

  const base = baseUrlPublica("https://app.wiigo.com.ar");
  const r = await enviarMail({
    para: [email],
    asunto: `Tu código para entrar a WiiGo: ${codigo}`,
    html: plantilla({
      titulo: nombre ? `Hola, ${escapar(nombre)}` : "Tu código para entrar",
      bajada: "Escribilo en la tienda de WiiGo para entrar a tu cuenta del Club.",
      destacado: `${codigo.slice(0, 3)} ${codigo.slice(3)}`,
      detalle: [`Vence en ${MINUTOS_CODIGO} minutos.`],
      nota: "Si no fuiste vos, ignorá este mail: sin el código nadie puede entrar.",
      pie: "WiiGo · Estaciones de Bienestar · Arístides Villanueva 256, Mendoza",
      base,
    }),
    texto: `Tu código para entrar a WiiGo: ${codigo}. Vence en ${MINUTOS_CODIGO} minutos. Si no fuiste vos, ignorá este mail.`,
  });
  if (!r.ok) {
    console.error("[tienda/cuenta] no salió el mail del código:", r.error);
    return "No pudimos mandarte el mail. Probá de nuevo en un momento.";
  }
  return null;
}

/** Verifica el código. Si está bien lo marca usado y devuelve lo que se guardó con él. */
export async function verificarCodigo(
  supabase: SupabaseClient,
  dni: string,
  codigo: string
): Promise<{ error: string; fila?: undefined } | { error: null; fila: { email: string; datos: DatosPendientes | null } }> {
  const { data: fila } = await supabase
    .from("codigos_tienda")
    .select("id_codigo, email, codigo_hash, datos, intentos, vence_en, usado_en")
    .eq("dni", dni)
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!fila || fila.usado_en || new Date(fila.vence_en as string).getTime() < Date.now()) return { error: "El código venció. Pedí uno nuevo." };
  if ((fila.intentos as number) >= INTENTOS_CODIGO) return { error: "Probaste muchas veces. Pedí un código nuevo." };
  if ((await huella(dni, codigo)) !== fila.codigo_hash) {
    await supabase.from("codigos_tienda").update({ intentos: (fila.intentos as number) + 1 }).eq("id_codigo", fila.id_codigo);
    return { error: "El código no es correcto. Revisalo y probá de nuevo." };
  }
  // Una sola vez: si dos pedidos llegan juntos, solo uno lo marca.
  const { data: marcado } = await supabase.from("codigos_tienda").update({ usado_en: new Date().toISOString() }).eq("id_codigo", fila.id_codigo).is("usado_en", null).select("id_codigo");
  if (!marcado || marcado.length === 0) return { error: "Ese código ya se usó. Pedí uno nuevo." };
  return { error: null, fila: { email: fila.email as string, datos: (fila.datos as DatosPendientes | null) ?? null } };
}

function escapar(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

/* ---------- lo que ve el cliente en «Mi WiiGo» ---------- */

const MEDIOS: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", DEBITO: "Débito", CREDITO: "Crédito", QR: "QR Mercado Pago", MERCADO_PAGO: "Mercado Pago", MERCADOPAGO: "Mercado Pago", TRANSFERENCIA: "Transferencia" };
const DONDE: Record<string, string> = { POS: "En la estación", SELF_CHECKOUT: "En el tótem de la estación", ONLINE: "Online · retiro en la estación" };

export async function perfilCliente(supabase: SupabaseClient, idCliente: string) {
  const { data: c } = await supabase
    .from("clientes")
    .select("id_cliente, nombre, apellido, dni, email, fecha_nacimiento, puntos, acepta_novedades, estado")
    .eq("id_cliente", idCliente)
    .maybeSingle();
  if (!c || c.estado === "INACTIVO") return null;

  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta, fecha, canal, total, medio_pago, puntos_generados, estado")
    .eq("id_cliente", idCliente)
    .order("fecha", { ascending: false })
    .limit(30);
  const validas = (ventas ?? []).filter((v) => !/CANCEL|ANUL|PENDIENTE/i.test(String(v.estado ?? "")));
  const ids = validas.map((v) => v.id_venta as string);
  const { data: detalle } = ids.length
    ? await supabase.from("detalle_ventas").select("id_venta, cantidad, subtotal, variantes_producto(nombre, productos(id_producto, nombre, imagen))").in("id_venta", ids)
    : { data: [] as unknown[] };

  type Fila = { id_venta: string; cantidad: number; subtotal: number; variantes_producto: { nombre: string; productos: { id_producto: string; nombre: string; imagen: string | null } | null } | null };
  const itemsDe = new Map<string, { id: string | null; n: string; v: string | null; q: number; imp: number; img: string | null }[]>();
  for (const d of (detalle ?? []) as unknown as Fila[]) {
    const p = d.variantes_producto?.productos;
    const sabor = d.variantes_producto?.nombre;
    const lista = itemsDe.get(d.id_venta) ?? [];
    lista.push({ id: p?.id_producto ?? null, n: p?.nombre ?? "Producto", v: sabor && sabor !== "Único" ? sabor : null, q: Number(d.cantidad) || 0, imp: Number(d.subtotal) || 0, img: p?.imagen ?? null });
    itemsDe.set(d.id_venta, lista);
  }

  return {
    nombre: c.nombre as string,
    apellido: (c.apellido as string | null) ?? "",
    dni: c.dni as string,
    email: (c.email as string | null) ?? "",
    cumple: (c.fecha_nacimiento as string | null) ?? null,
    promos: !!c.acepta_novedades,
    puntos: Number(c.puntos ?? 0),
    compras: validas.map((v) => ({
      fecha: v.fecha as string,
      donde: DONDE[String(v.canal)] ?? "En la estación",
      pago: MEDIOS[String(v.medio_pago ?? "").toUpperCase()] ?? (v.medio_pago ? String(v.medio_pago) : ""),
      // `total`, no `total_cobrado`: en efectivo, total_cobrado puede ser lo que entregó el cliente (con el vuelto).
      total: Number(v.total ?? 0),
      puntos: Number(v.puntos_generados ?? 0),
      items: itemsDe.get(v.id_venta as string) ?? [],
    })),
  };
}
