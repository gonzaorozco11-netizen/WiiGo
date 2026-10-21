import PantallaRrhh, { type ParamsRrhh } from "../pantalla";

export const dynamic = "force-dynamic";

export default function AsistenciaPage({ searchParams }: { searchParams: ParamsRrhh }) {
  return <PantallaRrhh vista="ASISTENCIA" searchParams={searchParams} />;
}
