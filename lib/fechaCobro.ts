// Cuándo le entra la plata de una venta a WiiGo (Gonzalo, 19/11: «que se le
// liquide lo que ya tengo»). Las liquidaciones de las marcas y de Alifrut son
// por mes y solo con lo que ya entró; lo que está en camino pasa al mes que sigue.
//
// Puro (sin base de datos): la fecha real de Mercado Pago la busca quien llama
// (lib/cobroDeVentas.ts) y viene en `liberacionMp`.
//
// Las reglas:
//   - Efectivo: el día de la venta.
//   - QR / transferencia de Mercado Pago: la fecha REAL en que Mercado Pago la
//     liberó (reporte de liberaciones, Cobros digitales). Hasta que aparece en el
//     reporte, se calcula: dinero en cuenta y transferencia en el día, débito a
//     los 2 días (lo que se ve en los reportes de noviembre).
//   - Nave (posnet y tarjeta de la tienda online), tabla «otros plazos» que mandó
//     Gonzalo el 19/11: débito 1 día hábil; crédito 8 días hábiles en 1 pago (el
//     sistema todavía no sabe las cuotas: 8 es el más largo, nunca se liquida antes
//     de tiempo). Cuando el posnet esté conectado, la fecha real de Nave.

export type DatoCobro = "REAL" | "CALCULADO" | "ESPERANDO";
export type Cobro = { /** AAAA-MM-DD en Argentina; null = no se sabe todavía. */ fecha: string | null; dato: DatoCobro };

// Feriados nacionales que no se mueven (+ carnaval y Viernes Santo). Los
// trasladables cambian por decreto cada año y no están: el cálculo puede quedar
// un día corto alrededor de esas fechas (por eso dice «calculado»).
const FERIADOS = new Set([
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-03-24", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-25",
  "2026-06-20", "2026-07-09", "2026-12-08", "2026-12-25",
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-24", "2027-03-26", "2027-04-02", "2027-05-01", "2027-05-25",
  "2027-06-20", "2027-07-09", "2027-12-08", "2027-12-25",
]);

/** La fecha en Argentina (AAAA-MM-DD) de un momento guardado en la base. */
export function diaArgentina(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function masDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function esHabil(dia: string): boolean {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return semana !== 0 && semana !== 6 && !FERIADOS.has(dia);
}

/** `n` días hábiles después de `dia` (sin contar el día de la venta). */
export function sumarDiasHabiles(dia: string, n: number): string {
  let d = dia;
  let faltan = n;
  while (faltan > 0) {
    d = masDias(d, 1);
    if (esHabil(d)) faltan--;
  }
  return d;
}

export function fechaDeCobro(v: {
  /** ventas.fecha */
  fecha: string;
  /** ventas.medio_pago: EFECTIVO | MERCADO_PAGO | POSNET */
  medio: string | null;
  /** pagos.forma_pago_cliente */
  forma: string | null;
  /** Cuándo la liberó Mercado Pago (cobros_digitales.fecha), si ya está en un reporte. */
  liberacionMp?: string | null;
}): Cobro {
  const dia = diaArgentina(v.fecha);
  if (!v.medio || v.medio === "EFECTIVO") return { fecha: dia, dato: "REAL" };

  if (v.medio === "MERCADO_PAGO") {
    if (v.liberacionMp) return { fecha: diaArgentina(v.liberacionMp), dato: "REAL" };
    // La cajera ya vio la plata en la cuenta antes de cobrar.
    if (v.forma === "TRANSFERENCIA") return { fecha: dia, dato: "REAL" };
    if (v.forma === "DINERO_CUENTA") return { fecha: dia, dato: "CALCULADO" };
    if (v.forma === "DEBITO" || v.forma === "PREPAGA") return { fecha: masDias(dia, 2), dato: "CALCULADO" };
    // Crédito o sin dato: se espera el reporte (el crédito está apagado en el QR).
    return { fecha: null, dato: "ESPERANDO" };
  }

  if (v.medio === "POSNET") {
    if (v.forma === "POSNET_DEBITO") return { fecha: sumarDiasHabiles(dia, 1), dato: "CALCULADO" };
    return { fecha: sumarDiasHabiles(dia, 8), dato: "CALCULADO" };
  }

  return { fecha: dia, dato: "CALCULADO" };
}

/** ¿Ya entró la plata al día del corte (AAAA-MM-DD)? */
export function cobradaAl(c: Cobro, corte: string): boolean {
  return c.fecha != null && c.fecha <= corte;
}
