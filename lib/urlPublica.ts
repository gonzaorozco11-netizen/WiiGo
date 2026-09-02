// El dominio con el que se arman los links que van a manos del cliente
// (hoy, el QR del comprobante).
//
// Por qué no alcanza con el origin del request: cada deploy de Vercel tiene
// además de tu dominio una URL propia (wiigo-a1b2c3-….vercel.app) que está
// protegida con login de Vercel. Si el totem o el POS quedan abiertos en una
// de esas — o si Vercel resuelve el request por ahí — el QR sale apuntando a
// una página que le pide al cliente iniciar sesión en Vercel. Pasó, y desde
// el celular del cliente no hay forma de arreglarlo.
//
// Orden de preferencia:
//   1. APP_URL, si la configurás a mano en Vercel. Manda siempre.
//   2. VERCEL_PROJECT_PRODUCTION_URL, que Vercel define sola y siempre apunta
//      al dominio de producción (tu dominio propio si lo tenés). No hay que
//      configurar nada.
//   3. El origin del request, como último recurso (desarrollo local).
export function baseUrlPublica(origenDelRequest = ""): string {
  const manual = process.env.APP_URL?.trim();
  if (manual) return manual.replace(/\/+$/, "");

  const produccion = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (produccion) return `https://${produccion.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  return origenDelRequest.replace(/\/+$/, "");
}
