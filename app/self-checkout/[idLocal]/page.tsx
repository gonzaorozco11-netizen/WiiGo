import { notFound } from "next/navigation";
import {
  getSupabaseServerClient,
  COLUMNAS_PRODUCTO_PUBLICO,
  COLUMNAS_VARIANTE_TOTEM,
  traerMarcasPublicas,
  type Local,
  type MarcaPublica,
  type ProductoPublico,
  type VarianteTotem,
  type Stock,
} from "@/lib/supabase";
import { obtenerClimaActual } from "@/lib/clima";
import { montoQuePideDni } from "@/lib/arca/config";
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

  // Columnas explícitas, no "*": esta pantalla es PÚBLICA (el tótem no tiene
  // login y cualquiera con el link entra desde su celular). Con "*" viajaban al
  // navegador el costo informado de cada producto y, peor, el royalty, el fee
  // de ingreso y el contacto de cada marca — las condiciones comerciales de los
  // contratos. Todo eso se quedaba en el HTML, al alcance de un cliente o de la
  // competencia.
  const [productosRes, variantesRes, marcasRes, stockRes] = await Promise.all([
    supabase.from("productos").select(COLUMNAS_PRODUCTO_PUBLICO).eq("estado", "ACTIVO"),
    supabase.from("variantes_producto").select(COLUMNAS_VARIANTE_TOTEM).eq("estado", "ACTIVO"),
    traerMarcasPublicas(supabase),
    supabase.from("stock").select("id_variante,cantidad").eq("id_local", idLocal),
  ]);

  // Si esta consulta falla y no se avisa, la pantalla queda con stock vacío
  // (todos los productos "sin stock" sin ningún error visible) en vez de
  // mostrar claramente que algo se rompió.
  const error =
    productosRes.error?.message ||
    variantesRes.error?.message ||
    marcasRes.error ||
    stockRes.error?.message;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudo cargar el self-checkout</p>
        <p className="text-sm text-neutral-500">{error}</p>
      </div>
    );
  }

  const cielo = await obtenerClimaActual((local as Local).latitud, (local as Local).longitud);

  // Monto a partir del cual hay que pedirle el DNI al cliente. 0 = nunca, que
  // es como está hasta que se cargue el monto en Configuración.
  const montoPideDni = await montoQuePideDni();

  return (
    <SelfCheckoutApp
      montoPideDni={montoPideDni}
      local={local as Local}
      productos={(productosRes.data ?? []) as unknown as ProductoPublico[]}
      variantes={(variantesRes.data ?? []) as unknown as VarianteTotem[]}
      marcas={marcasRes.marcas}
      stock={(stockRes.data ?? []) as unknown as Pick<Stock, "id_variante" | "cantidad">[]}
      clima={cielo.clima}
      esDeNoche={cielo.esDeNoche}
    />
  );
}
