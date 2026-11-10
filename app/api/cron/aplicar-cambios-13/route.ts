// Lo mismo que /api/cron/aplicar-cambios, a las 13:05 de Argentina (16:05 UTC):
// el final del turno mañana. Va en una ruta aparte porque en el plan gratis de
// Vercel cada proceso automático corre una sola vez por día (ver vercel.json).
export { GET } from "../aplicar-cambios/route";
