import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase";
import { esRolInterno } from "@/lib/rolesInternos";

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

// Los planes viven en lib/planesMarca.ts, que no importa `next/headers` y por
// eso lo puede usar también el tablero, que corre en el navegador. Se
// reexportan para no romper lo que ya los importaba de acá.
export {
  PLANES,
  ETIQUETA_PLAN,
  SUMA_EL_PLAN,
  planIncluye,
  beneficiosHasta,
  planSiguiente,
  type PlanMarca,
} from "@/lib/planesMarca";

import { PLANES, NIVEL, planIncluye, type PlanMarca } from "@/lib/planesMarca";

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

/**
 * El plan sobre la sesión, para usar directo en las pantallas.
 * Sin sesión responde false: nada se muestra "por las dudas".
 */
export function sesionIncluye(sesion: SesionMarca | null, minimo: PlanMarca): boolean {
  return sesion ? planIncluye(sesion.plan, minimo) : false;
}


// ===================== CONTROLES DE ACCESO =====================
//
// Todo archivo con "use server" convierte cada función exportada en un
// endpoint POST: quien esté logueado puede llamarla con los parámetros que
// quiera. Mientras al sistema solo entraban el dueño y los empleados eso no
// importaba, pero desde que las marcas tienen usuario propio, una función que
// recibe `idMarca` sin controlar nada es la puerta para que una marca lea —o
// peor, escriba— los datos de otra.
//
// Estos dos guardas van al principio de esas funciones. Tiran error en vez de
// devolver vacío: un acceso indebido tiene que fallar fuerte y visible, no
// pasar desapercibido.

/**
 * ¿Quién está logueado? Sirve para distinguir al equipo de WiiGo de los de
 * afuera (marcas y profesionales). Se pregunta por los roles internos y no
 * por "marca": así un rol nuevo no pasa como empleado.
 */
async function rolActual(): Promise<{ hay: boolean; esInterno: boolean }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (!sesion) return { hay: false, esInterno: false };
  return { hay: true, esInterno: esRolInterno(sesion.rol) };
}

/**
 * Lectura de datos de una marca: la propia si es un usuario de marca,
 * cualquiera si es del equipo de WiiGo.
 */
export async function exigirLecturaDeMarca(idMarca: string): Promise<void> {
  const sesionMarca = await obtenerSesionMarca();
  if (sesionMarca) {
    if (sesionMarca.idMarca !== idMarca) {
      throw new Error("No tenés acceso a los datos de esa marca");
    }
    return;
  }
  const { hay, esInterno } = await rolActual();
  if (!hay) throw new Error("Sesión no válida");
  if (!esInterno) throw new Error("No tenés acceso a los datos de esa marca");
}

/**
 * Operaciones que solo hace el equipo de WiiGo: registrar pagos, fees,
 * cargos, compensaciones, cerrar liquidaciones. Ninguna marca las ejecuta,
 * ni sobre sus propios datos.
 */
export async function exigirGestionInterna(): Promise<void> {
  const { hay, esInterno } = await rolActual();
  if (!hay) throw new Error("Sesión no válida");
  if (!esInterno) throw new Error("Esta operación es del equipo de WiiGo");
}
