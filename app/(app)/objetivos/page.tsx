import { getSupabaseServerClient, type Objetivo } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ObjetivosApp, { type ProductoParaObjetivo } from "@/components/ObjetivosApp";

export const dynamic = "force-dynamic";

export default async function ObjetivosPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "objetivos")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const [objetivosRes, productosRes, marcasRes, subcatsRes, relRes] = await Promise.all([
    supabase.from("objetivos").select("*").order("orden", { ascending: true }),
    supabase
      .from("productos")
      .select("id_producto,nombre,id_marca,id_subcategoria,imagen")
      .eq("estado", "ACTIVO"),
    supabase.from("marcas").select("id_marca,nombre").eq("estado", "ACTIVA"),
    supabase.from("subcategorias").select("id_subcategoria,nombre").eq("estado", "ACTIVA"),
    supabase.from("producto_objetivos").select("id_producto,id_objetivo").limit(10000),
  ]);

  const error = objetivosRes.error || productosRes.error || relRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los objetivos</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  const marcas = new Map(
    ((marcasRes.data ?? []) as { id_marca: string; nombre: string }[]).map((m) => [m.id_marca, m.nombre])
  );
  const rubros = new Map(
    ((subcatsRes.data ?? []) as { id_subcategoria: string; nombre: string }[]).map((s) => [
      s.id_subcategoria,
      s.nombre,
    ])
  );

  // De cada producto, en qué objetivos está. Se manda armado para que la
  // pantalla pueda decir "esta creatina también está en Rendimiento" sin
  // tener que recorrer la relación entera en cada tecla.
  const objetivosDe = new Map<string, string[]>();
  for (const r of (relRes.data ?? []) as { id_producto: string; id_objetivo: string }[]) {
    const lista = objetivosDe.get(r.id_producto);
    if (lista) lista.push(r.id_objetivo);
    else objetivosDe.set(r.id_producto, [r.id_objetivo]);
  }

  const productos: ProductoParaObjetivo[] = (
    (productosRes.data ?? []) as {
      id_producto: string;
      nombre: string;
      id_marca: string;
      id_subcategoria: string | null;
      imagen: string | null;
    }[]
  )
    .map((p) => ({
      idProducto: p.id_producto,
      nombre: p.nombre,
      marca: marcas.get(p.id_marca) ?? null,
      rubro: p.id_subcategoria ? rubros.get(p.id_subcategoria) ?? null : null,
      imagen: p.imagen,
      objetivos: objetivosDe.get(p.id_producto) ?? [],
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return (
    <ObjetivosApp objetivos={(objetivosRes.data ?? []) as Objetivo[]} productos={productos} />
  );
}
