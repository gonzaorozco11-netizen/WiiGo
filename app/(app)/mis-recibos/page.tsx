import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { recibosDePersona } from "@/lib/misRecibos";
import { EMISOR } from "@/lib/emisor";
import MisRecibosApp from "@/components/MisRecibosApp";

export const dynamic = "force-dynamic";

// Mis recibos: los sueldos pagados de cada uno, para verlos y firmarlos con el
// dedo. Como Mis Tareas, sin pantalla propia: cada uno ve solo los suyos.
export default async function MisRecibosPage() {
  const cookieStore = await cookies();
  const sesion = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (!sesion) redirect("/login");

  const supabase = getSupabaseServerClient();
  const { data: usuario } = await supabase.from("usuarios").select("id_persona").eq("id_usuario", sesion.sub).maybeSingle();
  const idPersona = (usuario?.id_persona as string | null) ?? null;
  const { recibos, faltaSql } = idPersona ? await recibosDePersona(supabase, idPersona) : { recibos: [], faltaSql: false };

  return <MisRecibosApp recibos={recibos} faltaSql={faltaSql} sinPersona={!idPersona} empresa={EMISOR.razonSocial} />;
}
