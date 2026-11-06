// Opiniones que escribe el propio paciente (sql/profesionales-opiniones-pacientes.sql).
//
// La profesional toca "Pedirle su opinión" al lado de un paciente: se arma un
// link personal (/opinion/<token>) que ella le manda por su WhatsApp. El
// paciente confirma los últimos 3 números de su DNI, escribe y da su permiso.
// La opinión queda PENDIENTE hasta que Gonzalo la aprueba; la profesional la
// ve desde que llega, con su estado (Gonzalo, 2026-11-06).

export const DIAS_LINK_OPINION = 30;
export const INTENTOS_DNI = 5;
export const LARGO_OPINION = { minimo: 15, maximo: 280 } as const;

export type EstadoOpinion = "PENDIENTE" | "APROBADA" | "DESCARTADA";
export type ComoAparece = "NOMBRE" | "INICIALES" | "ANONIMO";

/** "Lucía Pérez" → "Lucía P." · iniciales → "L. P." · anónimo → null. */
export function nombreParaMostrar(nombre: string | null, apellido: string | null, como: ComoAparece): string | null {
  const n = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  const a = (apellido ?? "").trim();
  if (como === "ANONIMO" || !n) return null;
  if (como === "INICIALES") return [n, a].filter(Boolean).map((x) => `${x.charAt(0).toUpperCase()}.`).join(" ");
  return a ? `${n} ${a.charAt(0).toUpperCase()}.` : n;
}

export function mensajePedidoOpinion(nombrePaciente: string, nombreProfesional: string, link: string) {
  const pila = nombrePaciente.trim().split(/\s+/)[0] || "";
  return (
    `¡Hola${pila ? ` ${pila}` : ""}! Gracias por venir a la consulta 🙂\n\n` +
    `Si te gustó, ¿me dejás tu opinión? Sale en la pantalla de WiiGo para que otros me conozcan. Es un minuto:\n\n` +
    `${link}\n\n¡Gracias! ${nombreProfesional}`
  );
}
