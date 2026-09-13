"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { marcarOrdenEnviada, cerrarOrdenIncompleta } from "@/app/(app)/compras/actions";
import type { DatosCompras, EntregaHistorial } from "@/lib/comprasDatos";
import {
  estaAbierta,
  etiquetaEstado,
  PENDIENTE,
  RECIBIDA_PARCIAL,
  CERRADA_INCOMPLETA,
} from "@/lib/estadosOrden";
import type { OrdenReposicion, OrdenCompraProveedor } from "@/lib/supabase";
import type { FilaVariante } from "@/components/ReposicionApp";
import NuevaOrdenModal from "@/components/NuevaOrdenModal";
import NuevaOrdenCompraModal from "@/components/NuevaOrdenCompraModal";
import RecepcionModal from "@/components/RecepcionModal";
import RecepcionCompraModal from "@/components/RecepcionCompraModal";
import CostosRecepcionModal from "@/components/CostosRecepcionModal";

// Las tres etapas de Compras, con los formularios adentro.
//
// El punto de esta pantalla: la tarea se hace acá. Antes cada botón mandaba a
// Abastecimiento o a Proveedores según a quién le hubieras pedido, que es un
// detalle interno del sistema que al que trabaja no le importa.
//
// Los formularios son EXACTAMENTE los mismos que ya usaban esas pantallas —
// cambian de lugar, no de lógica. Por eso no hay riesgo de que un pedido se
// guarde distinto según desde dónde lo hiciste.

export type Etapa = "ORDENES" | "RECEPCION" | "COSTEO";

function fechaCorta(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function dias(iso: string) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function haceCuanto(d: number) {
  if (d === 0) return "hoy";
  if (d === 1) return "ayer";
  return `hace ${d} días`;
}

type Fila = {
  origen: "MARCA" | "PROVEEDOR";
  idOrden: string;
  contraparte: string;
  local: string;
  fecha: string;
  estado: string;
  unidades: number;
  dias: number;
  /** null = emitida pero todavía sin mandar. Es lo que define la etapa. */
  enviadaEl: string | null;
};

export default function ComprasTrabajo({ etapa, datos }: { etapa: Etapa; datos: DatosCompras }) {
  const [nuevaMarca, setNuevaMarca] = useState(false);
  const [nuevaProveedor, setNuevaProveedor] = useState(false);
  const [recibirMarca, setRecibirMarca] = useState<OrdenReposicion | null>(null);
  const [recibirProveedor, setRecibirProveedor] = useState<OrdenCompraProveedor | null>(null);
  // Se costea una ENTREGA, no un pedido: dos entregas del mismo pedido
  // pueden traer precios distintos y cada una es su propio lote.
  const [costear, setCostear] = useState<EntregaHistorial | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function enviar(f: Fila) {
    setError(null);
    setEnviando(`${f.origen}-${f.idOrden}`);
    marcarOrdenEnviada(f.origen, f.idOrden)
      .then((r) => {
        if (r.error) setError(r.error);
        else router.refresh();
      })
      .finally(() => setEnviando(null));
  }

  const marcaPorId = useMemo(() => new Map(datos.marcas.map((m) => [m.id_marca, m])), [datos.marcas]);
  const proveedorPorId = useMemo(
    () => new Map(datos.proveedores.map((p) => [p.id_proveedor, p])),
    [datos.proveedores]
  );
  const localPorId = useMemo(() => new Map(datos.locales.map((l) => [l.id_local, l])), [datos.locales]);
  const productoPorId = useMemo(() => new Map(datos.productos.map((p) => [p.id_producto, p])), [datos.productos]);

  // El catálogo que piden los formularios de nueva orden.
  const filas = useMemo<FilaVariante[]>(
    () =>
      datos.variantes
        .map((variante) => {
          const producto = productoPorId.get(variante.id_producto);
          if (!producto) return null;
          return { variante, producto, marca: marcaPorId.get(producto.id_marca) };
        })
        .filter((f): f is FilaVariante => f !== null),
    [datos.variantes, productoPorId, marcaPorId]
  );

  // A un proveedor solo se le compra marca propia. Lo de las marcas en
  // consignación te lo mandan ellas: ofrecerlo en una orden de compra es
  // ofrecer algo que no se puede comprar.
  const filasPropias = useMemo(
    () => filas.filter((f) => datos.idsMarcaPropia.includes(f.producto.id_marca)),
    [filas, datos.idsMarcaPropia]
  );

  const cantidadPorClave = useMemo(() => {
    const map = new Map<string, number>();
    datos.stock.forEach((s) => map.set(`${s.id_variante}_${s.id_local}`, s.cantidad));
    return map;
  }, [datos.stock]);

  const nombrePorVariante = useMemo(() => {
    const map = new Map<string, string>();
    filas.forEach((f) => {
      map.set(
        f.variante.id_variante,
        `${f.producto.nombre}${f.variante.nombre !== "Único" ? ` — ${f.variante.nombre}` : ""}`
      );
    });
    return map;
  }, [filas]);

  const costoActualPorVariante = useMemo(() => {
    const map = new Map<string, number | null>();
    filas.forEach((f) => map.set(f.variante.id_variante, f.producto.costo_informado));
    return map;
  }, [filas]);

  const ivaActualPorVariante = useMemo(() => {
    const map = new Map<string, number>();
    filas.forEach((f) => map.set(f.variante.id_variante, f.producto.iva_porcentaje ?? 21));
    return map;
  }, [filas]);

  /** Solo tiene sentido para entregas de proveedor — las de marca no se costean. */
  const proveedorDeEntrega = (e: EntregaHistorial) => proveedorPorId.get(e.idContraparte);

  const detalleMarcaDe = (idOrden: string) => datos.detalleMarca.filter((d) => d.id_orden === idOrden);
  const detalleProveedorDe = (idOrden: string) => datos.detalleProveedor.filter((d) => d.id_orden === idOrden);

  /** Qué traía un pedido, para poder abrir las filas ya cerradas. */
  function contenidoDe(f: Fila) {
    const lineas =
      f.origen === "MARCA"
        ? detalleMarcaDe(f.idOrden).map((d) => ({
            nombre: nombrePorVariante.get(d.id_variante) ?? "Producto",
            pedidas: d.cantidad_solicitada ?? 0,
            recibidas: d.cantidad_recibida ?? 0,
          }))
        : detalleProveedorDe(f.idOrden).map((d) => ({
            nombre: nombrePorVariante.get(d.id_variante) ?? "Producto",
            pedidas: d.cantidad_solicitada ?? 0,
            recibidas: d.cantidad_recibida ?? 0,
          }));
    return lineas;
  }

  // ---------- Las dos tablas en una sola lista ----------
  const todas = useMemo<Fila[]>(() => {
    const a: Fila[] = datos.ordenesMarca.map((o) => ({
      origen: "MARCA",
      idOrden: o.id_orden,
      contraparte: marcaPorId.get(o.id_marca)?.nombre ?? "Marca",
      local: localPorId.get(o.id_local)?.nombre ?? "—",
      fecha: o.fecha,
      estado: o.estado,
      unidades: o.total_unidades ?? 0,
      dias: dias(o.fecha),
      enviadaEl: o.enviada_el ?? null,
    }));
    const b: Fila[] = datos.ordenesProveedor.map((o) => ({
      origen: "PROVEEDOR",
      idOrden: o.id_orden,
      contraparte: proveedorPorId.get(o.id_proveedor)?.nombre ?? "Proveedor",
      local: localPorId.get(o.id_local)?.nombre ?? "—",
      fecha: o.fecha_alta,
      estado: o.estado,
      unidades: o.total_unidades ?? 0,
      dias: dias(o.fecha_alta),
      enviadaEl: o.enviada_el ?? null,
    }));
    return [...a, ...b];
  }, [datos.ordenesMarca, datos.ordenesProveedor, marcaPorId, proveedorPorId, localPorId]);

  // Cada pedido está en UNA etapa a la vez. Emitida y sin mandar vive en
  // Órdenes; en cuanto se marca como enviada pasa a Recepción y desaparece de
  // acá. Mostrarla en las dos era lo confuso de la versión anterior.
  const sinEnviar = useMemo(
    () =>
      todas
        .filter((o) => o.estado === PENDIENTE && !o.enviadaEl)
        .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [todas]
  );
  const esperandoLlegar = useMemo(
    () =>
      todas
        .filter((o) => o.estado === PENDIENTE && o.enviadaEl)
        .sort((a, b) => (a.enviadaEl ?? "").localeCompare(b.enviadaEl ?? "")),
    [todas]
  );
  // Llegó una parte y falta el resto. Sigue siendo trabajo del local: la
  // mercadería que falta todavía está en la calle.
  const aMedias = useMemo(
    () =>
      todas
        .filter((o) => o.estado === RECIBIDA_PARCIAL)
        .sort((a, b) => (a.enviadaEl ?? a.fecha).localeCompare(b.enviadaEl ?? b.fecha)),
    [todas]
  );
  const cerradas = useMemo(
    () => todas.filter((o) => !estaAbierta(o.estado)).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 12),
    [todas]
  );

  function abrirRecepcion(f: Fila) {
    if (f.origen === "MARCA") {
      setRecibirMarca(datos.ordenesMarca.find((o) => o.id_orden === f.idOrden) ?? null);
    } else {
      setRecibirProveedor(datos.ordenesProveedor.find((o) => o.id_orden === f.idOrden) ?? null);
    }
  }

  return (
    <>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
      )}

      {etapa === "ORDENES" && (
        <>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h1 className="text-xl font-semibold text-neutral-900">Órdenes de compra</h1>
            <div className="flex gap-2">
              <button
                onClick={() => setNuevaProveedor(true)}
                className="text-sm font-semibold bg-accent hover:bg-accent-dark text-white rounded-lg px-3.5 py-2"
              >
                + Pedir a un proveedor
              </button>
              <button
                onClick={() => setNuevaMarca(true)}
                className="text-sm font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3.5 py-2"
              >
                + Pedir a una marca
              </button>
            </div>
          </div>
          <p className="text-sm text-neutral-500 mt-1 mb-5">
            Órdenes emitidas que todavía no se mandaron. Al marcarlas como enviadas pasan a Recepción y salen de
            acá.
          </p>

          <Seccion titulo="Emitidas · falta mandarlas" vacio="Todas las órdenes ya fueron enviadas.">
            {sinEnviar.map((f) => (
              <FilaOrden
                key={`${f.origen}-${f.idOrden}`}
                f={f}
                accion="Marcar como enviada"
                onAccion={() => enviar(f)}
                trabajando={enviando === `${f.origen}-${f.idOrden}`}
              />
            ))}
          </Seccion>

          {esperandoLlegar.length > 0 && (
            <Seccion titulo="Ya enviadas · esperando en Recepción">
              {esperandoLlegar.map((f) => (
                <FilaOrden key={`${f.origen}-${f.idOrden}`} f={f} tenue detalle={contenidoDe(f)} />
              ))}
            </Seccion>
          )}

          {cerradas.length > 0 && (
            <Seccion titulo="Ya recibidas">
              {cerradas.map((f) => (
                <FilaOrden key={`${f.origen}-${f.idOrden}`} f={f} tenue detalle={contenidoDe(f)} />
              ))}
            </Seccion>
          )}
        </>
      )}

      {etapa === "RECEPCION" && (
        <>
          <h1 className="text-xl font-semibold text-neutral-900">Recepción de mercadería</h1>
          <p className="text-sm text-neutral-500 mt-1 mb-5">
            Contá lo que hay en la caja y cargá <b className="text-neutral-700">eso</b>, no lo que dice el remito. Si
            falta algo, queda el reclamo hecho solo.
          </p>

          <Seccion
            titulo="Esperando llegar · lo que se mandó primero"
            vacio="No hay nada esperando. Todo lo que se mandó ya llegó."
          >
            {esperandoLlegar.map((f) => (
              <FilaOrden key={`${f.origen}-${f.idOrden}`} f={f} accion="Recepcionar" onAccion={() => abrirRecepcion(f)} />
            ))}
          </Seccion>

          {/* Llegó una parte y falta el resto. No vuelve a Órdenes: sigue
              siendo trabajo del local hasta que llegue lo que falta o
              administración lo dé por cerrado desde Costeo. */}
          {aMedias.length > 0 && (
            <Seccion titulo="Llegaron a medias · falta el resto">
              {aMedias.map((f) => (
                <FilaOrden
                  key={`${f.origen}-${f.idOrden}`}
                  f={f}
                  accion="Recibir el resto"
                  onAccion={() => abrirRecepcion(f)}
                  detalle={contenidoDe(f)}
                />
              ))}
            </Seccion>
          )}

          {sinEnviar.length > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              Hay {sinEnviar.length} {sinEnviar.length === 1 ? "orden emitida" : "órdenes emitidas"} que todavía no se
              mandaron. No aparecen acá hasta que administración las marque como enviadas.
            </p>
          )}

          <HistorialEntregas entregas={datos.entregas} />

          <p className="text-xs text-neutral-400 mt-4">
            Acá no se ven costos: contar unidades no necesita saber cuánto salió cada cosa, y con las marcas es
            información sensible.
          </p>
        </>
      )}

      {etapa === "COSTEO" && (
        <CosteoEtapa datos={datos} proveedorPorId={proveedorPorId} onCostear={(e) => setCostear(e)} />
      )}

      {/* ---------- Los formularios de siempre, montados acá ---------- */}
      {nuevaMarca && (
        <NuevaOrdenModal
          marcas={datos.marcas}
          locales={datos.locales}
          filas={filas}
          cantidadPorClave={cantidadPorClave}
          onClose={() => setNuevaMarca(false)}
        />
      )}
      {nuevaProveedor && (
        <NuevaOrdenCompraModal
          proveedores={datos.proveedores}
          locales={datos.locales}
          filas={filasPropias}
          cantidadPorClave={cantidadPorClave}
          onClose={() => setNuevaProveedor(false)}
        />
      )}
      {recibirMarca && (
        <RecepcionModal
          orden={recibirMarca}
          detalle={detalleMarcaDe(recibirMarca.id_orden)}
          marca={marcaPorId.get(recibirMarca.id_marca)}
          local={localPorId.get(recibirMarca.id_local)}
          nombrePorVariante={nombrePorVariante}
          onClose={() => setRecibirMarca(null)}
        />
      )}
      {recibirProveedor && (
        <RecepcionCompraModal
          orden={recibirProveedor}
          detalle={detalleProveedorDe(recibirProveedor.id_orden)}
          proveedor={proveedorPorId.get(recibirProveedor.id_proveedor)}
          local={localPorId.get(recibirProveedor.id_local)}
          nombrePorVariante={nombrePorVariante}
          onClose={() => setRecibirProveedor(null)}
        />
      )}
      {costear && (
        <CostosRecepcionModal
          entrega={costear}
          lineas={datos.lineasEntrega.filter((l) => l.idRecepcion === costear.idRecepcion)}
          entregasDelPedido={datos.entregas.filter((e) => e.idOrden === costear.idOrden)}
          proveedor={proveedorDeEntrega(costear)}
          nombrePorVariante={nombrePorVariante}
          costoActualPorVariante={costoActualPorVariante}
          ivaActualPorVariante={ivaActualPorVariante}
          onClose={() => setCostear(null)}
        />
      )}
    </>
  );
}

// ---------- Costeo ----------

function CosteoEtapa({
  datos,
  proveedorPorId,
  onCostear,
}: {
  datos: DatosCompras;
  proveedorPorId: Map<string, DatosCompras["proveedores"][number]>;
  onCostear: (entrega: EntregaHistorial) => void;
}) {
  const router = useRouter();
  const [cerrando, setCerrando] = useState<string | null>(null);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);

  /** Cuántas unidades del pedido nunca llegaron. 0 = llegó todo. */
  function faltanteDe(idOrden: string) {
    return datos.detalleProveedor
      .filter((d) => d.id_orden === idOrden)
      .reduce((acc, d) => acc + Math.max(0, (d.cantidad_solicitada ?? 0) - (d.cantidad_recibida ?? 0)), 0);
  }

  function cerrarPedido(idOrden: string) {
    setErrorCierre(null);
    setCerrando(idOrden);
    cerrarOrdenIncompleta("PROVEEDOR", idOrden, "El proveedor no envía el resto")
      .then((r) => {
        if (r.error) setErrorCierre(r.error);
        else router.refresh();
      })
      .finally(() => setCerrando(null));
  }

  // Por ENTREGA. Un pedido que llegó en dos veces aparece dos veces, cada una
  // con su propia factura y su propio costo.
  const entregaPorId = new Map(datos.entregas.map((e) => [e.idRecepcion, e]));
  const productosDe = (idRecepcion: string) =>
    datos.lineasEntrega.filter((l) => l.idRecepcion === idRecepcion).length;

  const porCostear = datos.recepcionesSinCostear
    .map((r) => ({
      ...r,
      entrega: entregaPorId.get(r.id_recepcion),
      orden: datos.ordenesProveedor.find((o) => o.id_orden === r.id_orden),
      proveedor: proveedorPorId.get(r.id_proveedor),
      dias: dias(r.fecha),
      productos: productosDe(r.id_recepcion),
    }))
    .filter((r) => r.orden && r.entrega);

  const costeadas = datos.recepcionesCosteadas
    .map((r) => ({
      ...r,
      entrega: entregaPorId.get(r.id_recepcion),
      orden: datos.ordenesProveedor.find((o) => o.id_orden === r.id_orden),
      proveedor: proveedorPorId.get(r.id_proveedor),
      productos: productosDe(r.id_recepcion),
    }))
    .filter((r) => r.orden && r.entrega);

  const vencidos = porCostear.filter((r) => r.dias > 3).length;

  const MODO: Record<string, string> = {
    LIQUIDACION_VENTA: "Liquidación mensual",
    REMITO: "Factura por entrega",
    PERIODO: "Factura por período",
  };

  return (
    <>
      <h1 className="text-xl font-semibold text-neutral-900">Costeo de recibidos</h1>
      <p className="text-sm text-neutral-500 mt-1 mb-5">
        Ponerle el precio a lo que llegó. Hasta que no se hace, la liquidación de ese proveedor se calcula mal y el
        margen que ves en las pantallas no es real.
      </p>

      {vencidos > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-sm text-red-800">
            <b>
              {vencidos} {vencidos === 1 ? "recepción lleva" : "recepciones llevan"} más de 3 días sin costear.
            </b>{" "}
            Todo lo que se vendió de esa mercadería en el medio está usando un costo viejo o estimado.
          </p>
        </div>
      )}

      {errorCierre && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{errorCierre}</p>
      )}

      <Seccion titulo="Por costear" vacio="Todo lo recibido tiene su costo cargado.">
        {porCostear.map((r) => {
          const aMedias = r.orden?.estado === RECIBIDA_PARCIAL;
          const faltan = aMedias ? faltanteDe(r.id_orden) : 0;
          return (
            <div
              key={r.id_recepcion}
              className={`border border-l-[3px] rounded-xl ${
                r.dias > 3 ? "border-red-200 border-l-red-500 bg-red-50" : "border-neutral-200 border-l-accent bg-white"
              }`}
            >
              <div className="flex items-center gap-3 flex-wrap px-4 py-3">
                <span className="flex-1 min-w-[200px]">
                  <span className="block font-semibold text-[14.5px] text-neutral-900">
                    {r.proveedor?.nombre ?? "—"}
                    {r.entrega && r.entrega.totalEntregas > 1 && (
                      <span className="ml-2 text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 align-middle">
                        {r.entrega.numeroEntrega}ª de {r.entrega.totalEntregas}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-neutral-400">
                    Pedido el {r.orden ? fechaCorta(r.orden.fecha_alta) : "—"} · recibido el {fechaCorta(r.fecha)} ·{" "}
                    {r.productos} {r.productos === 1 ? "producto" : "productos"} · {haceCuanto(r.dias)}
                  </span>
                </span>
                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full border bg-neutral-50 text-neutral-500 border-neutral-200 whitespace-nowrap">
                  {MODO[r.proveedor?.modo_facturacion ?? ""] ?? r.proveedor?.modo_facturacion}
                </span>
                <button
                  onClick={() => r.entrega && onCostear(r.entrega)}
                  className="text-sm font-semibold bg-accent hover:bg-accent-dark text-white rounded-lg px-3 py-1.5"
                >
                  Costear
                </button>
              </div>

              {/* El faltante aparece acá y no en Recepción: reclamarle a la
                  marca es trabajo de administración, que es quien está
                  mirando esta pantalla. El local solo cuenta lo que llegó. */}
              {aMedias && faltan > 0 && (
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 flex-wrap rounded-b-[9px]">
                  <span className="flex-1 min-w-[220px] text-sm text-amber-900">
                    <b>Este pedido llegó a medias — faltan {faltan} unidades.</b> Lo que ves acá es solo esta entrega.
                    Si el proveedor manda el resto, entra como una entrega nueva.
                  </span>
                  <button
                    onClick={() => cerrarPedido(r.id_orden)}
                    disabled={cerrando === r.id_orden}
                    className="text-sm font-semibold text-amber-900 bg-white border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {cerrando === r.id_orden ? "Cerrando..." : "Cerrar pedido como está"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </Seccion>

      {/* Ya costeadas pero todavía sin liquidar: se pueden corregir. Es el
          único momento en que cambiar un costo no reescribe nada — esa plata
          todavía no se le pagó a nadie. Al liquidarse, desaparecen de acá. */}
      {costeadas.length > 0 && (
        <Seccion titulo="Ya costeadas · todavía se pueden corregir">
          {costeadas.map((r) => (
            <div
              key={r.id_recepcion}
              className="flex items-center gap-3 flex-wrap border border-neutral-200 border-l-[3px] border-l-emerald-500 rounded-xl px-4 py-3 bg-white"
            >
              <span className="flex-1 min-w-[200px]">
                <span className="block font-semibold text-[14.5px] text-neutral-900">
                  {r.proveedor?.nombre ?? "—"}
                </span>
                <span className="block text-xs text-neutral-400">
                  Recibido el {fechaCorta(r.fecha)} · {r.productos} {r.productos === 1 ? "producto" : "productos"} ·
                  costeado
                </span>
              </span>
              <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 whitespace-nowrap">
                Sin liquidar
              </span>
              <button
                onClick={() => r.entrega && onCostear(r.entrega)}
                className="text-sm font-semibold text-neutral-700 border border-neutral-300 rounded-lg px-3 py-1.5 hover:bg-neutral-50"
              >
                Corregir
              </button>
            </div>
          ))}
        </Seccion>
      )}

      <div className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 mt-5">
        <p className="text-xs text-neutral-500">
          <b className="text-neutral-700">La pantalla pide cosas distintas según el proveedor.</b> Con los de
          liquidación mensual alcanza con el costo — su factura llega a fin de mes y se carga contra la liquidación.
          Con los que facturan por entrega, además hay que cargar el número de factura, y ahí sí nace la deuda.
        </p>
        <p className="text-xs text-neutral-500 mt-2">
          <b className="text-neutral-700">Un costo se puede corregir hasta que se liquide.</b> Después no: esa plata
          ya se le pagó al proveedor, y el ajuste va en la liquidación siguiente en vez de borrar lo que pasó.
        </p>
      </div>
    </>
  );
}

// ---------- Historial ----------

type Periodo = "SEMANA" | "MES" | "TODO";

/**
 * Arranca en "Este mes" a propósito.
 *
 * El historial crece para siempre: con un año de uso son miles de filas que
 * nadie mira. "Todo" sigue disponible para el que la busca.
 */
function FiltroPeriodo({ valor, onCambio }: { valor: Periodo; onCambio: (p: Periodo) => void }) {
  const opciones: { clave: Periodo; texto: string }[] = [
    { clave: "SEMANA", texto: "Esta semana" },
    { clave: "MES", texto: "Este mes" },
    { clave: "TODO", texto: "Todo" },
  ];
  return (
    <div className="flex gap-1.5 flex-wrap">
      {opciones.map((o) => (
        <button
          key={o.clave}
          onClick={() => onCambio(o.clave)}
          className={`text-xs font-semibold rounded-lg px-2.5 py-1 border ${
            valor === o.clave
              ? "bg-accent text-white border-accent"
              : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
          }`}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

function entraEnPeriodo(iso: string, periodo: Periodo) {
  if (periodo === "TODO") return true;
  const d = dias(iso);
  return periodo === "SEMANA" ? d <= 7 : d <= 31;
}

/**
 * Lo que ya entró, abajo del trabajo pendiente.
 *
 * Son ENTREGAS, no pedidos: un pedido que llegó en dos veces aparece dos
 * veces, con su "1ª de 2" y su "2ª de 2". No es un duplicado — cada entrega
 * tuvo su remito, su fecha y su factura.
 */
function HistorialEntregas({ entregas }: { entregas: EntregaHistorial[] }) {
  const [periodo, setPeriodo] = useState<Periodo>("MES");
  const [quien, setQuien] = useState("TODOS");

  const contrapartes = useMemo(
    () => Array.from(new Set(entregas.map((e) => e.contraparte))).sort((a, b) => a.localeCompare(b)),
    [entregas]
  );

  const visibles = useMemo(
    () =>
      entregas.filter(
        (e) => entraEnPeriodo(e.fechaRecibida, periodo) && (quien === "TODOS" || e.contraparte === quien)
      ),
    [entregas, periodo, quien]
  );

  const unidades = visibles.reduce((acc, e) => acc + e.unidades, 0);

  return (
    <div className="mt-6 border border-neutral-200 rounded-xl bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-100 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-neutral-900">✅ Ya recibidas</p>
          <p className="text-xs text-neutral-400 mt-0.5">
            Lo que entró. Si algo quedó mal cargado, avisale a administración.
          </p>
        </div>
        <p className="text-xs text-neutral-500 tabular-nums">
          <b className="text-neutral-800">
            {visibles.length} {visibles.length === 1 ? "entrega" : "entregas"}
          </b>{" "}
          · {unidades} unidades
        </p>
      </div>

      <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-100 flex items-center gap-2 flex-wrap">
        <select
          value={quien}
          onChange={(e) => setQuien(e.target.value)}
          className="text-xs rounded-lg border border-neutral-300 px-2 py-1.5 bg-white text-neutral-700"
        >
          <option value="TODOS">Todos los proveedores</option>
          {contrapartes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <FiltroPeriodo valor={periodo} onCambio={setPeriodo} />
      </div>

      {visibles.length === 0 ? (
        <p className="px-4 py-6 text-sm text-neutral-400 text-center">
          No hay entregas en este período.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-400 border-b border-neutral-100">
                <th className="px-4 py-2 font-bold">Pedido</th>
                <th className="px-4 py-2 font-bold">Proveedor / marca</th>
                <th className="px-4 py-2 font-bold">Pedido el</th>
                <th className="px-4 py-2 font-bold">Recibida el</th>
                <th className="px-4 py-2 font-bold">Entrega</th>
                <th className="px-4 py-2 font-bold text-right">Unidades</th>
                <th className="px-4 py-2 font-bold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((e) => (
                <tr key={e.idRecepcion} className="border-b border-neutral-50 last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">
                    #{e.idOrden.slice(0, 6).toUpperCase()}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-900">{e.contraparte}</td>
                  <td className="px-4 py-2.5 text-neutral-500 tabular-nums">
                    {e.fechaPedido ? fechaCorta(e.fechaPedido) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-700 tabular-nums">{fechaCorta(e.fechaRecibida)}</td>
                  <td className="px-4 py-2.5 text-xs text-neutral-400">
                    {e.totalEntregas === 1 ? "única" : `${e.numeroEntrega}ª de ${e.totalEntregas}`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">{e.unidades}</td>
                  <td className="px-4 py-2.5">
                    <ChipEstado estado={e.estadoOrden} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChipEstado({ estado }: { estado: string }) {
  const estilo =
    estado === RECIBIDA_PARCIAL
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : estado === CERRADA_INCOMPLETA
        ? "bg-red-50 text-red-700 border-red-200"
        : estado === "RECIBIDA"
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-neutral-50 text-neutral-500 border-neutral-200";
  return (
    <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${estilo}`}>
      {estado === RECIBIDA_PARCIAL ? "Parcial" : etiquetaEstado(estado, true)}
    </span>
  );
}

// ---------- Piezas compartidas ----------

function Seccion({
  titulo,
  vacio,
  children,
}: {
  titulo: string;
  vacio?: string;
  children: React.ReactNode;
}) {
  const hay = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (!hay && !vacio) return null;
  return (
    <div className="mb-5">
      <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">{titulo}</p>
      {hay ? (
        <div className="flex flex-col gap-2">{children}</div>
      ) : (
        <p className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-4 text-sm font-medium text-center">
          ✓ {vacio}
        </p>
      )}
    </div>
  );
}

function FilaOrden({
  f,
  accion,
  onAccion,
  tenue,
  trabajando,
  detalle,
}: {
  f: Fila;
  accion?: string;
  onAccion?: () => void;
  tenue?: boolean;
  trabajando?: boolean;
  /** Qué traía el pedido. Si viene, la fila se puede abrir. */
  detalle?: { nombre: string; pedidas: number; recibidas: number }[];
}) {
  // Las filas ya cerradas se pueden abrir para ver qué traían: si no, son
  // renglones muertos que ocupan lugar y no responden al clic.
  const [abierta, setAbierta] = useState(false);
  // Una orden emitida hace más de dos días y todavía sin mandar es el caso
  // que este tablero viene a evitar: el pedido que nunca sale.
  const demorado = f.estado === PENDIENTE && !f.enviadaEl && f.dias > 2;

  const abrible = Boolean(detalle && detalle.length > 0);

  return (
    <div
      className={`border border-neutral-200 border-l-[3px] rounded-xl bg-white ${
        f.origen === "MARCA" ? "border-l-violet-500" : "border-l-accent"
      } ${tenue && !abierta ? "opacity-70" : ""}`}
    >
    <div
      className={`flex items-center gap-3 flex-wrap px-4 py-3 ${abrible ? "cursor-pointer" : ""}`}
      onClick={abrible ? () => setAbierta((v) => !v) : undefined}
    >
      <span className="flex-1 min-w-[200px]">
        <span className="block font-semibold text-[14.5px] text-neutral-900">
          {abrible && <span className="text-neutral-400 text-xs mr-1.5">{abierta ? "▾" : "▸"}</span>}
          {f.contraparte}
        </span>
        <span className="block text-xs text-neutral-400">
          Pedida el {fechaCorta(f.fecha)} · {f.unidades} unidades · {f.local}
        </span>
      </span>

      <span
        className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
          f.origen === "MARCA"
            ? "bg-violet-50 text-violet-700 border-violet-200"
            : "bg-accent-tint text-accent border-blue-200"
        }`}
      >
        {f.origen === "MARCA" ? "Marca" : "Proveedor"}
      </span>

      <span className="text-right min-w-[100px]">
        <span
          className={`block text-[13px] font-semibold ${
            demorado ? "text-amber-700" : f.estado === RECIBIDA_PARCIAL ? "text-amber-700" : "text-neutral-700"
          }`}
        >
          {etiquetaEstado(f.estado, Boolean(f.enviadaEl))}
        </span>
        <span className={`block text-[11px] ${demorado ? "text-amber-700 font-semibold" : "text-neutral-400"}`}>
          {f.enviadaEl && estaAbierta(f.estado)
            ? `mandada ${haceCuanto(dias(f.enviadaEl))}`
            : `pedida ${haceCuanto(f.dias)}`}
        </span>
      </span>

      {accion && onAccion && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAccion();
          }}
          disabled={trabajando}
          className="text-sm font-semibold bg-accent hover:bg-accent-dark text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          {trabajando ? "..." : accion}
        </button>
      )}
    </div>

    {abierta && detalle && (
      <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50">
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Qué traía</p>
        <table className="w-full text-xs">
          <tbody>
            {detalle.map((d, i) => {
              const falto = d.recibidas < d.pedidas;
              return (
                <tr key={i}>
                  <td className="py-1 text-neutral-600">{d.nombre}</td>
                  <td className="py-1 text-right text-neutral-400 tabular-nums w-20">{d.pedidas} pedidas</td>
                  <td
                    className={`py-1 text-right tabular-nums w-24 ${
                      falto ? "text-red-600 font-semibold" : "text-neutral-700"
                    }`}
                  >
                    {d.recibidas} llegaron
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
    </div>
  );
}
