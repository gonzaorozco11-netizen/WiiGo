"use client";

import { useMemo, useState } from "react";
import type {
  Marca,
  Local,
  Producto,
  VarianteProducto,
  Stock,
  OrdenReposicion,
  DetalleReposicion,
  DetalleRecepcion,
} from "@/lib/supabase";
import NuevaOrdenModal from "@/components/NuevaOrdenModal";
import RecepcionModal from "@/components/RecepcionModal";

export type FilaVariante = { variante: VarianteProducto; producto: Producto; marca: Marca | undefined };

export const ESTADO_ESTILO: Record<string, string> = {
  PENDIENTE: "bg-amber-50 text-amber-700",
  RECIBIDA: "bg-emerald-50 text-emerald-700",
  RECIBIDA_CON_DIFERENCIAS: "bg-red-50 text-red-700",
};

export default function ReposicionApp({
  marcas,
  locales,
  productos,
  variantes,
  stock,
  ordenes,
  detalle,
  reclamos,
}: {
  marcas: Marca[];
  locales: Local[];
  productos: Producto[];
  variantes: VarianteProducto[];
  stock: Stock[];
  ordenes: OrdenReposicion[];
  detalle: DetalleReposicion[];
  reclamos: DetalleRecepcion[];
}) {
  const [nuevaOrdenOpen, setNuevaOrdenOpen] = useState(false);
  const [ordenAbierta, setOrdenAbierta] = useState<OrdenReposicion | null>(null);
  const [tab, setTab] = useState<"TODAS" | "PENDIENTE" | "RECIBIDA_CON_DIFERENCIAS" | "RECIBIDA">("TODAS");

  const marcaPorId = useMemo(() => new Map(marcas.map((m) => [m.id_marca, m])), [marcas]);
  const localPorId = useMemo(() => new Map(locales.map((l) => [l.id_local, l])), [locales]);
  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id_producto, p])), [productos]);

  const filas = useMemo<FilaVariante[]>(() => {
    return variantes
      .map((variante) => {
        const producto = productoPorId.get(variante.id_producto);
        if (!producto) return null;
        return { variante, producto, marca: marcaPorId.get(producto.id_marca) };
      })
      .filter((f): f is FilaVariante => f !== null);
  }, [variantes, productoPorId, marcaPorId]);

  const cantidadPorClave = useMemo(() => {
    const map = new Map<string, number>();
    stock.forEach((s) => map.set(`${s.id_variante}_${s.id_local}`, s.cantidad));
    return map;
  }, [stock]);

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

  const detalleDeOrden = useMemo(() => {
    const map = new Map<string, DetalleReposicion[]>();
    detalle.forEach((d) => {
      const grupo = map.get(d.id_orden) ?? [];
      grupo.push(d);
      map.set(d.id_orden, grupo);
    });
    return map;
  }, [detalle]);

  const conteos = useMemo(
    () => ({
      TODAS: ordenes.length,
      PENDIENTE: ordenes.filter((o) => o.estado === "PENDIENTE").length,
      RECIBIDA_CON_DIFERENCIAS: ordenes.filter((o) => o.estado === "RECIBIDA_CON_DIFERENCIAS").length,
      RECIBIDA: ordenes.filter((o) => o.estado === "RECIBIDA").length,
    }),
    [ordenes]
  );

  const ordenesFiltradas = useMemo(
    () => (tab === "TODAS" ? ordenes : ordenes.filter((o) => o.estado === tab)),
    [ordenes, tab]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-neutral-900">Abastecimiento</h1>
        <button
          onClick={() => setNuevaOrdenOpen(true)}
          className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium"
        >
          + Nueva orden
        </button>
      </div>

      {reclamos.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-semibold text-red-800 mb-2">
            ⚠ Reclamos pendientes ({reclamos.length})
          </p>
          <ul className="text-sm text-red-800 space-y-1">
            {reclamos.map((r) => (
              <li key={r.id_detalle_recepcion}>
                {nombrePorVariante.get(r.id_variante) ?? "Producto"}: pedido {r.cantidad_solicitada}, llegó{" "}
                {r.cantidad_recibida} ({r.estado_control === "FALTANTE" ? "faltante" : "sobrante"} de{" "}
                {Math.abs(r.diferencia ?? 0)})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <TabButton activo={tab === "TODAS"} onClick={() => setTab("TODAS")}>
          Todas ({conteos.TODAS})
        </TabButton>
        <TabButton activo={tab === "PENDIENTE"} onClick={() => setTab("PENDIENTE")}>
          Pendientes de recepcionar ({conteos.PENDIENTE})
        </TabButton>
        <TabButton activo={tab === "RECIBIDA_CON_DIFERENCIAS"} onClick={() => setTab("RECIBIDA_CON_DIFERENCIAS")}>
          Con diferencias ({conteos.RECIBIDA_CON_DIFERENCIAS})
        </TabButton>
        <TabButton activo={tab === "RECIBIDA"} onClick={() => setTab("RECIBIDA")}>
          Recibidas OK ({conteos.RECIBIDA})
        </TabButton>
      </div>

      {ordenesFiltradas.length === 0 ? (
        <p className="text-sm text-neutral-500 py-12 text-center">
          {ordenes.length === 0 ? "Todavía no generaste ninguna orden." : "No hay órdenes en esta categoría."}
        </p>
      ) : (
        <ul className="space-y-2">
          {ordenesFiltradas.map((o) => (
            <li
              key={o.id_orden}
              className="bg-white border border-neutral-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-neutral-900">{marcaPorId.get(o.id_marca)?.nombre ?? "—"}</p>
                  <span className="text-xs font-mono text-neutral-400">#{o.id_orden.slice(0, 8).toUpperCase()}</span>
                  <span className={`text-xs rounded-full px-2 py-0.5 ${ESTADO_ESTILO[o.estado] ?? "bg-neutral-100 text-neutral-600"}`}>
                    {o.estado.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="text-sm text-neutral-500">
                  {localPorId.get(o.id_local)?.nombre ?? "—"} · {o.total_unidades} unidades ·{" "}
                  {new Date(o.fecha).toLocaleDateString("es-AR")}
                </p>
              </div>
              <button onClick={() => setOrdenAbierta(o)} className="text-sm text-accent hover:underline shrink-0">
                {o.estado === "PENDIENTE" ? "Recepcionar" : "Ver"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {nuevaOrdenOpen && (
        <NuevaOrdenModal
          marcas={marcas}
          locales={locales}
          filas={filas}
          cantidadPorClave={cantidadPorClave}
          onClose={() => setNuevaOrdenOpen(false)}
        />
      )}

      {ordenAbierta && (
        <RecepcionModal
          orden={ordenAbierta}
          detalle={detalleDeOrden.get(ordenAbierta.id_orden) ?? []}
          marca={marcaPorId.get(ordenAbierta.id_marca)}
          local={localPorId.get(ordenAbierta.id_local)}
          nombrePorVariante={nombrePorVariante}
          onClose={() => setOrdenAbierta(null)}
        />
      )}
    </div>
  );
}

function TabButton({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-sm rounded-full px-3 py-1.5 border ${
        activo ? "bg-accent text-white border-accent" : "bg-white text-neutral-600 border-neutral-300"
      }`}
    >
      {children}
    </button>
  );
}
