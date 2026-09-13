"use client";

import { useMemo, useState, useTransition } from "react";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { costearEntrega } from "@/app/(app)/proveedores/actions";
import type { EntregaHistorial, LineaEntrega } from "@/lib/comprasDatos";

// Costear una entrega.
//
// Dos formas de comprar, una sola pantalla:
//
// - Alifrut (LIQUIDACION_VENTA): solo costo + IVA. No nace deuda.
// - Coca-Cola (REMITO / PERIODO): además la factura, que sí genera deuda.
//
// El bloque de "qué entregas cubre" existe porque una factura no siempre
// corresponde a una sola entrega. El proveedor puede facturar el pedido
// entero el viernes y entregar en dos veces — una deuda, dos entregas. El
// sistema no puede adivinarlo: lo elige quien tiene la factura adelante.

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCorta(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sumarDias(iso: string, dias: number) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CostosRecepcionModal({
  entrega,
  lineas,
  entregasDelPedido,
  proveedor,
  nombrePorVariante,
  costoActualPorVariante,
  ivaActualPorVariante,
  onClose,
}: {
  entrega: EntregaHistorial;
  /** Lo que llegó en ESTA entrega. */
  lineas: LineaEntrega[];
  /** Todas las entregas del mismo pedido, para elegir cuáles cubre la factura. */
  entregasDelPedido: EntregaHistorial[];
  proveedor: ProveedorConSaldo | undefined;
  nombrePorVariante: Map<string, string>;
  costoActualPorVariante: Map<string, number | null>;
  /** Alícuota que ya tiene cargada cada producto. En alimentos no todo es 21%. */
  ivaActualPorVariante: Map<string, number>;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Alifrut no factura por entrega: su factura llega a fin de mes contra la
  // liquidación. Para él, todo el bloque de factura sobra.
  const pideFactura = proveedor?.modo_facturacion !== "LIQUIDACION_VENTA";

  const [costos, setCostos] = useState<Record<string, string>>(
    Object.fromEntries(lineas.map((l) => [l.idVariante, String(costoActualPorVariante.get(l.idVariante) ?? "")]))
  );
  const [alicuotas, setAlicuotas] = useState<Record<string, number>>(
    Object.fromEntries(lineas.map((l) => [l.idVariante, ivaActualPorVariante.get(l.idVariante) ?? 21]))
  );
  const [comprobante, setComprobante] = useState<File | null>(null);

  // --- Factura ---
  const [numero, setNumero] = useState("");
  const [tipoComprobante, setTipoComprobante] = useState("A");
  const [fechaEmision, setFechaEmision] = useState(hoyISO());
  const [montoFactura, setMontoFactura] = useState("");
  const [unidadesFactura, setUnidadesFactura] = useState("");
  const [discrepancia, setDiscrepancia] = useState(false);
  const [motivoDiscrepancia, setMotivoDiscrepancia] = useState("");

  // Las otras entregas del mismo pedido que todavía no se facturaron.
  const otras = useMemo(
    () => entregasDelPedido.filter((e) => e.idRecepcion !== entrega.idRecepcion && !e.facturada),
    [entregasDelPedido, entrega.idRecepcion]
  );

  // Vienen tildadas las anteriores a la fecha de la factura: una factura no
  // puede cubrir mercadería que entró después de emitirse. Es una sugerencia,
  // no una regla — se destilda.
  const [cubiertas, setCubiertas] = useState<Record<string, boolean>>({});
  const sugeridas = useMemo(() => {
    const map: Record<string, boolean> = {};
    otras.forEach((e) => {
      map[e.idRecepcion] = e.fechaRecibida.slice(0, 10) <= fechaEmision;
    });
    return map;
  }, [otras, fechaEmision]);
  const estaCubierta = (id: string) => cubiertas[id] ?? sugeridas[id] ?? false;

  const vencimiento = proveedor?.condicion_pago_dias
    ? sumarDias(fechaEmision, proveedor.condicion_pago_dias)
    : null;

  const totales = lineas.reduce(
    (acc, l) => {
      const neto = (Number(costos[l.idVariante]) || 0) * l.cantidadRecibida;
      const iva = neto * ((alicuotas[l.idVariante] ?? 21) / 100);
      return { neto: acc.neto + neto, iva: acc.iva + iva };
    },
    { neto: 0, iva: 0 }
  );
  const totalEntrega = totales.neto + totales.iva;

  // Control de que cuadre: unidades cubiertas contra las que dice la factura.
  const unidadesCubiertas =
    lineas.reduce((a, l) => a + l.cantidadRecibida, 0) +
    otras.filter((e) => estaCubierta(e.idRecepcion)).reduce((a, e) => a + e.unidades, 0);
  const unidadesDeclaradas = Number(unidadesFactura) || 0;
  const cuadranUnidades = unidadesDeclaradas > 0 && unidadesDeclaradas === unidadesCubiertas;
  const hayDeclaracion = unidadesDeclaradas > 0;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await costearEntrega({
          idRecepcion: entrega.idRecepcion,
          costos: lineas.map((l) => ({
            idVariante: l.idVariante,
            costo: Number(costos[l.idVariante]) || 0,
            iva: alicuotas[l.idVariante] ?? 21,
          })),
          factura: pideFactura
            ? {
                numero,
                tipoComprobante,
                fechaEmision,
                fechaVencimiento: vencimiento,
                monto: Number(montoFactura) || 0,
                iva: totales.iva > 0 ? totales.iva : null,
                idsRecepcionCubiertas: otras.filter((e) => estaCubierta(e.idRecepcion)).map((e) => e.idRecepcion),
                unidadesFacturadas: unidadesDeclaradas || null,
                discrepancia,
                motivoDiscrepancia,
              }
            : null,
          comprobante,
        });
        if (res.error) setError(res.error);
        else onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  const etiquetaEntrega =
    entrega.totalEntregas === 1 ? "entrega única" : `${entrega.numeroEntrega}ª de ${entrega.totalEntregas} entregas`;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">WiiGo</p>
            <h2 className="text-xl font-semibold text-neutral-900">Costear entrega</h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {proveedor?.nombre ?? "—"} · Pedido #{entrega.idOrden.slice(0, 8).toUpperCase()} ·{" "}
              <b className="text-neutral-500">{etiquetaEntrega}</b>, del {fechaCorta(entrega.fechaRecibida)}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="divide-y divide-neutral-100">
          {/* ---------- 1. La factura ---------- */}
          {pideFactura && (
            <Bloque n={1} titulo="La factura">
              <div className="grid gap-3 sm:grid-cols-4">
                <Campo etiqueta="Nº de factura" obligatorio>
                  <input
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    placeholder="A-0003-00004521"
                    className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </Campo>
                <Campo etiqueta="Tipo">
                  <select
                    value={tipoComprobante}
                    onChange={(e) => setTipoComprobante(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="A">Factura A</option>
                    <option value="B">Factura B</option>
                    <option value="C">Factura C</option>
                    <option value="REMITO">Remito</option>
                  </select>
                </Campo>
                <Campo etiqueta="Fecha de la factura" obligatorio>
                  <input
                    type="date"
                    value={fechaEmision}
                    onChange={(e) => setFechaEmision(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </Campo>
                <Campo etiqueta="Total de la factura" obligatorio>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={montoFactura}
                    onChange={(e) => setMontoFactura(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </Campo>
              </div>
              <p className="text-xs text-neutral-400 mt-2.5">
                La fecha de la factura no es la del pedido: manda el período de IVA y desde ahí corre el plazo de
                pago.{" "}
                {vencimiento ? (
                  <>
                    Vence el <b className="text-neutral-600">{fechaCorta(vencimiento)}</b> ·{" "}
                    {proveedor?.condicion_pago_dias} días.
                  </>
                ) : (
                  <>Este proveedor no tiene plazo de pago cargado en su ficha.</>
                )}
              </p>
            </Bloque>
          )}

          {/* ---------- 2. Los costos ---------- */}
          <Bloque n={pideFactura ? 2 : 1} titulo="Los costos de esta entrega">
            <div className="border border-neutral-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[620px]">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="p-3">Producto</th>
                    <th className="p-3 text-right">Recibido</th>
                    <th className="p-3 text-right">Costo anterior</th>
                    <th className="p-3 text-right">Costo neto</th>
                    <th className="p-3">IVA</th>
                    <th className="p-3 text-right">Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => {
                    const costoAnterior = costoActualPorVariante.get(l.idVariante) ?? null;
                    const costoNuevo = Number(costos[l.idVariante]) || 0;
                    const puedeComparar = costoAnterior != null && costoAnterior > 0 && costoNuevo > 0;
                    const pct = puedeComparar ? ((costoNuevo - costoAnterior) / costoAnterior) * 100 : null;
                    return (
                      <tr key={l.idVariante} className="border-b border-neutral-100 last:border-0">
                        <td className="p-3 text-neutral-900">{nombrePorVariante.get(l.idVariante) ?? "—"}</td>
                        <td className="p-3 text-right text-neutral-500 tabular-nums">{l.cantidadRecibida}</td>
                        <td className="p-3 text-right text-neutral-400 tabular-nums">
                          {costoAnterior != null ? `$${formatearMonto(costoAnterior)}` : "—"}
                        </td>
                        <td className="p-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={costos[l.idVariante] ?? ""}
                            onChange={(e) => setCostos((prev) => ({ ...prev, [l.idVariante]: e.target.value }))}
                            className="w-24 rounded-lg border border-accent px-2 py-1.5 text-sm text-right tabular-nums font-semibold focus:outline-none focus:ring-2 focus:ring-accent"
                          />
                        </td>
                        <td className="p-2">
                          {/* Por producto y no una sola para todo el pedido: en
                              alimentos conviven el 21% y el 10,5%, y con la
                              alícuota mal puesta el crédito fiscal sale mal. */}
                          <select
                            value={alicuotas[l.idVariante] ?? 21}
                            onChange={(e) =>
                              setAlicuotas((prev) => ({ ...prev, [l.idVariante]: Number(e.target.value) }))
                            }
                            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                          >
                            <option value={21}>21%</option>
                            <option value={10.5}>10,5%</option>
                            <option value={0}>Exento</option>
                          </select>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {pct == null || Math.abs(pct) < 0.05 ? (
                            <span className="text-xs text-neutral-400">sin cambios</span>
                          ) : pct > 0 ? (
                            <span className="text-xs font-semibold text-red-600">▲ +{pct.toFixed(1)}%</span>
                          ) : (
                            <span className="text-xs font-semibold text-emerald-600">▼ {pct.toFixed(1)}%</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-neutral-50 border-t border-neutral-200 text-sm font-semibold tabular-nums">
                    <td className="p-3 text-xs text-neutral-500 uppercase" colSpan={3}>
                      Neto ${formatearMonto(totales.neto)} · IVA ${formatearMonto(totales.iva)}
                    </td>
                    <td className="p-3 text-right text-neutral-900" colSpan={3}>
                      ${formatearMonto(totalEntrega)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-neutral-400 mt-2.5">
              El costo va <b className="text-neutral-600">sin IVA</b>. Cada entrega guarda el suyo: si el mismo
              producto entró dos veces a precios distintos, el sistema no los promedia — los gasta del más viejo al
              más nuevo.
            </p>
          </Bloque>

          {/* ---------- 3. Qué entregas cubre ---------- */}
          {pideFactura && otras.length > 0 && (
            <Bloque n={3} titulo="Qué entregas cubre esta factura">
              <div className="flex flex-col gap-2">
                <EntregaFija
                  titulo={`${entrega.numeroEntrega}ª entrega · ${fechaCorta(entrega.fechaRecibida)}`}
                  detalle="la que estás costeando"
                  unidades={lineas.reduce((a, l) => a + l.cantidadRecibida, 0)}
                />
                {otras.map((e) => {
                  const on = estaCubierta(e.idRecepcion);
                  return (
                    <button
                      key={e.idRecepcion}
                      type="button"
                      onClick={() => setCubiertas((prev) => ({ ...prev, [e.idRecepcion]: !on }))}
                      className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left ${
                        on ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white hover:bg-neutral-50"
                      }`}
                    >
                      <span
                        className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center text-[11px] font-bold shrink-0 ${
                          on ? "bg-accent border-accent text-white" : "border-neutral-300 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-neutral-900">
                          {e.numeroEntrega}ª entrega · {fechaCorta(e.fechaRecibida)}
                        </span>
                        <span className="block text-xs text-neutral-400">
                          {on ? "la cubre esta factura" : "va en otra factura"}
                        </span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-neutral-700">{e.unidades} un.</span>
                    </button>
                  );
                })}
              </div>

              {hayDeclaracion && (
                <div
                  className={`flex items-center gap-3 flex-wrap rounded-lg px-3.5 py-2.5 mt-3 text-sm tabular-nums ${
                    cuadranUnidades
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  <span>
                    La factura dice <b>{unidadesDeclaradas} unidades</b> · estás cubriendo{" "}
                    <b>{unidadesCubiertas}</b>
                  </span>
                  <span className="flex-1" />
                  <b>
                    {cuadranUnidades
                      ? "✓ Cuadra"
                      : unidadesDeclaradas > unidadesCubiertas
                        ? `✕ Sobran ${unidadesDeclaradas - unidadesCubiertas} facturadas`
                        : `✕ Faltan ${unidadesCubiertas - unidadesDeclaradas} en la factura`}
                  </b>
                </div>
              )}

              <div className="mt-3">
                <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
                  Unidades que dice la factura (opcional)
                </label>
                <input
                  type="number"
                  min={0}
                  value={unidadesFactura}
                  onChange={(e) => setUnidadesFactura(e.target.value)}
                  placeholder="para controlar que cuadre"
                  className="w-56 rounded-lg border border-neutral-300 px-2.5 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <p className="text-xs text-neutral-400 mt-2.5">
                Vienen tildadas las entregas anteriores a la fecha de la factura. Si el proveedor mandó una factura
                por entrega, destildalas.{" "}
                <b className="text-neutral-600">Si el número de factura ya está cargado, no se genera deuda nueva</b> —
                esta entrega se suma a la que ya existe.
              </p>
            </Bloque>
          )}

          {/* ---------- 4. Cierre ---------- */}
          <Bloque n={pideFactura ? 4 : 2} titulo="Cierre">
            {pideFactura && (
              <>
                <label className="flex items-start gap-2.5 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={discrepancia}
                    onChange={(e) => setDiscrepancia(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-amber-600"
                  />
                  <span className="text-sm">
                    <b className="text-neutral-900">El proveedor facturó algo mal</b>
                    <span className="block text-xs text-neutral-500">
                      Mandó de más, de menos, o se equivocó en un precio. Se guarda igual, con la diferencia anotada
                      para pedir la nota de crédito.
                    </span>
                  </span>
                </label>
                {discrepancia && (
                  <textarea
                    value={motivoDiscrepancia}
                    onChange={(e) => setMotivoDiscrepancia(e.target.value)}
                    rows={2}
                    placeholder="Ej: facturaron 24 aguas que nunca entraron."
                    className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                )}
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
                Foto del remito o la factura (opcional)
              </label>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
                className="w-full text-sm"
              />
            </div>

            {!pideFactura && (
              <p className="text-xs text-neutral-400 mt-3">
                A {proveedor?.nombre ?? "este proveedor"} se le paga por lo que se venda, no por esta entrega, así
                que esto <b className="text-neutral-600">no genera deuda</b>. Su factura llega a fin de mes contra la
                liquidación.
              </p>
            )}

            {error && (
              <p className="text-sm text-red-600 mt-3" role="alert">
                {error}
              </p>
            )}

            <div className="flex gap-2 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isPending}
                className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
              >
                {isPending ? "Guardando..." : "Guardar costeo"}
              </button>
            </div>
          </Bloque>
        </div>
      </div>
    </div>
  );
}

function Bloque({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <div className="px-6 py-5">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 mb-3 flex items-center gap-2">
        <span className="w-[18px] h-[18px] rounded-[5px] bg-accent-tint text-accent flex items-center justify-center text-[10.5px]">
          {n}
        </span>
        {titulo}
      </p>
      {children}
    </div>
  );
}

function Campo({
  etiqueta,
  obligatorio,
  children,
}: {
  etiqueta: string;
  obligatorio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-neutral-500 mb-1">
        {etiqueta} {obligatorio && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

/** La entrega que se está costeando: siempre va, no se puede destildar. */
function EntregaFija({ titulo, detalle, unidades }: { titulo: string; detalle: string; unidades: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-accent bg-accent-tint px-3.5 py-2.5">
      <span className="w-[18px] h-[18px] rounded-[5px] bg-accent border border-accent text-white flex items-center justify-center text-[11px] font-bold shrink-0">
        ✓
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-neutral-900">{titulo}</span>
        <span className="block text-xs text-neutral-400">{detalle}</span>
      </span>
      <span className="text-sm font-semibold tabular-nums text-neutral-700">{unidades} un.</span>
    </div>
  );
}
