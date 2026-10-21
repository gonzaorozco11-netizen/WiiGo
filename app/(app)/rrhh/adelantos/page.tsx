import { redirect } from "next/navigation";

// Los adelantos ahora viven dentro de Sueldos, porque se descuentan ahí.
export default function AdelantosPage() {
  redirect("/rrhh/sueldos?tab=adelantos");
}
