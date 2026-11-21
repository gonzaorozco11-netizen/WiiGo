"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { friendlyDbError } from "@/lib/errors";

// Sumar un cliente a WiiGo Club en 20 segundos, desde la caja o desde el
// acceso directo del Inicio (Gonzalo, 2026-11-12: «que tengan un acceso
// directo para agregar a un cliente rápido, así ya acumula puntos»).
//
// Con el DNI ya suma puntos desde esa misma compra: no espera ninguna
// confirmación. El mail es opcional; cuando esté la confirmación por mail
// (parte 2 de la tienda online), le llega la bienvenida para confirmarlo y
// elegir si quiere novedades. Sin confirmar acumula igual, pero no recibe promociones.
//
// Lo puede usar quien vende (POS) o quien maneja Clientes.

export type ClienteClub = { dni: string; nombre: string; apellido: string | null; puntos: number };

const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** «lucía fernández» → «Lucía Fernández»: el operativo escribe rápido. */
function conMayuscula(s: string) {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, letra: string) => sep + letra.toUpperCase());
}

/**
 * Buscar a alguien del Club por DNI (Gonzalo, 21/11): nombre, desde cuándo está y
 * cuántos puntos tiene. Sin mail ni teléfono: el operativo no los necesita para esto.
 */
export type FichaClub = { dni: string; nombre: string; apellido: string | null; puntos: number; desde: string | null; ultimaCompra: string | null; compras: number };

export async function consultarClienteClub(dniTexto: string): Promise<{ error: string | null; cliente: FichaClub | null }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !(puedeVerPantalla(sesion, "club-sumar") || puedeVerPantalla(sesion, "pos") || puedeVerPantalla(sesion, "clientes"))) {
    return { error: "No tenés permiso para ver clientes.", cliente: null };
  }
  const dni = (dniTexto ?? "").replace(/\D/g, "");
  if (!/^\d{7,9}$/.test(dni)) return { error: "El DNI tiene que tener 7 u 8 números (sin puntos).", cliente: null };
  const supabase = getSupabaseServerClient();
  const { data: c } = await supabase.from("clientes").select("id_cliente, dni, nombre, apellido, puntos, fecha_alta").eq("dni", dni).maybeSingle();
  if (!c) return { error: null, cliente: null };
  const { data: ventas, count } = await supabase
    .from("ventas")
    .select("fecha", { count: "exact" })
    .eq("id_cliente", c.id_cliente as string)
    .eq("estado", "PAGADA")
    .order("fecha", { ascending: false })
    .limit(1);
  return {
    error: null,
    cliente: {
      dni,
      nombre: c.nombre as string,
      apellido: (c.apellido as string | null) ?? null,
      puntos: Number(c.puntos ?? 0),
      desde: (c.fecha_alta as string | null) ?? null,
      ultimaCompra: (ventas?.[0]?.fecha as string | undefined) ?? null,
      compras: count ?? 0,
    },
  };
}

export async function sumarClienteAlClub(datos: {
  dni: string;
  nombre: string;
  apellido: string;
  email?: string;
  telefono?: string;
}): Promise<{ error: string | null; cliente?: ClienteClub; yaEstaba?: boolean }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !(puedeVerPantalla(sesion, "club-sumar") || puedeVerPantalla(sesion, "pos") || puedeVerPantalla(sesion, "clientes"))) {
    return { error: "No tenés permiso para sumar clientes." };
  }

  const dni = (datos.dni ?? "").replace(/\D/g, "");
  if (!/^\d{7,9}$/.test(dni)) return { error: "El DNI tiene que tener 7 u 8 números (sin puntos)." };
  const nombre = conMayuscula(datos.nombre ?? "");
  const apellido = conMayuscula(datos.apellido ?? "");
  if (!nombre) return { error: "Falta el nombre." };
  if (!apellido) return { error: "Falta el apellido." };
  const email = (datos.email ?? "").trim().toLowerCase() || null;
  if (email && !MAIL.test(email)) return { error: "Ese mail no parece correcto: revisalo o dejalo vacío." };
  const telefono = (datos.telefono ?? "").trim() || null;

  try {
    const supabase = getSupabaseServerClient();
    // Si ya estaba (otro lo cargó, o se escribió el DNI con puntos en la caja), se usa ese.
    const buscar = () => supabase.from("clientes").select("dni, nombre, apellido, puntos").eq("dni", dni).maybeSingle();
    const { data: existente } = await buscar();
    if (existente) {
      return { error: null, yaEstaba: true, cliente: { dni, nombre: existente.nombre as string, apellido: (existente.apellido as string | null) ?? null, puntos: Number(existente.puntos ?? 0) } };
    }

    const { error } = await supabase.from("clientes").insert({ nombre, apellido, dni, email, telefono, puntos: 0, estado: "ACTIVO" });
    if (error) {
      // Dos cajas sumándolo a la vez: si ya quedó cargado, es el mismo cliente.
      const { data: otraVez } = await buscar();
      if (otraVez) return { error: null, yaEstaba: true, cliente: { dni, nombre: otraVez.nombre as string, apellido: (otraVez.apellido as string | null) ?? null, puntos: Number(otraVez.puntos ?? 0) } };
      return { error: friendlyDbError(error) };
    }
    revalidatePath("/clientes");
    return { error: null, cliente: { dni, nombre, apellido, puntos: 0 } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo sumar el cliente." };
  }
}
