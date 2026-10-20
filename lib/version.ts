// Qué versión del sistema está publicada. La usa el totem para darse cuenta
// solo de que hubo un deploy nuevo y recargarse cuando nadie lo está usando
// (ver app/api/version/route.ts y SelfCheckoutApp).
//
// Vercel define estas variables en cada deploy, también mientras la página
// está corriendo. Si no hay ninguna (en la compu, con `npm run dev`) sale
// "local", y el totem nunca se recarga por esto: falla para el lado seguro.
export function versionActual(): string {
  return process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "local";
}
