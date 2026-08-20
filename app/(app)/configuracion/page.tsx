import { getSupabaseServerClient } from "@/lib/supabase";
import ConfiguracionApp from "@/components/ConfiguracionApp";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const supabase = getSupabaseServerClient();

  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", ["PUNTOS_ACTIVO", "PUNTOS_CADA_MONTO", "PUNTOS_OTORGADOS"]);

  const valores = new Map((data ?? []).map((c) => [c.parametro, c.valor]));

  return (
    <ConfiguracionApp
      puntosActivo={valores.get("PUNTOS_ACTIVO") === "true"}
      puntosCadaMonto={Number(valores.get("PUNTOS_CADA_MONTO") ?? 1000)}
      puntosOtorgados={Number(valores.get("PUNTOS_OTORGADOS") ?? 10)}
    />
  );
}
