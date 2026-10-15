"use client";

import { useState, useTransition } from "react";
import type { Marca, Local, OrdenReposicion, DetalleReposicion } from "@/lib/supabase";
import { recepcionarOrden } from "@/app/(app)/reposicion/actions";
import { ESTADO_ESTILO } from "@/components/ReposicionApp";
import { estaAbierta, etiquetaEstado, RECIBIDA_PARCIAL } from "@/lib/estadosOrden";
import { CampoRemito } from "@/components/RemitoRecepcion";
import { MOTIVOS_FALTANTE } from "@/lib/recepcionDiferencias";
import { subirFotoDiferencia } from "@/app/(app)/reposicion/actions";

/**
 * Sacarle la foto a lo que no cerró, con la caja abierta.
 *
 * `capture="environment"` abre la cámara directo en el celular o la tablet:
 * la caja rota está ahí, no en un archivo guardado. Mismo criterio que el
 * remito.
 *
 * No es obligatoria y el botón no lo esconde: la mercadería no espera a que
 * alguien encuentre el teléfono. Sin foto la marca ve el motivo solo, que ya
 * es más de lo que veía antes.
 */
function BotonFoto({
  idDetalle,
  hecha,
  subiendo,
  onElegir,
  tono = "red",
}: {
  idDetalle: string;
  hecha: boolean;
  subiendo: boolean;
  onElegir: (idDetalle: string, archivo: File) => void;
  tono?: "red" | "amber";
}) {
  const estilo = hecha
    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
    : tono === "amber"
      ? "border-amber-300 bg-white text-amber-800 border-dashed"
      : "border-red-300 bg-white text-red-800 border-dashed";

  return (
    <label
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer ${estilo}`}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2 5.5h2.5l1-1.5h5l1 1.5H14v8H2z" />
        <circle cx="8" cy="9" r="2.4" />
      </svg>
      {subiendo ? "Subiendo…" : hecha ? "Foto sacada · cambiar" : "Sacar foto"}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={subiendo}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onElegir(idDetalle, f);
        }}
      />
    </label>
  );
}

// El gemelo de RecepcionCompraModal, para lo que mandan las marcas.
// Mismas reglas: se carga lo que llegó AHORA, y si falta algo el pedido
// queda abierto esperando la próxima entrega.

export default function RecepcionModal({
  orden,
  detalle,
  marca,
  local,
  nombrePorVariante,
  onClose,
}: {
  orden: OrdenReposicion;
  detalle: DetalleReposicion[];
  marca: Marca | undefined;
  local: Local | undefined;
  nombrePorVariante: Map<string, string>;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [observaciones, setObservaciones] = useState("");
  const [remito, setRemito] = useState<File | null>(null);

  const abierta = estaAbierta(orden.estado);
  const esSegundaVuelta = orden.estado === RECIBIDA_PARCIAL;

  const faltaDe = (d: DetalleReposicion) =>
    Math.max(0, (d.cantidad_solicitada ?? 0) - (d.cantidad_recibida ?? 0));

  /**
   * Lo que llegó, VACÍO al abrir. Lo escribe quien cuenta.
   *
   * Antes venía precargado con lo que faltaba, y eso convertía recibir en
   * apretar confirmar: si el campo ya dice 5, nadie cuenta las 5. El
   * precargado no ahorra trabajo, ahorra el conteo — que es el único trabajo
   * que esta pantalla tiene.
   *
   * Se guarda como texto y no como número para poder distinguir "" de "0":
   * vacío es «todavía no lo conté» y 0 es «conté y no llegó ninguna». Con un
   * número solo, las dos cosas valdrían cero y el pedido se cerraría con
   * renglones que nadie miró.
   */
  const [recibidos, setRecibidos] = useState<Record<string, string>>({});
  const cantidadDe = (id: string) => {
    const n = Number(recibidos[id]);
    return recibidos[id] !== undefined && recibidos[id] !== "" && Number.isFinite(n) ? n : 0;
  };
  // Los que ya se completaron en una entrega anterior no tienen campo que
  // llenar: no se cuentan como "falta contar" o el botón nunca se habilita.
  const sinContar = detalle.filter(
    (d) => faltaDe(d) > 0 && (recibidos[d.id_detalle] ?? "") === ""
  ).length;
  // Por qué entró menos. Es lo único que decide quien abre la caja, y sin
  // esto la marca lee «faltan 6» como «no lo mandaste».
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  // La foto de lo que no cerró, por renglón: path ya subido, o "subiendo".
  // Se sube al sacarla y no al confirmar, así una foto que falla no frena el
  // conteo de la mercadería — que es lo que no puede esperar.
  const [fotos, setFotos] = useState<Record<string, string>>({});
  const [subiendo, setSubiendo] = useState<string | null>(null);

  async function sacarFoto(idDetalle: string, archivo: File) {
    setError(null);
    setSubiendo(idDetalle);
    const fd = new FormData();
    fd.append("archivo", archivo);
    const r = await subirFotoDiferencia(fd);
    setSubiendo(null);
    if (r.error || !r.path) {
      setError(`La foto no subió (${r.error ?? "error"}). Podés recibir igual.`);
      return;
    }
    setFotos((p) => ({ ...p, [idDetalle]: r.path! }));
  }

  const totalSolicitado = detalle.reduce((acc, d) => acc + (d.cantidad_solicitada ?? 0), 0);
  const totalYaRecibido = detalle.reduce((acc, d) => acc + (d.cantidad_recibida ?? 0), 0);
  const totalAhora = detalle.reduce((acc, d) => acc + cantidadDe(d.id_detalle), 0);
  const totalPendiente = detalle.reduce(
    (acc, d) =>
      acc + Math.max(0, (d.cantidad_solicitada ?? 0) - (d.cantidad_recibida ?? 0) - cantidadDe(d.id_detalle)),
    0
  );
  const quedaAbierto = totalPendiente > 0;
  const codigo = orden.id_orden.slice(0, 8).toUpperCase();

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await recepcionarOrden(
          orden.id_orden,
          detalle.map((d) => ({
            idDetalle: d.id_detalle,
            idVariante: d.id_variante,
            cantidadSolicitada: d.cantidad_solicitada,
            cantidadRecibida: cantidadDe(d.id_detalle),
            motivoFaltante: motivos[d.id_detalle] || null,
            fotoPath: fotos[d.id_detalle] || null,
          })),
          observaciones,
          remito
        );
        if (res.error) setError(res.error);
        else {
          if (res.aviso) window.alert(res.aviso);
          onClose();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">WiiGo</p>
            <h2 className="text-xl font-semibold text-neutral-900">
              {!abierta ? "Orden de Pedido" : esSegundaVuelta ? "Recibir el resto" : "Recepcionar pedido"}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              #{codigo} · pedido el{" "}
              {new Date(orden.fecha).toLocaleDateString("es-AR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
              {esSegundaVuelta && " · ya entró una parte"}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium text-neutral-900">
                {marca?.nombre ?? "—"} <span className="text-neutral-400">→</span> {local?.nombre ?? "—"}
              </p>
              {marca?.contacto && <p className="text-xs text-neutral-500">Contacto: {marca.contacto}</p>}
            </div>
            <span
              className={`text-xs font-semibold rounded-full px-2.5 py-1 ${
                ESTADO_ESTILO[orden.estado] ?? "bg-neutral-100 text-neutral-600"
              }`}
            >
              {etiquetaEstado(orden.estado, true)}
            </span>
          </div>

          <div className="border border-neutral-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 bg-neutral-50">
                  <th className="p-3">Producto</th>
                  <th className="p-3 text-right">Pedido</th>
                  {esSegundaVuelta && <th className="p-3 text-right">Ya recibido</th>}
                  {abierta && <th className="p-3 text-right bg-accent-tint text-accent">Recibo ahora</th>}
                  <th className="p-3 text-right">{abierta ? "Queda pendiente" : "Recibido"}</th>
                </tr>
              </thead>
              <tbody>
                {detalle.map((d) => {
                  const pedido = d.cantidad_solicitada ?? 0;
                  const previo = d.cantidad_recibida ?? 0;
                  const ahora = cantidadDe(d.id_detalle);
                  const crudo = recibidos[d.id_detalle] ?? "";
                  const pendiente = Math.max(0, pedido - previo - ahora);
                  const yaCerrado = previo >= pedido;
                  return (
                    <tr
                      key={d.id_detalle}
                      className={`border-b border-neutral-100 last:border-0 ${yaCerrado && abierta ? "opacity-50" : ""}`}
                    >
                      <td className="p-3 text-neutral-900">{nombrePorVariante.get(d.id_variante) ?? "—"}</td>
                      <td className="p-3 text-right text-neutral-500 tabular-nums">{pedido}</td>
                      {esSegundaVuelta && (
                        <td className="p-3 text-right text-neutral-500 tabular-nums">{previo}</td>
                      )}
                      {abierta && (
                        <td className="p-2 text-right bg-accent-tint">
                          {yaCerrado ? (
                            <span className="text-neutral-400 px-3">—</span>
                          ) : (
                            // Arranca vacío: lo escribe quien cuenta. El
                            // `placeholder` dice cuántas esperaba el pedido,
                            // así el dato de referencia está a la vista sin
                            // meterse en el campo.
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={crudo}
                              placeholder={String(pedido - previo)}
                              aria-label={`Cuántas llegaron de ${nombrePorVariante.get(d.id_variante) ?? "este producto"}`}
                              onChange={(e) => {
                                var v = e.target.value;
                                setRecibidos((prev) => ({
                                  ...prev,
                                  [d.id_detalle]: v === "" ? "" : String(Math.max(0, Number(v) || 0)),
                                }));
                              }}
                              className={`w-20 rounded-lg px-2 py-1.5 text-sm text-right font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-accent ${
                                crudo === ""
                                  ? "border border-dashed border-accent/60 bg-white placeholder:text-neutral-300 placeholder:font-normal"
                                  : "border border-accent bg-white"
                              }`}
                            />
                          )}
                        </td>
                      )}
                      <td className="p-3 text-right tabular-nums">
                        {!abierta ? (
                          <span className="text-neutral-900">{previo}</span>
                        ) : yaCerrado ? (
                          <span className="text-neutral-400 text-xs">cerrado</span>
                        ) : previo + ahora > pedido ? (
                          /* Antes decía "✓ completo" igual que si hubiera
                             llegado justo, así que un error de tipeo pasaba
                             derecho y nadie se enteraba del excedente hasta
                             el inventario. */
                          <span className="text-amber-700 font-semibold text-xs">
                            +{previo + ahora - pedido} de más
                          </span>
                        ) : pendiente === 0 ? (
                          <span className="text-emerald-600 font-semibold text-xs">✓ completo</span>
                        ) : (
                          <span className="text-amber-700 font-semibold">{pendiente}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* Las explicaciones van en una fila aparte y no al lado del
                    número: la tabla se lee de un vistazo para contar, y un
                    párrafo adentro de la celda rompe esa lectura. */}
                {abierta &&
                  detalle.map((d) => {
                    const pedido = d.cantidad_solicitada ?? 0;
                    const previo = d.cantidad_recibida ?? 0;
                    const ahora = cantidadDe(d.id_detalle);
                    const total = previo + ahora;
                    const nombre = nombrePorVariante.get(d.id_variante) ?? "—";
                    // Sin contar todavía no hay nada que avisar: un renglón
                    // vacío no es un faltante, es un renglón que falta mirar.
                    if ((recibidos[d.id_detalle] ?? "") === "") return null;

                    if (total > pedido) {
                      return (
                        <tr key={`n-${d.id_detalle}`} className="bg-amber-50">
                          <td colSpan={esSegundaVuelta ? 5 : 4} className="px-3 py-2">
                            <p className="text-xs text-amber-800 leading-relaxed">
                              <b>{nombre}: llegaron {total - pedido} de más.</b> Recibilas igual — entran
                              a la góndola y quedan avisadas para que administración decida si se
                              quedan.
                            </p>
                            <div className="mt-2">
                              <BotonFoto
                                idDetalle={d.id_detalle}
                                hecha={Boolean(fotos[d.id_detalle])}
                                subiendo={subiendo === d.id_detalle}
                                onElegir={sacarFoto}
                                tono="amber"
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    if (ahora < pedido - previo) {
                      return (
                        <tr key={`n-${d.id_detalle}`} className="bg-red-50">
                          <td colSpan={esSegundaVuelta ? 5 : 4} className="px-3 py-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-red-800">
                                <b>{nombre}:</b> faltan {pedido - previo - ahora}. ¿Por qué?
                              </span>
                              <select
                                value={motivos[d.id_detalle] ?? ""}
                                onChange={(e) =>
                                  setMotivos((prev) => ({ ...prev, [d.id_detalle]: e.target.value }))
                                }
                                className="rounded-lg border border-red-300 bg-white px-2 py-1 text-xs text-red-800"
                              >
                                <option value="">Elegí un motivo</option>
                                {MOTIVOS_FALTANTE.map((m) => (
                                  <option key={m.clave} value={m.clave}>
                                    {m.etiqueta}
                                  </option>
                                ))}
                              </select>
                              <BotonFoto
                                idDetalle={d.id_detalle}
                                hecha={Boolean(fotos[d.id_detalle])}
                                subiendo={subiendo === d.id_detalle}
                                onElegir={sacarFoto}
                              />
                              <span className="text-[11px] text-red-700">
                                La marca ve esto. Sin motivo lee «no lo mandaste».
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return null;
                  })}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-50 border-t border-neutral-200 font-semibold tabular-nums">
                  <td className="p-3 text-xs text-neutral-500 uppercase">Total</td>
                  <td className="p-3 text-right text-neutral-900">{totalSolicitado}</td>
                  {esSegundaVuelta && <td className="p-3 text-right text-neutral-900">{totalYaRecibido}</td>}
                  {abierta && <td className="p-3 text-right text-accent bg-accent-tint">{totalAhora}</td>}
                  <td className={`p-3 text-right ${totalPendiente > 0 ? "text-amber-700" : "text-neutral-900"}`}>
                    {abierta ? totalPendiente : totalYaRecibido}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {abierta ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Observaciones</label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  rows={2}
                  placeholder="Ej: caja golpeada, el resto lo mandan la semana que viene..."
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              {/* Acá el remito es el único comprobante que va a existir: un
                  pedido a una marca no pasa por Costeo. */}
              <CampoRemito archivo={remito} onElegir={setRemito} />

              {/* Un renglón sin tocar no es cero: es uno que nadie contó.
                  Confirmar así cerraría el pedido con productos que nadie
                  miró, y el faltante se descubriría en el inventario de fin
                  de mes, cuando ya no hay a quién preguntarle. */}
              {sinContar > 0 ? (
                <div className="flex gap-2.5 bg-neutral-100 border border-neutral-300 rounded-lg px-3.5 py-3">
                  <span aria-hidden="true">✍️</span>
                  <p className="text-sm text-neutral-700">
                    <b>
                      {sinContar === 1
                        ? "Falta contar 1 producto."
                        : `Faltan contar ${sinContar} productos.`}
                    </b>{" "}
                    Poné cuántas unidades llegaron de cada uno. Si de alguno no llegó ninguna, escribí{" "}
                    <b>0</b> — dejarlo vacío no es lo mismo.
                  </p>
                </div>
              ) : quedaAbierto ? (
                <div className="flex gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-3">
                  <span aria-hidden="true">⏳</span>
                  <p className="text-sm text-amber-900">
                    <b>
                      Faltan {totalPendiente} {totalPendiente === 1 ? "unidad" : "unidades"}.
                    </b>{" "}
                    Las {totalAhora} que recibís entran al stock ahora y se pueden vender. El pedido queda abierto
                    esperando el resto.
                  </p>
                </div>
              ) : (
                <div className="flex gap-2.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-3">
                  <span aria-hidden="true">✓</span>
                  <p className="text-sm text-emerald-800">Con esto llegó todo lo pedido. El pedido se cierra.</p>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmar}
                  disabled={isPending || sinContar > 0 || totalAhora === 0}
                  className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
                >
                  {isPending
                    ? "Confirmando..."
                    : sinContar > 0
                      ? `Faltan contar ${sinContar}`
                      : quedaAbierto
                        ? "Confirmar lo que llegó"
                        : "Confirmar recepción"}
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={onClose}
              className="w-full rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
