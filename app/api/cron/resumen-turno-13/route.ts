// Respaldo del resumen del turno mañana por mail al dueño (14:30 de Argentina,
// 17:30 UTC, ver vercel.json). Desde el 27/11 el resumen sale al cerrar la caja
// (cerrarTurno); este solo manda si ese día nadie la cerró. Lo que entre después
// lo cubre el de la noche (ver RESUMEN_TURNO_HASTA en lib/resumenTurno.ts).
import { rutaResumenDeTurno } from "@/lib/resumenTurno";

export const maxDuration = 60;

export const GET = rutaResumenDeTurno("manana");
