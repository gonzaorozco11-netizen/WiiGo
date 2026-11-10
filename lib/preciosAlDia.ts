import { aplicarCambiosProgramados } from "@/app/(app)/aprobaciones/actions";

// Los cambios de precio aprobados entran al final de cada turno (13:00 y 21:00,
// Configuración → Aprobaciones). El proceso automático de Vercel es solo el
// respaldo: en el plan gratis puede correr en cualquier minuto de esa hora.
// Por eso, además, se ponen al día apenas alguien usa el sistema pasada la
// hora: al fichar la salida (así el que se va ve los carteles nuevos), al
// abrir Carteles y al abrir la caja.
//
// Una vez por minuto como mucho (salvo `siempre`, al fichar la salida), y si
// falla no frena la pantalla.
let ultima = 0;

export async function ponerPreciosAlDia(siempre = false): Promise<void> {
  const ahora = Date.now();
  if (!siempre && ahora - ultima < 60_000) return;
  ultima = ahora;
  try {
    await aplicarCambiosProgramados();
  } catch (e) {
    console.error("No se pudieron aplicar los cambios de precio programados:", e);
  }
}
