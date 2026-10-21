import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { listarHorarios } from "@/app/(app)/organizacion/actions";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import RrhhApp, { type VistaRrhh } from "@/components/RrhhApp";

export type ParamsRrhh = Promise<Record<string, string | string[] | undefined>>;

// Los datos que necesitan las cuatro pantallas de RR.HH.
//
// Se cargan igual para todas a propósito: son tres consultas chicas sobre
// tablas de pocas filas, y tener una carga distinta por pantalla serían
// cuatro lugares donde equivocarse para ahorrar milisegundos.
//
// ?mes=AAAA-MM y ?tab= vienen de la dirección: así un link desde otra
// pantalla abre el mismo mes y la solapa justa.
export default async function PantallaRrhh({ vista, searchParams }: { vista: VistaRrhh; searchParams?: ParamsRrhh }) {
  const params = (await searchParams) ?? {};
  const mes = typeof params.mes === "string" ? params.mes : undefined;
  const tab = typeof params.tab === "string" ? params.tab : undefined;
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const [{ data: usuarios }, horarios, { data: personas }] = await Promise.all([
    supabase
      .from("usuarios")
      .select("id_usuario, nombre, sueldo_base")
      .eq("estado", "ACTIVO")
      .order("nombre", { ascending: true }),
    listarHorarios(),
    supabase
      .from("personas")
      .select("id_persona, nombre, apellido")
      .eq("estado", "ACTIVO")
      .order("nombre", { ascending: true }),
  ]);

  return (
    <RrhhApp
      vista={vista}
      usuarios={usuarios ?? []}
      horariosIniciales={horarios}
      personas={personas ?? []}
      mesInicial={mes}
      subInicial={tab}
    />
  );
}
