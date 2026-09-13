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
  todasLasLineas,
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
  /** Las de todas las entregas del pedido, para poder sumar lo que ya se costeó. */
  todasLasLineas: LineaEntrega[];
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

  // Con factura arranca vacío a propósito: el costo guardado ya tiene los
  // impuestos adentro, así que prellenarlo haría que al corregir se vuelvan a
  // sumar sobre un número que ya los tenía. Con factura se copia del papel.
  const [costos, setCostos] = useState<Record<string, string>>(
    Object.fromEntries(
      lineas.map((l) => [
        l.idVariante,
        pideFactura ? "" : String(costoActualPorVariante.get(l.idVariante) ?? ""),
      ])
    )
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

  // El pie: lo que está en la factura pero no en ningún renglón.
  const [impuestos, setImpuestos] = useState("");
  const [retenciones, setRetenciones] = useState("");
  const [descuentos, setDescuentos] = useState("");
  /** null = todavía lo calcula el sistema. Un número = lo pisó una persona. */
  const [ivaManual, setIvaManual] = useState<string | null>(null);

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

  // ---------- El pie ----------
  const nImpuestos = Number(impuestos) || 0;
  const nRetenciones = Number(retenciones) || 0;
  const nDescuentos = Number(descuentos) || 0;
  // El IVA sale de la alícuota de cada producto — no de una sola tasa al pie,
  // porque en la góndola conviven el 21% y el 10,5%. Se puede pisar a mano si
  // la factura lo discrimina distinto.
  const ivaCalculado = totales.iva;
  const ivaFinal = ivaManual !== null ? Number(ivaManual) || 0 : ivaCalculado;

  // Impuestos y retenciones encarecen la mercadería; los descuentos la
  // abaratan. El IVA no entra: vuelve como crédito fiscal.
  const subtotalSinIva = totales.neto + nImpuestos + nRetenciones - nDescuentos;
  const totalEntrega = subtotalSinIva + ivaFinal;

  // Lo que realmente cuesta cada unidad, con el pie repartido proporcional al
  // valor de cada línea. Es el número que se guarda y con el que se calcula
  // el margen.
  const factor = totales.neto > 0 ? subtotalSinIva / totales.neto : 1;
  const hayPie = nImpuestos !== 0 || nRetenciones !== 0 || nDescuentos !== 0;

  // Control de que cuadre: unidades cubiertas contra las que dice la factura.
  const unidadesCubiertas =
    lineas.reduce((a, l) => a + l.cantidadRecibida, 0) +
    otras.filter((e) => estaCubierta(e.idRecepcion)).reduce((a, e) => a + e.unidades, 0);
  const unidadesDeclaradas = Number(unidadesFactura) || 0;
  const cuadranUnidades = unidadesDeclaradas > 0 && unidadesDeclaradas === unidadesCubiertas;
  const hayDeclaracion = unidadesDeclaradas > 0;

  // Lo que aportan las OTRAS entregas cubiertas, con el costo que ya tienen
  // cargado. Si alguna todavía no se costeó, suma 0 y el aviso lo dice.
  const otrasCubiertas = otras.filter((e) => estaCubierta(e.idRecepcion));
  const totalOtras = otrasCubiertas.reduce((acc, e) => {
    const suyas = todasLasLineas.filter((l) => l.idRecepcion === e.idRecepcion);
    return (
      acc +
      suyas.reduce((a, l) => {
        const neto = (l.costoUnitario ?? 0) * l.cantidadRecibida;
        return a + neto * (1 + (ivaActualPorVariante.get(l.idVariante) ?? 21) / 100);
      }, 0)
    );
  }, 0);
  const hayOtrasSinCostear = otrasCubiertas.some((e) =>
    todasLasLineas.filter((l) => l.idRecepcion === e.idRecepcion).some((l) => l.costoUnitario == null)
  );

  // El control que importa: la suma de los ítems contra el total de la
  // factura. Sin esto, un error de tipeo en el total se convierte en deuda
  // real y en crédito fiscal calculado sobre otra cosa.
  const totalCubierto = totalEntrega + totalOtras;
  const montoDeclarado = Number(montoFactura) || 0;
  const diferencia = montoDeclarado - totalCubierto;
  // Un peso de tolerancia: los redondeos del proveedor no son un error.
  const cuadraPlata = Math.abs(diferencia) <= 1;
  const hayMonto = montoDeclarado > 0;

  // Qué falta para poder guardar. Se calcula acá y no se descubre después de
  // apretar: el botón apagado con el motivo al pasar el mouse molesta menos
  // que un error rojo tras completar todo el formulario.
  const motivoBloqueo = !pideFactura
    ? null
    : !numero.trim()
      ? "Falta el número de factura."
      : montoDeclarado <= 0
        ? "Falta el total de la factura."
        : !cuadraPlata && !motivoDiscrepancia.trim()
          ? "Los números no cuadran: contá por qué antes de guardar."
          : null;
  const sePuedeGuardar = motivoBloqueo === null;

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
                idsRecepcionCubiertas: otras.filter((e) => estaCubierta(e.idRecepcion)).map((e) => e.idRecepcion),
                unidadesFacturadas: unidadesDeclaradas || null,
                // Que no cuadre ya es una diferencia, aunque nadie haya
                // tildado el casillero.
                discrepancia: discrepancia || !cuadraPlata,
                motivoDiscrepancia,
                impuestos: nImpuestos,
                retenciones: nRetenciones,
                descuentos: nDescuentos,
                iva: ivaFinal,
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
                    {hayPie && <th className="p-3 text-right bg-accent-tint text-accent">Costo final</th>}
                    <th className="p-3 text-right">Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => {
                    const costoAnterior = costoActualPorVariante.get(l.idVariante) ?? null;
                    const costoNuevo = Number(costos[l.idVariante]) || 0;
                    // Se compara final contra final: el costo anterior ya
                    // tiene sus impuestos adentro, así que compararlo contra
                    // el neto de hoy mostraría una baja que no existe.
                    const costoFinal = costoNuevo * factor;
                    const puedeComparar = costoAnterior != null && costoAnterior > 0 && costoNuevo > 0;
                    const pct = puedeComparar ? ((costoFinal - costoAnterior) / costoAnterior) * 100 : null;
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
                        {hayPie && (
                          <td className="p-3 text-right tabular-nums bg-accent-tint font-semibold text-accent">
                            {costoNuevo > 0 ? `$${formatearMonto(costoFinal)}` : "—"}
                          </td>
                        )}
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
                      Neto de los ítems
                    </td>
                    <td className="p-3 text-right text-neutral-900" colSpan={hayPie ? 3 : 2}>
                      ${formatearMonto(totales.neto)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-neutral-400 mt-2.5">
              Poné el <b className="text-neutral-600">neto que dice el renglón de la factura</b>, sin IVA. Cada
              entrega guarda el suyo: si el mismo producto entró dos veces a precios distintos, el sistema no los
              promedia — los gasta del más viejo al más nuevo.
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
          <Bloque n={pideFactura ? 4 : 2} titulo={pideFactura ? "Al pie de la factura" : "Cierre"}>
            {pideFactura && (
              <>
                <div className="grid gap-3 sm:grid-cols-4 mb-4">
                  <CampoPie
                    etiqueta="Impuestos ($)"
                    valor={impuestos}
                    onCambio={setImpuestos}
                    pista="Percepciones, IIBB."
                    efecto="Entran al costo."
                  />
                  <CampoPie
                    etiqueta="Retenciones ($)"
                    valor={retenciones}
                    onCambio={setRetenciones}
                    efecto="Entran al costo."
                  />
                  <CampoPie
                    etiqueta="Descuentos ($)"
                    valor={descuentos}
                    onCambio={setDescuentos}
                    efecto="Se restan del costo."
                  />
                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-500 mb-1">IVA ($)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={ivaManual ?? (ivaCalculado > 0 ? ivaCalculado.toFixed(2) : "")}
                      onChange={(e) => setIvaManual(e.target.value)}
                      className="w-full rounded-lg border border-accent bg-accent-tint px-2.5 py-2 text-sm text-right tabular-nums font-semibold focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    <p className="text-[11px] text-neutral-400 mt-1 leading-snug">
                      Sale de la alícuota de cada producto. Si la factura lo discrimina distinto, corregilo.{" "}
                      <b className="text-neutral-600">No entra al costo: es crédito fiscal.</b>
                      {ivaManual !== null && (
                        <button
                          type="button"
                          onClick={() => setIvaManual(null)}
                          className="block text-accent hover:underline mt-0.5"
                        >
                          Volver al calculado (${formatearMonto(ivaCalculado)})
                        </button>
                      )}
                    </p>
                  </div>
                </div>

                {/* La escalera. El IVA se suma al final y sobre el neto de los
                    ítems, no sobre el subtotal: las percepciones no llevan IVA. */}
                <div className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3">
                  <Renglon etiqueta={`Neto de los ${lineas.reduce((a, l) => a + l.cantidadRecibida, 0)} ítems`} valor={totales.neto} />
                  {(nImpuestos !== 0 || nRetenciones !== 0) && (
                    <Renglon etiqueta="+ Impuestos y retenciones" valor={nImpuestos + nRetenciones} />
                  )}
                  {nDescuentos !== 0 && <Renglon etiqueta="− Descuentos" valor={-nDescuentos} rojo />}
                  <Renglon etiqueta="Subtotal sin IVA" valor={subtotalSinIva} fuerte />
                  <Renglon etiqueta="+ IVA" valor={ivaFinal} />
                  <div className="flex justify-between items-baseline border-t-2 border-neutral-200 mt-1.5 pt-2.5">
                    <span className="text-base font-bold">Total</span>
                    <span className="text-base font-bold tabular-nums">${formatearMonto(totalEntrega)}</span>
                  </div>
                  {hayPie && (
                    <p className="text-xs text-neutral-500 mt-2.5">
                      El costo de cada producto sube un{" "}
                      <b className="text-neutral-700">{((factor - 1) * 100).toFixed(1)}%</b> por el pie de la
                      factura. Esa plata se paga igual, así que va al costo — mirá la columna{" "}
                      <b className="text-neutral-700">Costo final</b> arriba.
                    </p>
                  )}
                </div>
              </>
            )}

            {pideFactura && hayMonto && (
              <div
                className={`rounded-lg px-3.5 py-3 mt-3 mb-3 text-sm tabular-nums ${
                  cuadraPlata ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span>
                    Suma de los ítems <b>${formatearMonto(totalCubierto)}</b> · Total de la factura{" "}
                    <b>${formatearMonto(montoDeclarado)}</b>
                  </span>
                  <span className="flex-1" />
                  <b>
                    {cuadraPlata
                      ? "✓ Cuadra"
                      : `✕ ${diferencia > 0 ? "Faltan" : "Sobran"} $${formatearMonto(Math.abs(diferencia))}`}
                  </b>
                </div>
                {!cuadraPlata && hayOtrasSinCostear && (
                  <p className="text-xs mt-1.5 opacity-90">
                    Ojo: alguna de las entregas que tildaste todavía no tiene costo cargado, así que no suma nada
                    acá.
                  </p>
                )}
              </div>
            )}

            {pideFactura && hayMonto && !cuadraPlata && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 mb-3">
                <p className="text-sm text-amber-900 mb-2">
                  <b>No cuadra. Contá por qué antes de guardar.</b> Puede ser que el proveedor haya facturado mal, o
                  que la factura traiga percepciones o un descuento al pie que no están en los ítems. Las dos cosas
                  son válidas — lo que no puede pasar es que la diferencia se pierda.
                </p>
                <textarea
                  value={motivoDiscrepancia}
                  onChange={(e) => setMotivoDiscrepancia(e.target.value)}
                  rows={2}
                  placeholder="Ej: facturaron 24 aguas que nunca entraron. / Trae percepción de IIBB de $2.900."
                  className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            )}

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
                {/* Si los números no cuadran ya hay un campo arriba pidiendo
                    la explicación: repetirlo sería preguntar dos veces. */}
                {discrepancia && cuadraPlata && (
                  <textarea
                    value={motivoDiscrepancia}
                    onChange={(e) => setMotivoDiscrepancia(e.target.value)}
                    rows={2}
                    placeholder="Ej: el total está bien pero facturaron un producto que no es."
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
                disabled={isPending || !sePuedeGuardar}
                title={motivoBloqueo ?? undefined}
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

function CampoPie({
  etiqueta,
  valor,
  onCambio,
  pista,
  efecto,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  pista?: string;
  efecto: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-neutral-500 mb-1">{etiqueta}</label>
      <input
        type="number"
        min={0}
        step="0.01"
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder="0,00"
        className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <p className="text-[11px] text-neutral-400 mt-1 leading-snug">
        {pista && `${pista} `}
        <b className="text-neutral-600">{efecto}</b>
      </p>
    </div>
  );
}

function Renglon({
  etiqueta,
  valor,
  fuerte,
  rojo,
}: {
  etiqueta: string;
  valor: number;
  fuerte?: boolean;
  rojo?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 py-1.5 text-sm tabular-nums ${
        fuerte ? "font-semibold border-t border-neutral-200 mt-1 pt-2" : ""
      }`}
    >
      <span className={fuerte ? "text-neutral-900" : "text-neutral-500"}>{etiqueta}</span>
      <span className={rojo ? "text-red-600 font-medium" : "text-neutral-900 font-medium"}>
        ${formatearMonto(Math.abs(valor))}
      </span>
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
