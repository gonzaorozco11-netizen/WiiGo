import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { EMISOR } from "@/lib/emisor";

// Página pública: es lo que se abre en el celular del cliente al escanear el
// QR del totem. No lleva login (ver proxy.ts) — el UUID de la venta hace de
// llave, igual que el link de un comprobante de cualquier billetera virtual.
//
// IMPORTANTE: mientras no esté la integración con ARCA esto NO es una
// factura. Lleva la misma leyenda que el ticket de papel. Cuando se conecte
// ARCA hay que agregar acá el CAE, su vencimiento, el tipo y número de
// comprobante y el QR oficial de ARCA.
export const dynamic = "force-dynamic";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFecha(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MEDIO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO: "Efectivo",
  MERCADO_PAGO: "Mercado Pago",
  TRANSFERENCIA: "Transferencia",
};

export default async function ComprobantePage({ params }: { params: Promise<{ idVenta: string }> }) {
  const { idVenta } = await params;
  const supabase = getSupabaseServerClient();

  const { data: venta } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, total, estado, medio_pago, id_local")
    .eq("id_venta", idVenta)
    .maybeSingle();

  if (!venta) notFound();

  const [{ data: detalle }, { data: local }, { data: productos }, { data: variantes }] = await Promise.all([
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

  const subtotal = lineas.reduce((acc, l) => acc + l.subtotal, 0);
  const descuento = Math.max(subtotal - (venta.total as number), 0);

  return (
    <main className="min-h-screen bg-neutral-100 py-6 px-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
        <header className="px-6 pt-6 pb-5 text-center border-b border-dashed border-neutral-200">
          <p className="text-lg font-extrabold text-neutral-900">{EMISOR.razonSocial}</p>
          <p className="text-sm text-neutral-500">{EMISOR.nombreFantasia}</p>
          <p className="text-xs text-neutral-400 mt-2">{EMISOR.domicilioComercial}</p>
          <p className="text-xs text-neutral-400">CUIT {EMISOR.cuit}</p>
          <p className="text-xs text-neutral-400">{EMISOR.condicionIva}</p>
          <p className="text-xs text-neutral-400">IIBB {EMISOR.ingresosBrutos}</p>
          <p className="text-xs text-neutral-400">Inicio de actividades: {EMISOR.inicioActividades}</p>
        </header>

        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-center">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Documento no válido como factura</p>
          <p className="text-xs text-amber-700 mt-0.5">Comprobante interno de control</p>
        </div>

        <dl className="px-6 py-4 text-sm border-b border-dashed border-neutral-200">
          <div className="flex justify-between py-0.5">
            <dt className="text-neutral-500">Pedido</dt>
            <dd className="font-semibold tabular-nums">VTA-{String(venta.numero).padStart(4, "0")}</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-neutral-500">Fecha</dt>
            <dd className="tabular-nums">{formatearFecha(venta.fecha as string)}</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-neutral-500">Local</dt>
            <dd>{local?.nombre ?? "—"}</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-neutral-500">Pago</dt>
            <dd>{MEDIO_PAGO_LABEL[venta.medio_pago as string] ?? (venta.medio_pago as string)}</dd>
          </div>
        </dl>

        <ul className="px-6 py-4 border-b border-dashed border-neutral-200">
          {lineas.map((l, i) => (
            <li key={i} className="flex justify-between items-start gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-900">{l.producto}</p>
                {l.variante && <p className="text-xs text-neutral-400">{l.variante}</p>}
                <p className="text-xs text-neutral-400 tabular-nums">
                  {l.cantidad} × ${formatearMonto(l.precioUnitario)}
                </p>
              </div>
              <p className="text-sm font-bold tabular-nums shrink-0">${formatearMonto(l.subtotal)}</p>
            </li>
          ))}
        </ul>

        <div className="px-6 py-4">
          {descuento > 0 && (
            <>
              <div className="flex justify-between text-sm py-0.5">
                <span className="text-neutral-500">Subtotal</span>
                <span className="tabular-nums">${formatearMonto(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm py-0.5 text-emerald-600">
                <span>Descuentos</span>
                <span className="tabular-nums">-${formatearMonto(descuento)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-baseline pt-3 mt-2 border-t border-neutral-200">
            <span className="font-bold text-neutral-900">Total</span>
            <span className="text-2xl font-extrabold text-neutral-900 tabular-nums">
              ${formatearMonto(venta.total as number)}
            </span>
          </div>
        </div>

        <footer className="px-6 pb-6 text-center">
          <p className="text-xs text-neutral-400">¡Gracias por tu compra!</p>
        </footer>
      </div>

      <p className="max-w-md mx-auto text-center text-xs text-neutral-400 mt-4">
        Guardá esta página o sacale una captura. También podés volver a abrirla escaneando el mismo código.
      </p>
    </main>
  );
}
