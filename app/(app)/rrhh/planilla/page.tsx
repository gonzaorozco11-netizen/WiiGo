import { redirect } from "next/navigation";
import type { ParamsRrhh } from "../pantalla";

// "Planilla" ahora se llama Asistencia. Los links viejos siguen funcionando
// y conservan el mes.
export default async function PlanillaPage({ searchParams }: { searchParams: ParamsRrhh }) {
  const { mes } = await searchParams;
  redirect(typeof mes === "string" ? `/rrhh/asistencia?mes=${encodeURIComponent(mes)}` : "/rrhh/asistencia");
}
