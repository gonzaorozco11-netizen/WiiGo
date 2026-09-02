import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase";

// Sesión del portal de marcas.
//
// Regla que sostiene todo el módulo: **la marca sale de la sesión, nunca de
// la URL ni de un parámetro**. Si el id de marca viajara por la dirección,
// cambiando un número una marca vería los datos de otra — y eso no se arregla
// pidiendo disculpas.
//
// Por la misma razón se lee fresco de la base en cada request y no de la
// cookie: si a una marca se le cambia el plan o se le da de baja el usuario,
// pega en el acto sin esperar a que reloguee.

export const PLANES = ["BRONCE", "METAL", "GOLD"] as const;
export type PlanMarca = (typeof PLANES)[number];

/** Orden de los planes: sirve para preguntar "¿tiene al menos Metal?". */
const NIVEL: Record<PlanMarca, number> = { BRONCE: 1, METAL: 2, GOLD: 3 };

export type SesionMarca = {
  idUsuario: string;
  nombreUsuario: string;
  idMarca: string;
  nombreMarca: string;
  logoMarca: string | null;
  plan: PlanMarca;
};

function normalizarPlan(valor: unknown): PlanMarca {
  const texto = String(valor ?? "").toUpperCase();
  return (PLANES as readonly string[]).includes(texto) ? (texto as PlanMarca) : "BRONCE";
}

/**
 * Devuelve la marca del usuario logueado, o null si no es un usuario de marca.
 *
 * Null significa "no tiene nada que hacer en el portal": ni un admin ni un
 * empleado entran acá. Para mirar el portal de una marca, el admin usa la
 * ficha de la marca en el sistema, que ya existe.
 */
export async function obtenerSesionMarca(): Promise<SesionMarca | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, rol, estado, id_marca")
    .eq("id_usuario", sesion.sub)
    .maybeSingle();

  if (!usuario || usuario.estado !== "ACTIVO") return null;
  if (usuario.rol !== "marca" || !usuario.id_marca) return null;

  const { data: marca } = await supabase
    .from("marcas")
    .select("id_marca, nombre, estado, plan, logo")
    .eq("id_marca", usuario.id_marca)
    .maybeSingle();

  // Marca dada de baja: el usuario deja de entrar, aunque siga activo.
  if (!marca || marca.estado !== "ACTIVA") return null;

  return {
    idUsuario: usuario.id_usuario as string,
    nombreUsuario: usuario.nombre as string,
    idMarca: marca.id_marca as string,
    nombreMarca: marca.nombre as string,
    logoMarca: (marca.logo as string | null) ?? null,
    plan: normalizarPlan(marca.plan),
  };
}

/** ¿El plan de la marca llega al nivel pedido? */
export function planIncluye(plan: PlanMarca, minimo: PlanMarca): boolean {
  return NIVEL[plan] >= NIVEL[minimo];
}

/**
 * Lo mismo pero sobre la sesión, para usar directo en las pantallas.
 * Sin sesión responde false: nada se muestra "por las dudas".
 */
export function sesionIncluye(sesion: SesionMarca | null, minimo: PlanMarca): boolean {
  return sesion ? planIncluye(sesion.plan, minimo) : false;
}

export const ETIQUETA_PLAN: Record<PlanMarca, string> = {
  BRONCE: "Bronce",
  METAL: "Metal",
  GOLD: "Gold",
};
