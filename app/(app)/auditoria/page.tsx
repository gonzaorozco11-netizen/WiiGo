import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { getSupabaseServerClient, type Marca } from "@/lib/supabase";
import AuditoriaFinancieraApp from "@/components/AuditoriaFinancieraApp";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");

  if (sesion?.rol !== "admin") {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-1">No tenés permiso para ver esta pantalla</p>
        <p className="text-sm text-neutral-500">La Auditoría financiera es solo para el Dueño.</p>
      </div>
    );
  }

  const supabase = getSupabaseServerClient();
  const { data: marcas } = await supabase.from("marcas").select("*").order("nombre", { ascending: true });

  return <AuditoriaFinancieraApp marcas={(marcas ?? []) as Marca[]} />;
}
