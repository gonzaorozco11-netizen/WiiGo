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
import { createProducto, updateProducto, subirFotoProducto, subirFotoFichaProducto } from "@/app/(app)/productos/actions";

type VarianteForm = {
  id: string;
  nombre: string;
  sku: string | null;
  stockMinimo: number;
  stockObjetivo: number;
  stockInicial: number;
};

// Con ~1000 fotos para cargar, subir la foto tal cual sale del celular (varios
// MB, a veces 4000x3000px) sería lentísimo y pesado de más para el catálogo.
// Se reescala en el navegador antes de subir — 1200px de lado más largo
// alcanza de sobra para verse nítida en el catálogo y en el Asesor, y baja el
// peso típico de varios MB a algunas centenas de KB.
async function comprimirImagen(archivo: File, maxLado = 1200, calidad = 0.82): Promise<File> {
  try {
    const bitmap = await createImageBitmap(archivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) return archivo;
    ctx.drawImage(bitmap, 0, 0, ancho, alto);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", calidad));
    if (!blob) return archivo;
    return new File([blob], archivo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return archivo;
  }
}

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
  const [fotoProducto, setFotoProducto] = useState(producto?.imagen ?? "");
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const isEditing = Boolean(producto);

  async function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo || !producto) return;
    setSubiendoFoto(true);
    try {
      const comprimido = await comprimirImagen(archivo);
      const formData = new FormData();
      formData.set("archivo", comprimido);
      const res = await subirFotoProducto(producto.id_producto, formData);
      if (res.error) setError(res.error);
      else if (res.url) setFotoProducto(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto");
    } finally {
      setSubiendoFoto(false);
    }
  }
  const marcaSeleccionada = marcas.find((m) => m.id_marca === idMarca);

  const subcategoriasDeMarca = useMemo(
    () => subcategorias.filter((s) => s.id_marca === idMarca),
    [subcategorias, idMarca]
  );

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const res = producto ? await updateProducto(producto.id_producto, formData) : await createProducto(formData);
        if (res.error) setError(res.error);
        else onClose();
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
            <Field label="Nombre (inglés)" name="nombre_en" defaultValue={producto?.nombre_en ?? ""} />
            <Field label="Nombre (portugués)" name="nombre_pt" defaultValue={producto?.nombre_pt ?? ""} />
          </div>

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

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Imagen</label>
            {isEditing ? (
              <div className="flex items-center gap-3 mb-2">
                <span className="w-16 h-16 rounded-lg overflow-hidden bg-neutral-100 border border-neutral-200 flex items-center justify-center shrink-0">
                  {fotoProducto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fotoProducto} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-neutral-300 text-xs">Sin foto</span>
                  )}
                </span>
                <label className="text-xs font-semibold text-accent cursor-pointer">
                  {subiendoFoto ? "Subiendo..." : fotoProducto ? "Cambiar foto" : "Subir foto"}
                  <input type="file" accept="image/*" onChange={handleFoto} disabled={subiendoFoto} className="hidden" />
                </label>
              </div>
            ) : (
              <p className="text-xs text-neutral-400 mb-2">La foto se sube después de crear el producto, editándolo.</p>
            )}
            <Field key={fotoProducto} label="o pegar una URL de imagen" name="imagen" defaultValue={fotoProducto} />
            <p className="text-xs text-neutral-400 mt-1">
              Recomendado: foto cuadrada, mínimo 800×800px, fondo blanco o neutro — así quedan todas parejas en el catálogo y en el Asesor. Se comprime sola al subir, no importa que la foto original pese varios MB.
            </p>
          </div>

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

          <FichaSection ficha={ficha} producto={producto} />

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

// Costo + cualquiera de los tres (Precio, Markup o Margen) alcanza para
// derivar los otros dos. Los tres campos están siempre editables — el que
// se toca recalcula los otros dos en el momento, no hay que elegir modo.
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
  const [precio, setPrecio] = useState(precioInicial ?? 0);
  const [markup, setMarkup] = useState(() =>
    costoInicial && precioInicial && costoInicial > 0 ? ((precioInicial - costoInicial) / costoInicial) * 100 : 0
  );
  const [margen, setMargen] = useState(() =>
    precioInicial && costoInicial !== null && precioInicial > 0
      ? ((precioInicial - costoInicial) / precioInicial) * 100
      : 0
  );
  const [descuento, setDescuento] = useState(descuentoInicial ?? 0);

  function recalcularDesdeCosto(nuevoCosto: number) {
    setCosto(nuevoCosto);
    // El precio se deja fijo — lo que cambia es cuánto margen/markup deja
    // ese precio con el costo nuevo.
    setMarkup(nuevoCosto > 0 ? ((precio - nuevoCosto) / nuevoCosto) * 100 : 0);
    setMargen(precio > 0 ? ((precio - nuevoCosto) / precio) * 100 : 0);
  }

  function recalcularDesdePrecio(nuevoPrecio: number) {
    setPrecio(nuevoPrecio);
    setMarkup(costo > 0 ? ((nuevoPrecio - costo) / costo) * 100 : 0);
    setMargen(nuevoPrecio > 0 ? ((nuevoPrecio - costo) / nuevoPrecio) * 100 : 0);
  }

  function recalcularDesdeMarkup(nuevoMarkup: number) {
    setMarkup(nuevoMarkup);
    const nuevoPrecio = costo * (1 + nuevoMarkup / 100);
    setPrecio(Math.round(nuevoPrecio * 100) / 100);
    setMargen(nuevoPrecio > 0 ? ((nuevoPrecio - costo) / nuevoPrecio) * 100 : 0);
  }

  function recalcularDesdeMargen(nuevoMargen: number) {
    setMargen(nuevoMargen);
    // Un margen de 100% o más implicaría precio infinito, no tiene sentido.
    const g = Math.min(nuevoMargen, 99);
    const nuevoPrecio = g < 100 ? costo / (1 - g / 100) : 0;
    setPrecio(Math.round(nuevoPrecio * 100) / 100);
    setMarkup(costo > 0 ? ((nuevoPrecio - costo) / costo) * 100 : 0);
  }

  const precioRedondeado = Math.round(precio * 100) / 100;
  const margenBajo = precioRedondeado > 0 && margen < margenMinimo;

  return (
    <div className="border border-neutral-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-neutral-900">💲 Precio y rentabilidad</h3>
      <p className="text-xs text-neutral-500 -mt-2">
        Completá cualquiera de los tres de abajo (Precio, Markup o Margen) — los otros dos se recalculan solos.
      </p>

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
            onChange={(e) => recalcularDesdeCosto(Number(e.target.value) || 0)}
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

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="precio_venta_visible">
            Precio de venta
          </label>
          <input
            id="precio_venta_visible"
            type="number"
            step="0.01"
            value={precio || ""}
            onChange={(e) => recalcularDesdePrecio(Number(e.target.value) || 0)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <input type="hidden" name="precio_venta" value={precioRedondeado || 0} />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Markup
            <Ayuda texto="Cuánto le sumás al costo para llegar al precio. Markup = (Precio − Costo) / Costo × 100. Ej: costo $100, precio $150 → markup 50%." />
          </label>
          <input
            type="number"
            step="0.01"
            value={Math.round(markup * 10) / 10 || ""}
            onChange={(e) => recalcularDesdeMarkup(Number(e.target.value) || 0)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Margen
            <Ayuda texto="De todo lo que factura ese producto, qué % es ganancia real. Margen = (Precio − Costo) / Precio × 100. Sirve para analizar rentabilidad." />
          </label>
          <input
            type="number"
            step="0.01"
            value={Math.round(margen * 10) / 10 || ""}
            onChange={(e) => recalcularDesdeMargen(Number(e.target.value) || 0)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
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

function FotoExtraFicha({
  idProducto,
  campo,
  valorInicial,
}: {
  idProducto: string;
  campo: "foto_extra_1" | "foto_extra_2" | "foto_extra_3";
  valorInicial: string;
}) {
  const [foto, setFoto] = useState(valorInicial);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setSubiendo(true);
    setError(null);
    try {
      const comprimido = await comprimirImagen(archivo);
      const formData = new FormData();
      formData.set("archivo", comprimido);
      const res = await subirFotoFichaProducto(idProducto, campo, formData);
      if (res.error) setError(res.error);
      else if (res.url) setFoto(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="w-14 h-14 rounded-lg overflow-hidden bg-neutral-100 border border-neutral-200 flex items-center justify-center shrink-0">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={foto} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-neutral-300 text-[10px]">Sin foto</span>
        )}
      </span>
      <div>
        <label className="text-xs font-semibold text-accent cursor-pointer">
          {subiendo ? "Subiendo..." : foto ? "Cambiar foto" : "Subir foto"}
          <input type="file" accept="image/*" onChange={handleFoto} disabled={subiendo} className="hidden" />
        </label>
        {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
      </div>
      <input type="hidden" name={`ficha_${campo}`} value={foto} readOnly />
    </div>
  );
}

function FichaSection({ ficha, producto }: { ficha: FichaProducto | null; producto: Producto | null }) {
  return (
    <div className="border border-neutral-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-neutral-900">🖥️ Ficha para Pantallas Asesoras</h3>
      <p className="text-xs text-neutral-500 mb-4">
        Esta información será visible para el cliente en las pantallas interactivas del local. La foto principal es
        la misma que cargaste arriba en "Imagen" — acá solo podés sumar hasta 3 fotos más para la ficha ampliada.
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

        <Field label="Video (URL)" name="ficha_video" defaultValue={ficha?.video ?? ""} />

        {producto && (
          <div className="col-span-2">
            <label className="block text-sm font-medium text-neutral-700 mb-2">Fotos extra (hasta 3)</label>
            <div className="flex flex-col gap-2.5">
              <FotoExtraFicha idProducto={producto.id_producto} campo="foto_extra_1" valorInicial={ficha?.foto_extra_1 ?? ""} />
              <FotoExtraFicha idProducto={producto.id_producto} campo="foto_extra_2" valorInicial={ficha?.foto_extra_2 ?? ""} />
              <FotoExtraFicha idProducto={producto.id_producto} campo="foto_extra_3" valorInicial={ficha?.foto_extra_3 ?? ""} />
            </div>
          </div>
        )}

        <details className="col-span-2 border border-neutral-200 rounded-xl p-3">
          <summary className="text-sm font-semibold text-neutral-900 cursor-pointer">
            🌐 Traducciones (inglés / portugués) — opcional
          </summary>
          <p className="text-xs text-neutral-500 mt-1 mb-3">
            Si los dejás vacíos, el Asesor muestra el texto en español aunque el cliente elija otro idioma.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Origen (inglés)" name="ficha_origen_en" defaultValue={ficha?.origen_en ?? ""} />
            <Field label="Origen (portugués)" name="ficha_origen_pt" defaultValue={ficha?.origen_pt ?? ""} />
            <Field label="Porción (inglés)" name="ficha_porcion_en" defaultValue={ficha?.porcion_en ?? ""} />
            <Field label="Porción (portugués)" name="ficha_porcion_pt" defaultValue={ficha?.porcion_pt ?? ""} />

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Ingredientes (inglés)</label>
              <textarea
                name="ficha_ingredientes_en"
                defaultValue={ficha?.ingredientes_en ?? ""}
                rows={2}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Ingredientes (portugués)</label>
              <textarea
                name="ficha_ingredientes_pt"
                defaultValue={ficha?.ingredientes_pt ?? ""}
                rows={2}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Micronutrientes (inglés)</label>
              <textarea
                name="ficha_micronutrientes_en"
                defaultValue={ficha?.micronutrientes_en ?? ""}
                rows={2}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Micronutrientes (portugués)</label>
              <textarea
                name="ficha_micronutrientes_pt"
                defaultValue={ficha?.micronutrientes_pt ?? ""}
                rows={2}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción pública (inglés)</label>
              <textarea
                name="ficha_descripcion_publica_en"
                defaultValue={ficha?.descripcion_publica_en ?? ""}
                rows={2}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción pública (portugués)</label>
              <textarea
                name="ficha_descripcion_publica_pt"
                defaultValue={ficha?.descripcion_publica_pt ?? ""}
                rows={2}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>
        </details>
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
