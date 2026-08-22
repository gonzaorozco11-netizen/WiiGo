import { getSupabaseServerClient, type Usuario, type Rol } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import ConfiguracionApp from "@/components/ConfiguracionApp";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.EDITAR_CONFIGURACION)) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-1">No tenés permiso para ver esta pantalla</p>
        <p className="text-sm text-neutral-500">Editar la Configuración es solo para admin o quien tenga ese permiso.</p>
      </div>
    );
  }

  const esAdmin = sesion?.rol === "admin";
  const supabase = getSupabaseServerClient();

  // La gestión de usuarios vive acá adentro como pestaña, pero sigue siendo
  // estrictamente admin-only — no es delegable como el resto de esta pantalla.
  const usuariosRes = esAdmin
    ? await supabase
        .from("usuarios")
        .select("id_usuario, nombre, email, rol, estado, fecha_alta, permisos, id_rol")
        .order("nombre", { ascending: true })
    : null;
  const rolesRes = esAdmin
    ? await supabase.from("roles").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true })
    : null;

  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [
      "PUNTOS_ACTIVO",
      "PUNTOS_CADA_MONTO",
      "PUNTOS_OTORGADOS",
      "PUNTOS_TOPE_CANJE_PORCENTAJE",
      "IMP_CREDITOS_PORCENTAJE",
      "SIRCREB_PORCENTAJE",
      "IMP_DEBITOS_PORCENTAJE",
      "IVA_GENERAL_PORCENTAJE",
      "IIBB_PORCENTAJE",
      "MARGEN_MINIMO_PORCENTAJE",
      "MP_COMISION_DINERO_CUENTA",
      "MP_COMISION_DEBITO",
      "MP_COMISION_CUOTAS_SIN_INTERES",
      "MP_COMISION_PREPAGA",
      "MP_COMISION_CREDITO",
      "GASTOS_TOPE_SIN_AUTORIZACION",
    ]);

  const valores = new Map((data ?? []).map((c) => [c.parametro, c.valor]));

  return (
    <ConfiguracionApp
      puntosActivo={valores.get("PUNTOS_ACTIVO") === "true"}
      puntosCadaMonto={Number(valores.get("PUNTOS_CADA_MONTO") ?? 1000)}
      puntosOtorgados={Number(valores.get("PUNTOS_OTORGADOS") ?? 10)}
      puntosTopeCanjePorcentaje={Number(valores.get("PUNTOS_TOPE_CANJE_PORCENTAJE") ?? 0)}
      impCreditosPorcentaje={Number(valores.get("IMP_CREDITOS_PORCENTAJE") ?? 0.6)}
      sircrebPorcentaje={Number(valores.get("SIRCREB_PORCENTAJE") ?? 5)}
      impDebitosPorcentaje={Number(valores.get("IMP_DEBITOS_PORCENTAJE") ?? 0.6)}
      ivaGeneralPorcentaje={Number(valores.get("IVA_GENERAL_PORCENTAJE") ?? 21)}
      iibbPorcentaje={Number(valores.get("IIBB_PORCENTAJE") ?? 0)}
      margenMinimoPorcentaje={Number(valores.get("MARGEN_MINIMO_PORCENTAJE") ?? 15)}
      mpComisionDineroCuenta={Number(valores.get("MP_COMISION_DINERO_CUENTA") ?? 0.8)}
      mpComisionDebito={Number(valores.get("MP_COMISION_DEBITO") ?? 1.39)}
      mpComisionCuotasSinInteres={Number(valores.get("MP_COMISION_CUOTAS_SIN_INTERES") ?? 1.38)}
      mpComisionPrepaga={Number(valores.get("MP_COMISION_PREPAGA") ?? 3.85)}
      mpComisionCredito={Number(valores.get("MP_COMISION_CREDITO") ?? 6.15)}
      gastosTopeSinAutorizacion={Number(valores.get("GASTOS_TOPE_SIN_AUTORIZACION") ?? 10000)}
      esAdmin={esAdmin}
      usuarios={(usuariosRes?.data ?? []) as Omit<Usuario, "password_hash">[]}
      roles={(rolesRes?.data ?? []) as Rol[]}
    />
  );
}
