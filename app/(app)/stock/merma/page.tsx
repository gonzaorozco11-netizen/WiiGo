import { getSupabaseServerClient, type Local } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { listarMermas } from "@/lib/mermas";
import MermasApp from "@/components/MermasApp";

// Lo que se perdió, de los tres tipos de proveedor juntos.
//
// Vive dentro de Stock y no en un módulo aparte porque es donde se carga y
// donde se mira el mismo número desde el otro lado: cuánta mercadería hay, y
// cuánta dejó de haber sin pasar por la caja.
export const dynamic = "force-dynamic";

function primerDiaDelMes() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`;
}

function hoyISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}

export default async function MermaPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; local?: string }>;
}) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "stock")) return <PantallaBloqueada />;

  const sp = await searchParams;
  const desde = sp.desde || primerDiaDelMes();
  const hasta = sp.hasta || hoyISO();
  const idLocal = sp.local || "";

  const supabase = getSupabaseServerClient();
  const [{ data: locales }, { mermas, resumen }] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre"),
    listarMermas({ desde, hasta, idLocal: idLocal || undefined }),
  ]);

  return (
    <MermasApp
      mermas={mermas}
      resumen={resumen}
      locales={(locales ?? []) as Local[]}
      desde={desde}
      hasta={hasta}
      idLocal={idLocal}
    />
  );
}
