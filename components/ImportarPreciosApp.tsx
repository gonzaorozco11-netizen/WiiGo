"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { Marca } from "@/lib/supabase";
import type { FilaImportacion } from "@/lib/importarPrecios";
import { previsualizarImportacion, confirmarImportacion } from "@/app/(app)/marcas/[id]/importar/actions";

export default function ImportarPreciosApp({ marca }: { marca: Marca }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilaImportacion[] | null>(null);
  const [excluidas, setExcluidas] = useState<Set<number>>(new Set());
  const [resultado, setResultado] = useState<string | null>(null);

  const encontradas = useMemo(() => (preview ?? []).filter((f) => f.encontrado), [preview]);
  const noEncontradas = useMemo(() => (preview ?? []).filter((f) => !f.encontrado), [preview]);

  function handlePrevisualizar(formData: FormData) {
    setError(null);
    setResultado(null);
    startTransition(async () => {
      try {
        const filas = await previsualizarImportacion(marca.id_marca, formData);
        setPreview(filas);
        setExcluidas(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  function handleConfirmar() {
    setError(null);
    const cambios = encontradas
      .filter((f) => !excluidas.has(f.fila))
      .map((f) => ({
        idProducto: f.idProducto!,
        costo: f.costoNuevo,
        precio: f.precioNuevo,
        descuento: f.descuentoNuevo,
      }));

    startTransition(async () => {
      try {
        const res = await confirmarImportacion(marca.id_marca, cambios);
        setResultado(`Se actualizaron ${res.actualizados} productos.`);
        setPreview(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  function toggleFila(fila: number) {
    setExcluidas((prev) => {
      const next = new Set(prev);
      if (next.has(fila)) next.delete(fila);
      else next.add(fila);
      return next;
    });
  }

  return (
    <div>
      <Link href={`/marcas/${marca.id_marca}`} className="text-sm text-accent hover:underline">
        ← Volver a {marca.nombre}
      </Link>

      <h1 className="text-lg font-semibold text-neutral-900 mt-4 mb-1">Importar precios</h1>
      <p className="text-sm text-neutral-500 mb-4">
        Subí el Excel que te manda {marca.nombre} con las variaciones de costo, precio y descuento.
        Vamos a buscar cada producto por nombre — antes de aplicar nada, te muestro qué encontró y
        qué no.
      </p>

      <a
        href={`/marcas/${marca.id_marca}/importar/plantilla`}
        className="inline-block text-sm text-accent hover:underline mb-6"
      >
        ⬇ Descargar plantilla con los productos actuales de {marca.nombre}
      </a>

      {!preview && (
        <form action={handlePrevisualizar} className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <input
            type="file"
            name="archivo"
            accept=".xlsx,.xls,.csv"
            required
            className="text-sm flex-1"
          />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            {isPending ? "Leyendo..." : "Previsualizar"}
          </button>
        </form>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">
          {error}
        </p>
      )}

      {resultado && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mt-4">
          {resultado}
        </p>
      )}

      {preview && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-neutral-600">
              {encontradas.length} producto{encontradas.length === 1 ? "" : "s"} encontrado
              {encontradas.length === 1 ? "" : "s"}
              {noEncontradas.length > 0 && `, ${noEncontradas.length} sin encontrar`}
            </p>
            <button
              onClick={() => setPreview(null)}
              className="text-sm text-neutral-500 hover:text-neutral-900"
            >
              Cancelar
            </button>
          </div>

          {encontradas.length > 0 && (
            <div className="bg-white border border-neutral-200 rounded-xl overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="p-3"></th>
                    <th className="p-3">Producto</th>
                    <th className="p-3">Costo</th>
                    <th className="p-3">Precio</th>
                    <th className="p-3">Descuento %</th>
                  </tr>
                </thead>
                <tbody>
                  {encontradas.map((f) => (
                    <tr key={f.fila} className="border-b border-neutral-100 last:border-0">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={!excluidas.has(f.fila)}
                          onChange={() => toggleFila(f.fila)}
                          className="rounded border-neutral-300 text-accent focus:ring-accent"
                        />
                      </td>
                      <td className="p-3 font-medium text-neutral-900">{f.nombreActual}</td>
                      <td className="p-3">
                        <CambioValor actual={f.costoActual} nuevo={f.costoNuevo} />
                      </td>
                      <td className="p-3">
                        <CambioValor actual={f.precioActual} nuevo={f.precioNuevo} />
                      </td>
                      <td className="p-3">
                        <CambioValor actual={f.descuentoActual} nuevo={f.descuentoNuevo} sufijo="%" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {noEncontradas.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
              <p className="text-sm font-medium text-amber-800 mb-2">
                No encontré estos productos (revisá el nombre o cargalos a mano):
              </p>
              <ul className="text-sm text-amber-800 space-y-1">
                {noEncontradas.map((f) => (
                  <li key={f.fila}>
                    Fila {f.fila}: "{f.nombreExcel}"
                  </li>
                ))}
              </ul>
            </div>
          )}

          {encontradas.length > 0 && (
            <button
              onClick={handleConfirmar}
              disabled={isPending || encontradas.length === excluidas.size}
              className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Aplicando..." : `Confirmar cambios (${encontradas.length - excluidas.size})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CambioValor({
  actual,
  nuevo,
  sufijo = "",
}: {
  actual: number | null;
  nuevo: number | null;
  sufijo?: string;
}) {
  const cambio = nuevo !== null && nuevo !== actual;
  return (
    <span className={cambio ? "text-neutral-900" : "text-neutral-400"}>
      {actual ?? "—"}
      {sufijo}
      {cambio && (
        <>
          {" "}
          → <strong>{nuevo}{sufijo}</strong>
        </>
      )}
    </span>
  );
}
