import { notFound } from "next/navigation";
import {
  getSupabaseServerClient,
  type Local,
  type Marca,
  type Producto,
  type VarianteProducto,
  type Stock,
} from "@/lib/supabase";
import SelfCheckoutApp from "@/components/SelfCheckoutApp";

export const dynamic = "force-dynamic";

export default async function SelfCheckoutPage({ params }: { params: Promise<{ idLocal: string }> }) {
  const { idLocal } = await params;
  const supabase = getSupabaseServerClient();

  const { data: local } = await supabase
    .from("locales")
    .select("*")
    .eq("id_local", idLocal)
    .eq("estado", "ACTIVO")
    .maybeSingle();

  if (!local) notFound();

  const [productosRes, variantesRes, marcasRes, stockRes, configRes] = await Promise.all([
    supabase.from("productos").select("*").eq("estado", "ACTIVO"),
    supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
    supabase.from("marcas").select("*").eq("estado", "ACTIVA"),
    supabase.from("stock").select("*").eq("id_local", idLocal),
    supabase.from("configuracion").select("valor").eq("parametro", "IVA_GENERAL_PORCENTAJE").maybeSingle(),
  ]);

  const ivaGeneralPorcentaje = Number(configRes.data?.valor ?? 21);

  return (
    <SelfCheckoutApp
      local={local as Local}
      productos={(productosRes.data ?? []) as Producto[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      stock={(stockRes.data ?? []) as Stock[]}
      ivaGeneralPorcentaje={ivaGeneralPorcentaje}
    />
  );
}
