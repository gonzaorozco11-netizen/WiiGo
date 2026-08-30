"use client";

import { useState } from "react";
import type { Gasto } from "@/lib/supabase";
import { actualizarGasto, obtenerUrlComprobanteGasto } from "@/app/(app)/gastos/actions";

type CategoriaGasto = { id_categoria: string; nombre: string; tipo_default: string; estado: string; fecha_alta: string };
type SubcategoriaGasto = { id_subcategoria: string; id_categoria: string; nombre: string; estado: string };

const MEDIO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO_TURNO: "💵 Efectivo del turno",
  EFECTIVO_ADMIN: "🔒 Caja Administración",
  TRANSFERENCIA: "🏦 Transferencia",
  MERCADO_PAGO: "💳 Mercado Pago / Tarjeta",
};

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

// Solo edición — corregir un error de tipeo (monto, categoría, descripción)
// en un gasto ya cargado. A propósito no toca local ni medio de pago (ya
// impactaron en el turno/caja) ni el comprobante — eso se carga una sola vez.
export default function ModalEditarGasto({
  gasto,
  categorias,
  subcategorias,
  puedeAutorizarSinLimite,
  topeAutorizacion,
  ivaGeneralPorcentaje,
  onClose,
  onGuardado,
}: {
  gasto: Gasto;
  categorias: CategoriaGasto[];
  subcategorias: SubcategoriaGasto[];
  puedeAutorizarSinLimite: boolean;
  topeAutorizacion: number;
  ivaGeneralPorcentaje: number;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [idCategoria, setIdCategoria] = useState(gasto.id_categoria ?? categorias[0]?.id_categoria ?? "__nueva__");
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [nuevaCategoriaTipo, setNuevaCategoriaTipo] = useState<"FIJO" | "VARIABLE">("VARIABLE");
  const [idSubcategoria, setIdSubcategoria] = useState(gasto.id_subcategoria ?? "");
  const [nuevaSubcategoria, setNuevaSubcategoria] = useState("");
  const [monto, setMonto] = useState(String(gasto.neto ?? gasto.monto));
  const [descripcion, setDescripcion] = useState(gasto.descripcion ?? "");
  const [pendienteFactura, setPendienteFactura] = useState(gasto.pendiente_factura ?? false);
  const [llevaIva, setLlevaIva] = useState((gasto.iva ?? 0) > 0);
  const [claveAdmin, setClaveAdmin] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subDisponibles = subcategorias.filter((s) => s.id_categoria === idCategoria);
  const categoriaSeleccionada = categorias.find((c) => c.id_categoria === idCategoria);
  const tipoResultante = categoriaSeleccionada?.tipo_default ?? "VARIABLE";
  const montoNum = Number(monto.replace(/[^\d.-]/g, "")) || 0;
  const montoConIva = Math.round(montoNum * (1 + ivaGeneralPorcentaje / 100) * 100) / 100;
  const mostrarAuth = !puedeAutorizarSinLimite && (llevaIva ? montoConIva : montoNum) > topeAutorizacion;

  function handleCategoriaChange(id: string) {
    setIdCategoria(id);
    setIdSubcategoria("");
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    actualizarGasto(gasto.id_gasto, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          onGuardado();
          onClose();
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar el gasto"))
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <form onSubmit={handleSubmit} className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Editar gasto</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4" role="alert">
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Categoría</label>
            <select
              name="id_categoria"
              value={idCategoria}
              onChange={(e) => handleCategoriaChange(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            >
              {categorias.map((c) => (
                <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>
              ))}
              <option value="__nueva__">+ Crear categoría nueva…</option>
            </select>
            {idCategoria === "__nueva__" && (
              <>
                <input
                  name="nueva_categoria"
                  required
                  value={nuevaCategoria}
                  onChange={(e) => setNuevaCategoria(e.target.value)}
                  placeholder="Nombre de la categoría nueva"
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
                />
                <select
                  name="tipo"
                  value={nuevaCategoriaTipo}
                  onChange={(e) => setNuevaCategoriaTipo(e.target.value as "FIJO" | "VARIABLE")}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
                >
                  <option value="VARIABLE">Variable — depende del mes</option>
                  <option value="FIJO">Fijo — todos los meses igual</option>
                </select>
              </>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Subcategoría</label>
            <select
              name="id_subcategoria"
              value={idSubcategoria}
              onChange={(e) => setIdSubcategoria(e.target.value)}
              required
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="" disabled>Elegí una subcategoría...</option>
              {subDisponibles.map((s) => (
                <option key={s.id_subcategoria} value={s.id_subcategoria}>{s.nombre}</option>
              ))}
              <option value="__nueva__">+ Crear subcategoría nueva…</option>
            </select>
            {idSubcategoria === "__nueva__" && (
              <input
                name="nueva_subcategoria_gasto"
                required
                value={nuevaSubcategoria}
                onChange={(e) => setNuevaSubcategoria(e.target.value)}
                placeholder="Nombre de la subcategoría nueva"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Monto</label>
            <input
              name="monto"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="$0"
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer mt-1.5">
              <input type="checkbox" name="lleva_iva" checked={llevaIva} onChange={(e) => setLlevaIva(e.target.checked)} />
              Tiene factura con IVA ({ivaGeneralPorcentaje}%)
            </label>
            {llevaIva && montoNum > 0 && (
              <p className="text-[11px] text-neutral-500 bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-1.5 mt-1">
                ${formatearMonto(montoNum)} + IVA = <span className="font-bold text-neutral-800">${formatearMonto(montoConIva)}</span>
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Tipo de gasto</label>
            <div className={`py-2 px-3 rounded-lg text-sm font-bold border ${tipoResultante === "FIJO" ? "bg-purple-50 border-purple-200 text-purple-700" : "bg-accent-tint border-accent text-accent-dark"}`}>
              {tipoResultante === "FIJO" ? "Fijo" : "Variable"}
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">Lo define la categoría/subcategoría elegida — cambialo desde Categorías si no es correcto.</p>
          </div>
        </div>

        <p className="text-xs text-neutral-400 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2 mb-3">
          Local y medio de pago no se pueden editar acá (ya impactaron en el turno o la caja) — {MEDIO_PAGO_LABEL[gasto.medio_pago] ?? gasto.medio_pago}.
          {gasto.comprobante_path && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => obtenerUrlComprobanteGasto(gasto.comprobante_path!).then((url) => window.open(url, "_blank"))}
                className="text-accent font-semibold"
              >
                Ver comprobante
              </button>
            </>
          )}
        </p>

        <div className="mb-3">
          <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción</label>
          <input name="descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-700 mb-3">
          <input type="checkbox" name="pendiente_factura" checked={pendienteFactura} onChange={(e) => setPendienteFactura(e.target.checked)} />
          Pendiente de factura — recordar reclamar el comprobante fiscal
        </label>

        {mostrarAuth && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
            <p className="text-sm font-semibold text-red-700 mb-1">⚠️ Requiere autorización</p>
            <p className="text-xs text-red-700 mb-2">
              Este monto supera el tope de ${formatearMonto(topeAutorizacion)} configurado para gastos sin aprobar. Hace falta la contraseña de un admin o de alguien autorizado para confirmarlo.
            </p>
            <input
              type="password"
              name="clave_admin"
              value={claveAdmin}
              onChange={(e) => setClaveAdmin(e.target.value)}
              placeholder="Contraseña de quien autoriza"
              className="w-full sm:w-64 border border-red-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm">
            {guardando ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
}
