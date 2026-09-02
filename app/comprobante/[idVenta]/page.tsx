import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerEmisor } from "@/lib/arca/emisor-db";
import { debeFacturarseAutomatico } from "@/lib/arca/config";
import { TIPO_COMPROBANTE, TIPO_DOC, urlQrArca } from "@/lib/arca/wsfe";
import RecargarComprobante from "@/components/RecargarComprobante";

// Página pública: es lo que se abre en el celular del cliente al escanear el
// QR del totem o del POS. No lleva login (ver proxy.ts) — el UUID de la venta
// hace de llave, igual que el link de un comprobante de cualquier billetera
// virtual.
//
// Es una sola página con dos caras, y cuál se muestra lo decide un solo dato:
// si la venta tiene CAE.
//
//   · Con CAE  → ES la factura electrónica. Lleva letra, punto de venta y
//                número, el CAE con su vencimiento y el QR oficial de ARCA
//                (RG 4892), que es lo que la hace verificable.
//   · Sin CAE  → comprobante interno del pedido, con la leyenda de que no
//                vale como factura.
//
// Cuál de las dos toca no depende de esta página sino de la configuración de
// facturación automática por medio de pago (Configuración → Facturación
// electrónica): efectivo sin tildar deja comprobante, Mercado Pago tildado
// deja factura.
export const dynamic = "force-dynamic";

function monto(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  const [emisor, { data: detalle }, { data: local }, { data: productos }, { data: variantes }] = await Promise.all([
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

  const esFactura = Boolean(venta.cae);

  // Si el medio de pago está configurado para facturarse solo pero el CAE
  // todavía no llegó, es casi seguro que está en camino: se avisa y se
  // recarga sola en vez de mostrar "no válido como factura" y confundir.
  const esperandoFactura =
    !esFactura && venta.estado === "PAGADA" && (await debeFacturarseAutomatico(venta.medio_pago as string));

  // Documento del receptor: las facturas emitidas antes de que se guardara
  // fueron todas a consumidor final, que es el único caso que existía.
  const tipoDocReceptor = (venta.factura_doc_tipo as number) ?? TIPO_DOC.CONSUMIDOR_FINAL;
  const nroDocReceptor = (venta.factura_doc_nro as string) ?? "0";
  const etiquetaReceptor =
    tipoDocReceptor === TIPO_DOC.CUIT
      ? `CUIT ${nroDocReceptor}`
      : tipoDocReceptor === TIPO_DOC.DNI && nroDocReceptor !== "0"
        ? `DNI ${nroDocReceptor}`
        : "Consumidor Final";

  let qrArca: string | null = null;
  let letra = "B";
  let codigo = "06";
  if (esFactura) {
    const tipoComprobante = (venta.factura_tipo as number) ?? TIPO_COMPROBANTE.FACTURA_B;
    letra = LETRA[tipoComprobante] ?? "B";
    codigo = CODIGO[tipoComprobante] ?? "06";
    const url = await urlQrArca(
      {
        cae: venta.cae as string,
        vencimientoCae: (venta.cae_vencimiento as string) ?? "",
        numeroComprobante: venta.factura_numero as number,
        tipoComprobante,
        puntoVenta: venta.factura_punto_venta as number,
        neto: (venta.factura_neto as number) ?? total,
        iva: (venta.factura_iva as number) ?? 0,
        total,
        fecha: ((venta.factura_fecha as string) ?? "").replace(/-/g, ""),
      },
      tipoDocReceptor,
      nroDocReceptor
    );
    qrArca = await QRCode.toDataURL(url, { margin: 1, width: 320 });
  }

  return (
    <main className="min-h-screen bg-neutral-100 py-6 px-4">
      {esperandoFactura && <RecargarComprobante />}

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

        {esFactura ? (
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
        ) : esperandoFactura ? (
          <div className="bg-sky-50 border-b border-sky-200 px-6 py-3 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-sky-800">Estamos generando tu factura</p>
            <p className="text-xs text-sky-700 mt-0.5">Esta página se actualiza sola en unos segundos.</p>
          </div>
        ) : (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Documento no válido como factura</p>
            <p className="text-xs text-amber-700 mt-0.5">Comprobante interno de control</p>
          </div>
        )}

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
            <dd>{MEDIO_PAGO_LABEL[venta.medio_pago as string] ?? (venta.medio_pago as string)}</dd>
          </div>
          {esFactura && (
            <div className="flex justify-between py-0.5">
              <dt className="text-neutral-500">Cliente</dt>
              <dd>{etiquetaReceptor}</dd>
            </div>
          )}
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
            <span className="font-bold text-neutral-900">{esFactura ? "Importe Total" : "Total"}</span>
            <span className="text-2xl font-extrabold text-neutral-900 tabular-nums">${monto(total)}</span>
          </div>
        </div>

        {esFactura && qrArca && (
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
        )}

        <footer className="px-6 pb-6 text-center">
          <p className="text-xs text-neutral-400">¡Gracias por tu compra!</p>
        </footer>
      </div>

      <p className="max-w-md mx-auto text-center text-xs text-neutral-400 mt-4">
        {esFactura
          ? "Esta es tu factura. Guardá la página o sacale una captura — también podés volver a abrirla escaneando el mismo código."
          : "Guardá esta página o sacale una captura. También podés volver a abrirla escaneando el mismo código."}
      </p>
    </main>
  );
}
