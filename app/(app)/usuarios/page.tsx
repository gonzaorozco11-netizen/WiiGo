import { cookies } from "next/headers";
import { getSupabaseServerClient, type Usuario } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import UsuariosApp from "@/components/UsuariosApp";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");

  if (sesion?.rol !== "admin") {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-1">No tenés permiso para ver esta pantalla</p>
        <p className="text-sm text-neutral-500">La gestión de usuarios es solo para administradores.</p>
      </div>
    );
  }

  const supabase = getSupabaseServerClient();
  // Nunca se trae password_hash acá — no hace falta en el cliente y no
  // hay que arriesgarse a exponerlo por accidente.
  const { data, error } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, email, rol, estado, fecha_alta, permisos")
    .order("nombre", { ascending: true });

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los usuarios</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  return <UsuariosApp usuarios={(data ?? []) as Omit<Usuario, "password_hash">[]} />;
}
