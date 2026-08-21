import { getSupabaseServerClient } from "@/lib/supabase";
import { detalleLiquidacion } from "@/app/(app)/liquidaciones/actions";
import ComprobanteLiquidacion from "@/components/ComprobanteLiquidacion";

export const dynamic = "force-dynamic";

export default async function ComprobantePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { liquidacion, marca, lineas, resumen } = await detalleLiquidacion(id);

  const supabase = getSupabaseServerClient();
  const { data: marcaCompleta } = await supabase
    .from("marcas")
    .select("nombre, cuit, contacto, email, telefono")
    .eq("id_marca", liquidacion.id_marca)
    .maybeSingle();

  return (
    <ComprobanteLiquidacion
      liquidacion={liquidacion}
      marca={marcaCompleta ?? { nombre: marca, cuit: null, contacto: null, email: null, telefono: null }}
      lineas={lineas}
      resumen={resumen}
    />
  );
}
