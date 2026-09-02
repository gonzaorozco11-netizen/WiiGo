import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerConfigArca } from "@/lib/arca/config";
import { emitirFactura, guardarFacturaEnVenta, TIPO_COMPROBANTE, TIPO_DOC } from "@/lib/arca/wsfe";

// El acto de facturar, sin controlar permisos.
//
// Está separado de la Server Action a propósito: la emisión automática se
// dispara cuando una empleada confirma un cobro, y ella no tiene (ni debería
// tener) permiso para facturar. El permiso se controla en la acción manual,
// que es la que dispara una persona.

export type DatosReceptor = {
  /** "CONSUMIDOR_FINAL" | "DNI" | "CUIT" */
  tipo: string;
  numero: string;
};

export type ResultadoEmision = { error: string | null; numero?: string };

export async function emitirFacturaParaVenta(idVenta: string, receptor: DatosReceptor): Promise<ResultadoEmision> {
  const supabase = getSupabaseServerClient();
  const config = await obtenerConfigArca();
  if (!config.habilitado) {
    return { error: "La facturación electrónica está apagada. Activala en Configuración → Facturación electrónica." };
  }

  const { data: venta } = await supabase
    .from("ventas")
    .select("id_venta, total, estado, cae")
    .eq("id_venta", idVenta)
    .maybeSingle();
  if (!venta) return { error: "No se encontró la venta" };
  if (venta.cae) return { error: "Esta venta ya tiene factura emitida." };
  if (venta.estado !== "PAGADA") return { error: "Solo se factura una venta ya pagada." };
  if (!venta.total || (venta.total as number) <= 0) return { error: "La venta no tiene importe para facturar." };

  // Factura A solo si el cliente es Responsable Inscripto y da su CUIT; para
  // todo lo demás (consumidor final, con o sin DNI) va Factura B.
  const digitos = receptor.numero.replace(/\D/g, "");
  const esCuit = receptor.tipo === "CUIT" && digitos.length === 11;
  const tipoComprobante = esCuit ? TIPO_COMPROBANTE.FACTURA_A : TIPO_COMPROBANTE.FACTURA_B;
  const tipoDoc = esCuit
    ? TIPO_DOC.CUIT
    : receptor.tipo === "DNI" && digitos.length >= 7
      ? TIPO_DOC.DNI
      : TIPO_DOC.CONSUMIDOR_FINAL;
  const nroDoc = tipoDoc === TIPO_DOC.CONSUMIDOR_FINAL ? "0" : digitos;

  const resultado = await emitirFactura({
    tipoComprobante,
    puntoVenta: config.puntoVenta,
    tipoDoc,
    nroDoc,
    total: venta.total as number,
    porcentajeIva: config.ivaPorcentaje,
  });

  await guardarFacturaEnVenta(idVenta, resultado);

  return {
    error: null,
    numero: `${String(resultado.puntoVenta).padStart(5, "0")}-${String(resultado.numeroComprobante).padStart(8, "0")}`,
  };
}
