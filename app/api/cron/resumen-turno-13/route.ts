// El resumen de ventas del turno mañana por mail al dueño. Pedido para las
// 13:15 de Argentina (16:15 UTC, ver vercel.json); en el plan gratis Vercel
// lo corre en algún momento de esa hora. Lo que entre después lo cubre el de
// la noche (ver RESUMEN_TURNO_HASTA en lib/resumenTurno.ts).
import { rutaResumenDeTurno } from "@/lib/resumenTurno";

export const maxDuration = 60;

export const GET = rutaResumenDeTurno("manana");
