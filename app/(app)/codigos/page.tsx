import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import CodigosApp, { type ItemCodigo } from "@/components/CodigosApp";

export const dynamic = "force-dynamic";

export default async function CodigosPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "codigos")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const [variantesRes, productosRes, marcasRes] = await Promise.all([
    supabase
      .from("variantes_producto")
      .select("id_variante,id_producto,nombre,sku,codigo_barras")
      .eq("estado", "ACTIVO"),
    supabase.from("productos").select("id_producto,nombre,imagen,id_marca").eq("estado", "ACTIVO"),
    supabase.from("marcas").select("id_marca,nombre").eq("estado", "ACTIVA"),
  ]);

  const error = variantesRes.error || productosRes.error || marcasRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los códigos</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  type FilaProducto = { id_producto: string; nombre: string; imagen: string | null; id_marca: string };
  type FilaVariante = {
    id_variante: string;
    id_producto: string;
    nombre: string;
    sku: string | null;
    codigo_barras: string | null;
  };

  const productos = new Map(
    ((productosRes.data ?? []) as FilaProducto[]).map((p) => [p.id_producto, p])
  );
  const marcas = new Map(
    ((marcasRes.data ?? []) as { id_marca: string; nombre: string }[]).map((m) => [m.id_marca, m.nombre])
  );

  // Solo las variantes de productos activos: una variante activa colgando de un
  // producto dado de baja no va a la góndola, así que tampoco lleva etiqueta.
  const items: ItemCodigo[] = ((variantesRes.data ?? []) as FilaVariante[])
    .flatMap((v) => {
      const p = productos.get(v.id_producto);
      if (!p) return [];
      return [
        {
          idVariante: v.id_variante,
          producto: p.nombre,
          // "Único" es plomería interna, no un sabor: no se muestra.
          variante: v.nombre === "Único" ? null : v.nombre,
          sku: v.sku,
          imagen: p.imagen,
          codigo: v.codigo_barras,
          // Las marcas que no están ACTIVA no salen ni en el asesor ni en el
          // tótem; se agrupan aparte para que no ensucien la cuenta.
          marca: marcas.get(p.id_marca) ?? null,
        },
      ];
    })
    .sort((a, b) => a.producto.localeCompare(b.producto, "es"));

  return <CodigosApp items={items} />;
}
