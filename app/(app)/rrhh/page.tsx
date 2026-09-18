import { redirect } from "next/navigation";

// RR.HH. se partió en tres pantallas (Personal, Planilla y Sueldos) y en el
// menú ya no hay una entrada suelta a /rrhh. Esto queda para que los links
// viejos y los favoritos de Gonzalo sigan funcionando: caen en Sueldos, que
// es lo que antes se abría primero.
//
// Cuando exista el Dashboard de RR.HH. va a vivir acá y este redirect se va.
export default function RrhhPage() {
  redirect("/rrhh/sueldos");
}
