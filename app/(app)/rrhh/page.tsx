import PantallaRrhh from "./pantalla";

// El dashboard de RR.HH. vive en la raíz del módulo: es lo primero que se abre
// y lo que contesta las tres preguntas del día — quién está, cuánto debo y qué
// está trabado. Los links viejos a /rrhh caen acá, que es lo correcto.
export const dynamic = "force-dynamic";

export default function RrhhPage() {
  return <PantallaRrhh vista="DASHBOARD" />;
}
