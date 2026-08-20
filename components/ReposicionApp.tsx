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

const ESTADO_ESTILO: Record<string, string> = {
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

      {ordenes.length === 0 ? (
        <p className="text-sm text-neutral-500 py-12 text-center">Todavía no generaste ninguna orden.</p>
      ) : (
        <ul className="space-y-2">
          {ordenes.map((o) => (
            <li
              key={o.id_orden}
              className="bg-white border border-neutral-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-neutral-900">{marcaPorId.get(o.id_marca)?.nombre ?? "—"}</p>
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
