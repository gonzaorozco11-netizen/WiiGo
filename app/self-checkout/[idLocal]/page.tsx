import { notFound } from "next/navigation";
import {
  getSupabaseServerClient,
  type Local,
  type Marca,
  type Producto,
  type VarianteProducto,
  type Stock,
} from "@/lib/supabase";
import { obtenerClimaActual } from "@/lib/clima";
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

  const [productosRes, variantesRes, marcasRes, stockRes] = await Promise.all([
    supabase.from("productos").select("*").eq("estado", "ACTIVO"),
    supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
    supabase.from("marcas").select("*").eq("estado", "ACTIVA"),
    supabase.from("stock").select("*").eq("id_local", idLocal),
  ]);

  // Si esta consulta falla y no se avisa, la pantalla queda con stock vacío
  // (todos los productos "sin stock" sin ningún error visible) en vez de
  // mostrar claramente que algo se rompió.
  const error = productosRes.error || variantesRes.error || marcasRes.error || stockRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudo cargar el self-checkout</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  const cielo = await obtenerClimaActual((local as Local).latitud, (local as Local).longitud);

  return (
    <SelfCheckoutApp
      local={local as Local}
      productos={(productosRes.data ?? []) as Producto[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      stock={(stockRes.data ?? []) as Stock[]}
      clima={cielo.clima}
      esDeNoche={cielo.esDeNoche}
    />
  );
}
