import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { EMISOR } from "@/lib/emisor";
import BotonImprimirRecibo from "@/components/BotonImprimirRecibo";

// El pedido, en papel, para mandarle al proveedor.
//
// Es una página del servidor y no un PDF generado: el navegador imprime a PDF
// mejor de lo que lo haría una librería, y así el documento se puede abrir en
// el celular y mandar por WhatsApp sin descargar nada.
//
// A propósito NO lleva precios. El sistema no guarda un precio al hacer el
// pedido — el costo aparece recién con la factura — y mandar un número
// inventado es peor que no mandar ninguno: el proveedor lo lee como precio
// acordado y después se discute.
export const dynamic = "force-dynamic";

function formatearFechaLarga(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function PedidoImprimiblePage({
  params,
}: {
  params: Promise<{ origen: string; idOrden: string }>;
}) {
  const sesion = await obtenerSesionConPantallas();
  // Mismo permiso que la pantalla desde donde se abre: quien puede armar el
  // pedido puede mandarlo.
  if (!puedeVerPantalla(sesion, "compras")) return <PantallaBloqueada />;

  const { origen, idOrden } = await params;
  const esProveedor = origen.toUpperCase() === "PROVEEDOR";
  const supabase = getSupabaseServerClient();

  const { data: orden } = await supabase
    .from(esProveedor ? "ordenes_compra_proveedor" : "ordenes_reposicion")
    .select("*")
    .eq("id_orden", idOrden)
    .maybeSingle();
  if (!orden) notFound();

  const { data: contraparte } = esProveedor
    ? await supabase
        .from("proveedores")
        .select("nombre, cuit, telefono, email")
        .eq("id_proveedor", orden.id_proveedor as string)
        .maybeSingle()
    : await supabase.from("marcas").select("nombre").eq("id_marca", orden.id_marca as string).maybeSingle();

  const { data: local } = await supabase
    .from("locales")
    .select("nombre, direccion, telefono")
    .eq("id_local", orden.id_local as string)
    .maybeSingle();

  const { data: detalle } = await supabase
    .from(esProveedor ? "detalle_orden_compra" : "detalle_reposicion")
    .select("id_variante, cantidad_solicitada")
    .eq("id_orden", idOrden);

  const idsVariante = (detalle ?? []).map((d) => d.id_variante as string);
  const { data: variantes } = idsVariante.length
    ? await supabase
        .from("variantes_producto")
        .select("id_variante, id_producto, nombre, sku, codigo_barras")
        .in("id_variante", idsVariante)
    : { data: [] as Record<string, unknown>[] };

  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto as string))];
  const { data: productos } = idsProducto.length
    ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProducto)
    : { data: [] as Record<string, unknown>[] };

  const nombreProducto = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
  const variantePorId = new Map((variantes ?? []).map((v) => [v.id_variante as string, v]));

  const lineas = (detalle ?? [])
    .map((d) => {
      const v = variantePorId.get(d.id_variante as string);
      const base = v ? nombreProducto.get(v.id_producto as string) ?? "Producto" : "Producto";
      const sufijo = v && v.nombre !== "Único" ? ` — ${v.nombre}` : "";
      return {
        nombre: `${base}${sufijo}`,
        // El código de barras primero: es lo que el proveedor puede cruzar
        // contra su propio sistema. El SKU es nuestro y a él no le dice nada.
        codigo: (v?.codigo_barras as string | null) || (v?.sku as string | null) || "—",
        cantidad: (d.cantidad_solicitada as number) ?? 0,
      };
    })
    .filter((l) => l.cantidad > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const totalUnidades = lineas.reduce((acc, l) => acc + l.cantidad, 0);
  const numero = idOrden.slice(0, 7).toUpperCase();
  const fecha = (orden.fecha_alta as string | null) ?? (orden.fecha as string | null);
  const cuit = esProveedor ? ((contraparte as { cuit?: string | null })?.cuit ?? null) : null;

  return (
    <div className="pedido-pagina">
      <style>{`
        .pedido-pagina { background: #f5f6f8; padding: 20px 16px 60px; min-height: 100vh; }
        .pedido-barra {
          max-width: 800px; margin: 0 auto 16px; display: flex;
          align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
        }
        .pedido-hoja {
          max-width: 800px; margin: 0 auto; background: #fff; color: #16191f;
          border: 1px solid #ddd; padding: 32px 34px;
          font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.5;
        }
        .pedido-top {
          display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap;
          padding-bottom: 16px; border-bottom: 2px solid #16191f;
        }
        .pedido-logo { height: 42px; width: auto; display: block; }
        .pedido-razon { font-size: 12px; color: #6b7488; margin-top: 8px; }
        .pedido-fiscal { font-size: 11.5px; color: #6b7488; margin-top: 6px; }
        .pedido-doc { text-align: right; }
        .pedido-tipo { font-size: 12.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
        .pedido-nro { font-family: ui-monospace, Consolas, monospace; font-size: 19px; font-weight: 700; }
        .pedido-fecha { font-size: 11.5px; color: #6b7488; margin-top: 4px; }

        .pedido-partes { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 20px 0 22px; }
        .pedido-et {
          font-size: 9.5px; font-weight: 700; letter-spacing: .1em;
          text-transform: uppercase; color: #6b7488; margin-bottom: 5px;
        }
        .pedido-nom { font-weight: 700; font-size: 15px; }
        .pedido-det { font-size: 12px; color: #6b7488; margin-top: 2px; }
        /* Resaltado a propósito: con dos locales, "dónde entregar" es el dato
           que más se lee mal, y la mercadería termina en el local equivocado. */
        /* El borde completo, y no solo el fondo, porque Chrome imprime sin
           "gráficos de fondo" por defecto: si el resalte dependiera del color
           de relleno, en el papel no se vería nada. */
        .pedido-entrega {
          background: #f4f7fc; border: 1px solid #c9d8ef; border-left: 3px solid #2a6fd6;
          padding: 10px 12px; border-radius: 0 6px 6px 0;
        }

        table.pedido-tabla { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        table.pedido-tabla th {
          text-align: left; font-size: 9.5px; font-weight: 700; letter-spacing: .09em;
          text-transform: uppercase; color: #6b7488;
          padding: 8px 10px; border-bottom: 1.5px solid #16191f;
        }
        table.pedido-tabla td { padding: 9px 10px; border-bottom: 1px solid #e2e6ee; }
        table.pedido-tabla th.num, table.pedido-tabla td.num { text-align: right; }
        table.pedido-tabla td.cod {
          font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; color: #6b7488;
        }
        table.pedido-tabla tr.tot td {
          border-bottom: 0; border-top: 1.5px solid #16191f;
          font-weight: 700; font-size: 13.5px; padding-top: 11px;
        }

        .pedido-obs {
          margin-top: 22px; padding: 11px 13px; background: #f8f9fb;
          border: 1px solid #e2e6ee; border-radius: 6px; font-size: 12px;
        }
        .pedido-pie {
          margin-top: 24px; padding-top: 13px; border-top: 1px solid #e2e6ee;
          font-size: 10.5px; color: #6b7488; line-height: 1.5;
          display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
        }
        @media print {
          .pedido-pagina { background: #fff; padding: 0; }
          .pedido-barra { display: none !important; }
          .pedido-hoja { border: 0; margin: 0; max-width: none; padding: 16mm 14mm; }
        }
      `}</style>

      <div className="pedido-barra">
        <BotonImprimirRecibo />
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
          Guardalo en PDF y mandáselo por WhatsApp o mail. El pedido ya quedó marcado como enviado.
        </p>
      </div>

      <div className="pedido-hoja">
        <div className="pedido-top">
          <div>
            {/* El logo completo (con la bajada), no el wordmark del menú: este
                papel se presenta ante alguien de afuera, que es justo cuando
                corresponde la marca entera. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/wiigo-logo.png" alt="WiiGo" className="pedido-logo" />
            <div className="pedido-razon">{EMISOR.razonSocial}</div>
            <div className="pedido-fiscal">
              CUIT {EMISOR.cuit} · {EMISOR.condicionIva}
              <br />
              {EMISOR.domicilioFiscal}
            </div>
          </div>
          <div className="pedido-doc">
            <div className="pedido-tipo">Orden de compra</div>
            <div className="pedido-nro">#{numero}</div>
            <div className="pedido-fecha">{formatearFechaLarga(fecha)}</div>
          </div>
        </div>

        <div className="pedido-partes">
          <div>
            <div className="pedido-et">{esProveedor ? "Proveedor" : "Marca"}</div>
            <div className="pedido-nom">{(contraparte as { nombre?: string })?.nombre ?? "—"}</div>
            {/* Los datos del proveedor solo si están cargados: una línea que
                dice "CUIT —" en un papel que sale para afuera queda peor que
                no ponerla. */}
            {cuit && <div className="pedido-det">CUIT {cuit}</div>}
          </div>
          <div className="pedido-entrega">
            <div className="pedido-et">Entregar en</div>
            <div className="pedido-nom">{(local?.nombre as string) ?? "—"}</div>
            {local?.direccion && <div className="pedido-det">{local.direccion as string}</div>}
            {local?.telefono && <div className="pedido-det">Tel. {local.telefono as string}</div>}
          </div>
        </div>

        <table className="pedido-tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Código</th>
              <th className="num">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>{l.nombre}</td>
                <td className="cod">{l.codigo}</td>
                <td className="num">{l.cantidad}</td>
              </tr>
            ))}
            <tr className="tot">
              <td colSpan={2}>Total</td>
              <td className="num">
                {totalUnidades} {totalUnidades === 1 ? "unidad" : "unidades"}
              </td>
            </tr>
          </tbody>
        </table>

        {Boolean(orden.observaciones) && (
          <div className="pedido-obs">
            <div className="pedido-et">Observaciones</div>
            {orden.observaciones as string}
          </div>
        )}

        <div className="pedido-pie">
          <span>
            Este documento es un pedido de mercadería. <b>No es una factura ni un remito.</b>
            <br />
            Cualquier diferencia entre lo pedido y lo que se despache, avisar antes de la entrega.
          </span>
          <span style={{ textAlign: "right" }}>
            {orden.usuario ? `Pedido por ${orden.usuario as string}` : "WiiGo"}
            <br />
            WiiGo · {formatearFechaLarga(fecha)}
          </span>
        </div>
      </div>
    </div>
  );
}
