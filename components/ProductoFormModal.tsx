"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  Producto,
  Marca,
  Subcategoria,
  FichaProducto,
  Objetivo,
  FiltroProducto,
  VarianteProducto,
  Local,
} from "@/lib/supabase";
import { createProducto, updateProducto } from "@/app/(app)/productos/actions";

type VarianteForm = {
  id: string;
  nombre: string;
  sku: string | null;
  stockMinimo: number;
  stockObjetivo: number;
  stockInicial: number;
};

export default function ProductoFormModal({
  producto,
  marcas,
  subcategorias,
  locales = [],
  margenMinimo = 15,
  objetivosGlobales = [],
  filtrosGlobales = [],
  ficha = null,
  objetivosAsignados = [],
  filtrosAsignados = [],
  variantesIniciales = [],
  onClose,
}: {
  producto: Producto | null;
  marcas: Marca[];
  subcategorias: Subcategoria[];
  locales?: Local[];
  margenMinimo?: number;
  objetivosGlobales?: Objetivo[];
  filtrosGlobales?: FiltroProducto[];
  ficha?: FichaProducto | null;
  objetivosAsignados?: string[];
  filtrosAsignados?: string[];
  variantesIniciales?: VarianteProducto[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [idMarca, setIdMarca] = useState(producto?.id_marca ?? marcas[0]?.id_marca ?? "");
  const [nuevaSubcategoria, setNuevaSubcategoria] = useState(false);
  const [variantes, setVariantes] = useState<VarianteForm[]>(
    variantesIniciales.length > 0
      ? variantesIniciales.map((v) => ({
          id: v.id_variante,
          nombre: v.nombre,
          sku: v.sku,
          stockMinimo: v.stock_minimo,
          stockObjetivo: v.stock_objetivo,
          stockInicial: 0,
        }))
      : [{ id: "", nombre: "", sku: null, stockMinimo: 0, stockObjetivo: 0, stockInicial: 0 }]
  );
  const [idLocalInicial, setIdLocalInicial] = useState(locales[0]?.id_local ?? "");
  const isEditing = Boolean(producto);
  const marcaSeleccionada = marcas.find((m) => m.id_marca === idMarca);

  const subcategoriasDeMarca = useMemo(
    () => subcategorias.filter((s) => s.id_marca === idMarca),
    [subcategorias, idMarca]
  );

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        if (producto) {
          await updateProducto(producto.id_producto, formData);
        } else {
          await createProducto(formData);
        }
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">
            {isEditing ? "Editar producto" : "Nuevo producto"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form action={handleSubmit} className="space-y-3">
          <Field label="Nombre *" name="nombre" defaultValue={producto?.nombre} required />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="id_marca">
                Marca *
              </label>
              <select
                id="id_marca"
                name="id_marca"
                value={idMarca}
                onChange={(e) => setIdMarca(e.target.value)}
                required
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {marcas.map((m) => (
                  <option key={m.id_marca} value={m.id_marca}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="id_subcategoria">
                Subcategoría
              </label>
              {!nuevaSubcategoria ? (
                <select
                  id="id_subcategoria"
                  name="id_subcategoria"
                  defaultValue={producto?.id_subcategoria ?? ""}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">Sin subcategoría</option>
                  {subcategoriasDeMarca.map((s) => (
                    <option key={s.id_subcategoria} value={s.id_subcategoria}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name="nueva_subcategoria"
                  placeholder="Nombre de la subcategoría"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              )}
              <button
                type="button"
                onClick={() => setNuevaSubcategoria((v) => !v)}
                className="text-xs text-accent mt-1"
              >
                {nuevaSubcategoria ? "Elegir una existente" : "+ Crear subcategoría nueva"}
              </button>
            </div>
          </div>

          <VariantesSection
            variantes={variantes}
            setVariantes={setVariantes}
            mostrarStockInicial={!isEditing}
            locales={locales}
            idLocalInicial={idLocalInicial}
            setIdLocalInicial={setIdLocalInicial}
          />

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción</label>
            <textarea
              name="descripcion"
              defaultValue={producto?.descripcion ?? ""}
              rows={2}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <PrecioCalculadora
            costoInicial={producto?.costo_informado ?? null}
            precioInicial={producto?.precio_venta ?? null}
            descuentoInicial={producto?.descuento_porcentaje ?? null}
            labelCosto={marcaSeleccionada?.tipo_comercializacion === "PROPIA" ? "Costo (CMV, sin IVA)" : "Costo informado"}
            margenMinimo={margenMinimo}
          />

          <Field label="Imagen (URL)" name="imagen" defaultValue={producto?.imagen ?? ""} />

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="estado">
              Estado
            </label>
            <select
              id="estado"
              name="estado"
              defaultValue={producto?.estado ?? "ACTIVO"}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="ACTIVO">ACTIVO</option>
              <option value="INACTIVO">INACTIVO</option>
            </select>
          </div>

          <FichaSection ficha={ficha} />

          <CheckboxSection
            titulo="🎯 Objetivos"
            descripcion="El producto podrá aparecer en varios objetivos al mismo tiempo."
            name="objetivos"
            opciones={objetivosGlobales.map((o) => ({ id: o.id_objetivo, nombre: o.nombre }))}
            seleccionados={objetivosAsignados}
            vacio="Todavía no cargaste objetivos. Andá a Catálogo asesor para crear alguno."
          />

          <CheckboxSection
            titulo="⚡ Filtros rápidos"
            descripcion="Restricciones o características que el cliente puede usar sobre el catálogo."
            name="filtros"
            opciones={filtrosGlobales.map((f) => ({ id: f.id_filtro, nombre: f.nombre }))}
            seleccionados={filtrosAsignados}
            vacio="Todavía no cargaste filtros. Andá a Catálogo asesor para crear alguno."
          />

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
  step,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  );
}

function Ayuda({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <span className="relative inline-block ml-1 align-middle">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        onBlur={() => setAbierto(false)}
        className="text-neutral-400 hover:text-accent"
        aria-label="Ayuda"
      >
        🔍
      </button>
      {abierto && (
        <span className="absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-56 bg-neutral-900 text-white text-xs font-normal leading-snug rounded-lg px-3 py-2 shadow-lg">
          {texto}
        </span>
      )}
    </span>
  );
}

type ModoPrecio = "PRECIO" | "MARKUP" | "MARGEN";

// Costo + uno de los tres (Precio, Markup o Margen) alcanza para derivar
// los otros dos. El usuario elige cuál de los tres quiere completar a
// mano — los otros dos se calculan solos.
function PrecioCalculadora({
  costoInicial,
  precioInicial,
  descuentoInicial,
  labelCosto,
  margenMinimo,
}: {
  costoInicial: number | null;
  precioInicial: number | null;
  descuentoInicial: number | null;
  labelCosto: string;
  margenMinimo: number;
}) {
  const [costo, setCosto] = useState(costoInicial ?? 0);
  const [modo, setModo] = useState<ModoPrecio>("PRECIO");
  const [valorPrecio, setValorPrecio] = useState(precioInicial ?? 0);
  const [valorMarkup, setValorMarkup] = useState(() =>
    costoInicial && precioInicial && costoInicial > 0 ? ((precioInicial - costoInicial) / costoInicial) * 100 : 0
  );
  const [valorMargen, setValorMargen] = useState(() =>
    precioInicial && costoInicial !== null && precioInicial > 0
      ? ((precioInicial - costoInicial) / precioInicial) * 100
      : 0
  );
  const [descuento, setDescuento] = useState(descuentoInicial ?? 0);

  const { precio, markup, margen } = useMemo(() => {
    if (modo === "PRECIO") {
      const p = valorPrecio;
      return {
        precio: p,
        markup: costo > 0 ? ((p - costo) / costo) * 100 : 0,
        margen: p > 0 ? ((p - costo) / p) * 100 : 0,
      };
    }
    if (modo === "MARKUP") {
      const p = costo * (1 + valorMarkup / 100);
      return { precio: p, markup: valorMarkup, margen: p > 0 ? ((p - costo) / p) * 100 : 0 };
    }
    // MARGEN — un margen de 100% o más implicaría precio infinito, no tiene sentido.
    const g = Math.min(valorMargen, 99);
    const p = g < 100 ? costo / (1 - g / 100) : 0;
    return { precio: p, markup: costo > 0 ? ((p - costo) / costo) * 100 : 0, margen: valorMargen };
  }, [modo, costo, valorPrecio, valorMarkup, valorMargen]);

  const precioRedondeado = Math.round(precio * 100) / 100;
  const margenBajo = precioRedondeado > 0 && margen < margenMinimo;

  return (
    <div className="border border-neutral-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-neutral-900">💲 Precio y rentabilidad</h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="costo_informado">
            {labelCosto}
          </label>
          <input
            id="costo_informado"
            name="costo_informado"
            type="number"
            step="0.01"
            value={costo || ""}
            onChange={(e) => setCosto(Number(e.target.value) || 0)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="descuento_porcentaje">
            Descuento %
          </label>
          <input
            id="descuento_porcentaje"
            name="descuento_porcentaje"
            type="number"
            step="0.01"
            value={descuento || ""}
            onChange={(e) => setDescuento(Number(e.target.value) || 0)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-500 mb-1.5">¿Qué querés completar?</p>
        <div className="flex gap-1.5">
          {([
            ["PRECIO", "Precio"],
            ["MARKUP", "Markup"],
            ["MARGEN", "Margen"],
          ] as [ModoPrecio, string][]).map(([m, etiqueta]) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                modo === m ? "bg-accent border-accent text-white" : "bg-white border-neutral-300 text-neutral-600"
              }`}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Precio de venta
            {modo !== "PRECIO" && <span className="text-neutral-400 font-normal text-xs"> (calculado)</span>}
          </label>
          {modo === "PRECIO" ? (
            <input
              type="number"
              step="0.01"
              value={valorPrecio || ""}
              onChange={(e) => setValorPrecio(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          ) : (
            <div className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-900">
              ${precioRedondeado.toFixed(2)}
            </div>
          )}
          <input type="hidden" name="precio_venta" value={precioRedondeado || 0} />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Markup
            <Ayuda texto="Cuánto le sumás al costo para llegar al precio. Markup = (Precio − Costo) / Costo × 100. Ej: costo $100, precio $150 → markup 50%." />
            {modo !== "MARKUP" && <span className="text-neutral-400 font-normal text-xs"> (calculado)</span>}
          </label>
          {modo === "MARKUP" ? (
            <input
              type="number"
              step="0.01"
              value={valorMarkup || ""}
              onChange={(e) => setValorMarkup(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          ) : (
            <div className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-900">
              {markup.toFixed(1)}%
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Margen
            <Ayuda texto="De todo lo que factura ese producto, qué % es ganancia real. Margen = (Precio − Costo) / Precio × 100. Sirve para analizar rentabilidad." />
            {modo !== "MARGEN" && <span className="text-neutral-400 font-normal text-xs"> (calculado)</span>}
          </label>
          {modo === "MARGEN" ? (
            <input
              type="number"
              step="0.01"
              value={valorMargen || ""}
              onChange={(e) => setValorMargen(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          ) : (
            <div className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-900">
              {margen.toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      {margenBajo && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠️ Margen bajo: {margen.toFixed(1)}%. El mínimo recomendado para no perder plata es {margenMinimo}% (cubre
          IIBB, costos financieros de cobro y un colchón operativo — ajustable en Configuración).
        </p>
      )}
    </div>
  );
}

function VariantesSection({
  variantes,
  setVariantes,
  mostrarStockInicial,
  locales,
  idLocalInicial,
  setIdLocalInicial,
}: {
  variantes: VarianteForm[];
  setVariantes: React.Dispatch<React.SetStateAction<VarianteForm[]>>;
  mostrarStockInicial: boolean;
  locales: Local[];
  idLocalInicial: string;
  setIdLocalInicial: (id: string) => void;
}) {
  return (
    <div className="border border-neutral-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-neutral-900">Variantes</h3>
        <button
          type="button"
          onClick={() =>
            setVariantes((prev) => [
              ...prev,
              { id: "", nombre: "", sku: null, stockMinimo: 0, stockObjetivo: 0, stockInicial: 0 },
            ])
          }
          className="text-xs text-accent"
        >
          + Agregar variante
        </button>
      </div>
      <p className="text-xs text-neutral-500 mb-3">
        Sabores, tamaños, etc. Cada variante tiene su propio SKU, código de barras y stock (el
        código se genera solo). Si el producto no tiene variaciones, dejá una sola fila — se va a
        llamar "Único".
      </p>

      {mostrarStockInicial && locales.length > 0 && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-neutral-500 mb-1" htmlFor="id_local_inicial">
            Local que recibe el stock inicial
          </label>
          <select
            id="id_local_inicial"
            name="id_local_inicial"
            value={idLocalInicial}
            onChange={(e) => setIdLocalInicial(e.target.value)}
            className="w-full sm:w-64 rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {locales.map((l) => (
              <option key={l.id_local} value={l.id_local}>
                {l.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        {variantes.map((v, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <input type="hidden" name="variante_id" value={v.id} />
            <input
              name="variante_nombre"
              value={v.nombre}
              onChange={(e) =>
                setVariantes((prev) => prev.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))
              }
              placeholder="Único"
              className="flex-1 min-w-[120px] rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {mostrarStockInicial && (
              <div className="flex items-center gap-1 shrink-0">
                <label className="text-xs text-neutral-500" htmlFor={`variante_stock_inicial_${i}`}>
                  Inicial
                </label>
                <input
                  id={`variante_stock_inicial_${i}`}
                  name="variante_stock_inicial"
                  type="number"
                  min={0}
                  value={v.stockInicial}
                  onChange={(e) =>
                    setVariantes((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, stockInicial: Number(e.target.value) } : x))
                    )
                  }
                  className="w-16 rounded-lg border border-neutral-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
            <div className="flex items-center gap-1 shrink-0">
              <label className="text-xs text-neutral-500" htmlFor={`variante_stock_minimo_${i}`}>
                Mín.
              </label>
              <input
                id={`variante_stock_minimo_${i}`}
                name="variante_stock_minimo"
                type="number"
                min={0}
                value={v.stockMinimo}
                onChange={(e) =>
                  setVariantes((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, stockMinimo: Number(e.target.value) } : x))
                  )
                }
                className="w-16 rounded-lg border border-neutral-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <label className="text-xs text-neutral-500" htmlFor={`variante_stock_objetivo_${i}`}>
                Obj.
              </label>
              <input
                id={`variante_stock_objetivo_${i}`}
                name="variante_stock_objetivo"
                type="number"
                min={0}
                value={v.stockObjetivo}
                onChange={(e) =>
                  setVariantes((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, stockObjetivo: Number(e.target.value) } : x))
                  )
                }
                className="w-16 rounded-lg border border-neutral-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            {v.sku && (
              <span className="text-xs font-mono text-neutral-400 whitespace-nowrap hidden lg:inline">
                {v.sku}
              </span>
            )}
            <button
              type="button"
              onClick={() => setVariantes((prev) => prev.filter((_, j) => j !== i))}
              className="text-sm text-red-500 shrink-0"
            >
              Borrar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FichaSection({ ficha }: { ficha: FichaProducto | null }) {
  return (
    <div className="border border-neutral-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-neutral-900">🖥️ Ficha para Pantallas Asesoras</h3>
      <p className="text-xs text-neutral-500 mb-4">
        Esta información será visible para el cliente en las pantallas interactivas del local.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Origen" name="ficha_origen" defaultValue={ficha?.origen ?? ""} />
        <Field label="Porción" name="ficha_porcion" defaultValue={ficha?.porcion ?? ""} />

        <div className="col-span-2">
          <label className="block text-sm font-medium text-neutral-700 mb-1">Ingredientes</label>
          <textarea
            name="ficha_ingredientes"
            defaultValue={ficha?.ingredientes ?? ""}
            rows={2}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <Field label="Kcal / 100 g" name="ficha_kcal" defaultValue={ficha?.kcal_100g ?? ""} type="number" />
        <Field
          label="Proteínas / 100 g"
          name="ficha_proteinas"
          defaultValue={ficha?.proteinas ?? ""}
          type="number"
          step="0.01"
        />
        <Field
          label="Carbohidratos / 100 g"
          name="ficha_carbohidratos"
          defaultValue={ficha?.carbohidratos ?? ""}
          type="number"
          step="0.01"
        />
        <Field
          label="Grasas / 100 g"
          name="ficha_grasas"
          defaultValue={ficha?.grasas ?? ""}
          type="number"
          step="0.01"
        />
        <Field
          label="Fibra / 100 g"
          name="ficha_fibra"
          defaultValue={ficha?.fibra ?? ""}
          type="number"
          step="0.01"
        />
        <Field
          label="Sodio / 100 g"
          name="ficha_sodio"
          defaultValue={ficha?.sodio ?? ""}
          type="number"
          step="0.01"
        />

        <div className="col-span-2">
          <label className="block text-sm font-medium text-neutral-700 mb-1">Micronutrientes</label>
          <textarea
            name="ficha_micronutrientes"
            defaultValue={ficha?.micronutrientes ?? ""}
            rows={2}
            placeholder="Ej: hierro, calcio, magnesio, vitamina B12..."
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="ficha_clasificacion">
            Clasificación
          </label>
          <select
            id="ficha_clasificacion"
            name="ficha_clasificacion"
            defaultValue={ficha?.clasificacion ?? ""}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">Sin definir</option>
            <option value="NATURAL">NATURAL</option>
            <option value="PROCESADO">PROCESADO</option>
            <option value="ULTRAPROCESADO">ULTRAPROCESADO</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="ficha_estado">
            Estado ficha pública
          </label>
          <select
            id="ficha_estado"
            name="ficha_estado"
            defaultValue={ficha?.estado ?? "ACTIVO"}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="ACTIVO">ACTIVO</option>
            <option value="INACTIVO">INACTIVO</option>
          </select>
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción pública</label>
          <textarea
            name="ficha_descripcion_publica"
            defaultValue={ficha?.descripcion_publica ?? ""}
            rows={2}
            placeholder="Texto comercial e informativo que verá el cliente."
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <Field
          label="Imagen principal (URL)"
          name="ficha_imagen_principal"
          defaultValue={ficha?.imagen_principal ?? ""}
        />
        <Field label="Video (URL)" name="ficha_video" defaultValue={ficha?.video ?? ""} />
      </div>
    </div>
  );
}

function CheckboxSection({
  titulo,
  descripcion,
  name,
  opciones,
  seleccionados,
  vacio,
}: {
  titulo: string;
  descripcion: string;
  name: string;
  opciones: { id: string; nombre: string }[];
  seleccionados: string[];
  vacio: string;
}) {
  return (
    <div className="border border-neutral-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-neutral-900">{titulo}</h3>
      <p className="text-xs text-neutral-500 mb-3">{descripcion}</p>

      {opciones.length === 0 ? (
        <p className="text-xs text-neutral-500 border border-dashed border-neutral-300 rounded-lg p-3">
          {vacio}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {opciones.map((o) => (
            <label
              key={o.id}
              className="flex items-center gap-2 border border-neutral-200 rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-neutral-50"
            >
              <input
                type="checkbox"
                name={name}
                value={o.id}
                defaultChecked={seleccionados.includes(o.id)}
                className="rounded border-neutral-300 text-accent focus:ring-accent"
              />
              <span className="font-medium">{o.nombre}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
