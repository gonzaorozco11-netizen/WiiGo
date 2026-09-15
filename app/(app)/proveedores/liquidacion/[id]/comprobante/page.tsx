import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { comprobanteLiquidacionProveedor } from "@/lib/liquidacionesProveedor";
import { EMISOR } from "@/lib/emisor";
import BotonImprimirRecibo from "@/components/BotonImprimirRecibo";

// El detalle de una liquidación ya cerrada, en papel.
//
// No recalcula: lee lo que quedó guardado al confirmar. Si un costo se
// corrigió después, este papel sigue diciendo lo que se liquidó ese día — que
// es justamente para lo que sirve un comprobante.
export const dynamic = "force-dynamic";

const MOTIVO_LABEL: Record<string, string> = {
  ROTURA: "Rotura",
  VENCIMIENTO: "Vencimiento",
  ROBO: "Robo",
  OTRO: "Otro",
};

function monto(v: number) {
  return v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCorta(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function fechaLarga(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

export default async function ComprobanteLiquidacionProveedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "proveedores")) return <PantallaBloqueada />;

  const { id } = await params;
  const c = await comprobanteLiquidacionProveedor(getSupabaseServerClient(), id);
  if (!c) notFound();

  const unidadesVendidas = c.vendidas.reduce((a, l) => a + l.cantidad, 0);
  const unidadesMerma = c.mermas.reduce((a, m) => a + m.cantidad, 0);
  // El IVA es la diferencia entre lo que se liquida y el neto: se guarda el
  // total, así que no se vuelve a calcular con una alícuota que podría no ser
  // la que se usó.
  const neto = c.netoVendido + c.netoMerma;
  const iva = Math.max(0, Math.round((c.montoFinal - neto) * 100) / 100);

  return (
    <div className="liq-pagina">
      <style>{`
        .liq-pagina { background: #f5f6f8; padding: 20px 16px 60px; min-height: 100vh; }
        .liq-barra {
          max-width: 800px; margin: 0 auto 16px; display: flex;
          align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
        }
        .liq-hoja {
          max-width: 800px; margin: 0 auto; background: #fff; color: #16191f;
          border: 1px solid #ddd; padding: 32px 34px;
          font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.5;
        }
        .liq-top {
          display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap;
          padding-bottom: 16px; border-bottom: 2px solid #16191f;
        }
        .liq-logo { height: 40px; width: auto; display: block; }
        .liq-razon { font-size: 12px; color: #6b7488; margin-top: 8px; }
        .liq-fiscal { font-size: 11.5px; color: #6b7488; margin-top: 4px; }
        .liq-doc { text-align: right; }
        .liq-tipo { font-size: 12.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
        .liq-nro { font-family: ui-monospace, Consolas, monospace; font-size: 18px; font-weight: 700; }
        .liq-per { font-size: 11.5px; color: #6b7488; margin-top: 4px; }

        .liq-partes { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 18px 0 4px; }
        .liq-et {
          font-size: 9.5px; font-weight: 700; letter-spacing: .1em;
          text-transform: uppercase; color: #6b7488; margin-bottom: 4px;
        }
        .liq-nom { font-weight: 700; font-size: 15px; }
        .liq-det { font-size: 12px; color: #6b7488; margin-top: 1px; }

        .liq-seccion {
          font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
          margin: 22px 0 7px; padding-bottom: 5px; border-bottom: 1px solid #d8dde6;
        }
        .liq-seccion.merma { color: #a4620a; border-bottom-color: #ebd4a8; }

        .liq-hoja table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .liq-hoja th {
          text-align: left; font-size: 9.5px; font-weight: 700; letter-spacing: .08em;
          text-transform: uppercase; color: #6b7488;
          padding: 6px 8px; border-bottom: 1px solid #d8dde6;
        }
        .liq-hoja td { padding: 7px 8px; border-bottom: 1px solid #eef1f5; }
        .liq-hoja td.num, .liq-hoja th.num { text-align: right; }
        .liq-hoja td.lote { font-size: 11px; color: #6b7488; }
        .liq-hoja tr.sub td {
          border-bottom: 0; border-top: 1px solid #d8dde6; font-weight: 700; padding-top: 8px;
        }

        .liq-totales { margin-top: 18px; padding-top: 12px; border-top: 2px solid #16191f; }
        .liq-r { display: flex; justify-content: space-between; gap: 16px; padding: 2px 0; }
        .liq-r .lbl { color: #6b7488; }
        .liq-r.grande {
          font-size: 17px; font-weight: 700; margin-top: 7px; padding-top: 9px;
          border-top: 1px solid #d8dde6;
        }
        .liq-r.grande .lbl { color: #16191f; }

        .liq-nota {
          margin-top: 16px; padding: 10px 12px; border-radius: 6px;
          font-size: 11.5px; border: 1px solid #d8dde6; background: #f8f9fb; color: #6b7488;
        }
        .liq-nota.falta { background: #fdf6e9; border-color: #ebd4a8; color: #a4620a; }
        .liq-pie {
          margin-top: 20px; padding-top: 12px; border-top: 1px solid #d8dde6;
          font-size: 10.5px; color: #6b7488; line-height: 1.5;
          display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
        }
        @media print {
          .liq-pagina { background: #fff; padding: 0; }
          .liq-barra { display: none !important; }
          .liq-hoja { border: 0; margin: 0; max-width: none; padding: 16mm 14mm; }
        }
      `}</style>

      <div className="liq-barra">
        <BotonImprimirRecibo />
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
          Es el respaldo de cómo se llegó al monto. La factura la emite el proveedor contra esto.
        </p>
      </div>

      <div className="liq-hoja">
        <div className="liq-top">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/wiigo-logo.png" alt="WiiGo" className="liq-logo" />
            <div className="liq-razon">{EMISOR.razonSocial}</div>
            <div className="liq-fiscal">
              CUIT {EMISOR.cuit} · {EMISOR.condicionIva}
            </div>
          </div>
          <div className="liq-doc">
            <div className="liq-tipo">Liquidación</div>
            <div className="liq-nro">#{c.idLiquidacion.slice(0, 7).toUpperCase()}</div>
            <div className="liq-per">
              Del {fechaCorta(c.fechaDesde)} al {fechaCorta(c.fechaHasta)} de{" "}
              {new Date(c.fechaHasta).getFullYear()}
            </div>
          </div>
        </div>

        <div className="liq-partes">
          <div>
            <div className="liq-et">Proveedor</div>
            <div className="liq-nom">{c.proveedor.nombre}</div>
            {c.proveedor.cuit && <div className="liq-det">CUIT {c.proveedor.cuit}</div>}
            <div className="liq-det">Liquidación por venta</div>
          </div>
          <div>
            <div className="liq-et">Generada</div>
            <div className="liq-nom">{fechaLarga(c.fecha)}</div>
            {c.usuario && <div className="liq-det">Por {c.usuario}</div>}
          </div>
        </div>

        <div className="liq-seccion">Mercadería vendida</div>
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Lote</th>
              <th className="num">Un.</th>
              <th className="num">Costo c/u</th>
              <th className="num">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {c.vendidas.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: "#6b7488" }}>
                  No hubo ventas en el período.
                </td>
              </tr>
            ) : (
              c.vendidas.map((l, i) => (
                <tr key={i}>
                  <td>{l.producto}</td>
                  <td className="lote">
                    {l.fechaRecepcion ? `Recibido ${fechaCorta(l.fechaRecepcion)}` : "Costo estimado"}
                  </td>
                  <td className="num">{l.cantidad}</td>
                  <td className="num">${monto(l.costoUnitario)}</td>
                  <td className="num">${monto(l.subtotal)}</td>
                </tr>
              ))
            )}
            <tr className="sub">
              <td colSpan={2}>Subtotal vendido</td>
              <td className="num">{unidadesVendidas - unidadesMerma}</td>
              <td />
              <td className="num">${monto(c.netoVendido)}</td>
            </tr>
          </tbody>
        </table>

        {c.mermas.length > 0 && (
          <>
            <div className="liq-seccion merma">Merma · mercadería que no se vendió</div>
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Motivo</th>
                  <th className="num">Un.</th>
                  <th className="num">Costo c/u</th>
                  <th className="num">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {c.mermas.map((m, i) => (
                  <tr key={i}>
                    <td>{m.producto}</td>
                    <td className="lote">
                      {MOTIVO_LABEL[m.motivo] ?? m.motivo} · {fechaCorta(m.fecha)}
                    </td>
                    <td className="num">{m.cantidad}</td>
                    <td className="num">${monto(m.costoUnitario)}</td>
                    <td className="num">${monto(m.subtotal)}</td>
                  </tr>
                ))}
                <tr className="sub">
                  <td colSpan={2}>Subtotal merma</td>
                  <td className="num">{unidadesMerma}</td>
                  <td />
                  <td className="num">${monto(c.netoMerma)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        <div className="liq-totales">
          <div className="liq-r">
            <span className="lbl">Neto vendido</span>
            <span>${monto(c.netoVendido)}</span>
          </div>
          {c.netoMerma > 0 && (
            <div className="liq-r">
              <span className="lbl">Neto merma</span>
              <span>${monto(c.netoMerma)}</span>
            </div>
          )}
          <div className="liq-r">
            <span className="lbl">IVA</span>
            <span>${monto(iva)}</span>
          </div>
          <div className="liq-r grande">
            <span className="lbl">Total a liquidar</span>
            <span>${monto(c.montoFinal)}</span>
          </div>
        </div>

        {c.facturaNumero ? (
          <div className="liq-nota">
            <b>Facturado con #{c.facturaNumero}.</b>
            {c.facturaIva != null && ` El IVA de $${monto(c.facturaIva)} ya entró como crédito fiscal.`}
          </div>
        ) : (
          <div className="liq-nota falta">
            <b>Pendiente de facturar.</b> {c.proveedor.nombre} tiene que emitir una factura por este monto.
            Hasta entonces el IVA de ${monto(iva)} no entra como crédito fiscal.
          </div>
        )}

        <div className="liq-pie">
          <span>
            Este documento es el detalle de la liquidación del período. <b>No es una factura.</b>
            <br />
            El costo de cada unidad sale del remito con el que entró, del más viejo al más nuevo.
          </span>
          <span style={{ textAlign: "right" }}>
            WiiGo · {fechaLarga(c.fecha)}
            {c.usuario && (
              <>
                <br />
                {c.usuario}
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
