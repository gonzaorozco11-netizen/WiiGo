// Armado del ticket que imprime el totem de autopedido.
//
// Cómo llega a la impresora: la impresora (Icod ET80) va conectada por USB
// adentro del totem, y una página web no puede hablarle directamente. El
// puente es **RawBT**, una app instalada en el totem que recibe los bytes
// por una URL con esquema `rawbt:` y se los pasa a la impresora. Por eso acá
// se generan bytes ESC/POS crudos y no HTML.
//
// IMPORTANTE — esto NO es una factura. Mientras no esté la integración con
// ARCA, el ticket lleva la leyenda "documento no válido como factura". Es un
// comprobante interno de control. Cuando se conecte ARCA hay que agregar
// CAE, vencimiento del CAE, tipo y número de comprobante, y el QR oficial.

// 80 mm a 203 dpi = 576 puntos = 48 caracteres en fuente A.
// (Si la impresora resultara ser de 58 mm, esto pasa a 32.)
export const ANCHO_TICKET = 48;

export type LineaTicket = {
  nombre: string;
  variante: string | null;
  cantidad: number;
  precioUnitario: number;
  importe: number;
};

export type DatosTicket = {
  numeroPedido: string;
  local: string;
  medioPago: string;
  fecha: Date;
  lineas: LineaTicket[];
  subtotal: number;
  descuentos: { concepto: string; monto: number }[];
  total: number;
};

const EMISOR = {
  razonSocial: "NUOVO IMPERO S.A.S.",
  nombreFantasia: "WiiGo - Estaciones de Bienestar",
  domicilio: "Aristides 256 - Ciudad",
  cuit: "30-71865412-9",
  condicionIva: "IVA Responsable Inscripto",
};

function centrar(texto: string) {
  const t = texto.slice(0, ANCHO_TICKET);
  const espacios = Math.max(0, Math.floor((ANCHO_TICKET - t.length) / 2));
  return " ".repeat(espacios) + t;
}

// Una etiqueta a la izquierda y un importe pegado a la derecha.
function fila(izquierda: string, derecha: string) {
  const der = derecha.slice(0, ANCHO_TICKET);
  const espacioIzq = ANCHO_TICKET - der.length - 1;
  let izq = izquierda;
  if (izq.length > espacioIzq) izq = izq.slice(0, espacioIzq);
  return izq + " ".repeat(ANCHO_TICKET - izq.length - der.length) + der;
}

function separador() {
  return "-".repeat(ANCHO_TICKET);
}

function monto(valor: number) {
  return "$" + valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function fechaHora(fecha: Date) {
  return fecha.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// El texto del ticket, en líneas. Se separa del armado de bytes para poder
// mostrarlo en pantalla (vista previa) sin depender de la impresora.
export function construirTextoTicket(d: DatosTicket): string[] {
  const lineas: string[] = [];

  lineas.push(centrar(EMISOR.razonSocial));
  lineas.push(centrar(EMISOR.nombreFantasia));
  lineas.push(centrar(EMISOR.domicilio));
  lineas.push(centrar("CUIT " + EMISOR.cuit));
  lineas.push(centrar(EMISOR.condicionIva));
  lineas.push("");
  lineas.push(separador());
  lineas.push(centrar("DOCUMENTO NO VALIDO COMO FACTURA"));
  lineas.push(centrar("Comprobante interno de control"));
  lineas.push(separador());
  lineas.push("");

  lineas.push(fila("Pedido:", d.numeroPedido));
  lineas.push(fila("Fecha:", fechaHora(d.fecha)));
  lineas.push(fila("Local:", d.local));
  lineas.push(fila("Pago:", d.medioPago));
  lineas.push(separador());

  for (const l of d.lineas) {
    // Nombre completo en su propia línea: los nombres de producto no entran
    // en una fila junto al importe sin quedar cortados.
    lineas.push(l.nombre.slice(0, ANCHO_TICKET));
    if (l.variante) lineas.push("  " + l.variante.slice(0, ANCHO_TICKET - 2));
    lineas.push(fila(`  ${l.cantidad} x ${monto(l.precioUnitario)}`, monto(l.importe)));
  }

  lineas.push(separador());
  if (d.descuentos.length > 0) {
    lineas.push(fila("Subtotal", monto(d.subtotal)));
    for (const desc of d.descuentos) {
      lineas.push(fila(desc.concepto, "-" + monto(desc.monto)));
    }
  }

  lineas.push(fila("TOTAL", monto(d.total)));
  lineas.push(separador());
  lineas.push("");
  lineas.push(centrar("Mostrale este ticket al personal"));
  lineas.push(centrar("para controlar antes de salir."));
  lineas.push("");
  lineas.push(centrar("Gracias por tu compra!"));

  return lineas;
}

// ===================== ESC/POS =====================
// Comandos mínimos, los que soporta cualquier impresora térmica.
const ESC = 0x1b;
const GS = 0x1d;

function bytesDeTexto(texto: string) {
  // La impresora se configura en codepage WPC1252 (ver INIT). En ese rango
  // los acentos del español coinciden con su code point Unicode, así que
  // alcanza con tomar el código de cada carácter. Lo que no entra se
  // reemplaza por "?" en vez de imprimir basura.
  const salida: number[] = [];
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0) ?? 63;
    salida.push(codigo < 256 ? codigo : 63);
  }
  return salida;
}

export function construirTicketEscPos(d: DatosTicket): Uint8Array {
  const bytes: number[] = [];

  bytes.push(ESC, 0x40); // inicializar
  bytes.push(ESC, 0x74, 16); // codepage WPC1252 (acentos del español)

  for (const linea of construirTextoTicket(d)) {
    bytes.push(...bytesDeTexto(linea), 0x0a);
  }

  // El total va en doble alto y ancho: es lo que el cliente y el personal
  // miran de un vistazo en el control de salida.
  bytes.push(ESC, 0x61, 1); // centrado
  bytes.push(GS, 0x21, 0x11); // doble alto y ancho
  bytes.push(...bytesDeTexto("TOTAL " + monto(d.total)), 0x0a);
  bytes.push(GS, 0x21, 0x00); // tamaño normal
  bytes.push(ESC, 0x61, 0); // vuelve a la izquierda

  bytes.push(...bytesDeTexto(separador()), 0x0a);
  bytes.push(ESC, 0x61, 1);
  bytes.push(...bytesDeTexto("Mostrale este ticket al personal"), 0x0a);
  bytes.push(...bytesDeTexto("para controlar antes de salir."), 0x0a);
  bytes.push(0x0a);
  bytes.push(...bytesDeTexto("Gracias por tu compra!"), 0x0a);
  bytes.push(ESC, 0x61, 0);

  bytes.push(0x0a, 0x0a, 0x0a, 0x0a); // avance para poder cortar
  bytes.push(GS, 0x56, 0x00); // corte

  return new Uint8Array(bytes);
}

// RawBT recibe los bytes en base64 dentro de una URL con esquema `rawbt:`.
export function urlImpresionRawBt(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return "rawbt:base64," + btoa(binario);
}

// Fully Kiosk (el navegador del totem) bloquea las URLs con esquema propio
// como `rawbt:` — probado: en Chrome del mismo totem imprime, en Fully no.
// Pero Fully expone una interfaz propia, `window.fully`, con la que la página
// sí puede pedirle que abra otra app. Requiere activar en Fully:
//   Settings → Advanced Web Settings → Enable JavaScript Interface (PLUS)
//
// Si esa interfaz no está (Chrome, una compu, o el interruptor apagado), se
// cae al método normal: navegar a la URL. Eso no cambia de página — Android
// intercepta el esquema, se lo entrega a RawBT y la pantalla queda igual.
// Ojo: NO sirve mandarlo desde un iframe oculto, Android ignora los esquemas
// propios que vienen de marcos internos (ya se probó).
type FullyKiosk = { startIntent?: (url: string) => void };

// Qué ofrece el navegador donde está corriendo la pantalla. Se usa desde el
// panel de diagnóstico (?diagnostico=1) para no tener que adivinar por qué
// una impresora no responde: dice si la interfaz de Fully está disponible y
// qué funciones expone.
export function diagnosticoImpresion() {
  const fully = (window as unknown as { fully?: Record<string, unknown> }).fully;
  const funciones: string[] = [];
  if (fully) {
    for (const clave in fully) {
      if (typeof fully[clave] === "function") funciones.push(clave);
    }
  }
  return {
    hayInterfazFully: !!fully,
    tieneStartIntent: !!fully && typeof fully.startIntent === "function",
    funcionesFully: funciones.sort(),
    userAgent: navigator.userAgent,
  };
}

// `lineas` es el ticket como texto (construirTextoTicket) y `bytes` el mismo
// ticket en ESC/POS. Se usa uno u otro según el navegador:
//
//   - En el totem (Fully Kiosk) el único camino que llega a RawBT es
//     fully.startIntent con "rawbt:" + el TEXTO escapado. Probado: la
//     versión con ESC/POS en base64 no llega, porque el base64 lleva "+",
//     "/" y "=" que rompen la dirección.
//   - En cualquier otro navegador (Chrome del totem, un celu, una compu)
//     funciona navegar a la URL con el ESC/POS, que sale mejor formateado.
//
// Para que RawBT imprima sin preguntar a qué impresora, hay que tildar en
// RawBT → Ajustes → Para "Compartir" y "Enviar":
// "Comience a imprimir automáticamente en la impresora predeterminada".
export function enviarAImpresora(bytes: Uint8Array, lineas: string[]) {
  const fully = (window as unknown as { fully?: FullyKiosk }).fully;
  if (fully && typeof fully.startIntent === "function") {
    try {
      fully.startIntent("rawbt:" + encodeURIComponent(lineas.join("\n")));
      return;
    } catch {
      // Si falla, se intenta igual por el camino de abajo.
    }
  }

  try {
    window.location.href = urlImpresionRawBt(bytes);
  } catch {
    // Sin impresora disponible — la venta ya está cerrada igual.
  }
}
