import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import CombosAdmin from "@/components/CombosAdmin";
import { listarCombos } from "@/lib/combosGestion";

export const dynamic = "force-dynamic";

// Combos (Gonzalo, 16/11): todos los combos de las marcas, para cambiar precio,
// pausar, borrar, cambiar la foto o armar uno nuevo, sin SQL. Lo que piden las
// marcas desde su portal llega a Aprobaciones.
export default async function CombosPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "combos")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const [combos, { data: marcas }, { data: productos }, { error: sinTabla }] = await Promise.all([
    listarCombos(supabase),
    supabase.from("marcas").select("id_marca, nombre").eq("estado", "ACTIVA").order("nombre"),
    supabase.from("productos").select("id_producto, id_marca, nombre, precio_venta, precio_efectivo").eq("estado", "ACTIVO").gt("precio_venta", 0).order("nombre").range(0, 4999),
    supabase.from("combos").select("id_combo", { head: true, count: "exact" }),
  ]);

  return (
    <CombosAdmin
      faltaSql={Boolean(sinTabla)}
      combos={combos}
      marcas={(marcas ?? []).map((m) => ({ idMarca: m.id_marca as string, nombre: m.nombre as string }))}
      productos={(productos ?? []).map((p) => ({
        idProducto: p.id_producto as string,
        idMarca: p.id_marca as string,
        nombre: p.nombre as string,
        precio: Number(p.precio_venta) || 0,
        precioEfectivo: Number(p.precio_efectivo) || Number(p.precio_venta) || 0,
      }))}
    />
  );
}
