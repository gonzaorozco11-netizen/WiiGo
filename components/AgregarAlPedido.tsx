"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { agregarRenglonPedido, productosParaAgregar, type ProductoParaAgregar } from "@/app/(app)/compras/pedir/actions";
import { coincide } from "@/components/FiltroSeleccion";
import { kgAGramos } from "@/lib/gramos";

/**
 * Sumar al pedido algo que no estaba en la lista (Gonzalo, 20/11). Uno solo para
 * las dos puntas:
 *   - «pediste»: al cargarlo en la web del proveedor se pidió algo de más;
 *   - «llego»: en Recepción llegó algo que no estaba en el pedido.
 * Agrega el renglón al mismo pedido (app/(app)/compras/pedir/actions.ts) y refresca:
 * la lista de arriba ya lo muestra para cargarlo o contarlo.
 */
export default function AgregarAlPedido({
  idOrden,
  modo,
  onAgregado,
}: {
  idOrden: string;
  modo: "pediste" | "llego";
  /** En Recepción: para dejar la cantidad ya escrita en la lista (21/11: se cargaba dos veces). */
  onAgregado?: (idVariante: string, cantidad: number, esGranel: boolean) => void;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [productos, setProductos] = useState<ProductoParaAgregar[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [elegido, setElegido] = useState<ProductoParaAgregar | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, start] = useTransition();

  const titulo = modo === "pediste" ? "+ Agregar algo que pediste y no está en la lista" : "+ Llegó algo que no estaba en el pedido";

  function abrir() {
    setAbierto(true);
    setAviso(null);
    if (productos) return;
    start(async () => {
      const r = await productosParaAgregar(idOrden);
      if (r.error) setError(r.error);
      setProductos(r.productos);
    });
  }

  const visibles = useMemo(
    () => (productos ?? []).filter((p) => busqueda.trim() && coincide([p.nombre], busqueda)).slice(0, 8),
    [productos, busqueda]
  );

  function agregar() {
    if (!elegido) return;
    const n = elegido.esGranel ? kgAGramos(cantidad) : Math.round(Number(cantidad.replace(",", ".")));
    if (!n || n <= 0) return setError(elegido.esGranel ? "Poné cuántos kilos." : "Poné cuántas unidades.");
    setError(null);
    start(async () => {
      const r = await agregarRenglonPedido(idOrden, elegido.idVariante, n);
      if (r.error) return setError(r.error);
      onAgregado?.(elegido.idVariante, n, elegido.esGranel);
      setAviso(`Listo: ${elegido.nombre} quedó en el pedido.`);
      setElegido(null);
      setBusqueda("");
      setCantidad("");
      router.refresh();
    });
  }

  if (!abierto) {
    return (
      <div className="my-3">
        <button
          type="button"
          onClick={abrir}
          className="w-full rounded-xl border-2 border-dashed border-sky-300 bg-white px-4 py-3 text-left text-sm font-semibold text-sky-800 hover:bg-sky-50"
        >
          {titulo}
          <span className="block text-xs font-normal text-neutral-500">
            {modo === "pediste" ? "Así sale en Recepción y entra al stock, como lo demás." : "Contalo acá en vez de escribirlo en la nota: entra al stock con su costo."}
          </span>
        </button>
        {aviso && <p className="text-sm text-emerald-700 mt-2">✓ {aviso}</p>}
      </div>
    );
  }

  return (
    <div className="my-3 rounded-xl border-2 border-sky-300 bg-white p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-sky-900">{titulo.replace(/^\+ /, "")}</p>
        <button type="button" onClick={() => setAbierto(false)} className="text-xs text-neutral-500 hover:underline">
          Cerrar
        </button>
      </div>

      {!elegido ? (
        <>
          <input
            type="search"
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscá el producto: avena, tostadas, chips…"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {productos === null && <p className="text-xs text-neutral-500 mt-2">Cargando productos…</p>}
          <ul className="mt-2 flex flex-col gap-1">
            {visibles.map((p) => (
              <li key={p.idVariante}>
                <button
                  type="button"
                  onClick={() => setElegido(p)}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm hover:bg-neutral-50 border border-neutral-100"
                >
                  {p.nombre}
                  {p.esGranel && <span className="ml-2 text-[11px] font-semibold text-amber-700">granel · en kilos</span>}
                </button>
              </li>
            ))}
          </ul>
          {productos && busqueda.trim() && visibles.length === 0 && (
            <p className="text-xs text-neutral-500 mt-2">
              No aparece. Si es nuevo, primero dalo de alta en <b>Productos</b> y vinculalo con el proveedor; después lo sumás acá.
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[12rem]">
            <p className="text-sm font-semibold text-neutral-900">{elegido.nombre}</p>
            <button type="button" onClick={() => setElegido(null)} className="text-xs text-accent hover:underline">
              Elegir otro
            </button>
          </div>
          <label className="text-xs text-neutral-600">
            {elegido.esGranel ? "Kilos" : modo === "llego" ? "Cuántos llegaron" : "Cuántos pediste"}
            <input
              inputMode="decimal"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="block w-28 mt-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm tabular-nums"
            />
          </label>
          <button
            type="button"
            onClick={agregar}
            disabled={pendiente}
            className="rounded-lg bg-sky-700 hover:bg-sky-800 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {pendiente ? "Agregando..." : "Agregar al pedido"}
          </button>
        </div>
      )}
      {modo === "llego" && elegido && (
        <p className="text-xs text-neutral-500 mt-2">Queda en la lista de arriba con esa cantidad ya puesta: revisala y confirmá.</p>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
