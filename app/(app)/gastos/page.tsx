import { getSupabaseServerClient, type Local } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { listarCategorias, listarSubcategorias } from "@/app/(app)/gastos/actions";
import GastosApp from "@/components/GastosApp";

export const dynamic = "force-dynamic";

export default async function GastosPage() {
  const sesionPantallas = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesionPantallas, "gastos")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const [localesRes, usuariosRes, turnosAbiertosRes, categorias, subcategorias, configRes, sesion, ivaRes] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase
      .from("usuarios")
      .select("id_usuario, nombre, sueldo_base")
      .eq("estado", "ACTIVO")
      .order("nombre", { ascending: true }),
    supabase.from("turnos").select("id_turno, id_local").eq("estado", "ABIERTO"),
    listarCategorias(),
    listarSubcategorias(),
    supabase.from("configuracion").select("valor").eq("parametro", "GASTOS_TOPE_SIN_AUTORIZACION").maybeSingle(),
    obtenerSesionConPermisos(),
    supabase.from("configuracion").select("valor").eq("parametro", "IVA_GENERAL_PORCENTAJE").maybeSingle(),
  ]);

  return (
    <GastosApp
      locales={(localesRes.data ?? []) as Local[]}
      usuarios={usuariosRes.data ?? []}
      turnosAbiertos={turnosAbiertosRes.data ?? []}
      categoriasIniciales={categorias}
      subcategoriasIniciales={subcategorias}
      puedeVerCajaAdmin={tienePermiso(sesion, PERMISOS.VER_CAJA_ADMIN)}
      puedeGestionarNomina={tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)}
      puedeAutorizarSinLimite={tienePermiso(sesion, PERMISOS.AUTORIZAR_GASTOS_SIN_LIMITE)}
      topeAutorizacion={Number(configRes.data?.valor ?? 10000)}
      ivaGeneralPorcentaje={Number(ivaRes.data?.valor ?? 21)}
    />
  );
}
