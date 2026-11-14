import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import {
  COOKIE_CLIENTE,
  MAIL_VALIDO,
  comparable,
  conMayuscula,
  firmarCliente,
  leerCliente,
  limpiarDni,
  mandarCodigo,
  ocultarMail,
  perfilCliente,
  verificarCodigo,
} from "@/lib/tiendaCuenta";

/**
 * La cuenta WiiGo Club de la tienda online (public/tienda/app.js).
 *
 * GET  → el perfil del que está adentro (o { usuario: null }).
 * POST → { accion: "dni" | "datos" | "codigo" | "actualizar" | "salir", ... }
 *
 * Es pública (vive bajo /api, que no pide login). Cada paso está pensado para
 * no contar nada de un cliente a quien no demostró ser él: con un DNI solo se
 * sabe a qué mail tapado se mandó el código, y si es del Club sin mail, nada
 * hasta que escriba el mismo apellido. Ver lib/tiendaCuenta.ts.
 */
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };
const mal = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: sinCache });

export async function GET(req: NextRequest) {
  const id = await leerCliente(req.cookies.get(COOKIE_CLIENTE)?.value);
  if (!id) return NextResponse.json({ usuario: null }, { headers: sinCache });
  const usuario = await perfilCliente(getSupabaseServerClient(), id);
  const res = NextResponse.json({ usuario }, { headers: sinCache });
  if (!usuario) res.cookies.delete(COOKIE_CLIENTE);
  return res;
}

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return mal("Pedido inválido.");
  }
  const supabase = getSupabaseServerClient();
  const accion = String(b.accion ?? "");

  try {
    /* 1. El DNI: ¿ya es del Club? ¿tiene mail? */
    if (accion === "dni") {
      const dni = limpiarDni(b.dni);
      if (!dni) return mal("Escribí tu DNI: 7 u 8 números, sin puntos.");
      const { data: c } = await supabase.from("clientes").select("nombre, email, estado").eq("dni", dni).maybeSingle();
      if (c && c.estado === "INACTIVO") return mal("Esa cuenta está dada de baja. Consultá en la estación.");
      const mail = (c?.email as string | null)?.trim().toLowerCase();
      if (c && mail && MAIL_VALIDO.test(mail)) {
        const err = await mandarCodigo(supabase, dni, mail, (c.nombre as string) ?? null, null);
        if (err) return mal(err, 429);
        return NextResponse.json({ paso: "codigo", mail: ocultarMail(mail) }, { headers: sinCache });
      }
      return NextResponse.json({ paso: "datos", encontrado: !!c }, { headers: sinCache });
    }

    /* 2. Los datos (cuenta nueva, o del Club sin mail) → código al mail que escribió */
    if (accion === "datos") {
      const dni = limpiarDni(b.dni);
      if (!dni) return mal("Escribí tu DNI: 7 u 8 números, sin puntos.");
      const email = String(b.email ?? "").trim().toLowerCase();
      if (!MAIL_VALIDO.test(email) || email.length > 120) return mal("Revisá el mail.");
      const cumple = String(b.cumple ?? "").trim() || null;
      if (cumple && (!/^\d{4}-\d{2}-\d{2}$/.test(cumple) || cumple < "1900-01-01" || cumple > new Date().toISOString().slice(0, 10))) return mal("Revisá la fecha de cumpleaños.");
      const promos = b.promos === true;

      const { data: c } = await supabase.from("clientes").select("nombre, apellido, email, estado").eq("dni", dni).maybeSingle();
      if (c && c.estado === "INACTIVO") return mal("Esa cuenta está dada de baja. Consultá en la estación.");
      if (c && c.email && MAIL_VALIDO.test(String(c.email))) {
        // Ya tiene mail: el código va a ese, nunca a uno nuevo escrito acá.
        const err = await mandarCodigo(supabase, dni, String(c.email).trim().toLowerCase(), c.nombre as string, null);
        if (err) return mal(err, 429);
        return NextResponse.json({ paso: "codigo", mail: ocultarMail(String(c.email)) }, { headers: sinCache });
      }
      if (c) {
        // Del Club sin mail: tiene que escribir el mismo apellido que quedó en la caja.
        if (!comparable(b.apellidoConf) || comparable(b.apellidoConf) !== comparable(c.apellido)) {
          return mal("El apellido no coincide con el de la estación. Si es tuyo, completalo la próxima vez que compres.");
        }
        const err = await mandarCodigo(supabase, dni, email, c.nombre as string, { cumple, promos, nuevo: false });
        if (err) return mal(err, 429);
        return NextResponse.json({ paso: "codigo", mail: ocultarMail(email) }, { headers: sinCache });
      }
      const nombre = conMayuscula(String(b.nombre ?? "")).slice(0, 60);
      const apellido = conMayuscula(String(b.apellido ?? "")).slice(0, 60);
      if (!nombre || !apellido) return mal("Completá tu nombre y apellido.");
      const err = await mandarCodigo(supabase, dni, email, nombre, { nombre, apellido, cumple, promos, nuevo: true });
      if (err) return mal(err, 429);
      return NextResponse.json({ paso: "codigo", mail: ocultarMail(email) }, { headers: sinCache });
    }

    /* 3. El código: entra (y si hacía falta, se crea o se completa el cliente) */
    if (accion === "codigo") {
      const dni = limpiarDni(b.dni);
      const codigo = String(b.codigo ?? "").replace(/\D/g, "");
      if (!dni || codigo.length !== 6) return mal("El código tiene 6 números.");
      const v = await verificarCodigo(supabase, dni, codigo);
      if (v.error !== null) return mal(v.error);
      const ahora = new Date().toISOString();
      const d = v.fila.datos;

      const { data: c } = await supabase.from("clientes").select("id_cliente, email, fecha_nacimiento").eq("dni", dni).maybeSingle();
      let idCliente = c?.id_cliente as string | undefined;
      if (c) {
        const cambios: Record<string, unknown> = { email_verificado_en: ahora };
        if (!c.email) cambios.email = v.fila.email; // del Club sin mail: queda el que confirmó
        if (d?.cumple && !c.fecha_nacimiento) cambios.fecha_nacimiento = d.cumple;
        if (d?.promos) Object.assign(cambios, { acepta_novedades: true, acepta_novedades_en: ahora });
        await supabase.from("clientes").update(cambios).eq("id_cliente", idCliente);
      } else {
        if (!d?.nuevo || !d.nombre || !d.apellido) return mal("El código venció. Pedí uno nuevo.");
        const { data: nuevo, error } = await supabase
          .from("clientes")
          .insert({
            nombre: d.nombre,
            apellido: d.apellido,
            dni,
            email: v.fila.email,
            fecha_nacimiento: d.cumple ?? null,
            puntos: 0,
            estado: "ACTIVO",
            email_verificado_en: ahora,
            acepta_novedades: !!d.promos,
            acepta_novedades_en: d.promos ? ahora : null,
          })
          .select("id_cliente")
          .single();
        if (error || !nuevo) {
          // Lo sumaron en la caja justo ahora: es el mismo cliente.
          const { data: otra } = await supabase.from("clientes").select("id_cliente").eq("dni", dni).maybeSingle();
          if (!otra) return mal("No pudimos crear tu cuenta. Probá de nuevo en un momento.", 500);
          idCliente = otra.id_cliente as string;
        } else idCliente = nuevo.id_cliente as string;
      }

      const usuario = await perfilCliente(supabase, idCliente!);
      const { token, maxAge } = await firmarCliente(idCliente!);
      const res = NextResponse.json({ usuario }, { headers: sinCache });
      res.cookies.set(COOKIE_CLIENTE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge });
      return res;
    }

    /* 4. Cambios desde «Mi WiiGo»: cumpleaños (si no estaba) y novedades */
    if (accion === "actualizar") {
      const id = await leerCliente(req.cookies.get(COOKIE_CLIENTE)?.value);
      if (!id) return mal("Tu sesión venció. Entrá de nuevo.", 401);
      const cambios: Record<string, unknown> = {};
      if (typeof b.promos === "boolean") Object.assign(cambios, { acepta_novedades: b.promos, acepta_novedades_en: new Date().toISOString() });
      if (b.cumple !== undefined) {
        const cumple = String(b.cumple ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cumple) || cumple < "1900-01-01" || cumple > new Date().toISOString().slice(0, 10)) return mal("Revisá la fecha de cumpleaños.");
        const { data: c } = await supabase.from("clientes").select("fecha_nacimiento").eq("id_cliente", id).maybeSingle();
        if (c?.fecha_nacimiento) return mal("Tu cumpleaños ya está cargado. Para cambiarlo, consultá en la estación.");
        cambios.fecha_nacimiento = cumple;
      }
      if (Object.keys(cambios).length) await supabase.from("clientes").update(cambios).eq("id_cliente", id);
      return NextResponse.json({ usuario: await perfilCliente(supabase, id) }, { headers: sinCache });
    }

    if (accion === "salir") {
      const res = NextResponse.json({ usuario: null }, { headers: sinCache });
      res.cookies.delete(COOKIE_CLIENTE);
      return res;
    }

    return mal("Pedido inválido.");
  } catch (e) {
    console.error("[tienda/cuenta]", accion, e);
    return mal("Algo falló. Probá de nuevo en un momento.", 500);
  }
}
