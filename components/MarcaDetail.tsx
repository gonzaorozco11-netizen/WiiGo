"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type {
  Marca,
  Producto,
  Subcategoria,
  FichaProducto,
  Objetivo,
  FiltroProducto,
  VarianteProducto,
} from "@/lib/supabase";
import { deleteSubcategoria } from "@/app/(app)/marcas/actions";
import { deleteProducto } from "@/app/(app)/productos/actions";
import { saldosRetencionMarcaAction, historialRetencionMarcaAction } from "@/app/(app)/liquidaciones/actions";
import MarcaFormModal from "@/components/MarcaFormModal";
import SubcategoriaFormModal from "@/components/SubcategoriaFormModal";
import ProductoFormModal from "@/components/ProductoFormModal";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

const ETIQUETA_TIPO_RETENCION: Record<string, string> = {
  SIRCREB: "SIRCREB",
  IMP_DEBITO_CREDITO: "Impuesto a los créditos/débitos",
  OTRO: "Otros",
};

const ETIQUETA_TIPO_MOVIMIENTO: Record<string, string> = {
  RETENCION: "Retención",
  COMPENSACION: "Compensación",
  DEVOLUCION: "Devolución",
  AJUSTE_POSITIVO: "Ajuste (+)",
  AJUSTE_NEGATIVO: "Ajuste (−)",
  ANULACION: "Anulación",
};

// Cuenta corriente de retenciones — nunca es plata de WiiGo, es lo
// retenido preventivamente (hoy solo SIRCREB) pendiente de compensar o
// devolver a la marca. Mismo patrón visual que el saldo por marca de
// Profesionales: saldo derivado de movimientos, nunca un número suelto.
function RetencionesMarca({ idMarca }: { idMarca: string }) {
  const [saldos, setSaldos] = useState<{ tipoRetencion: string; saldo: number }[]>([]);
  const [historial, setHistorial] = useState<
    { idMovimiento: string; tipoRetencion: string; tipoMovimiento: string; importe: number; saldoNuevo: number; usuario: string | null; observaciones: string | null; fecha: string }[]
  >([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);

  useEffect(() => {
    setCargando(true);
    Promise.all([saldosRetencionMarcaAction(idMarca), historialRetencionMarcaAction(idMarca)])
      .then(([s, h]) => {
        setSaldos(s);
        setHistorial(h);
      })
      .finally(() => setCargando(false));
  }, [idMarca]);

  const totalPendiente = saldos.reduce((acc, s) => acc + s.saldo, 0);

  if (cargando) return null;
  if (saldos.length === 0 && historial.length === 0) return null;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4 mb-8">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-neutral-900">🧾 Cuenta corriente de retenciones</h2>
        <span className="text-lg font-extrabold text-purple-700 tabular-nums">${formatearMonto(totalPendiente)}</span>
      </div>
      <p className="text-xs text-neutral-400 mb-3">
        Retenido preventivamente en liquidaciones (ej. SIRCREB) — no es ganancia de WiiGo, queda pendiente de compensar o devolver.
      </p>
      {saldos.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {saldos.map((s) => (
            <div key={s.tipoRetencion} className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
              <span className="text-sm font-medium text-purple-900">{ETIQUETA_TIPO_RETENCION[s.tipoRetencion] ?? s.tipoRetencion}</span>
              <span className="text-sm font-bold text-purple-700 tabular-nums">${formatearMonto(s.saldo)}</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => setMostrarHistorial((v) => !v)} className="text-xs font-semibold text-accent">
        {mostrarHistorial ? "▾" : "▸"} Historial de movimientos ({historial.length})
      </button>
      {mostrarHistorial && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-400 border-b border-neutral-200">
                <th className="p-2">Fecha</th>
                <th className="p-2">Tipo</th>
                <th className="p-2">Movimiento</th>
                <th className="p-2 text-right">Importe</th>
                <th className="p-2 text-right">Saldo</th>
                <th className="p-2">Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((m) => (
                <tr key={m.idMovimiento} className="border-b border-neutral-100 last:border-0">
                  <td className="p-2 whitespace-nowrap text-neutral-500">
                    {new Date(m.fecha).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  </td>
                  <td className="p-2">{ETIQUETA_TIPO_RETENCION[m.tipoRetencion] ?? m.tipoRetencion}</td>
                  <td className="p-2">{ETIQUETA_TIPO_MOVIMIENTO[m.tipoMovimiento] ?? m.tipoMovimiento}</td>
                  <td className={`p-2 text-right tabular-nums font-semibold ${m.importe >= 0 ? "text-purple-700" : "text-emerald-600"}`}>
                    {m.importe >= 0 ? "+" : ""}${formatearMonto(m.importe)}
                  </td>
                  <td className="p-2 text-right tabular-nums">${formatearMonto(m.saldoNuevo)}</td>
                  <td className="p-2 text-neutral-400">{m.observaciones ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MarcaDetail({
  marca,
  subcategorias,
  productos,
  objetivosGlobales,
  filtrosGlobales,
  fichaPorProducto,
  objetivosPorProducto,
  filtrosPorProducto,
  variantesPorProducto,
}: {
  marca: Marca;
  subcategorias: Subcategoria[];
  productos: Producto[];
  objetivosGlobales: Objetivo[];
  filtrosGlobales: FiltroProducto[];
  fichaPorProducto: Record<string, FichaProducto>;
  objetivosPorProducto: Record<string, string[]>;
  filtrosPorProducto: Record<string, string[]>;
  variantesPorProducto: Record<string, VarianteProducto[]>;
}) {
  const [isPending, startTransition] = useTransition();
  const [editMarcaOpen, setEditMarcaOpen] = useState(false);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<Subcategoria | null>(null);
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<Producto | null>(null);
  const [searchSub, setSearchSub] = useState("");
  const [searchProd, setSearchProd] = useState("");

  const nombreSubcategoria = useMemo(() => {
    const map = new Map(subcategorias.map((s) => [s.id_subcategoria, s.nombre]));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "—");
  }, [subcategorias]);

  const subcategoriasFiltradas = useMemo(() => {
    const q = searchSub.trim().toLowerCase();
    if (!q) return subcategorias;
    return subcategorias.filter((s) => s.nombre.toLowerCase().includes(q));
  }, [subcategorias, searchSub]);

  const productosFiltrados = useMemo(() => {
    const q = searchProd.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) => {
      const variantes = variantesPorProducto[p.id_producto] ?? [];
      return [
        p.nombre,
        nombreSubcategoria(p.id_subcategoria),
        ...variantes.map((v) => v.sku),
        ...variantes.map((v) => v.codigo_barras),
      ]
        .filter(Boolean)
        .some((f) => f!.toLowerCase().includes(q));
    });
  }, [productos, searchProd, nombreSubcategoria, variantesPorProducto]);

  function handleDeleteSub(sub: Subcategoria) {
    if (!confirm(`¿Borrar la subcategoría "${sub.nombre}"?`)) return;
    startTransition(async () => {
      try {
        const res = await deleteSubcategoria(sub.id_subcategoria, marca.id_marca);
        if (res.error) alert(res.error);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  function handleDeleteProd(prod: Producto) {
    if (!confirm(`¿Borrar "${prod.nombre}"?`)) return;
    startTransition(async () => {
      try {
        const res = await deleteProducto(prod.id_producto);
        if (res.error) alert(res.error);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div>
      <Link href="/marcas" className="text-sm text-accent hover:underline">
        ← Volver a marcas
      </Link>

      <div className="flex items-start justify-between gap-3 mt-4 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{marca.nombre}</h1>
          <span
            className={`inline-block mt-1 text-xs rounded-full px-2 py-0.5 ${
              marca.estado === "ACTIVA"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {marca.estado}
          </span>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/marcas/${marca.id_marca}/importar`}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700"
          >
            Importar precios
          </Link>
          <button
            onClick={() => setEditMarcaOpen(true)}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700"
          >
            Editar marca
          </button>
        </div>
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <Dato label="CUIT" valor={marca.cuit} />
        <Dato label="Contacto" valor={marca.contacto} />
        <Dato label="Royalty" valor={marca.royalty_porcentaje !== null ? `${marca.royalty_porcentaje}%` : null} />
        <Dato label="Fee de ingreso" valor={marca.fee_ingreso !== null ? `$${marca.fee_ingreso}` : null} />
      </div>

      {marca.tipo_comercializacion === "CONSIGNACION" && <RetencionesMarca idMarca={marca.id_marca} />}

      {/* Subcategorías */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-neutral-900">Subcategorías</h2>
          <button
            onClick={() => {
              setEditingSub(null);
              setSubModalOpen(true);
            }}
            className="rounded-lg bg-accent hover:bg-accent-dark text-white px-3 py-1.5 text-sm font-medium"
          >
            + Nueva subcategoría
          </button>
        </div>

        {subcategorias.length > 0 && (
          <input
            type="search"
            placeholder="Buscar subcategoría..."
            value={searchSub}
            onChange={(e) => setSearchSub(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        )}

        {subcategorias.length === 0 ? (
          <p className="text-sm text-neutral-500 py-6 text-center bg-white border border-neutral-200 rounded-xl">
            No hay subcategorías todavía.
          </p>
        ) : subcategoriasFiltradas.length === 0 ? (
          <p className="text-sm text-neutral-500 py-6 text-center bg-white border border-neutral-200 rounded-xl">
            No hay subcategorías que coincidan con la búsqueda.
          </p>
        ) : (
          <ul className="space-y-2">
            {subcategoriasFiltradas.map((s) => (
              <li
                key={s.id_subcategoria}
                className="bg-white border border-neutral-200 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-900">{s.nombre}</span>
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${
                      s.estado === "ACTIVA"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {s.estado}
                  </span>
                </div>
                <div className="flex gap-3 shrink-0">
                  <button
                    onClick={() => {
                      setEditingSub(s);
                      setSubModalOpen(true);
                    }}
                    className="text-sm text-neutral-500 hover:text-neutral-900"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDeleteSub(s)}
                    disabled={isPending}
                    className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Productos */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-neutral-900">Productos</h2>
          <button
            onClick={() => {
              setEditingProd(null);
              setProdModalOpen(true);
            }}
            className="rounded-lg bg-accent hover:bg-accent-dark text-white px-3 py-1.5 text-sm font-medium"
          >
            + Nuevo producto
          </button>
        </div>

        {productos.length > 0 && (
          <input
            type="search"
            placeholder="Buscar producto, SKU, código o subcategoría..."
            value={searchProd}
            onChange={(e) => setSearchProd(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        )}

        {productos.length === 0 ? (
          <p className="text-sm text-neutral-500 py-6 text-center bg-white border border-neutral-200 rounded-xl">
            Esta marca todavía no tiene productos.
          </p>
        ) : productosFiltrados.length === 0 ? (
          <p className="text-sm text-neutral-500 py-6 text-center bg-white border border-neutral-200 rounded-xl">
            No hay productos que coincidan con la búsqueda.
          </p>
        ) : (
          <ul className="space-y-2">
            {productosFiltrados.map((p) => (
              <li
                key={p.id_producto}
                className="bg-white border border-neutral-200 rounded-xl px-4 py-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-neutral-900">{p.nombre}</p>
                    <span className="text-xs bg-neutral-100 text-neutral-600 rounded-full px-2 py-0.5">
                      {nombreSubcategoria(p.id_subcategoria)}
                    </span>
                    <span
                      className={`text-xs rounded-full px-2 py-0.5 ${
                        p.estado === "ACTIVO"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {p.estado}
                    </span>
                    {p.descuento_porcentaje !== null && p.descuento_porcentaje > 0 && (
                      <span className="text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-0.5 font-medium">
                        -{p.descuento_porcentaje}%
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-neutral-500 flex flex-wrap gap-x-3">
                    {p.precio_venta !== null && <span>${p.precio_venta}</span>}
                    <span>
                      {(variantesPorProducto[p.id_producto] ?? []).length}{" "}
                      {(variantesPorProducto[p.id_producto] ?? []).length === 1 ? "variante" : "variantes"}
                    </span>
                  </div>
                </div>
                <div className="flex gap-3 shrink-0">
                  <button
                    onClick={() => {
                      setEditingProd(p);
                      setProdModalOpen(true);
                    }}
                    className="text-sm text-neutral-500 hover:text-neutral-900"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDeleteProd(p)}
                    disabled={isPending}
                    className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editMarcaOpen && <MarcaFormModal marca={marca} onClose={() => setEditMarcaOpen(false)} />}

      {subModalOpen && (
        <SubcategoriaFormModal
          idMarca={marca.id_marca}
          subcategoria={editingSub}
          onClose={() => setSubModalOpen(false)}
        />
      )}

      {prodModalOpen && (
        <ProductoFormModal
          producto={editingProd}
          marcas={[marca]}
          subcategorias={subcategorias}
          objetivosGlobales={objetivosGlobales}
          filtrosGlobales={filtrosGlobales}
          ficha={editingProd ? fichaPorProducto[editingProd.id_producto] ?? null : null}
          objetivosAsignados={editingProd ? objetivosPorProducto[editingProd.id_producto] ?? [] : []}
          filtrosAsignados={editingProd ? filtrosPorProducto[editingProd.id_producto] ?? [] : []}
          variantesIniciales={editingProd ? variantesPorProducto[editingProd.id_producto] ?? [] : []}
          onClose={() => setProdModalOpen(false)}
        />
      )}
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string | null }) {
  return (
    <div>
      <p className="text-xs text-neutral-500 uppercase font-medium">{label}</p>
      <p className="text-sm font-semibold text-neutral-900 mt-0.5">{valor ?? "—"}</p>
    </div>
  );
}
