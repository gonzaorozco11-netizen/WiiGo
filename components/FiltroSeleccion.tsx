"use client";

/**
 * Buscar y elegir qué se imprime, igual en Códigos de barras y en Carteles de
 * góndola (Gonzalo, 2026-11-07: «poder destildar todo… o marcar por marca o
 * por subcategoría, o directamente buscar el producto puntual»).
 *
 * La búsqueda y la subcategoría solo achican la lista que se ve: lo que ya
 * estaba marcado sigue marcado y se imprime igual. Así se puede buscar un
 * producto, marcarlo, buscar otro y marcarlo, e imprimir los dos juntos.
 */
export default function FiltroSeleccion({
  busqueda,
  setBusqueda,
  subcategorias,
  subcategoria,
  setSubcategoria,
  visibles,
  marcados,
  unidad,
  onMarcarVisibles,
  onDestildarTodo,
}: {
  busqueda: string;
  setBusqueda: (s: string) => void;
  subcategorias: string[];
  subcategoria: string;
  setSubcategoria: (s: string) => void;
  /** Cuántos productos quedan a la vista con el filtro. */
  visibles: number;
  /** Cuántos están marcados para imprimir, se vean o no. */
  marcados: number;
  /** «carteles», «productos»: cómo se cuenta lo marcado. */
  unidad: string;
  onMarcarVisibles: () => void;
  onDestildarTodo: () => void;
}) {
  const filtrando = busqueda.trim() !== "" || subcategoria !== "";
  return (
    <div className="print:hidden mb-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar un producto…"
          className="flex-1 min-w-[12rem] rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {subcategorias.length > 0 && (
          <select
            value={subcategoria}
            onChange={(e) => setSubcategoria(e.target.value)}
            aria-label="Subcategoría"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">Todas las subcategorías</option>
            {subcategorias.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-neutral-600 mr-auto">
          <b className="text-neutral-900">{marcados}</b> {unidad} marcados
          {filtrando && <> · se ven {visibles}</>}
        </span>
        <button
          type="button"
          onClick={onMarcarVisibles}
          disabled={visibles === 0}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40"
        >
          {filtrando ? `Marcar estos ${visibles}` : "Marcar todo"}
        </button>
        <button
          type="button"
          onClick={onDestildarTodo}
          disabled={marcados === 0}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40"
        >
          Destildar todo
        </button>
      </div>
    </div>
  );
}

/** Lo que hace la búsqueda: sin tildes ni mayúsculas, todas las palabras en cualquier orden. */
export function coincide(textos: (string | null | undefined)[], busqueda: string) {
  const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const palabras = plano(busqueda).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return true;
  const todo = plano(textos.filter(Boolean).join(" "));
  return palabras.every((p) => todo.includes(p));
}

/** Las subcategorías que hay en la lista, ordenadas. */
export function subcategoriasDe(items: { subcategoria?: string | null }[]) {
  return [...new Set(items.map((i) => i.subcategoria?.trim()).filter((s): s is string => Boolean(s)))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
}
