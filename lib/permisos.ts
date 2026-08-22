// Sistema de permisos granular: un admin puede todo, siempre. Un operativo
// hace lo básico del día a día por defecto, y solo puede además hacer lo que
// un admin le haya tildado explícitamente acá. Se chequea SIEMPRE contra la
// base de datos en el momento (nunca contra la cookie de sesión, que puede
// tener hasta 30 días) — así si un admin le saca un permiso a alguien, o lo
// desactiva, el cambio pega al toque, no espera a que esa persona reloguee.

import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

export const PERMISOS = {
  VER_CAJA_ADMIN: "ver_caja_administracion",
  GESTIONAR_NOMINA: "gestionar_nomina",
  AUTORIZAR_GASTOS_SIN_LIMITE: "autorizar_gastos_sin_limite",
  EDITAR_CONFIGURACION: "editar_configuracion",
} as const;

export type Permiso = (typeof PERMISOS)[keyof typeof PERMISOS];

export const PERMISOS_DISPONIBLES: { clave: Permiso; label: string; descripcion: string }[] = [
  {
    clave: PERMISOS.VER_CAJA_ADMIN,
    label: "Ver Caja Administración",
    descripcion: "El efectivo consolidado de todos los cierres de turno, de todos los locales.",
  },
  {
    clave: PERMISOS.GESTIONAR_NOMINA,
    label: "Gestionar Nómina",
    descripcion: "Ver y editar sueldos base y adelantos de todos los empleados.",
  },
  {
    clave: PERMISOS.AUTORIZAR_GASTOS_SIN_LIMITE,
    label: "Autorizar gastos sin límite",
    descripcion: "Puede confirmar un gasto por encima del tope sin pedirle la clave a un admin.",
  },
  {
    clave: PERMISOS.EDITAR_CONFIGURACION,
    label: "Editar Configuración",
    descripcion: "Tasas de IVA/IIBB, comisiones de Mercado Pago, reglas de puntos, tope de gastos.",
  },
];

export type SesionConPermisos = {
  idUsuario: string;
  nombre: string;
  rol: string;
  permisos: string[];
};

// Lectura fresca desde la base — no confiar en lo que diga la cookie para
// nada que dé acceso a algo sensible.
export async function obtenerSesionConPermisos(): Promise<SesionConPermisos | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("usuarios")
    .select("nombre, rol, estado, permisos")
    .eq("id_usuario", sesion.sub)
    .maybeSingle();
  if (!data || data.estado !== "ACTIVO") return null;

  return {
    idUsuario: sesion.sub,
    nombre: data.nombre,
    rol: data.rol ?? "operativo",
    permisos: data.permisos ?? [],
  };
}

export function tienePermiso(sesion: SesionConPermisos | null, permiso: Permiso) {
  if (!sesion) return false;
  return sesion.rol === "admin" || sesion.permisos.includes(permiso);
}
