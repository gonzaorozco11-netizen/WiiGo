import PantallaRrhh, { type ParamsRrhh } from "../pantalla";

export const dynamic = "force-dynamic";

export default function SueldosPage({ searchParams }: { searchParams: ParamsRrhh }) {
  return <PantallaRrhh vista="SUELDOS" searchParams={searchParams} />;
}
