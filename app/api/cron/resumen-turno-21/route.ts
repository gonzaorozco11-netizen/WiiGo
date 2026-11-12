// El resumen de ventas del turno tarde, con el total del día, por mail al
// dueño. Pedido para las 21:15 de Argentina (00:15 UTC, ver vercel.json; en
// el plan gratis corre en algún momento de esa hora). Va en
// una ruta aparte de la del mediodía porque en el plan gratis de Vercel cada
// proceso automático corre una sola vez por día.
import { rutaResumenDeTurno } from "@/lib/resumenTurno";

export const maxDuration = 60;

export const GET = rutaResumenDeTurno("tarde");
