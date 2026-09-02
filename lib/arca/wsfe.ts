import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerCredencialesArca, URLS_ARCA } from "@/lib/arca/credenciales";
import { obtenerTicketAcceso } from "@/lib/arca/wsaa";
import { obtenerEmisor } from "@/lib/arca/emisor-db";

// WSFE: el servicio de ARCA que autoriza cada factura y devuelve el CAE.
//
// Qué se le manda: importes, tipo de comprobante, punto de venta, y los datos
// del receptor si los hay. Nada más. ARCA no accede a la base de datos.
//
// El CUIT que va en Auth es el de la EMPRESA que factura (NUOVO IMPERO), no
// el del titular del certificado (Gonzalo). Funciona porque la empresa lo
// autorizó como representante para este servicio en ARCA.

export const TIPO_COMPROBANTE = { FACTURA_A: 1, FACTURA_B: 6 } as const;
export const TIPO_DOC = { CUIT: 80, DNI: 96, CONSUMIDOR_FINAL: 99 } as const;

export type DatosFactura = {
  tipoComprobante: number;
  puntoVenta: number;
  tipoDoc: number;
  nroDoc: string;
  total: number;
  /** Porcentaje de IVA a aplicar (21 por defecto). */
  porcentajeIva: number;
};

export type ResultadoFactura = {
  cae: string;
  vencimientoCae: string;
  numeroComprobante: number;
  tipoComprobante: number;
  puntoVenta: number;
  neto: number;
  iva: number;
  total: number;
  fecha: string;
};

function cuitSinGuiones(cuit: string) {
  return cuit.replace(/\D/g, "");
}

function fechaArcaHoy() {
  // ARCA espera AAAAMMDD en hora argentina.
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const m = Object.fromEntries(partes.map((p) => [p.type, p.value])) as Record<string, string>;
  return `${m.year}${m.month}${m.day}`;
}

function redondear2(v: number) {
  return Math.round(v * 100) / 100;
}

function entre(texto: string, etiqueta: string) {
  const m = texto.match(new RegExp(`<${etiqueta}>([\\s\\S]*?)</${etiqueta}>`));
  return m ? m[1] : null;
}

function todos(texto: string, etiqueta: string) {
  return [...texto.matchAll(new RegExp(`<${etiqueta}>([\\s\\S]*?)</${etiqueta}>`, "g"))].map((m) => m[1]);
}

async function llamarWsfe(accion: string, cuerpo: string) {
  const ticket = await obtenerTicketAcceso();
  // El certificado autentica (puede ser de otra persona); el CUIT que factura
  // es siempre el de la empresa, que autorizó a ese certificado en ARCA.
  const emisor = await obtenerEmisor();

  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:${accion}>
      <ar:Auth>
        <ar:Token>${ticket.token}</ar:Token>
        <ar:Sign>${ticket.sign}</ar:Sign>
        <ar:Cuit>${cuitSinGuiones(emisor.cuit)}</ar:Cuit>
      </ar:Auth>
      ${cuerpo}
    </ar:${accion}>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(URLS_ARCA.wsfe, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    body: sobre,
    cache: "no-store",
  });
  const texto = await res.text();

  const falla = entre(texto, "faultstring") ?? entre(texto, "soap:Text");
  if (falla) throw new Error(`ARCA: ${falla}`);
  if (!res.ok) throw new Error(`ARCA respondió ${res.status}.`);

  // Errores de negocio: vienen dentro de <Errors>, no como falla HTTP.
  const bloqueErrores = entre(texto, "Errors");
  if (bloqueErrores) {
    const mensajes = todos(bloqueErrores, "Msg");
    const codigos = todos(bloqueErrores, "Code");
    throw new Error(mensajes.map((m, i) => `[${codigos[i] ?? "?"}] ${m}`).join(" · "));
  }

  return texto;
}

/** Último número autorizado para ese punto de venta y tipo de comprobante. */
export async function ultimoComprobante(puntoVenta: number, tipoComprobante: number) {
  const texto = await llamarWsfe(
    "FECompUltimoAutorizado",
    `<ar:PtoVta>${puntoVenta}</ar:PtoVta><ar:CbteTipo>${tipoComprobante}</ar:CbteTipo>`
  );
  return Number(entre(texto, "CbteNro") ?? 0);
}

export async function emitirFactura(datos: DatosFactura): Promise<ResultadoFactura> {
  const siguiente = (await ultimoComprobante(datos.puntoVenta, datos.tipoComprobante)) + 1;

  // Los precios del sistema ya incluyen IVA, así que se desarma para
  // informar neto e IVA por separado, que es como los pide ARCA.
  const neto = redondear2(datos.total / (1 + datos.porcentajeIva / 100));
  const iva = redondear2(datos.total - neto);
  const fecha = fechaArcaHoy();

  // Id 5 = 21%, Id 4 = 10,5%. Se elige por el porcentaje configurado.
  const idAlicuota = datos.porcentajeIva === 10.5 ? 4 : 5;

  const cuerpo = `<ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${datos.puntoVenta}</ar:PtoVta>
          <ar:CbteTipo>${datos.tipoComprobante}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>${datos.tipoDoc}</ar:DocTipo>
            <ar:DocNro>${cuitSinGuiones(datos.nroDoc) || 0}</ar:DocNro>
            <ar:CbteDesde>${siguiente}</ar:CbteDesde>
            <ar:CbteHasta>${siguiente}</ar:CbteHasta>
            <ar:CbteFch>${fecha}</ar:CbteFch>
            <ar:ImpTotal>${datos.total.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0</ar:ImpTotConc>
            <ar:ImpNeto>${neto.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>0</ar:ImpOpEx>
            <ar:ImpTrib>0</ar:ImpTrib>
            <ar:ImpIVA>${iva.toFixed(2)}</ar:ImpIVA>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:Iva>
              <ar:AlicIva>
                <ar:Id>${idAlicuota}</ar:Id>
                <ar:BaseImp>${neto.toFixed(2)}</ar:BaseImp>
                <ar:Importe>${iva.toFixed(2)}</ar:Importe>
              </ar:AlicIva>
            </ar:Iva>
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>`;

  const texto = await llamarWsfe("FECAESolicitar", cuerpo);

  const resultado = entre(texto, "Resultado");
  const cae = entre(texto, "CAE");
  const vencimiento = entre(texto, "CAEFchVto");

  // "R" = rechazado, "P" = parcial. Solo "A" (aprobado) sirve.
  if (resultado !== "A" || !cae || !vencimiento) {
    const observaciones = entre(texto, "Observaciones");
    const detalle = observaciones ? todos(observaciones, "Msg").join(" · ") : "sin detalle";
    throw new Error(`ARCA no aprobó la factura (${resultado ?? "sin resultado"}): ${detalle}`);
  }

  return {
    cae,
    vencimientoCae: vencimiento,
    numeroComprobante: siguiente,
    tipoComprobante: datos.tipoComprobante,
    puntoVenta: datos.puntoVenta,
    neto,
    iva,
    total: datos.total,
    fecha,
  };
}

/** Datos que ARCA exige dentro del QR de la factura (RG 4892). */
export async function urlQrArca(f: ResultadoFactura, tipoDoc: number, nroDoc: string) {
  const emisor = await obtenerEmisor();
  const payload = {
    ver: 1,
    fecha: `${f.fecha.slice(0, 4)}-${f.fecha.slice(4, 6)}-${f.fecha.slice(6, 8)}`,
    cuit: Number(cuitSinGuiones(emisor.cuit)),
    ptoVta: f.puntoVenta,
    tipoCmp: f.tipoComprobante,
    nroCmp: f.numeroComprobante,
    importe: f.total,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: tipoDoc,
    nroDocRec: Number(cuitSinGuiones(nroDoc) || 0),
    tipoCodAut: "E",
    codAut: Number(f.cae),
  };
  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}

/** Guarda el CAE en la venta para no volver a facturarla nunca. */
export async function guardarFacturaEnVenta(idVenta: string, f: ResultadoFactura) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("ventas")
    .update({
      cae: f.cae,
      cae_vencimiento: f.vencimientoCae,
      factura_tipo: f.tipoComprobante,
      factura_punto_venta: f.puntoVenta,
      factura_numero: f.numeroComprobante,
      factura_neto: f.neto,
      factura_iva: f.iva,
      factura_fecha: `${f.fecha.slice(0, 4)}-${f.fecha.slice(4, 6)}-${f.fecha.slice(6, 8)}`,
    })
    .eq("id_venta", idVenta);
  if (error) throw new Error(error.message);
}
