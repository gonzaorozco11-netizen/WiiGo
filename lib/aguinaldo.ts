import { fechaHoraArgentina } from "@/lib/horarios";

// Vive acá y no en rrhh/actions.ts porque ese archivo es "use server" y
// desde ahí solo se pueden exportar funciones asíncronas. Esta la necesitan
// las dos partes: el servidor para validar y la pantalla para deshabilitar
// el botón.

// El aguinaldo recién se puede cerrar cuando llegó el mes en que se paga:
// junio para el 1er semestre, diciembre para el 2do (Art. 122 LCT). Antes de
// eso el semestre no terminó y cerrarlo sería pagar días no trabajados.
export function puedeCerrarseAguinaldo(semestre: string) {
  const [anioStr, nro] = semestre.split("-");
  const anio = Number(anioStr);
  const mesDePago = nro === "1" ? 6 : 12;
  const { fecha } = fechaHoraArgentina();
  const [anioHoy, mesHoy] = fecha.split("-").map(Number);
  if (anioHoy > anio) return true;
  if (anioHoy < anio) return false;
  return mesHoy >= mesDePago;
}

export function etiquetaSemestre(semestre: string) {
  const [anio, nro] = semestre.split("-");
  return nro === "1" ? `1er semestre ${anio} (enero a junio)` : `2do semestre ${anio} (julio a diciembre)`;
}

export function semestreActual() {
  const { fecha } = fechaHoraArgentina();
  const [anio, mes] = fecha.split("-").map(Number);
  return `${anio}-${mes <= 6 ? 1 : 2}`;
}
