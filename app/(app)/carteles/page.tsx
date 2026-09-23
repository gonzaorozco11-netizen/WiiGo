import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { ambosPrecios } from "@/lib/precios";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import CartelesApp, { type ItemCartel } from "@/components/CartelesApp";

export const dynamic = "force-dynamic";

export default async function CartelesPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "carteles")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const [productosRes, marcasRes, tareasRes] = await Promise.all([
    supabase
      .from("productos")
      .select("id_producto,nombre,id_marca,precio_venta,precio_efectivo,descuento_porcentaje")
      .eq("estado", "ACTIVO"),
    supabase.from("marcas").select("id_marca,nombre").eq("estado", "ACTIVA"),
    // Los carteles que quedaron con el precio viejo. La cuenta ya la lleva el
    // circuito de solicitudes de marca; acá solo se lee para poder reimprimir
    // justo esos y no toda la góndola.
    supabase
      .from("tareas_etiqueta")
      .select("id_tarea,id_producto,precio_anterior,precio_nuevo,tipo,vence_el")
      .in("estado", ["PENDIENTE", "VENCIDA"])
      .limit(500),
  ]);

  const error = productosRes.error || marcasRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los carteles</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  type FilaProducto = {
    id_producto: string;
    nombre: string;
    id_marca: string;
    precio_venta: number | null;
    precio_efectivo: number | null;
    descuento_porcentaje: number | null;
  };

  const marcas = new Map(
    ((marcasRes.data ?? []) as { id_marca: string; nombre: string }[]).map((m) => [m.id_marca, m.nombre])
  );

  // Los que cambiaron de precio y todavía tienen el cartel viejo puesto.
  const ahora = Date.now();
  const tareas = new Map<string, { idTarea: string; vencida: boolean; tipo: string }>();
  for (const t of (tareasRes.data ?? []) as {
    id_tarea: string;
    id_producto: string;
    tipo: string;
    vence_el: string;
  }[]) {
    // Si un producto tiene varias tareas abiertas alcanza con reimprimirlo una
    // vez: se queda con la más urgente.
    const vencida = new Date(t.vence_el).getTime() < ahora;
    const previa = tareas.get(t.id_producto);
    if (!previa || (vencida && !previa.vencida)) {
      tareas.set(t.id_producto, { idTarea: t.id_tarea, vencida, tipo: t.tipo });
    }
  }

  const items: ItemCartel[] = ((productosRes.data ?? []) as FilaProducto[])
    .map((p) => {
      // La cuenta de los dos precios —oferta incluida— vive en lib/precios.ts y
      // la comparten el POS, el tótem y el asesor. Un cartel que diga otra cosa
      // que la caja es peor que no tener cartel.
      const { lista, efectivo } = ambosPrecios(
        {
          precio_venta: p.precio_venta,
          precio_efectivo: p.precio_efectivo,
          descuento_porcentaje: p.descuento_porcentaje,
        },
        null
      );
      const t = tareas.get(p.id_producto);
      return {
        idProducto: p.id_producto,
        nombre: p.nombre,
        marca: marcas.get(p.id_marca) ?? null,
        lista,
        efectivo,
        // Sin precio de efectivo cargado el cartel mentiría a medias, así que
        // esos no se pueden imprimir hasta que la marca lo cargue.
        tienePrecioEfectivo: p.precio_efectivo != null,
        enOferta: (p.descuento_porcentaje ?? 0) > 0,
        descuento: p.descuento_porcentaje ?? 0,
        idTarea: t?.idTarea ?? null,
        vencida: t?.vencida ?? false,
      };
    })
    .filter((i) => i.lista > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return <CartelesApp items={items} />;
}
