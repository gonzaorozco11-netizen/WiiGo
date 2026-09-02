import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { obtenerEmisor } from "@/lib/arca/emisor-db";
import { TIPO_COMPROBANTE, TIPO_DOC, urlQrArca } from "@/lib/arca/wsfe";
import BotonImprimirRecibo from "@/components/BotonImprimirRecibo";

// La factura ya emitida, en el formato que exige ARCA (RG 4892): letra en el
// recuadro del medio, datos del emisor y del receptor, detalle, CAE con su
// vencimiento y el QR oficial.
//
// Es una vista de algo que ya pasó: acá no se emite ni se corrige nada. Los
// datos salen de las columnas que guardó guardarFacturaEnVenta, así que lo
// que se ve es exactamente lo que quedó autorizado en ARCA.
export const dynamic = "force-dynamic";

function monto(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCorta(iso: string | null) {
  if (!iso) return "—";
  // Las fechas fiscales vienen como AAAA-MM-DD sin hora: partirlas a mano
  // evita que el navegador las interprete en UTC y muestre el día anterior.
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

const LETRA: Record<number, string> = { [TIPO_COMPROBANTE.FACTURA_A]: "A", [TIPO_COMPROBANTE.FACTURA_B]: "B" };
const CODIGO: Record<number, string> = { [TIPO_COMPROBANTE.FACTURA_A]: "01", [TIPO_COMPROBANTE.FACTURA_B]: "06" };
const ETIQUETA_DOC: Record<number, string> = {
  [TIPO_DOC.CUIT]: "CUIT",
  [TIPO_DOC.DNI]: "DNI",
  [TIPO_DOC.CONSUMIDOR_FINAL]: "DNI",
};

export default async function FacturaPage({ params }: { params: Promise<{ idVenta: string }> }) {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.EMITIR_FACTURAS)) return <PantallaBloqueada />;

  const { idVenta } = await params;
  const supabase = getSupabaseServerClient();

  const { data: venta } = await supabase.from("ventas").select("*").eq("id_venta", idVenta).maybeSingle();
  if (!venta) notFound();

  // Sin CAE no hay factura que mostrar: la venta existe pero nunca se emitió.
  if (!venta.cae) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="font-semibold text-neutral-900 mb-1">Esta venta todavía no tiene factura</p>
        <p className="text-sm text-neutral-500">Emitila desde la pantalla de Ventas, con el botón “Facturar”.</p>
      </div>
    );
  }

  const [emisor, { data: detalle }, { data: cliente }, { data: productos }, { data: variantes }] = await Promise.all([
    obtenerEmisor(),
    supabase.from("detalle_ventas").select("id_variante, cantidad, precio_unitario, subtotal").eq("id_venta", idVenta),
    venta.id_cliente
      ? supabase.from("clientes").select("nombre, apellido, dni").eq("id_cliente", venta.id_cliente).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("productos").select("id_producto, nombre"),
    supabase.from("variantes_producto").select("id_variante, id_producto, nombre"),
  ]);

  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
  const variantePorId = new Map((variantes ?? []).map((v) => [v.id_variante as string, v]));

  function nombreDe(idVariante: string) {
    const variante = variantePorId.get(idVariante);
    if (!variante) return "Producto";
    const base = productoPorId.get(variante.id_producto as string) ?? "Producto";
    return (variante.nombre as string) !== "Único" ? `${base} — ${variante.nombre}` : base;
  }

  const tipoComprobante = (venta.factura_tipo as number) ?? TIPO_COMPROBANTE.FACTURA_B;
  const esFacturaA = tipoComprobante === TIPO_COMPROBANTE.FACTURA_A;
  const total = venta.total as number;
  const neto = (venta.factura_neto as number) ?? total;
  const iva = (venta.factura_iva as number) ?? 0;

  // Las facturas emitidas antes de que se guardara el documento del receptor
  // fueron todas a consumidor final: es el único caso que existía.
  const tipoDoc = (venta.factura_doc_tipo as number) ?? TIPO_DOC.CONSUMIDOR_FINAL;
  const nroDoc = (venta.factura_doc_nro as string) ?? "0";
  const hayDocumento = tipoDoc !== TIPO_DOC.CONSUMIDOR_FINAL && nroDoc !== "0";

  const nombreReceptor =
    [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ") || (esFacturaA ? "—" : "Consumidor Final");

  // En Factura A el detalle va neto (el IVA se discrimina abajo); en B los
  // precios se muestran tal como los pagó el cliente, con IVA incluido.
  const factorNeto = esFacturaA && total > 0 ? neto / total : 1;

  const lineas = (detalle ?? []).map((d) => ({
    nombre: nombreDe(d.id_variante as string),
    cantidad: d.cantidad as number,
    precioUnitario: (d.precio_unitario as number) * factorNeto,
    subtotal: (d.subtotal as number) * factorNeto,
  }));

  const sumaLineas = lineas.reduce((acc, l) => acc + l.subtotal, 0);
  const baseComparacion = esFacturaA ? neto : total;
  const descuento = Math.max(sumaLineas - baseComparacion, 0);

  const qr = await urlQrArca(
    {
      cae: venta.cae as string,
      vencimientoCae: (venta.cae_vencimiento as string) ?? "",
      numeroComprobante: venta.factura_numero as number,
      tipoComprobante,
      puntoVenta: venta.factura_punto_venta as number,
      neto,
      iva,
      total,
      fecha: ((venta.factura_fecha as string) ?? "").replace(/-/g, ""),
    },
    tipoDoc,
    nroDoc
  );
  const qrImagen = await QRCode.toDataURL(qr, { margin: 1, width: 240 });

  return (
    <div className="factura-pagina">
      <style>{`
        .factura-pagina { background: #f5f5f5; padding: 20px 12px 40px; }
        .factura-barra {
          max-width: 800px; margin: 0 auto 16px; display: flex;
          align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
        }
        .factura-hoja {
          max-width: 800px; margin: 0 auto; background: #fff; color: #111;
          border: 1px solid #ddd; padding: 24px 28px;
          font-family: Arial, Helvetica, sans-serif; font-size: 12.5px; line-height: 1.4;
        }
        .factura-encabezado {
          display: grid; grid-template-columns: 1fr 74px 1fr; align-items: stretch;
          border: 1px solid #111; position: relative;
        }
        .factura-lado { padding: 14px 16px 18px; }
        .factura-letra {
          border-left: 1px solid #111; border-right: 1px solid #111;
          display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
          padding-top: 8px;
        }
        .factura-letra b { font-size: 40px; line-height: 1; }
        .factura-letra span { font-size: 9px; color: #444; margin-top: 2px; }
        .factura-razon { font-size: 17px; font-weight: 700; }
        .factura-fantasia { font-size: 12px; color: #555; margin-bottom: 8px; }
        .factura-tipo { font-size: 17px; font-weight: 700; letter-spacing: .04em; }
        .factura-dato { display: block; font-size: 11.5px; }
        .factura-dato b { font-weight: 700; }
        .factura-receptor {
          border: 1px solid #111; border-top: 0; padding: 12px 16px;
          display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px;
        }
        table.factura-items { width: 100%; border-collapse: collapse; margin-top: 14px; }
        table.factura-items th {
          text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
          color: #fff; background: #444; padding: 6px 8px; font-weight: 600;
        }
        table.factura-items th.num, table.factura-items td.num { text-align: right; }
        table.factura-items td { padding: 6px 8px; border-bottom: 1px solid #eee; }
        .factura-totales { display: flex; justify-content: flex-end; margin-top: 10px; }
        .factura-totales dl { width: 300px; margin: 0; }
        .factura-fila { display: flex; justify-content: space-between; padding: 3px 0; }
        .factura-fila.total {
          border-top: 2px solid #111; margin-top: 6px; padding-top: 8px;
          font-size: 16px; font-weight: 700;
        }
        .factura-pie {
          display: flex; align-items: flex-end; gap: 20px; margin-top: 26px;
          border-top: 1px solid #ccc; padding-top: 14px;
        }
        .factura-pie img { width: 110px; height: 110px; }
        .factura-cae { margin-left: auto; text-align: right; }
        .factura-cae b { font-size: 15px; letter-spacing: .02em; }
        .factura-nota { font-size: 10.5px; color: #666; margin-top: 16px; }
        .factura-aviso {
          max-width: 800px; margin: 0 auto 16px; background: #ecfdf5; border: 1px solid #a7f3d0;
          border-radius: 8px; padding: 12px 14px; font-size: 12.5px; color: #065f46;
        }
        @media print {
          /* El menú de la app no va en la hoja (mismo criterio que el
             comprobante de liquidación). */
          header, .no-imprimir { display: none !important; }
          main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
          body { background: #fff !important; }
          .factura-pagina { background: #fff; padding: 0; }
          .factura-barra, .factura-aviso { display: none !important; }
          .factura-hoja { border: 0; margin: 0; max-width: none; padding: 12mm 12mm; }
          table.factura-items th { background: #444 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="factura-barra">
        <BotonImprimirRecibo />
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
          Comprobante autorizado por ARCA. Se puede imprimir o guardar en PDF para mandárselo al cliente.
        </p>
      </div>

      <div className="factura-aviso">
        <b>Factura válida.</b> Autorizada por ARCA el {fechaCorta(venta.factura_fecha as string)} con CAE{" "}
        {venta.cae as string}. El cliente puede verificarla escaneando el QR.
      </div>

      <div className="factura-hoja">
        <div className="factura-encabezado">
          <div className="factura-lado">
            <p className="factura-razon">{emisor.razonSocial}</p>
            {emisor.nombreFantasia && <p className="factura-fantasia">{emisor.nombreFantasia}</p>}
            <span className="factura-dato">
              <b>Domicilio comercial:</b> {emisor.domicilioComercial}
            </span>
            <span className="factura-dato">
              <b>Condición frente al IVA:</b> {emisor.condicionIva}
            </span>
          </div>

          <div className="factura-letra">
            <b>{LETRA[tipoComprobante] ?? "B"}</b>
            <span>COD. {CODIGO[tipoComprobante] ?? "06"}</span>
          </div>

          <div className="factura-lado">
            <p className="factura-tipo">FACTURA</p>
            <span className="factura-dato">
              <b>Punto de Venta:</b> {String(venta.factura_punto_venta ?? 0).padStart(5, "0")} &nbsp;{" "}
              <b>Comp. Nro:</b> {String(venta.factura_numero ?? 0).padStart(8, "0")}
            </span>
            <span className="factura-dato">
              <b>Fecha de Emisión:</b> {fechaCorta(venta.factura_fecha as string)}
            </span>
            <span className="factura-dato">
              <b>CUIT:</b> {emisor.cuit}
            </span>
            <span className="factura-dato">
              <b>Ingresos Brutos:</b> {emisor.ingresosBrutos}
            </span>
            <span className="factura-dato">
              <b>Inicio de actividades:</b> {emisor.inicioActividades}
            </span>
          </div>
        </div>

        <div className="factura-receptor">
          <span className="factura-dato">
            <b>{ETIQUETA_DOC[tipoDoc] ?? "DNI"}:</b> {hayDocumento ? nroDoc : cliente?.dni || "—"}
          </span>
          <span className="factura-dato">
            <b>Apellido y Nombre / Razón Social:</b> {nombreReceptor}
          </span>
          <span className="factura-dato">
            <b>Condición frente al IVA:</b> {esFacturaA ? "Responsable Inscripto" : "Consumidor Final"}
          </span>
          <span className="factura-dato">
            <b>Condición de venta:</b> Contado
          </span>
        </div>

        <table className="factura-items">
          <thead>
            <tr>
              <th>Descripción</th>
              <th className="num">Cant.</th>
              <th className="num">Precio Unit.</th>
              <th className="num">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>{l.nombre}</td>
                <td className="num">{l.cantidad}</td>
                <td className="num">${monto(l.precioUnitario)}</td>
                <td className="num">${monto(l.subtotal)}</td>
              </tr>
            ))}
            {descuento > 0 && (
              <tr>
                <td>Descuento</td>
                <td className="num">1</td>
                <td className="num">-${monto(descuento)}</td>
                <td className="num">-${monto(descuento)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="factura-totales">
          <dl>
            {/* En Factura B el IVA no se discrimina: la ley solo permite
                mostrar el importe final. En A sí va desagregado. */}
            {esFacturaA ? (
              <>
                <div className="factura-fila">
                  <span>Importe Neto Gravado</span>
                  <span>${monto(neto)}</span>
                </div>
                <div className="factura-fila">
                  <span>IVA</span>
                  <span>${monto(iva)}</span>
                </div>
              </>
            ) : (
              <div className="factura-fila">
                <span>Subtotal</span>
                <span>${monto(total)}</span>
              </div>
            )}
            <div className="factura-fila">
              <span>Otros Tributos</span>
              <span>$0,00</span>
            </div>
            <div className="factura-fila total">
              <span>Importe Total</span>
              <span>${monto(total)}</span>
            </div>
          </dl>
        </div>

        <div className="factura-pie">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrImagen} alt="Código QR de verificación de ARCA" />
          <div className="factura-cae">
            <span className="factura-dato">
              <b>CAE N°:</b>
            </span>
            <b>{venta.cae as string}</b>
            <span className="factura-dato" style={{ marginTop: 6 }}>
              <b>Fecha de Vto. de CAE:</b> {fechaCorta(venta.cae_vencimiento as string)}
            </span>
          </div>
        </div>

        <p className="factura-nota">
          Comprobante autorizado electrónicamente por ARCA. Venta {`VTA-${String(venta.numero).padStart(4, "0")}`}.
        </p>
      </div>
    </div>
  );
}
