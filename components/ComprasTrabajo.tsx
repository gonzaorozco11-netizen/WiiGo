"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  marcarOrdenEnviada,
  desmarcarOrdenEnviada,
  cancelarOrden,
  cerrarOrdenIncompleta,
} from "@/app/(app)/compras/actions";
import { anularCosteo } from "@/app/(app)/proveedores/actions";
import type { DatosCompras, EntregaHistorial, LineaEntrega } from "@/lib/comprasDatos";
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
import NuevaOrdenCompraModal, { type OrdenParaEditar } from "@/components/NuevaOrdenCompraModal";
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

export default function ComprasTrabajo({
  etapa,
  datos,
  puedeCerrarPedidos = true,
}: {
  etapa: Etapa;
  datos: DatosCompras;
  /** Cerrar un pedido incompleto es decisión de administración, no del local. */
  puedeCerrarPedidos?: boolean;
}) {
  const [nuevaMarca, setNuevaMarca] = useState(false);
  const [nuevaProveedor, setNuevaProveedor] = useState(false);
  const [editando, setEditando] = useState<OrdenParaEditar | null>(null);
  const [recibirMarca, setRecibirMarca] = useState<OrdenReposicion | null>(null);
  const [recibirProveedor, setRecibirProveedor] = useState<OrdenCompraProveedor | null>(null);
  // Se costea una ENTREGA, no un pedido: dos entregas del mismo pedido
  // pueden traer precios distintos y cada una es su propio lote.
  const [costear, setCostear] = useState<EntregaHistorial | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscarOrdenes, setBuscarOrdenes] = useState("");
  const [origenFiltro, setOrigenFiltro] = useState<"TODAS" | "MARCA" | "PROVEEDOR">("TODAS");
  const [periodoCerradas, setPeriodoCerradas] = useState<Periodo>("MES");
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

  /** Se marcó como enviada por error y todavía no llegó nada: vuelve a Órdenes. */
  function deshacerEnvio(f: Fila) {
    setError(null);
    setEnviando(`${f.origen}-${f.idOrden}`);
    desmarcarOrdenEnviada(f.origen, f.idOrden)
      .then((r) => {
        if (r.error) setError(r.error);
        else router.refresh();
      })
      .finally(() => setEnviando(null));
  }

  /** Cuántas unidades del pedido nunca llegaron. */
  const faltanteDePedido = (f: Fila) =>
    (f.origen === "MARCA" ? detalleMarcaDe(f.idOrden) : detalleProveedorDe(f.idOrden)).reduce(
      (acc, d) => acc + Math.max(0, (d.cantidad_solicitada ?? 0) - (d.cantidad_recibida ?? 0)),
      0
    );

  /**
   * Dar por cerrado un pedido a medias, desde Recepción.
   *
   * Mismo flujo que el de Costeo — pregunta el motivo y si eso estaba
   * facturado — porque es la misma decisión. Lo que cambia es dónde se toma:
   * acá es donde uno ve que el pedido quedó colgado.
   */
  function cerrarPedidoDesdeRecepcion(f: Fila, faltan: number) {
    const motivo = window.prompt(
      `Vas a dar por cerrado el pedido a ${f.contraparte} con ${faltan} unidades sin recibir.\n\n¿Por qué?`,
      "El proveedor no envía el resto"
    );
    if (motivo === null) return;

    const netoTexto = window.prompt(
      "¿Esa mercadería que no llegó ya estaba facturada?\n\n" +
        "Si te la cobraron, poné el NETO facturado de más (sin IVA) y queda un reclamo de nota de crédito.\n\n" +
        "Si no estaba facturada, dejalo en 0.",
      "0"
    );
    if (netoTexto === null) return;
    const neto = Number(netoTexto) || 0;

    let iva = 0;
    if (neto > 0) {
      const ivaTexto = window.prompt(`IVA de esos $${neto.toLocaleString("es-AR")}:`, String(Math.round(neto * 0.21)));
      if (ivaTexto === null) return;
      iva = Number(ivaTexto) || 0;
    }

    setError(null);
    setEnviando(`${f.origen}-${f.idOrden}`);
    cerrarOrdenIncompleta("PROVEEDOR", f.idOrden, motivo, neto > 0 ? { neto, iva } : null)
      .then((r) => {
        if (r.error) setError(r.error);
        else {
          if (r.aviso) window.alert(r.aviso);
          router.refresh();
        }
      })
      .finally(() => setEnviando(null));
  }

  /** Corregir un pedido a proveedor que todavía no salió. */
  function abrirEdicion(f: Fila) {
    const orden = datos.ordenesProveedor.find((o) => o.id_orden === f.idOrden);
    if (!orden) return;
    setEditando({
      idOrden: orden.id_orden,
      idProveedor: orden.id_proveedor,
      idLocal: orden.id_local,
      observaciones: orden.observaciones ?? "",
      lineas: detalleProveedorDe(orden.id_orden).map((d) => ({
        idVariante: d.id_variante,
        cantidad: d.cantidad_solicitada ?? 0,
      })),
    });
  }

  function anular(f: Fila) {
    const motivo = window.prompt(
      `Vas a anular el pedido a ${f.contraparte} de ${f.unidades} unidades.\n\n¿Por qué? (queda anotado)`,
      "Cargado por error"
    );
    if (motivo === null) return;
    setError(null);
    setEnviando(`${f.origen}-${f.idOrden}`);
    cancelarOrden(f.origen, f.idOrden, motivo)
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
  // Lo pendiente no se filtra: son pocas filas y esconder trabajo detrás de
  // un buscador es la forma más fácil de que un pedido se pierda.
  const sinEnviar = useMemo(
    () => todas.filter((o) => o.estado === PENDIENTE && !o.enviadaEl).sort((a, b) => a.fecha.localeCompare(b.fecha)),
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

  // Los filtros son solo del historial: son pedidos terminados, y sin corte
  // la lista crece para siempre.
  const todasCerradas = useMemo(() => todas.filter((o) => !estaAbierta(o.estado)), [todas]);
  const hayCerradas = todasCerradas.length > 0;
  const cerradas = useMemo(
    () =>
      todasCerradas
        .filter(
          (o) =>
            coincide(buscarOrdenes, o.contraparte, o.idOrden) &&
            (origenFiltro === "TODAS" || o.origen === origenFiltro) &&
            entraEnPeriodo(o.fecha, periodoCerradas)
        )
        .sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [todasCerradas, buscarOrdenes, origenFiltro, periodoCerradas]
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

          {/* Lo que hay que hacer: tarjetas grandes, con sombra y botón. */}
          {sinEnviar.length === 0 ? (
            <p className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-4 text-sm font-medium text-center">
              ✓ Todas las órdenes ya fueron enviadas.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {sinEnviar.map((f) => {
                const clave = `${f.origen}-${f.idOrden}`;
                const demorado = f.dias > 2;
                return (
                  <TarjetaTrabajo
                    key={clave}
                    icono="📤"
                    tono={demorado ? "ambar" : "azul"}
                    titulo={f.contraparte}
                    detalle={
                      <>
                        {f.unidades} unidades · {f.local} · pedida {haceCuanto(f.dias)}
                        {demorado && <b className="text-amber-700"> · todavía sin mandar</b>}
                      </>
                    }
                    etiqueta={<EtiquetaOrigen origen={f.origen} />}
                  >
                    {/* Mientras no se mandó, el pedido se puede corregir o
                        tirar sin consecuencias: no hay mercadería ni deuda. */}
                    {f.origen === "PROVEEDOR" && <BotonSuave onClick={() => abrirEdicion(f)}>Editar</BotonSuave>}
                    <BotonSuave onClick={() => anular(f)}>Anular</BotonSuave>
                    <BotonPrincipal onClick={() => enviar(f)} disabled={enviando === clave}>
                      {enviando === clave ? "..." : "Marcar como enviada →"}
                    </BotonPrincipal>
                  </TarjetaTrabajo>
                );
              })}
            </div>
          )}

          {/* En camino: ni trabajo ni archivo. Filas livianas, sin sombra. */}
          {esperandoLlegar.length > 0 && (
            <div className="mt-5">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 mb-2">
                Ya enviadas · esperando en Recepción
              </p>
              <div className="flex flex-col gap-1.5">
                {esperandoLlegar.map((f) => {
                  const clave = `${f.origen}-${f.idOrden}`;
                  return (
                    <div
                      key={clave}
                      className="flex items-center gap-3 flex-wrap border border-neutral-200 rounded-lg px-3.5 py-2 bg-white"
                    >
                      <span className="flex-1 min-w-[160px] text-[13px]">
                        <b className="font-semibold text-neutral-800">{f.contraparte}</b>
                        <span className="text-neutral-400">
                          {" "}
                          · {f.unidades} un. · mandada {haceCuanto(dias(f.enviadaEl ?? f.fecha))}
                        </span>
                      </span>
                      <BotonSuave onClick={() => deshacerEnvio(f)} disabled={enviando === clave}>
                        Deshacer envío
                      </BotonSuave>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {hayCerradas && (
            <>
              <Corte />
              <CajaHistorial
                titulo="Pedidos cerrados"
                resumen={
                  <>
                    <b className="text-neutral-800">
                      {cerradas.length} {cerradas.length === 1 ? "pedido" : "pedidos"}
                    </b>{" "}
                    · {cerradas.reduce((a, f) => a + f.unidades, 0)} unidades
                  </>
                }
                filtros={
                  <>
                    <Buscador
                      valor={buscarOrdenes}
                      onCambio={setBuscarOrdenes}
                      placeholder="Buscar por proveedor, marca o número de pedido..."
                    />
                    <GrupoBotones
                      opciones={[
                        { clave: "TODAS" as const, texto: "Todas" },
                        { clave: "PROVEEDOR" as const, texto: "Proveedores" },
                        { clave: "MARCA" as const, texto: "Marcas" },
                      ]}
                      valor={origenFiltro}
                      onCambio={setOrigenFiltro}
                    />
                    <FiltroPeriodo valor={periodoCerradas} onCambio={setPeriodoCerradas} />
                  </>
                }
                vacio={cerradas.length === 0 ? "No hay pedidos cerrados con esos filtros." : undefined}
              >
                <TablaPedidos filas={cerradas} contenidoDe={contenidoDe} />
              </CajaHistorial>
            </>
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

          {esperandoLlegar.length === 0 && aMedias.length === 0 ? (
            <p className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-4 text-sm font-medium text-center">
              ✓ No hay nada esperando. Todo lo que se mandó ya llegó.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {/* Llegó una parte y falta el resto. Va primero y en ámbar:
                  es lo que tiene mercadería en la calle hace más tiempo. */}
              {aMedias.map((f) => {
                const faltan = faltanteDePedido(f);
                return (
                  <TarjetaTrabajo
                    key={`${f.origen}-${f.idOrden}`}
                    icono="⏳"
                    tono="ambar"
                    titulo={f.contraparte}
                    detalle={
                      <>
                        {faltan > 0 ? `Faltan ${faltan} unidades` : "Llegó a medias"} · mandada{" "}
                        {haceCuanto(dias(f.enviadaEl ?? f.fecha))} · {f.local}
                      </>
                    }
                    etiqueta={<EtiquetaOrigen origen={f.origen} />}
                  >
                    {/* "No las van a mandar más" se decide acá también, no
                        solo en Costeo: este es el lugar donde uno VE que el
                        pedido quedó a medias, y buscarlo en otra pantalla es
                        lo que hace que quede abierto para siempre. */}
                    {puedeCerrarPedidos && f.origen === "PROVEEDOR" && (
                      <BotonSuave
                        onClick={() => cerrarPedidoDesdeRecepcion(f, faltan)}
                        disabled={enviando === `${f.origen}-${f.idOrden}`}
                      >
                        No lo mandan más
                      </BotonSuave>
                    )}
                    <BotonPrincipal tono="ambar" onClick={() => abrirRecepcion(f)}>
                      Recibir el resto →
                    </BotonPrincipal>
                  </TarjetaTrabajo>
                );
              })}

              {esperandoLlegar.map((f) => (
                <TarjetaTrabajo
                  key={`${f.origen}-${f.idOrden}`}
                  icono="📥"
                  titulo={f.contraparte}
                  detalle={
                    <>
                      {f.unidades} unidades · {f.local} · mandada {haceCuanto(dias(f.enviadaEl ?? f.fecha))}
                    </>
                  }
                  etiqueta={<EtiquetaOrigen origen={f.origen} />}
                >
                  <BotonPrincipal onClick={() => abrirRecepcion(f)}>Recepcionar →</BotonPrincipal>
                </TarjetaTrabajo>
              ))}
            </div>
          )}

          {sinEnviar.length > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-4">
              Hay {sinEnviar.length} {sinEnviar.length === 1 ? "orden emitida" : "órdenes emitidas"} que todavía no se
              mandaron. No aparecen acá hasta que administración las marque como enviadas.
            </p>
          )}

          <Corte />

          <HistorialEntregas
            entregas={datos.entregas}
            lineas={datos.lineasEntrega}
            nombrePorVariante={nombrePorVariante}
          />

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
      {/* El mismo formulario, con el pedido adentro. No hay una pantalla de
          edición aparte: dos formularios para lo mismo terminan divergiendo. */}
      {editando && (
        <NuevaOrdenCompraModal
          proveedores={datos.proveedores}
          locales={datos.locales}
          filas={filasPropias}
          cantidadPorClave={cantidadPorClave}
          editar={editando}
          onClose={() => {
            setEditando(null);
            router.refresh();
          }}
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
          todasLasLineas={datos.lineasEntrega}
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
  const [anulando, setAnulando] = useState<string | null>(null);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);
  // Los filtros van solo sobre las ya costeadas. "Por costear" es trabajo
  // pendiente: esconderlo detrás de un filtro de fecha es como taparlo.
  const [buscarCosteadas, setBuscarCosteadas] = useState("");
  const [periodoCosteadas, setPeriodoCosteadas] = useState<Periodo>("MES");

  /** Cuántas unidades del pedido nunca llegaron. 0 = llegó todo. */
  function faltanteDe(idOrden: string) {
    return datos.detalleProveedor
      .filter((d) => d.id_orden === idOrden)
      .reduce((acc, d) => acc + Math.max(0, (d.cantidad_solicitada ?? 0) - (d.cantidad_recibida ?? 0)), 0);
  }

  /**
   * Deshacer un costeo entero. Para un número mal puesto está Corregir; esto
   * es para cuando el costeo no tendría que haber pasado.
   */
  function anularEsteCosteo(idRecepcion: string, proveedor: string) {
    const motivo = window.prompt(
      `Vas a anular el costeo de esta entrega de ${proveedor}.\n\n` +
        "La entrega vuelve a Por costear y la deuda se cancela con un movimiento contrario.\n\n" +
        "¿Por qué lo anulás? (queda en el historial)",
      ""
    );
    if (motivo === null) return;
    setErrorCierre(null);
    setAnulando(idRecepcion);
    anularCosteo(idRecepcion, motivo)
      .then((r) => {
        if (r.error) setErrorCierre(r.error);
        else {
          if (r.aviso) window.alert(r.aviso);
          router.refresh();
        }
      })
      .finally(() => setAnulando(null));
  }

  function cerrarPedido(idOrden: string, faltan: number) {
    const motivo = window.prompt(
      `Vas a dar por cerrado este pedido con ${faltan} unidades sin recibir.\n\n¿Por qué?`,
      "El proveedor no envía el resto"
    );
    if (motivo === null) return;

    // La pregunta que decide si nace un reclamo. Se pregunta y no se calcula:
    // el sistema sabe cuántas faltaron, pero no si el proveedor las facturó
    // ni a qué precio.
    const netoTexto = window.prompt(
      "¿Esa mercadería que no llegó ya estaba facturada?\n\n" +
        "Si te la cobraron, poné el NETO que te facturaron de más (sin IVA) y queda un reclamo de nota de crédito.\n\n" +
        "Si no estaba facturada, dejalo en 0.",
      "0"
    );
    if (netoTexto === null) return;
    const neto = Number(netoTexto) || 0;

    let iva = 0;
    if (neto > 0) {
      const ivaTexto = window.prompt(`IVA de esos $${neto.toLocaleString("es-AR")}:`, String(Math.round(neto * 0.21)));
      if (ivaTexto === null) return;
      iva = Number(ivaTexto) || 0;
    }

    setErrorCierre(null);
    setCerrando(idOrden);
    cerrarOrdenIncompleta("PROVEEDOR", idOrden, motivo, neto > 0 ? { neto, iva } : null)
      .then((r) => {
        if (r.error) setErrorCierre(r.error);
        else {
          if (r.aviso) window.alert(r.aviso);
          router.refresh();
        }
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

  const costeadasVisibles = costeadas.filter(
    (r) =>
      entraEnPeriodo(r.fecha, periodoCosteadas) &&
      coincide(buscarCosteadas, r.proveedor?.nombre ?? "", r.id_orden)
  );
  // Cuánto costó lo que se ve: el costo real ya cargado de cada entrega.
  const montoCosteado = costeadasVisibles.reduce(
    (acc, r) =>
      acc +
      datos.lineasEntrega
        .filter((l) => l.idRecepcion === r.id_recepcion)
        .reduce((a, l) => a + (l.costoUnitario ?? 0) * l.cantidadRecibida, 0),
    0
  );

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

      {porCostear.length === 0 ? (
        <p className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-4 text-sm font-medium text-center">
          ✓ Todo lo recibido tiene su costo cargado.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {porCostear.map((r) => {
            const aMedias = r.orden?.estado === RECIBIDA_PARCIAL;
            const faltan = aMedias ? faltanteDe(r.id_orden) : 0;
            return (
              <TarjetaTrabajo
                key={r.id_recepcion}
                icono="🧮"
                tono={r.dias > 3 ? "rojo" : "azul"}
                titulo={
                  <>
                    {r.proveedor?.nombre ?? "—"}
                    {r.entrega && r.entrega.totalEntregas > 1 && (
                      <span className="ml-2 text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 align-middle">
                        {r.entrega.numeroEntrega}ª de {r.entrega.totalEntregas}
                      </span>
                    )}
                  </>
                }
                detalle={
                  <>
                    Pedido el {r.orden ? fechaCorta(r.orden.fecha_alta) : "—"} · recibido el {fechaCorta(r.fecha)} ·{" "}
                    {r.productos} {r.productos === 1 ? "producto" : "productos"}
                    {r.dias > 3 ? (
                      <b className="text-red-700"> · {haceCuanto(r.dias)}, sin costear</b>
                    ) : (
                      <> · {haceCuanto(r.dias)}</>
                    )}
                  </>
                }
                etiqueta={
                  <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full border bg-neutral-50 text-neutral-500 border-neutral-200 whitespace-nowrap">
                    {MODO[r.proveedor?.modo_facturacion ?? ""] ?? r.proveedor?.modo_facturacion}
                  </span>
                }
                /* El faltante aparece acá y no en Recepción: reclamarle a la
                   marca es trabajo de administración, que es quien está
                   mirando esta pantalla. El local solo cuenta lo que llegó. */
                pie={
                  aMedias && faltan > 0 ? (
                    <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 flex-wrap rounded-b-[11px]">
                      <span className="flex-1 min-w-[220px] text-sm text-amber-900">
                        <b>Este pedido llegó a medias — faltan {faltan} unidades.</b> Lo que ves acá es solo esta
                        entrega. Si el proveedor manda el resto, entra como una entrega nueva.
                      </span>
                      <button
                        onClick={() => cerrarPedido(r.id_orden, faltan)}
                        disabled={cerrando === r.id_orden}
                        className="text-sm font-semibold text-amber-900 bg-white border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {cerrando === r.id_orden ? "Cerrando..." : "Cerrar pedido como está"}
                      </button>
                    </div>
                  ) : undefined
                }
              >
                <BotonPrincipal onClick={() => r.entrega && onCostear(r.entrega)}>Costear →</BotonPrincipal>
              </TarjetaTrabajo>
            );
          })}
        </div>
      )}

      {/* Ya costeadas pero todavía sin liquidar: se pueden corregir. Es el
          único momento en que cambiar un costo no reescribe nada — esa plata
          todavía no se le pagó a nadie. Al liquidarse, desaparecen de acá. */}
      {costeadas.length > 0 && (
        <>
          <Corte />
          <CajaHistorial
            titulo="Ya costeadas · todavía se pueden corregir"
            resumen={
              <>
                <b className="text-neutral-800">
                  {costeadasVisibles.length} {costeadasVisibles.length === 1 ? "entrega" : "entregas"}
                </b>{" "}
                · ${montoCosteado.toLocaleString("es-AR", { maximumFractionDigits: 0 })} en costo
              </>
            }
            filtros={
              <>
                <Buscador
                  valor={buscarCosteadas}
                  onCambio={setBuscarCosteadas}
                  placeholder="Buscar por proveedor o número de pedido..."
                />
                <FiltroPeriodo valor={periodoCosteadas} onCambio={setPeriodoCosteadas} />
              </>
            }
            vacio={costeadasVisibles.length === 0 ? "No hay entregas costeadas en este período." : undefined}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200">
                    <th className={THEAD}>Pedido</th>
                    <th className={THEAD}>Proveedor</th>
                    <th className={THEAD}>Recibido el</th>
                    <th className={`${THEAD} text-right`}>Costo</th>
                    <th className={`${THEAD} text-right`}></th>
                  </tr>
                </thead>
                <tbody>
                  {costeadasVisibles.map((r) => {
                    const costo = datos.lineasEntrega
                      .filter((l) => l.idRecepcion === r.id_recepcion)
                      .reduce((a, l) => a + (l.costoUnitario ?? 0) * l.cantidadRecibida, 0);
                    return (
                      <tr key={r.id_recepcion} className="hover:bg-neutral-50">
                        <td className={`${TD} font-mono text-[11px] text-neutral-400 whitespace-nowrap`}>
                          #{r.id_orden.slice(0, 6).toUpperCase()}
                        </td>
                        <td className={`${TD} text-neutral-800`}>
                          {r.proveedor?.nombre ?? "—"}
                          {r.entrega && r.entrega.totalEntregas > 1 && (
                            <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                              {r.entrega.numeroEntrega}ª de {r.entrega.totalEntregas}
                            </span>
                          )}
                        </td>
                        <td className={`${TD} tabular-nums`}>{fechaCorta(r.fecha)}</td>
                        <td className={`${TD} text-right tabular-nums text-neutral-800`}>
                          ${costo.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
                        </td>
                        <td className={`${TD} text-right whitespace-nowrap`}>
                          {/* Si el pedido sigue a medias, acá también se
                              puede dar por cerrado: costear la entrega no
                              tendría que hacer desaparecer esa decisión. */}
                          {r.orden?.estado === RECIBIDA_PARCIAL && faltanteDe(r.id_orden) > 0 && (
                            <button
                              onClick={() => cerrarPedido(r.id_orden, faltanteDe(r.id_orden))}
                              disabled={cerrando === r.id_orden}
                              className="text-[11px] font-semibold text-amber-700 hover:underline mr-3 disabled:opacity-50"
                            >
                              {cerrando === r.id_orden ? "..." : "No lo mandan más"}
                            </button>
                          )}
                          {/* Anular a la izquierda y en gris: Corregir es lo
                              que se usa casi siempre. */}
                          <button
                            onClick={() => anularEsteCosteo(r.id_recepcion, r.proveedor?.nombre ?? "")}
                            disabled={anulando === r.id_recepcion}
                            className="text-[11px] font-semibold text-neutral-400 hover:text-neutral-700 mr-3 disabled:opacity-50"
                          >
                            {anulando === r.id_recepcion ? "..." : "Anular"}
                          </button>
                          <button
                            onClick={() => r.entrega && onCostear(r.entrega)}
                            className="text-[11px] font-bold text-accent hover:underline"
                          >
                            Corregir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CajaHistorial>
        </>
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

/** El buscador, igual en las tres pantallas. */
function Buscador({
  valor,
  onCambio,
  placeholder,
}: {
  valor: string;
  onCambio: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1 min-w-[190px]">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs" aria-hidden="true">
        🔍
      </span>
      <input
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder={placeholder}
        className="w-full text-xs rounded-lg border border-neutral-300 pl-7 pr-7 py-1.5 bg-white text-neutral-700 focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {valor && (
        <button
          onClick={() => onCambio("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 text-xs"
          aria-label="Limpiar"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Botones de filtro. Oscuro el elegido, para que no compita con el azul de las acciones. */
function GrupoBotones<T extends string>({
  opciones,
  valor,
  onCambio,
}: {
  opciones: { clave: T; texto: string }[];
  valor: T;
  onCambio: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {opciones.map((o) => (
        <button
          key={o.clave}
          onClick={() => onCambio(o.clave)}
          className={`text-xs font-semibold rounded-lg px-2.5 py-1 border ${
            valor === o.clave
              ? "bg-neutral-800 text-white border-neutral-800"
              : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
          }`}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

/** ¿El texto buscado aparece en el nombre o en el código del pedido? */
function coincide(q: string, contraparte: string, idOrden: string) {
  if (!q) return true;
  const t = q.trim().toLowerCase();
  return contraparte.toLowerCase().includes(t) || idOrden.toLowerCase().includes(t);
}

/**
 * Lo que ya entró, abajo del trabajo pendiente.
 *
 * Son ENTREGAS, no pedidos: un pedido que llegó en dos veces aparece dos
 * veces, con su "1ª de 2" y su "2ª de 2". No es un duplicado — cada entrega
 * tuvo su remito, su fecha y su factura.
 */
type FiltroEstado = "TODAS" | "COMPLETAS" | "PARCIALES" | "PROBLEMA";

function HistorialEntregas({
  entregas,
  lineas,
  nombrePorVariante,
}: {
  entregas: EntregaHistorial[];
  lineas: LineaEntrega[];
  nombrePorVariante: Map<string, string>;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("MES");
  const [quien, setQuien] = useState("TODOS");
  const [estado, setEstado] = useState<FiltroEstado>("TODAS");
  const [busqueda, setBusqueda] = useState("");
  /** Qué fila está abierta. Una sola por vez: abrir la siguiente cierra la anterior. */
  const [abierta, setAbierta] = useState<string | null>(null);

  const contrapartes = useMemo(
    () => Array.from(new Set(entregas.map((e) => e.contraparte))).sort((a, b) => a.localeCompare(b)),
    [entregas]
  );

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return entregas.filter((e) => {
      if (!entraEnPeriodo(e.fechaRecibida, periodo)) return false;
      if (quien !== "TODOS" && e.contraparte !== quien) return false;
      if (estado === "COMPLETAS" && e.estadoOrden !== "RECIBIDA") return false;
      if (estado === "PARCIALES" && e.estadoOrden !== RECIBIDA_PARCIAL) return false;
      if (
        estado === "PROBLEMA" &&
        e.estadoOrden !== CERRADA_INCOMPLETA &&
        e.estadoOrden !== "RECIBIDA_CON_DIFERENCIAS"
      ) {
        return false;
      }
      // Se busca por proveedor y por código de pedido: son las dos formas en
      // que alguien se acuerda de una entrega.
      if (q && !e.contraparte.toLowerCase().includes(q) && !e.idOrden.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entregas, periodo, quien, estado, busqueda]);

  const unidades = visibles.reduce((acc, e) => acc + e.unidades, 0);

  const filtrosEstado: { clave: FiltroEstado; texto: string }[] = [
    { clave: "TODAS", texto: "Todas" },
    { clave: "COMPLETAS", texto: "Completas" },
    { clave: "PARCIALES", texto: "Parciales" },
    { clave: "PROBLEMA", texto: "Con problema" },
  ];

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

      <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-100 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Buscador valor={busqueda} onCambio={setBusqueda} placeholder="Buscar por proveedor o número de pedido..." />
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
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <GrupoBotones opciones={filtrosEstado} valor={estado} onCambio={setEstado} />
          <span className="flex-1" />
          <FiltroPeriodo valor={periodo} onCambio={setPeriodo} />
        </div>
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
              {visibles.map((e) => {
                const suyas = lineas.filter((l) => l.idRecepcion === e.idRecepcion);
                const estaAbierta = abierta === e.idRecepcion;
                return (
                  <Fragment key={e.idRecepcion}>
                    <tr
                      onClick={() => setAbierta(estaAbierta ? null : e.idRecepcion)}
                      className={`border-b border-neutral-50 last:border-0 cursor-pointer hover:bg-neutral-50 ${
                        estaAbierta ? "bg-neutral-50" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-neutral-500 whitespace-nowrap">
                        <span className="text-neutral-400 mr-1">{estaAbierta ? "▾" : "▸"}</span>
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
                    {estaAbierta && (
                      <tr>
                        <td colSpan={7} className="px-4 pb-3 pt-0 bg-neutral-50 border-b border-neutral-100">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                            Qué entró en esta entrega
                          </p>
                          {suyas.length === 0 ? (
                            <p className="text-xs text-neutral-400 py-1">
                              No quedó el detalle de esta entrega. Suele pasar con las cargadas antes de septiembre.
                            </p>
                          ) : (
                            <table className="w-full text-xs">
                              <tbody>
                                {suyas.map((l) => {
                                  const falto = l.cantidadRecibida < l.cantidadSolicitada;
                                  return (
                                    <tr key={l.idVariante}>
                                      <td className="py-1 text-neutral-700">
                                        {nombrePorVariante.get(l.idVariante) ?? "Producto"}
                                      </td>
                                      <td className="py-1 text-right text-neutral-400 tabular-nums w-24">
                                        {l.cantidadSolicitada > 0 ? `${l.cantidadSolicitada} pedidas` : ""}
                                      </td>
                                      <td
                                        className={`py-1 text-right tabular-nums w-24 font-semibold ${
                                          falto ? "text-amber-700" : "text-neutral-800"
                                        }`}
                                      >
                                        {l.cantidadRecibida} llegaron
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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

function EtiquetaOrigen({ origen }: { origen: "MARCA" | "PROVEEDOR" }) {
  return (
    <span
      className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
        origen === "MARCA"
          ? "bg-violet-50 text-violet-700 border-violet-200"
          : "bg-accent-tint text-accent border-blue-200"
      }`}
    >
      {origen === "MARCA" ? "Marca" : "Proveedor"}
    </span>
  );
}

/**
 * El corte entre lo que hay que hacer y lo que ya pasó.
 *
 * Una línea que cruza la pantalla, no otro subtítulo en gris. La diferencia
 * entre trabajo y archivo tiene que verse de reojo, sin leer: arriba tarjetas
 * con sombra y botón azul, abajo una tabla plana.
 */
function Corte({ texto = "Historial" }: { texto?: string }) {
  return (
    <div className="flex items-center gap-3 my-6">
      <span className="h-px bg-neutral-200 flex-1" />
      <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-neutral-400">{texto}</span>
      <span className="h-px bg-neutral-200 flex-1" />
    </div>
  );
}

/** Lo que hay que hacer. Grande, con ícono y sombra — no se confunde con una fila. */
function TarjetaTrabajo({
  icono,
  titulo,
  detalle,
  etiqueta,
  tono = "azul",
  children,
  pie,
}: {
  icono: string;
  titulo: React.ReactNode;
  detalle: React.ReactNode;
  etiqueta?: React.ReactNode;
  tono?: "azul" | "ambar" | "rojo";
  /** Los botones. */
  children?: React.ReactNode;
  /** Una franja debajo, para avisos pegados a la tarjeta. */
  pie?: React.ReactNode;
}) {
  const borde =
    tono === "ambar" ? "border-l-amber-500" : tono === "rojo" ? "border-l-red-500" : "border-l-accent";
  const fondoIcono =
    tono === "ambar" ? "bg-amber-50" : tono === "rojo" ? "bg-red-50" : "bg-accent-tint";
  const sombra =
    tono === "ambar"
      ? "shadow-[0_2px_8px_-4px_rgba(180,83,9,.35)]"
      : tono === "rojo"
        ? "shadow-[0_2px_8px_-4px_rgba(185,28,28,.35)]"
        : "shadow-[0_2px_8px_-4px_rgba(37,99,235,.35)]";

  return (
    <div className={`border border-neutral-200 border-l-4 ${borde} rounded-xl bg-white ${sombra}`}>
      <div className="flex items-center gap-3.5 px-4 py-3.5 flex-wrap">
        <span className={`w-9 h-9 rounded-xl ${fondoIcono} flex items-center justify-center text-[17px] shrink-0`}>
          {icono}
        </span>
        <span className="flex-1 min-w-[170px]">
          <span className="tipo-titulo block text-[16px] font-semibold text-neutral-900">{titulo}</span>
          <span className="block text-[12.5px] text-neutral-500">{detalle}</span>
        </span>
        {etiqueta}
        {children && <span className="flex items-center gap-2 flex-wrap">{children}</span>}
      </div>
      {pie}
    </div>
  );
}

function BotonPrincipal({
  children,
  onClick,
  disabled,
  tono = "azul",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tono?: "azul" | "ambar";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-sm font-semibold text-white rounded-lg px-4 py-2 disabled:opacity-50 ${
        tono === "ambar" ? "bg-amber-600 hover:bg-amber-700" : "bg-accent hover:bg-accent-dark"
      }`}
    >
      {children}
    </button>
  );
}

function BotonSuave({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-xs font-semibold text-neutral-500 border border-neutral-300 rounded-lg px-2.5 py-1.5 hover:bg-neutral-50 hover:text-neutral-700 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** La caja del historial: encabezado con el contador, filtros y la tabla. */
function CajaHistorial({
  titulo,
  resumen,
  filtros,
  vacio,
  children,
}: {
  titulo: string;
  resumen: React.ReactNode;
  filtros?: React.ReactNode;
  vacio?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-neutral-100 flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] font-semibold text-neutral-800">{titulo}</p>
        <p className="text-[11.5px] text-neutral-500 tabular-nums">{resumen}</p>
      </div>
      {filtros && (
        <div className="px-4 py-2 bg-neutral-50 border-b border-neutral-100 flex items-center gap-2 flex-wrap">
          {filtros}
        </div>
      )}
      {vacio ? <p className="px-4 py-6 text-sm text-neutral-400 text-center">{vacio}</p> : children}
    </div>
  );
}

const THEAD = "text-left text-[9.5px] uppercase tracking-[0.06em] text-neutral-400 font-bold px-4 py-1.5";
const TD = "px-4 py-1.5 text-[12px] text-neutral-600 border-b border-neutral-50";

/** Los pedidos ya cerrados, como tabla. Cada fila se abre para ver qué traía. */
function TablaPedidos({
  filas,
  contenidoDe,
}: {
  filas: Fila[];
  contenidoDe: (f: Fila) => { nombre: string; pedidas: number; recibidas: number }[];
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[540px]">
        <thead>
          <tr className="bg-neutral-50 border-b border-neutral-200">
            <th className={THEAD}>Pedido</th>
            <th className={THEAD}>Quién</th>
            <th className={THEAD}>Pedido el</th>
            <th className={`${THEAD} text-right`}>Unid.</th>
            <th className={THEAD}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const clave = `${f.origen}-${f.idOrden}`;
            const esta = abierta === clave;
            const detalle = contenidoDe(f);
            return (
              <Fragment key={clave}>
                <tr
                  onClick={() => setAbierta(esta ? null : clave)}
                  className={`cursor-pointer hover:bg-neutral-50 ${esta ? "bg-neutral-50" : ""}`}
                >
                  <td className={`${TD} font-mono text-[11px] text-neutral-400 whitespace-nowrap`}>
                    {esta ? "▾" : "▸"} #{f.idOrden.slice(0, 6).toUpperCase()}
                  </td>
                  <td className={`${TD} text-neutral-800`}>
                    {f.contraparte}
                    <span
                      className={`ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        f.origen === "MARCA" ? "bg-violet-50 text-violet-700" : "bg-accent-tint text-accent-dark"
                      }`}
                    >
                      {f.origen === "MARCA" ? "Marca" : "Prov."}
                    </span>
                  </td>
                  <td className={`${TD} tabular-nums`}>{fechaCorta(f.fecha)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{f.unidades}</td>
                  <td className={TD}>
                    <ChipEstado estado={f.estado} />
                  </td>
                </tr>
                {esta && (
                  <tr>
                    <td colSpan={5} className="px-4 pb-3 pt-1 bg-neutral-50 border-b border-neutral-100">
                      <p className="text-[9.5px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
                        Qué traía
                      </p>
                      <table className="w-full text-[11.5px]">
                        <tbody>
                          {detalle.map((d, i) => (
                            <tr key={i}>
                              <td className="py-0.5 text-neutral-600">{d.nombre}</td>
                              <td className="py-0.5 text-right text-neutral-400 tabular-nums w-20">
                                {d.pedidas} pedidas
                              </td>
                              <td
                                className={`py-0.5 text-right tabular-nums w-24 font-semibold ${
                                  d.recibidas < d.pedidas ? "text-amber-700" : "text-neutral-700"
                                }`}
                              >
                                {d.recibidas} llegaron
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

