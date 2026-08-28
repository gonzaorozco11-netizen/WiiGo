import { getSupabaseServerClient, type Local, type Marca } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { listarCategorias, listarSubcategorias } from "@/app/(app)/gastos/actions";
import { listarCategoriasCargoMarca, listarSubcategoriasCargoMarca, listarCategoriasIngreso, listarSubcategoriasIngreso } from "@/app/(app)/gastos-ingresos/actions";
import GastosIngresosApp from "@/components/GastosIngresosApp";

export const dynamic = "force-dynamic";

export default async function GastosIngresosPage() {
  const sesionPantallas = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesionPantallas, "gastos-ingresos")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const [localesRes, marcasRes, categoriasGasto, subcategoriasGasto, categoriasCargo, subcategoriasCargo, categoriasIngreso, subcategoriasIngreso, configRes, sesionPermisos] =
    await Promise.all([
      supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
      supabase.from("marcas").select("*").eq("tipo_comercializacion", "CONSIGNACION").order("nombre", { ascending: true }),
      listarCategorias(),
      listarSubcategorias(),
      listarCategoriasCargoMarca(),
      listarSubcategoriasCargoMarca(),
      listarCategoriasIngreso(),
      listarSubcategoriasIngreso(),
      supabase.from("configuracion").select("valor").eq("parametro", "GASTOS_TOPE_SIN_AUTORIZACION").maybeSingle(),
      obtenerSesionConPermisos(),
    ]);

  return (
    <GastosIngresosApp
      locales={(localesRes.data ?? []) as Local[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      categoriasGasto={categoriasGasto}
      subcategoriasGasto={subcategoriasGasto}
      categoriasCargo={categoriasCargo}
      subcategoriasCargo={subcategoriasCargo}
      categoriasIngreso={categoriasIngreso}
      subcategoriasIngreso={subcategoriasIngreso}
      topeAutorizacion={Number(configRes.data?.valor ?? 10000)}
      puedeAutorizarSinLimite={tienePermiso(sesionPermisos, PERMISOS.AUTORIZAR_GASTOS_SIN_LIMITE)}
    />
  );
}
