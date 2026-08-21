import { cookies } from "next/headers";
import { getSupabaseServerClient, type Local } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { listarCategorias, listarSubcategorias } from "@/app/(app)/gastos/actions";
import GastosApp from "@/components/GastosApp";

export const dynamic = "force-dynamic";

export default async function GastosPage() {
  const supabase = getSupabaseServerClient();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");

  const [localesRes, usuariosRes, turnosAbiertosRes, categorias, subcategorias, configRes] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase
      .from("usuarios")
      .select("id_usuario, nombre, sueldo_base")
      .eq("estado", "ACTIVO")
      .order("nombre", { ascending: true }),
    supabase.from("turnos").select("id_turno, id_local").eq("estado", "ABIERTO"),
    listarCategorias(),
    listarSubcategorias(),
    supabase.from("configuracion").select("valor").eq("parametro", "GASTOS_TOPE_SIN_AUTORIZACION").maybeSingle(),
  ]);

  return (
    <GastosApp
      locales={(localesRes.data ?? []) as Local[]}
      usuarios={usuariosRes.data ?? []}
      turnosAbiertos={turnosAbiertosRes.data ?? []}
      categoriasIniciales={categorias}
      subcategoriasIniciales={subcategorias}
      rol={session?.rol ?? null}
      topeAutorizacion={Number(configRes.data?.valor ?? 10000)}
    />
  );
}
