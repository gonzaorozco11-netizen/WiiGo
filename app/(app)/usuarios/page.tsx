import { getSupabaseServerClient, type Usuario } from "@/lib/supabase";
import UsuariosApp from "@/components/UsuariosApp";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const supabase = getSupabaseServerClient();
  // Nunca se trae password_hash acá — no hace falta en el cliente y no
  // hay que arriesgarse a exponerlo por accidente.
  const { data, error } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, email, rol, estado, fecha_alta")
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
