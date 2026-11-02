import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerEmisor } from "@/lib/arca/emisor-db";
import { debeFacturarseAutomatico } from "@/lib/arca/config";
import { TIPO_COMPROBANTE, TIPO_DOC, urlQrArca } from "@/lib/arca/wsfe";
import { WIIGO_ISOTIPO_DATA_URI } from "@/lib/wiigo-logo-data";
import RecargarComprobante from "@/components/RecargarComprobante";

// Página pública: es lo que se abre en el celular del cliente al escanear el
// QR del totem o del POS. No lleva login (ver proxy.ts) — el UUID de la venta
// hace de llave, igual que el link de un comprobante de cualquier billetera
// virtual.
//
// Es una sola página con dos caras, y cuál se muestra lo decide un solo dato:
// si la venta tiene CAE.
//
//   · Con CAE  → ES la factura electrónica. Lleva los datos fiscales del
//                emisor (obligatorios), letra, punto de venta y número, el
//                CAE con su vencimiento y el QR oficial de ARCA (RG 4892).
//   · Sin CAE  → comprobante de compra. Marca comercial, sin un solo dato de
//                la sociedad: razón social, CUIT, IIBB y condición frente al
//                IVA son requisitos DE UNA FACTURA, y ponerlos en un papel
//                que dice "no válido como factura" solo lo hace parecer lo
//                que no es.
//
// Cuál de las dos toca no depende de esta página sino de la configuración de
// facturación automática por medio de pago (Configuración → Facturación
// electrónica): efectivo sin tildar deja comprobante, Mercado Pago tildado
// deja factura.
export const dynamic = "force-dynamic";

// Va acá y no en los datos fiscales a propósito: es la marca hablándole al
// cliente, no información del emisor.
const FRASE_MARCA = "El Bienestar del Mendocino, en un solo lugar 💪🔋";

function monto(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function montoEntero(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFechaHora(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2 sep, 18:24" — lo justo para el momento en que se abre. */
function fechaBreve(iso: string) {
  return new Date(iso)
    .toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(".", "");
}

function fechaCorta(iso: string | null) {
  if (!iso) return "—";
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

const MEDIO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO: "Efectivo",
  MERCADO_PAGO: "Mercado Pago",
  TRANSFERENCIA: "Transferencia",
};

const LETRA: Record<number, string> = { [TIPO_COMPROBANTE.FACTURA_A]: "A", [TIPO_COMPROBANTE.FACTURA_B]: "B" };
const CODIGO: Record<number, string> = { [TIPO_COMPROBANTE.FACTURA_A]: "01", [TIPO_COMPROBANTE.FACTURA_B]: "06" };

export default async function ComprobantePage({ params }: { params: Promise<{ idVenta: string }> }) {
  const { idVenta } = await params;
  const supabase = getSupabaseServerClient();

  const { data: venta } = await supabase.from("ventas").select("*").eq("id_venta", idVenta).maybeSingle();
  if (!venta) notFound();

  const esFactura = Boolean(venta.cae);

  const [emisor, { data: detalle }, { data: local }, { data: productos }, { data: variantes }] = await Promise.all([
    // Los datos fiscales solo se usan en la cara de factura, pero se traen
    // igual: es una consulta a la tabla de configuración, no vale la pena
    // ramificar por eso.
    obtenerEmisor(),
    supabase.from("detalle_ventas").select("id_variante, cantidad, precio_unitario, subtotal").eq("id_venta", idVenta),
    supabase.from("locales").select("nombre").eq("id_local", venta.id_local).maybeSingle(),
    supabase.from("productos").select("id_producto, nombre"),
    supabase.from("variantes_producto").select("id_variante, id_producto, nombre"),
  ]);

  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
  const variantePorId = new Map((variantes ?? []).map((v) => [v.id_variante as string, v]));

  function nombreDe(idVariante: string) {
    const variante = variantePorId.get(idVariante);
    if (!variante) return { producto: "Producto", variante: null as string | null };
    const nombreProducto = productoPorId.get(variante.id_producto as string) ?? "Producto";
    const nombreVariante = (variante.nombre as string) !== "Único" ? (variante.nombre as string) : null;
    return { producto: nombreProducto, variante: nombreVariante };
  }

  const lineas = (detalle ?? []).map((d) => ({
    ...nombreDe(d.id_variante as string),
    cantidad: d.cantidad as number,
    precioUnitario: d.precio_unitario as number,
    subtotal: d.subtotal as number,
  }));

  const total = venta.total as number;
  const sumaLineas = lineas.reduce((acc, l) => acc + l.subtotal, 0);
  const descuento = Math.max(sumaLineas - total, 0);
  const medioPago = MEDIO_PAGO_LABEL[venta.medio_pago as string] ?? (venta.medio_pago as string);
  const puntos = (venta.puntos_generados as number) ?? 0;

  // Si el medio de pago está configurado para facturarse solo pero el CAE
  // todavía no llegó, es casi seguro que está en camino: se avisa y se
  // recarga sola en vez de mostrar "no válido como factura" y confundir.
  const esperandoFactura =
    !esFactura && venta.estado === "PAGADA" && (await debeFacturarseAutomatico(venta.medio_pago as string));

  // ===================== CARA "COMPROBANTE" =====================
  if (!esFactura) {
    return (
      <main className="min-h-screen bg-neutral-100 py-6 px-4">
        {esperandoFactura && <RecargarComprobante />}

        <div className="max-w-md mx-auto bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <header className="px-5 pt-7 pb-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={WIIGO_ISOTIPO_DATA_URI} alt="WiiGo" className="h-11 w-auto mx-auto" />
            <p className="text-[12.5px] font-semibold text-neutral-500 mt-3 max-w-[22ch] mx-auto leading-snug">
              {FRASE_MARCA}
            </p>
          </header>

          <div className="px-5 pb-1 text-center">
            {esperandoFactura ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 border border-sky-200 text-sky-800 text-[12.5px] font-bold px-3 py-1">
                Estamos generando tu factura…
              </span>
            ) : venta.estado === "PAGADA" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12.5px] font-bold pl-2.5 pr-3 py-1">
                <span className="w-[15px] h-[15px] rounded-full bg-emerald-800 text-white text-[9px] flex items-center justify-center">
                  ✓
                </span>
                Pagado
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-neutral-100 border border-neutral-200 text-neutral-600 text-[12.5px] font-bold px-3 py-1">
                {venta.estado === "ANULADA" || venta.estado === "CANCELADA" ? "Anulado" : "Pendiente de pago"}
              </span>
            )}

            <p className="text-[11.5px] text-neutral-400 mt-2.5">
              {local?.nombre ?? "—"} · {fechaBreve(venta.fecha as string)}
            </p>

            <span className="inline-block mt-2.5 font-mono text-[12.5px] font-semibold text-neutral-700 bg-neutral-100 border border-neutral-200 rounded-md px-2.5 py-1 tracking-tight">
              VTA-{String(venta.numero).padStart(4, "0")}
            </span>
          </div>

          <ul className="px-5 pt-3.5 pb-1">
            {lineas.map((l, i) => (
              <li
                key={i}
                className="flex justify-between items-start gap-3 py-1.5 border-t border-neutral-100 first:border-0"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-neutral-900">{l.producto}</p>
                  <p className="text-[11px] text-neutral-400 tabular-nums">
                    {l.variante ? `${l.variante} · ` : ""}
                    {l.cantidad} × ${montoEntero(l.precioUnitario)}
                  </p>
                </div>
                <p className="text-[13px] font-bold tabular-nums shrink-0">${montoEntero(l.subtotal)}</p>
              </li>
            ))}
          </ul>

          <div className="px-5 pt-2 pb-3.5">
            {descuento > 0 && (
              <div className="flex justify-between text-[12px] text-emerald-600 pb-1.5">
                <span>Descuentos</span>
                <span className="tabular-nums">-${montoEntero(descuento)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline border-t-2 border-neutral-900 pt-2.5">
              <span className="text-sm font-bold text-neutral-900">Total</span>
              <span className="text-[25px] font-extrabold text-neutral-900 tabular-nums leading-none">
                ${montoEntero(total)}
              </span>
            </div>
            {venta.estado === "PAGADA" && (
              <div className="flex justify-between text-xs text-neutral-500 mt-1.5">
                <span>Pagaste con</span>
                <span>{medioPago}</span>
              </div>
            )}
          </div>

          {puntos > 0 && (
            <div className="mx-5 mb-3.5 flex items-center gap-2.5 rounded-[10px] bg-amber-50/70 border border-amber-200/70 px-3 py-2.5">
              <span className="text-base leading-none">⭐</span>
              <span className="text-xs text-amber-800">
                <b className="block text-[13px] text-amber-900">
                  Sumaste {puntos} punto{puntos === 1 ? "" : "s"} WiiGo
                </b>
                Usalos como descuento la próxima.
              </span>
            </div>
          )}

          <footer className="px-5 pb-5 text-center">
            <p className="text-[13.5px] font-bold text-neutral-700">¡Gracias por tu compra!</p>
            <p className="text-[10px] text-neutral-300 mt-3 pt-2.5 border-t border-dashed border-neutral-200 leading-relaxed">
              Comprobante de compra · No válido como factura.
            </p>
          </footer>
        </div>
      </main>
    );
  }

  // ===================== CARA "FACTURA" =====================
  // Acá sí van todos los datos fiscales: son obligatorios.
  const tipoComprobante = (venta.factura_tipo as number) ?? TIPO_COMPROBANTE.FACTURA_B;
  const letra = LETRA[tipoComprobante] ?? "B";
  const codigo = CODIGO[tipoComprobante] ?? "06";

  // Las facturas emitidas antes de que se guardara el documento del receptor
  // fueron todas a consumidor final, que es el único caso que existía.
  const tipoDocReceptor = (venta.factura_doc_tipo as number) ?? TIPO_DOC.CONSUMIDOR_FINAL;
  const nroDocReceptor = (venta.factura_doc_nro as string) ?? "0";
  const etiquetaReceptor =
    tipoDocReceptor === TIPO_DOC.CUIT
      ? `CUIT ${nroDocReceptor}`
      : tipoDocReceptor === TIPO_DOC.DNI && nroDocReceptor !== "0"
        ? `DNI ${nroDocReceptor}`
        : "Consumidor Final";

  const urlQr = await urlQrArca({
    cae: venta.cae as string,
    vencimientoCae: (venta.cae_vencimiento as string) ?? "",
    numeroComprobante: venta.factura_numero as number,
    tipoComprobante,
    puntoVenta: venta.factura_punto_venta as number,
    neto: (venta.factura_neto as number) ?? total,
    iva: (venta.factura_iva as number) ?? 0,
    total,
    fecha: ((venta.factura_fecha as string) ?? "").replace(/-/g, ""),
    tipoDoc: tipoDocReceptor,
    nroDoc: nroDocReceptor,
  });
  const qrArca = await QRCode.toDataURL(urlQr, { margin: 1, width: 320 });

  return (
    <main className="min-h-screen bg-neutral-100 py-6 px-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
        <header className="px-6 pt-6 pb-5 text-center border-b border-dashed border-neutral-200">
          <p className="text-lg font-extrabold text-neutral-900">{emisor.razonSocial}</p>
          <p className="text-sm text-neutral-500">{emisor.nombreFantasia}</p>
          <p className="text-xs text-neutral-400 mt-2">{emisor.domicilioComercial}</p>
          <p className="text-xs text-neutral-400">CUIT {emisor.cuit}</p>
          <p className="text-xs text-neutral-400">{emisor.condicionIva}</p>
          <p className="text-xs text-neutral-400">IIBB {emisor.ingresosBrutos}</p>
          <p className="text-xs text-neutral-400">Inicio de actividades: {emisor.inicioActividades}</p>
        </header>

        <div className="border-b border-neutral-200 px-6 py-4 flex items-center justify-center gap-4">
          <div className="w-12 h-12 border-2 border-neutral-900 rounded flex flex-col items-center justify-center leading-none shrink-0">
            <span className="text-2xl font-extrabold">{letra}</span>
            <span className="text-[7px] text-neutral-500 mt-0.5">COD. {codigo}</span>
          </div>
          <div className="text-left">
            <p className="text-sm font-extrabold uppercase tracking-wide text-neutral-900">Factura {letra}</p>
            <p className="text-xs text-neutral-500 tabular-nums">
              N° {String(venta.factura_punto_venta ?? 0).padStart(5, "0")}-
              {String(venta.factura_numero ?? 0).padStart(8, "0")}
            </p>
            <p className="text-xs text-neutral-500">Emitida el {fechaCorta(venta.factura_fecha as string)}</p>
          </div>
        </div>

        <dl className="px-6 py-4 text-sm border-b border-dashed border-neutral-200">
          <div className="flex justify-between py-0.5">
            <dt className="text-neutral-500">Pedido</dt>
            <dd className="font-semibold tabular-nums">VTA-{String(venta.numero).padStart(4, "0")}</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-neutral-500">Fecha</dt>
            <dd className="tabular-nums">{formatearFechaHora(venta.fecha as string)}</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-neutral-500">Local</dt>
            <dd>{local?.nombre ?? "—"}</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-neutral-500">Pago</dt>
            <dd>{medioPago}</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-neutral-500">Cliente</dt>
            <dd>{etiquetaReceptor}</dd>
          </div>
        </dl>

        <ul className="px-6 py-4 border-b border-dashed border-neutral-200">
          {lineas.map((l, i) => (
            <li key={i} className="flex justify-between items-start gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-900">{l.producto}</p>
                {l.variante && <p className="text-xs text-neutral-400">{l.variante}</p>}
                <p className="text-xs text-neutral-400 tabular-nums">
                  {l.cantidad} × ${monto(l.precioUnitario)}
                </p>
              </div>
              <p className="text-sm font-bold tabular-nums shrink-0">${monto(l.subtotal)}</p>
            </li>
          ))}
        </ul>

        <div className="px-6 py-4">
          {descuento > 0 && (
            <>
              <div className="flex justify-between text-sm py-0.5">
                <span className="text-neutral-500">Subtotal</span>
                <span className="tabular-nums">${monto(sumaLineas)}</span>
              </div>
              <div className="flex justify-between text-sm py-0.5 text-emerald-600">
                <span>Descuentos</span>
                <span className="tabular-nums">-${monto(descuento)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-baseline pt-3 mt-2 border-t border-neutral-200">
            <span className="font-bold text-neutral-900">Importe Total</span>
            <span className="text-2xl font-extrabold text-neutral-900 tabular-nums">${monto(total)}</span>
          </div>
        </div>

        <div className="border-t border-dashed border-neutral-200 px-6 py-5 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrArca} alt="Código QR de verificación de ARCA" className="w-24 h-24 shrink-0" />
          <div className="text-xs text-neutral-600 leading-relaxed">
            <p className="font-bold text-neutral-900">CAE N° {venta.cae as string}</p>
            <p>Vto. del CAE: {fechaCorta(venta.cae_vencimiento as string)}</p>
            <p className="text-neutral-400 mt-1.5">
              Comprobante autorizado por ARCA. Escaneá este código para verificarlo.
            </p>
          </div>
        </div>

        <footer className="px-6 pb-6 text-center">
          <p className="text-xs text-neutral-400">¡Gracias por tu compra!</p>
        </footer>
      </div>

      <p className="max-w-md mx-auto text-center text-xs text-neutral-400 mt-4">
        Esta es tu factura. Guardá la página o sacale una captura — también podés volver a abrirla escaneando el
        mismo código.
      </p>
    </main>
  );
}
