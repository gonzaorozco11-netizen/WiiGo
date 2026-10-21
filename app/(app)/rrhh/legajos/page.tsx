import PantallaRrhh, { type ParamsRrhh } from "../pantalla";

export const dynamic = "force-dynamic";

export default function LegajosPage({ searchParams }: { searchParams: ParamsRrhh }) {
  return <PantallaRrhh vista="LEGAJOS" searchParams={searchParams} />;
}
