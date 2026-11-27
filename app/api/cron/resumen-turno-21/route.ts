// Respaldo del resumen del turno tarde (con el total del día) por mail al dueño:
// 22:30 de Argentina (01:30 UTC, ver vercel.json). Desde el 27/11 sale al cerrar
// la caja (cerrarTurno); este solo manda si ese día nadie la cerró. Va en
// una ruta aparte de la del mediodía porque en el plan gratis de Vercel cada
// proceso automático corre una sola vez por día.
import { rutaResumenDeTurno } from "@/lib/resumenTurno";

export const maxDuration = 60;

export const GET = rutaResumenDeTurno("tarde");
