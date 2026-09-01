// Datos fiscales de la empresa que emite los comprobantes.
//
// Están acá y en un solo lugar a propósito: antes estaban duplicados en el
// ticket y en la página del comprobante, y se publicó un CUIT equivocado sin
// que nadie lo notara. Todo lo que muestre datos del emisor tiene que
// importarlos de acá.
//
// Fuente: constancia de ARCA "Modificación de Punto de Venta / Emisión"
// del 01/09/2026.
export const EMISOR = {
  razonSocial: "NUOVO IMPERO S.A.S.",
  nombreFantasia: "WiiGo — Estaciones de Bienestar",
  cuit: "30-71851497-1",
  condicionIva: "IVA Responsable Inscripto",
  ingresosBrutos: "00000974719",
  inicioActividades: "09/2026",

  // El domicilio fiscal de la sociedad no es el del local: la sociedad está
  // en Dr. Minoprio 1561 y el punto de venta 00003 está en Arístides 256.
  // En el comprobante se muestra el del local (es donde compró el cliente),
  // pero para ARCA el que identifica al contribuyente es el fiscal.
  domicilioFiscal: "Dr. Minoprio 1561 — Mendoza (CP 5500)",
  domicilioComercial: "Arístides Villanueva 256 — Mendoza (CP 5500)",

  // Punto de venta habilitado como "RECE para aplicativo y web services".
  // Es el único tipo que sirve para facturar desde el sistema; los de
  // "Comprobantes en línea" no.
  puntoVenta: 3,
} as const;
