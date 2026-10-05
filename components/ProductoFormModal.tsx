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
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import {
  esCodigoInterno,
  limpiarCodigoBarras,
  digitoVerificadorOk,
  largoDeCodigoConocido,
  formatearCodigo,
} from "@/lib/codigos";
import EscanerCodigo from "@/components/EscanerCodigo";
import { simularMargen, type TasasGenerales, type CondicionesMarca } from "@/lib/margenMarca";

type VarianteForm = {
  id: string;
  nombre: string;
  sku: string | null;
  stockMinimo: number;
  stockObjetivo: number;
  stockInicial: number;
  /** El código que generamos nosotros, para imprimir en etiqueta. */
  codigoInterno: string | null;
  /** Si el envase ya trae su propio código impreso de fábrica. */
  tienePropio: boolean;
  /** El código del envase, escaneado o tipeado. Vacío si no tiene. */
  codigoPropio: string;
};

const VARIANTE_VACIA: VarianteForm = {
  id: "",
  nombre: "",
  sku: null,
  stockMinimo: 0,
  stockObjetivo: 0,
  stockInicial: 0,
  codigoInterno: null,
  tienePropio: false,
  codigoPropio: "",
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
  otrosCostos = 0,
  otrosCostosEfectivo = 0,
  ivaGeneral = 21,
  redondeoPrecio = 0,
  costoMarcaInicial = null,
  tasas,
  objetivosGlobales = [],
  filtrosGlobales = [],
  ficha = null,
  objetivosAsignados = [],
  filtrosAsignados = [],
  variantesIniciales = [],
  proveedoresLiquidacion = [],
  onClose,
}: {
  producto: Producto | null;
  marcas: Marca[];
  subcategorias: Subcategoria[];
  locales?: Local[];
  margenMinimo?: number;
  /** % de la venta neta que se va en IIBB, Mercado Pago e impuesto al cheque. */
  otrosCostos?: number;
  /** Lo mismo pero cobrando en efectivo: sin la comisión de Mercado Pago. */
  otrosCostosEfectivo?: number;
  /** IVA que se usa cuando el producto no tiene el suyo cargado. */
  ivaGeneral?: number;
  /** Múltiplo al que se redondea el precio calculado. 0 = no redondear. */
  redondeoPrecio?: number;
  /** Lo que la marca dice que le cuesta. Solo para productos en consignación. */
  costoMarcaInicial?: { costo: number; desde: string; cargadoPor: string | null } | null;
  tasas: TasasGenerales;
  objetivosGlobales?: Objetivo[];
  filtrosGlobales?: FiltroProducto[];
  ficha?: FichaProducto | null;
  objetivosAsignados?: string[];
  filtrosAsignados?: string[];
  variantesIniciales?: VarianteProducto[];
  proveedoresLiquidacion?: ProveedorConSaldo[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [idMarca, setIdMarca] = useState(producto?.id_marca ?? marcas[0]?.id_marca ?? "");
  // Controlado para poder explicar abajo qué implica el proveedor elegido:
  // con uno de liquidación mensual la plata funciona distinto que con uno
  // que te factura por entrega.
  const [idProveedorProducto, setIdProveedorProducto] = useState(producto?.id_proveedor_liquidacion ?? "");
  const proveedorElegido = proveedoresLiquidacion.find((p) => p.id_proveedor === idProveedorProducto);
  const [nuevaSubcategoria, setNuevaSubcategoria] = useState(false);
  const [variantes, setVariantes] = useState<VarianteForm[]>(
    variantesIniciales.length > 0
      ? variantesIniciales.map((v) => {
          // Un código que arranca en "20" es de los nuestros: quiere decir que
          // el envase no traía ninguno. Cualquier otro salió del paquete.
          const propio = Boolean(v.codigo_barras) && !esCodigoInterno(v.codigo_barras);
          return {
            id: v.id_variante,
            nombre: v.nombre,
            sku: v.sku,
            stockMinimo: v.stock_minimo,
            stockObjetivo: v.stock_objetivo,
            stockInicial: 0,
            codigoInterno: propio ? null : v.codigo_barras,
            tienePropio: propio,
            codigoPropio: propio ? (v.codigo_barras as string) : "",
          };
        })
      : [{ ...VARIANTE_VACIA }]
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

  // Qué paso se está viendo. Clickeable y no un asistente rígido: al editar
  // un precio se va derecho al 2 y se guarda, sin pasar por el 1.
  const [paso, setPaso] = useState(1);

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

        <Pasos paso={paso} onPaso={setPaso} />

        {/* Los tres pasos están SIEMPRE armados: lo que cambia es cuál se ve.
            Si se desmontaran, sus campos saldrían del envío y el guardado los
            pisaría con vacío — editar un precio te borraría la ficha
            nutricional entera. Por eso se esconden con CSS y no con JSX. */}
        <form action={handleSubmit} className="space-y-3">
          <div className={paso === 1 ? "space-y-3" : "hidden"}>
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

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción</label>
            <textarea
              name="descripcion"
              defaultValue={producto?.descripcion ?? ""}
              rows={2}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          </div>

          {/* ---------- 2 · Precio y stock ---------- */}
          <div className={paso === 2 ? "space-y-3" : "hidden"}>
          <VariantesSection
            variantes={variantes}
            setVariantes={setVariantes}
            mostrarStockInicial={!isEditing}
            locales={locales}
            idLocalInicial={idLocalInicial}
            setIdLocalInicial={setIdLocalInicial}
          />

          {/* Dos calculadoras distintas porque son dos negocios distintos.
              En la marca propia WiiGo compra y revende: el costo y el margen
              son suyos. En consignación el producto es de la marca, y lo que
              se descuenta es el royalty más lo que se le traslada — que cambia
              según cómo pague el cliente, así que no entra en un "otros
              costos %" fijo. Ver lib/margenMarca.ts. */}
          {marcaSeleccionada && marcaSeleccionada.tipo_comercializacion !== "PROPIA" ? (
            <PrecioDeMarca
              marca={marcaSeleccionada}
              tasas={tasas}
              costoInicial={costoMarcaInicial}
              precioInicial={producto?.precio_venta ?? null}
              descuentoInicial={producto?.descuento_porcentaje ?? null}
              precioEfectivoInicial={producto?.precio_efectivo ?? null}
              iva={producto?.iva_porcentaje ?? ivaGeneral}
              redondeo={redondeoPrecio}
            />
          ) : (
          <PrecioCalculadora
            costoInicial={producto?.costo_informado ?? null}
            costosExtraInicial={producto?.costos_extra ?? null}
            precioInicial={producto?.precio_venta ?? null}
            descuentoInicial={producto?.descuento_porcentaje ?? null}
            precioEfectivoInicial={producto?.precio_efectivo ?? null}
            labelCosto={marcaSeleccionada?.tipo_comercializacion === "PROPIA" ? "Costo (CMV, sin IVA)" : "Costo informado"}
            margenMinimo={margenMinimo}
            otrosCostos={otrosCostos}
            otrosCostosEfectivo={otrosCostosEfectivo}
            iva={producto?.iva_porcentaje ?? ivaGeneral}
            redondeo={redondeoPrecio}
          />
          )}

          {marcaSeleccionada?.tipo_comercializacion === "PROPIA" && proveedoresLiquidacion.length > 0 && (
            <div>
              {/* Antes decía "Se liquida por venta a" y solo ofrecía los
                  proveedores de liquidación mensual. La pregunta real es
                  quién te provee este producto: sin eso, la orden de compra
                  no sabe qué sugerirle a cada proveedor. Lo que cambia según
                  el modo es qué pasa después, y eso lo aclara el texto de
                  abajo. */}
              <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="id_proveedor_liquidacion">
                Proveedor de este producto (opcional)
              </label>
              <select
                id="id_proveedor_liquidacion"
                name="id_proveedor_liquidacion"
                value={idProveedorProducto}
                onChange={(e) => setIdProveedorProducto(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">Ninguno</option>
                {proveedoresLiquidacion.map((p) => (
                  <option key={p.id_proveedor} value={p.id_proveedor}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              <p className="text-xs text-neutral-400 mt-1">
                {proveedorElegido?.modo_facturacion === "LIQUIDACION_VENTA"
                  ? "A fin de mes se le paga el costo de lo que se vendió de este producto, no lo que se le compró. Y al armar una orden de compra para este proveedor, el producto se sugiere solo."
                  : proveedorElegido
                    ? "Al armar una orden de compra para este proveedor, este producto se sugiere solo si está por debajo del mínimo. La deuda nace cuando cargás su factura."
                    : "Sirve para que al pedirle a ese proveedor, el sistema sepa qué ofrecerte sin que lo busques a mano."}
              </p>
            </div>
          )}

          </div>

          {/* Sigue el paso 1: la foto y el estado son parte de qué es el
              producto, aunque en el código vengan después del precio. */}
          <div className={paso === 1 ? "space-y-3" : "hidden"}>
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
          </div>

          {/* ---------- 3 · Ficha del asesor ---------- */}
          <div className={paso === 3 ? "space-y-3" : "hidden"}>
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
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          {/* Un solo Guardar para los tres pasos, abajo y siempre visible.
              Uno por paso haría pensar que hay que guardar tres veces. */}
          <div className="flex gap-2 pt-2 border-t border-neutral-100 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700"
            >
              Cancelar
            </button>
            {paso < 3 && (
              <button
                type="button"
                onClick={() => setPaso(paso + 1)}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Siguiente →
              </button>
            )}
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

/**
 * Los tres pasos del formulario, clickeables.
 *
 * No es un asistente que obliga a pasar por los tres: son pestañas
 * numeradas. El número ordena cuando estás creando; el click salva cuando
 * venís a cambiar una sola cosa.
 */
function Pasos({ paso, onPaso }: { paso: number; onPaso: (n: number) => void }) {
  const items = [
    { n: 1, titulo: "El producto", pie: "Nombre, marca, foto" },
    { n: 2, titulo: "Precio y stock", pie: "Costo, precio, variantes" },
    { n: 3, titulo: "Ficha del asesor", pie: "Opcional" },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5 mb-4">
      {items.map((i) => {
        const activo = paso === i.n;
        return (
          <button
            key={i.n}
            type="button"
            onClick={() => onPaso(i.n)}
            className={`text-left rounded-xl border px-3 py-2.5 ${
              activo ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white hover:bg-neutral-50"
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                  activo ? "bg-accent text-white" : "bg-neutral-200 text-neutral-600"
                }`}
              >
                {i.n}
              </span>
              <span
                className={`text-[13px] font-semibold truncate ${activo ? "text-accent" : "text-neutral-700"}`}
              >
                {i.titulo}
              </span>
            </span>
            <span className="block text-[11px] text-neutral-400 mt-0.5 truncate">{i.pie}</span>
          </button>
        );
      })}
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

/**
 * El bloque de precio cuando el producto NO es de WiiGo.
 *
 * Lo que cambia respecto del otro no es el número sino el modelo. Los costos de
 * WiiGo son un % de la venta neta; los de una marca son un % del precio bruto,
 * y además dependen de cómo pague el cliente. El "otros costos %" equivalente
 * sería `deducciones × (1 − margen)` — un valor que se mueve cada vez que se
 * toca el margen, así que como campo fijo mentiría. Por eso no existe acá: se
 * calcula y se muestra abierto en el reparto.
 *
 * Las cuentas salen de simularMargen(), el mismo cálculo que la liquidación que
 * de verdad le paga a la marca.
 */
function PrecioDeMarca({
  marca,
  tasas,
  costoInicial,
  precioInicial,
  descuentoInicial,
  precioEfectivoInicial,
  iva,
  redondeo,
}: {
  marca: Marca;
  tasas: TasasGenerales;
  costoInicial: { costo: number; desde: string; cargadoPor: string | null } | null;
  precioInicial: number | null;
  descuentoInicial: number | null;
  precioEfectivoInicial: number | null;
  iva: number;
  redondeo: number;
}) {
  const [costo, setCosto] = useState(costoInicial?.costo ?? 0);
  const [precio, setPrecio] = useState(precioInicial ?? 0);
  const [descuento, setDescuento] = useState(descuentoInicial ?? 0);
  const [medio, setMedio] = useState<string>("CREDITO");
  /** Lo que se está tecleando en el margen, mientras se teclea. Null = mostrar el calculado. */
  const [margenEscrito, setMargenEscrito] = useState<string | null>(null);
  const [efectivo, setEfectivo] = useState(precioEfectivoInicial ?? 0);
  const [offEfectivo, setOffEfectivo] = useState(() =>
    precioInicial && precioEfectivoInicial && precioInicial > 0
      ? ((precioInicial - precioEfectivoInicial) / precioInicial) * 100
      : 0
  );

  const condiciones: CondicionesMarca = {
    royalty: marca.royalty_porcentaje ?? 0,
    ivaRoyalty: marca.iva_royalty_porcentaje ?? 0,
    trasladarIvaComision: Boolean(marca.trasladar_iva_comision),
    trasladarIvaComisionEfectivo: marca.trasladar_iva_comision_efectivo ?? true,
    trasladarComisionCobro: Boolean(marca.trasladar_comision_cobro),
    trasladarSircreb: Boolean(marca.trasladar_sircreb),
    trasladarImpCreditos: Boolean(marca.trasladar_imp_creditos),
    trasladarImpDebitos: Boolean(marca.trasladar_imp_debitos),
  };

  function redondear(p: number) {
    return redondeo > 0 && p > 0 ? Math.ceil(p / redondeo) * redondeo : p;
  }

  const filas = precio > 0 ? simularMargen({ precio, costo: costo || null, marca: condiciones, tasas }) : [];
  const fila = filas.find((f) => f.medio === medio) ?? filas[0];
  const enEfectivo = filas.find((f) => f.medio === "EFECTIVO");

  // Escribir el margen que quiere la marca y que salga el precio. Es la inversa
  // de la cuenta de abajo: si margen = (T − costo) / T y T = precio × (1 − d),
  // entonces precio = costo / ((1 − margen)(1 − d)).
  function precioDesdeMargen(margenPct: number) {
    if (!(costo > 0) || !fila || fila.precio <= 0) return 0;
    const d = (fila.precio - fila.leTransferimos) / fila.precio;
    const resto = (1 - Math.min(margenPct, 99) / 100) * (1 - d);
    return resto > 0.0001 ? costo / resto : 0;
  }
  const pesos = (n: number) =>
    n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v: number) => (precio > 0 ? (v / precio) * 100 : 0);

  const deWiigo = fila ? fila.comisionWiigo + fila.ivaComision : 0;
  const deBanco = fila ? fila.comisionMp + fila.impCreditos + fila.impDebitos : 0;

  // Lo que le queda a la marca: lo que se le transfiere menos lo que le costó.
  //
  // Sin descontarle ningún IVA propio. WiiGo le factura a ELLA la comisión — no
  // al revés — así que de los impuestos de la marca el sistema no sabe nada:
  // cuánto IVA le corresponde depende de cómo facture, y si es monotributista
  // no discrimina ninguno. Restarle un IVA supuesto sería mostrarle una
  // ganancia más chica que la real por una cuenta que nadie hizo.
  const ganancia = fila && costo > 0 ? fila.leTransferimos - costo : 0;
  /** Lo mismo, para cualquier fila de la tabla de medios de pago. */
  const gananciaDe = (f: { leTransferimos: number }) => (costo > 0 ? f.leTransferimos - costo : 0);

  /** Su ganancia sobre lo que recibe. Las dos puntas son plata que WiiGo conoce exacta. */
  const margenDeLaMarca =
    fila && costo > 0 && fila.leTransferimos > 0 ? (ganancia / fila.leTransferimos) * 100 : 0;

  return (
    <div className="border border-neutral-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-neutral-900">📦 Costo de la marca</h3>
      <p className="text-xs text-neutral-500 -mt-2">
        Lo que le cuesta a <b>{marca.nombre}</b> producir una unidad, sin IVA. Es su dato, no el tuyo.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="costo_marca">
            Costo de la marca
            <Ayuda texto="Lo carga la marca desde su portal. Si todavía no entró, lo podés cargar vos acá. Queda con fecha de vigencia: las ventas de antes se siguen calculando con el costo que regía." />
          </label>
          <input
            id="costo_marca"
            name="costo_marca"
            type="number"
            step="0.01"
            value={costo || ""}
            onChange={(e) => setCosto(Number(e.target.value) || 0)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <p className="text-[11px] text-neutral-400 mt-1">
            {costoInicial
              ? `Rige desde ${costoInicial.desde} · lo cargó ${costoInicial.cargadoPor ?? "WiiGo"}`
              : "Todavía no lo cargó nadie"}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="descuento_porcentaje">
            Descuento oferta %
            <Ayuda texto="La oferta que pinta el cartelito «-20%» en el catálogo. Se aplica sobre el precio de tarjeta." />
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

      <div className="border-t border-neutral-200 pt-3 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-900">💲 Precio y reparto</h3>
        <p className="text-xs text-neutral-500 -mt-2">
          Escribí el precio de góndola, o el margen que quiere la marca y sale el precio.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Margen bruto de la marca %
              <Ayuda texto="BRUTO: solo descuenta la mercadería. Un 60% quiere decir que de cada $100 que WiiGo le transfiere, $60 le quedan ANTES de sus propios impuestos y gastos: su IVA según cómo facture, Ingresos Brutos, alquiler, sueldos. No es lo que gana al final. Y la base es lo que RECIBE, no lo que paga el cliente — de ese total también salen la comisión de WiiGo y lo que se va en cobrar." />
            </label>
            <input
              type="number"
              step="0.1"
              // Mientras se escribe manda lo escrito y no lo derivado: si el
              // campo se recalculara en cada tecla, escribir "60" sería
              // imposible — al teclear el 6 saltaría a un precio de 6% y el
              // campo volvería con otro número.
              value={margenEscrito ?? (costo > 0 && precio > 0 ? Math.round(margenDeLaMarca * 10) / 10 || "" : "")}
              onChange={(e) => {
                setMargenEscrito(e.target.value);
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n > 0) setPrecio(redondear(precioDesdeMargen(n)));
              }}
              onBlur={() => setMargenEscrito(null)}
              disabled={!(costo > 0)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-neutral-50"
            />
            <p className="text-[11px] text-neutral-400 mt-1">
              Sobre lo que factura, antes de sus gastos
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="precio_venta_visible">
              Precio de góndola
            </label>
            <input
              id="precio_venta_visible"
              type="number"
              step="0.01"
              value={precio || ""}
              onChange={(e) => setPrecio(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input type="hidden" name="precio_venta" value={precio || 0} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">IVA %</label>
            <input
              type="text"
              value={`${iva.toLocaleString("es-AR")} %`}
              readOnly
              className="w-full rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
            />
            <p className="text-[11px] text-neutral-400 mt-1">Del producto</p>
          </div>
        </div>

        {fila && costo > 0 && (
          <>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 space-y-1">
              <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1">
                De los ${pesos(precio)} que paga el cliente · {fila.etiqueta.toLowerCase()}
              </p>

              <DonaReparto
                partes={[
                  { color: "#64748b", monto: costo },
                  { color: "#2563eb", monto: deWiigo },
                  { color: "#c2843a", monto: deBanco },
                  { color: "#b4bcc6", monto: fila.sircreb },
                  { color: "#0d9488", monto: ganancia },
                ]}
                centro={`$${pesos(ganancia)}`}
                pie={`de ganancia para ${marca.nombre}`}
              />

              <RepartoMarca color="#64748b" etiqueta="Costo mercadería" monto={costo} pct={pct(costo)} pesos={pesos} />
              <RepartoMarca color="#2563eb" etiqueta="Comisión WiiGo + IVA" monto={deWiigo} pct={pct(deWiigo)} pesos={pesos} tono="mio" />
              {deBanco > 0 && (
                <RepartoMarca
                  color="#c2843a"
                  etiqueta="Otros costos"
                  ayuda="Lo que se va en cobrar: la comisión de Mercado Pago y el impuesto a los créditos. Si alguna vez se le traslada el impuesto a los débitos, también entra acá. En efectivo no hay ninguno."
                  monto={deBanco}
                  pct={pct(deBanco)}
                  pesos={pesos}
                />
              )}
              {fila.sircreb > 0 && (
                <RepartoMarca
                  color="#b4bcc6"
                  etiqueta="SIRCREB"
                  // Sin prometer que vuelve. Que se devuelva o se compense es
                  // una decisión comercial que todavía no está tomada, y una
                  // pantalla no es el lugar para comprometerla.
                  ayuda="Retención impositiva sobre la venta."
                  monto={fila.sircreb}
                  pct={pct(fila.sircreb)}
                  pesos={pesos}
                />
              )}
              <RepartoMarca
                color="#0d9488"
                etiqueta="Le queda a la marca"
                ayuda={`Lo que se le transfiere ($${pesos(
                  fila.leTransferimos
                )}) menos lo que le costó el producto. De ahí salen sus propios impuestos, que dependen de cómo facture — WiiGo no los calcula.`}
                monto={ganancia}
                pct={pct(ganancia)}
                pesos={pesos}
                tono="suyo"
              />

              {/* El mismo número en las dos bases que la gente usa, para que no
                  haya que elegir cuál mirar ni adivinar sobre qué es. */}
              <div className="pt-2 border-t border-neutral-200 mt-2">
                <p className="text-xs text-neutral-700">
                  Por cada unidad vendida, a <b>{marca.nombre} le quedan ${pesos(ganancia)}</b>:
                </p>
                <p className="text-xs text-neutral-600 mt-0.5">
                  <b className="text-emerald-700">{(Math.round(margenDeLaMarca * 10) / 10).toLocaleString("es-AR")}%</b>{" "}
                  de lo que recibe ·{" "}
                  <b className="text-emerald-700">{(Math.round(pct(ganancia) * 10) / 10).toLocaleString("es-AR")}%</b>{" "}
                  de lo que paga el cliente
                </p>
                <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                  Ya tiene descontado todo lo que se ve arriba. De ahí todavía salen{" "}
                  <b>los impuestos y los gastos de {marca.nombre}</b> —su IVA según cómo facture,
                  Ingresos Brutos, alquiler, sueldos— que WiiGo no conoce y no calcula.
                </p>
              </div>
            </div>

            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-neutral-400">
                  <th className="text-left font-semibold pb-1">Si el cliente paga con</th>
                  <th className="text-right font-semibold pb-1">Le queda a la marca</th>
                  <th className="text-right font-semibold pb-1">De lo que recibe</th>
                  <th className="text-right font-semibold pb-1">Tu comisión</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr
                    key={f.medio}
                    onClick={() => setMedio(f.medio)}
                    className={`cursor-pointer border-t border-neutral-100 ${
                      f.medio === medio ? "bg-accent-tint" : ""
                    }`}
                  >
                    <td className="py-1.5 text-neutral-700">{f.etiqueta}</td>
                    <td
                      className={`py-1.5 text-right font-semibold ${
                        f.medio === "EFECTIVO" ? "text-emerald-700" : f.medio === "CREDITO" ? "text-red-700" : "text-neutral-800"
                      }`}
                    >
                      ${pesos(gananciaDe(f))}
                    </td>
                    <td className="py-1.5 text-right text-neutral-500">
                      {f.leTransferimos > 0 ? Math.round((gananciaDe(f) / f.leTransferimos) * 100) : 0}%
                    </td>
                    <td className="py-1.5 text-right text-accent font-semibold">
                      ${pesos(f.comisionWiigo + f.ivaComision)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {enEfectivo && gananciaDe(enEfectivo) > ganancia && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Entre efectivo y {fila.etiqueta.toLowerCase()} hay{" "}
                <b>${pesos(gananciaDe(enEfectivo) - ganancia)} de diferencia</b> en lo que gana{" "}
                {marca.nombre}, con el mismo producto al mismo precio. Tu comisión casi no cambia.
              </p>
            )}
          </>
        )}

        {costo <= 0 && precio > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Cargá el costo de la marca y acá te mostramos cuánto le queda de cada venta y cuánto te
            queda a vos.
          </p>
        )}
      </div>

      {/* El precio en efectivo sigue igual que en la marca propia: es el otro
          precio del producto, no un descuento. */}
      <div className="border-t border-neutral-200 pt-3 space-y-2">
        <h4 className="text-sm font-semibold text-neutral-900">💵 Precio pagando en efectivo</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Precio en efectivo</label>
            <input
              type="number"
              step="0.01"
              value={efectivo || ""}
              onChange={(e) => {
                const n = Number(e.target.value) || 0;
                setEfectivo(n);
                setOffEfectivo(precio > 0 && n > 0 ? ((precio - n) / precio) * 100 : 0);
              }}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input type="hidden" name="precio_efectivo" value={efectivo > 0 ? efectivo : ""} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Es un % menos</label>
            <input
              type="number"
              step="0.1"
              value={Math.round(offEfectivo * 10) / 10 || ""}
              onChange={(e) => {
                const p = Number(e.target.value) || 0;
                setOffEfectivo(p);
                setEfectivo(p > 0 && precio > 0 ? redondear(precio * (1 - p / 100)) : 0);
              }}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>
      </div>

      {/* El costo de la marca no viaja en `costo_informado`: va a su propia
          tabla, con vigencia y con quién lo cargó. */}
      <input type="hidden" name="costo_informado" value={costo || 0} />
    </div>
  );
}

/**
 * El reparto del precio como una dona, con el monto que le queda a la marca en
 * el centro.
 *
 * Dona y no barra porque los pedazos son partes de un todo y una dona lo dice
 * sin leer: el agujero del medio sirve para poner el número que importa, y el
 * pedazo verde se compara contra la vuelta entera de un vistazo.
 *
 * SVG a mano y sin librería: son cinco arcos sobre un círculo, y meter una
 * dependencia de gráficos para esto sería más código del que ahorra.
 */
function DonaReparto({
  partes,
  centro,
  pie,
}: {
  partes: { color: string; monto: number }[];
  centro: string;
  pie: string;
}) {
  const total = partes.reduce((a, p) => a + Math.max(p.monto, 0), 0);
  const R = 54;
  const C = 2 * Math.PI * R;
  let acumulado = 0;

  return (
    <div className="flex items-center justify-center py-1">
      <div className="relative" style={{ width: 150, height: 150 }}>
        <svg viewBox="0 0 150 150" width="150" height="150" aria-hidden="true">
          {/* Arranca arriba y gira como un reloj: es como se lee una torta. */}
          <g transform="rotate(-90 75 75)">
            {partes.map((p, i) => {
              const porcion = total > 0 ? Math.max(p.monto, 0) / total : 0;
              const largo = porcion * C;
              const offset = -acumulado * C;
              acumulado += porcion;
              return (
                <circle
                  key={i}
                  cx="75"
                  cy="75"
                  r={R}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="21"
                  strokeDasharray={`${largo} ${C - largo}`}
                  strokeDashoffset={offset}
                />
              );
            })}
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[17px] font-bold text-emerald-700 tabular-nums leading-none">{centro}</span>
          <span className="text-[10px] text-neutral-500 mt-1 text-center px-6 leading-tight">{pie}</span>
        </div>
      </div>
    </div>
  );
}

function RepartoMarca({
  color,
  etiqueta,
  ayuda,
  monto,
  pct,
  pesos,
  tono,
}: {
  color: string;
  etiqueta: string;
  ayuda?: string;
  monto: number;
  pct: number;
  pesos: (n: number) => string;
  tono?: "mio" | "suyo";
}) {
  const clase = tono === "mio" ? "text-accent font-semibold" : tono === "suyo" ? "text-emerald-700 font-semibold" : "text-neutral-600";
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className={`flex items-center gap-2 ${clase}`}>
        <i className="w-2.5 h-2.5 rounded-sm block flex-none" style={{ background: color }} />
        {etiqueta}
        {ayuda && <Ayuda texto={ayuda} />}
      </span>
      <span className="flex items-baseline gap-2 tabular-nums">
        <span className="text-[11px] text-neutral-400">{pct.toFixed(1)}%</span>
        <span className={clase}>${pesos(monto)}</span>
      </span>
    </div>
  );
}

// Una línea del reparto del precio. Al lado del monto va el % del precio final,
// que es lo que deja comparar dos productos de precios distintos.
function Reparto({
  etiqueta,
  monto,
  total,
  pesos,
  destacado = false,
}: {
  etiqueta: string;
  monto: number;
  total: number;
  pesos: (n: number) => string;
  destacado?: boolean;
}) {
  const share = total > 0 ? (monto / total) * 100 : 0;
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className={destacado ? "font-semibold text-emerald-800" : "text-neutral-600"}>{etiqueta}</span>
      <span className="flex items-baseline gap-2 tabular-nums">
        <span className="text-[11px] text-neutral-400">{share.toFixed(1)}%</span>
        <span className={destacado ? "font-semibold text-emerald-800" : "text-neutral-800"}>${pesos(monto)}</span>
      </span>
    </div>
  );
}

// Entre el costo de la mercadería y lo que paga el cliente hay tres cosas más:
// la bolsita, lo que se va en cobrar (IIBB, Mercado Pago, impuesto al cheque) y
// el IVA. La cuenta es:
//
//   costo  = mercadería + bolsita
//   neto   = costo / (1 − otrosCostos% − margen%)
//   precio = neto × (1 + IVA%)        ← lo que ve el cliente en la góndola
//
// Así el margen que se escribe es el que queda de verdad. La cuenta anterior
// —precio = costo / (1 − margen)— dividía un costo SIN IVA para llegar a un
// precio CON IVA, y devolvía la mitad del margen que declaraba: con costo
// $3.702 y margen 30% daba $5.288, que sobre la venta neta son 15,3%.
//
// Los tres siguen editables (Margen, Markup o Precio): se escribe cualquiera y
// los otros dos se recalculan, no hay que elegir modo.
function PrecioCalculadora({
  costoInicial,
  costosExtraInicial,
  precioInicial,
  descuentoInicial,
  precioEfectivoInicial,
  labelCosto,
  margenMinimo,
  otrosCostos,
  otrosCostosEfectivo,
  iva,
  redondeo,
}: {
  costoInicial: number | null;
  costosExtraInicial: number | null;
  precioInicial: number | null;
  descuentoInicial: number | null;
  precioEfectivoInicial: number | null;
  labelCosto: string;
  margenMinimo: number;
  otrosCostos: number;
  otrosCostosEfectivo: number;
  iva: number;
  redondeo: number;
}) {
  const [costo, setCosto] = useState(costoInicial ?? 0);
  const [extra, setExtra] = useState(costosExtraInicial ?? 0);
  const [precio, setPrecio] = useState(precioInicial ?? 0);
  const [descuento, setDescuento] = useState(descuentoInicial ?? 0);

  const fIva = 1 + iva / 100;
  const pOtros = otrosCostos / 100;

  // Las cuatro son la misma cuenta leída en distinto orden. Reciben el costo
  // total por parámetro porque quien las llama suele tener un valor más nuevo
  // que el del estado (React actualiza recién en el próximo render).
  function precioDeMargen(m: number, costoTotal: number) {
    // Margen + otros costos llegando a 100% sería precio infinito.
    const resto = 1 - pOtros - Math.min(m, 99) / 100;
    return resto > 0.0001 ? (costoTotal / resto) * fIva : 0;
  }
  function margenDePrecio(p: number, costoTotal: number) {
    const neto = p / fIva;
    return neto > 0 ? (1 - pOtros - costoTotal / neto) * 100 : 0;
  }
  function markupDePrecio(p: number, costoTotal: number) {
    return costoTotal > 0 ? (p / costoTotal - 1) * 100 : 0;
  }
  function precioDeMarkup(mk: number, costoTotal: number) {
    return costoTotal * (1 + mk / 100);
  }

  // El precio que se guarda tiene que ser el mismo que se imprime en el cartel:
  // si el tótem cobra $7.274,82 y la góndola dice $7.300, el cliente ve dos
  // precios distintos y alguno de los dos está mal. Por eso el redondeo no es
  // una sugerencia al costado, es el precio.
  //
  // Para arriba y no al más cercano: redondear para abajo se come margen sin
  // avisar. Y solo sobre los precios que calcula el sistema — si se escribe uno
  // a mano se respeta tal cual, que para eso se escribió.
  function redondear(p: number) {
    return redondeo > 0 && p > 0 ? Math.ceil(p / redondeo) * redondeo : p;
  }

  const [markup, setMarkup] = useState(() =>
    markupDePrecio(precioInicial ?? 0, (costoInicial ?? 0) + (costosExtraInicial ?? 0))
  );
  const [margen, setMargen] = useState(() =>
    margenDePrecio(precioInicial ?? 0, (costoInicial ?? 0) + (costosExtraInicial ?? 0))
  );

  // Los dos van de la mano: se escribe uno y el otro se completa. Se guardan
  // por separado para que escribir "14" no le pise los decimales al monto ni
  // al revés.
  const [efectivo, setEfectivo] = useState(precioEfectivoInicial ?? 0);
  const [offEfectivo, setOffEfectivo] = useState(() =>
    precioInicial && precioEfectivoInicial && precioInicial > 0
      ? ((precioInicial - precioEfectivoInicial) / precioInicial) * 100
      : 0
  );

  function cambiarEfectivoPorMonto(nuevo: number) {
    setEfectivo(nuevo);
    setOffEfectivo(precio > 0 && nuevo > 0 ? ((precio - nuevo) / precio) * 100 : 0);
  }

  function cambiarEfectivoPorPorcentaje(pct: number) {
    setOffEfectivo(pct);
    setEfectivo(pct > 0 && precio > 0 ? redondear(precio * (1 - pct / 100)) : 0);
  }

  // El precio en efectivo se define contra el de lista, así que cuando el de
  // lista cambia tiene que seguirlo. Si se quedaba en los pesos viejos, el % que
  // se había elegido se desdibujaba solo: se ponía 10% menos, se subía la
  // góndola y el efectivo terminaba en un 6% que no decidió nadie.
  //
  // Manda el %, no el monto: es lo que se negocia con la marca ("Animalfit da
  // 14%") y lo que se quiere sostener cuando cambia el precio.
  function reajustarEfectivo(nuevoPrecio: number) {
    if (offEfectivo <= 0 || nuevoPrecio <= 0) return;
    setEfectivo(redondear(nuevoPrecio * (1 - offEfectivo / 100)));
  }

  // Tocar un costo deja el precio quieto: lo que cambia es cuánto margen deja
  // ese precio ahora. Si se recalculara el precio, cargar el costo real de una
  // lista nueva movería los precios de la góndola sin que nadie lo pida.
  function recalcularDesdeCosto(nuevoCosto: number) {
    setCosto(nuevoCosto);
    setMarkup(markupDePrecio(precio, nuevoCosto + extra));
    setMargen(margenDePrecio(precio, nuevoCosto + extra));
  }

  function recalcularDesdeExtra(nuevoExtra: number) {
    setExtra(nuevoExtra);
    setMarkup(markupDePrecio(precio, costo + nuevoExtra));
    setMargen(margenDePrecio(precio, costo + nuevoExtra));
  }

  function recalcularDesdePrecio(nuevoPrecio: number) {
    setPrecio(nuevoPrecio);
    setMarkup(markupDePrecio(nuevoPrecio, costo + extra));
    setMargen(margenDePrecio(nuevoPrecio, costo + extra));
    reajustarEfectivo(nuevoPrecio);
  }

  function recalcularDesdeMarkup(nuevoMarkup: number) {
    setMarkup(nuevoMarkup);
    const nuevoPrecio = redondear(precioDeMarkup(nuevoMarkup, costo + extra));
    setPrecio(nuevoPrecio);
    setMargen(margenDePrecio(nuevoPrecio, costo + extra));
    reajustarEfectivo(nuevoPrecio);
  }

  // No se pisa el margen que se está escribiendo: al redondear el precio para
  // arriba, el margen real queda un poco por encima del que se pidió, y
  // escribirlo de vuelta en el campo pelearía con quien está tipeando. La
  // diferencia se muestra debajo del precio.
  function recalcularDesdeMargen(nuevoMargen: number) {
    setMargen(nuevoMargen);
    const nuevoPrecio = redondear(precioDeMargen(nuevoMargen, costo + extra));
    setPrecio(nuevoPrecio);
    setMarkup(markupDePrecio(nuevoPrecio, costo + extra));
    reajustarEfectivo(nuevoPrecio);
  }

  const costoTotal = costo + extra;
  const precioRedondeado = Math.round(precio * 100) / 100;
  const efectivoRedondeado = Math.round(efectivo * 100) / 100;

  // Cuánto margen deja de verdad el precio que quedó, que después de redondear
  // para arriba es un poco más que el pedido. Es el número honesto: el campo
  // "Margen que quiero" guarda lo que se escribió, esto es lo que pasa.
  const margenReal = margenDePrecio(precioRedondeado, costoTotal);
  const precioSinRedondear = precioDeMargen(margen, costoTotal);
  const seRedondeo =
    redondeo > 0 && precioSinRedondear > 0 && Math.abs(precioRedondeado - precioSinRedondear) > 0.5;
  const margenBajo = precioRedondeado > 0 && margenReal < margenMinimo;

  // A dónde va cada peso de lo que paga el cliente.
  const neto = precioRedondeado / fIva;
  const montoIva = precioRedondeado - neto;
  const costosDeCobrar = neto * pOtros;
  const ganancia = neto - costoTotal - costosDeCobrar;

  // En efectivo no se paga la comisión de Mercado Pago, así que hay un descuento
  // que deja la misma ganancia que cobrando con tarjeta. Todo lo que se dé por
  // encima de ese % sale del margen.
  const netoMismaGanancia = (costoTotal + ganancia) / (1 - otrosCostosEfectivo / 100);
  // Redondeado igual que el de góndola, y para arriba: así el precio que sugiere
  // es uno que se puede poner en el cartel, y de paso queda del lado seguro.
  const precioMismaGanancia = redondear(netoMismaGanancia * fIva);
  const offGratis =
    precioRedondeado > 0 ? Math.max(0, (1 - precioMismaGanancia / precioRedondeado) * 100) : 0;

  const netoEfectivo = efectivoRedondeado / fIva;
  const gananciaEfectivo =
    efectivoRedondeado > 0 ? netoEfectivo * (1 - otrosCostosEfectivo / 100) - costoTotal : 0;
  // El % que terminó quedando después de redondear, no el que se escribió.
  const offReal =
    precioRedondeado > 0 && efectivoRedondeado > 0
      ? ((precioRedondeado - efectivoRedondeado) / precioRedondeado) * 100
      : 0;

  const pesos = (n: number) =>
    n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="border border-neutral-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-neutral-900">📦 Costo por unidad</h3>
      <p className="text-xs text-neutral-500 -mt-2">
        Lo que te sale poner una unidad en la góndola, sin IVA.
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
          <p className="text-[11px] text-neutral-400 mt-1">Lo que te cobra el proveedor por una unidad</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="costos_extra">
            Costos extra por unidad
            <Ayuda texto="La bolsita, la etiqueta, el precinto: lo que gastás por unidad y no le pagás al proveedor. Va una bolsita entera por paquete, no un pedazo. Se suma al costo solo para calcular el precio — a la marca o al proveedor se le sigue liquidando el costo de arriba." />
          </label>
          <input
            id="costos_extra"
            name="costos_extra"
            type="number"
            step="0.01"
            value={extra || ""}
            onChange={(e) => recalcularDesdeExtra(Number(e.target.value) || 0)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <p className="text-[11px] text-neutral-400 mt-1">Bolsita, etiqueta</p>
        </div>
      </div>

      {costoTotal > 0 && (
        <p className="text-xs text-neutral-600">
          Costo total de la unidad: <span className="font-semibold text-neutral-900">${pesos(costoTotal)}</span>
        </p>
      )}

      <div className="border-t border-neutral-200 pt-3 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-900">💲 Precio y rentabilidad</h3>
        <p className="text-xs text-neutral-500 -mt-2">
          Escribí el margen que querés ganar y sale el precio. O escribí el precio y te dice qué margen deja. Los
          otros dos se recalculan solos.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Margen que quiero %
              <Ayuda texto="Lo que te queda de verdad: después de la mercadería, la bolsita, Ingresos Brutos y lo que te cobran por cobrar. Antes del alquiler y los sueldos. Margen = Ganancia / Venta neta × 100." />
            </label>
            <input
              type="number"
              step="0.01"
              value={Math.round(margen * 10) / 10 || ""}
              onChange={(e) => recalcularDesdeMargen(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Otros costos %
              <Ayuda texto="Ingresos Brutos, la comisión de Mercado Pago y el impuesto al débito y crédito. Es igual para todos los productos y se cambia en Configuración, no acá." />
            </label>
            <input
              type="text"
              value={`${otrosCostos.toLocaleString("es-AR")} %`}
              readOnly
              className="w-full rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
            />
            <p className="text-[11px] text-neutral-400 mt-1">Viene de Configuración</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              IVA %
              <Ayuda texto="La alícuota del producto. El precio de góndola ya lo incluye, porque es lo que paga el cliente." />
            </label>
            <input
              type="text"
              value={`${iva.toLocaleString("es-AR")} %`}
              readOnly
              className="w-full rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
            />
            <p className="text-[11px] text-neutral-400 mt-1">Del producto</p>
          </div>
        </div>

        <div className="rounded-xl border border-accent bg-accent-tint px-4 py-3">
          <p className="text-[11px] font-semibold text-blue-800 uppercase tracking-wide">
            Precio de góndola · con IVA · tarjeta o QR
          </p>
          <p className="text-3xl font-semibold text-blue-900 tabular-nums leading-none mt-1">
            ${pesos(precioRedondeado)}
          </p>
          {precioRedondeado > 0 && costoTotal > 0 && (
            <p className="text-[11px] text-blue-800 mt-1.5 leading-snug">
              {seRedondeo
                ? `Redondeado para arriba desde $${pesos(precioSinRedondear)} — el margen queda en ${margenReal.toFixed(1)}%.`
                : `Margen real ${margenReal.toFixed(1)}%.`}{" "}
              Es el mismo precio que va a cobrar el tótem y el que sale en el cartel.
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="precio_venta_visible">
              Precio de góndola
              <Ayuda texto="Si el precio te lo pone la competencia, escribilo acá: el margen se recalcula al revés y te dice cuánto te queda con ese precio." />
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
              <Ayuda texto="Cuántas veces el costo es el precio final. Markup = Precio de góndola / Costo total − 1, en porcentaje. Ej: costo $100, precio $213 → markup 113%." />
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
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="descuento_porcentaje">
              Descuento oferta %
              <Ayuda texto="La oferta que pinta el cartelito «-20%» en el catálogo. Se aplica sobre el precio de tarjeta. Si el producto también tiene precio en efectivo, los descuentos no se suman: el cliente paga el más barato de los dos. Ver la ayuda del bloque de efectivo, más abajo." />
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

        {precioRedondeado > 0 && costoTotal > 0 && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 space-y-1">
            <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
              De los ${pesos(precioRedondeado)} que paga el cliente
            </p>
            <Reparto etiqueta="Mercadería" monto={costo} total={precioRedondeado} pesos={pesos} />
            {extra > 0 && (
              <Reparto etiqueta="Bolsita y etiqueta" monto={extra} total={precioRedondeado} pesos={pesos} />
            )}
            <Reparto
              etiqueta="Costos de cobrar"
              monto={costosDeCobrar}
              total={precioRedondeado}
              pesos={pesos}
            />
            <Reparto etiqueta="IVA" monto={montoIva} total={precioRedondeado} pesos={pesos} />
            <Reparto
              etiqueta="Te queda a vos"
              monto={ganancia}
              total={precioRedondeado}
              pesos={pesos}
              destacado
            />
          </div>
        )}
      </div>

      {margenBajo && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠️ Margen bajo: {margen.toFixed(1)}%. Te quedan ${pesos(ganancia)} por unidad. El mínimo recomendado es{" "}
          {margenMinimo}% para que el producto aguante el alquiler, los sueldos y la luz — ajustable en Configuración.
        </p>
      )}

      {/* El precio en efectivo no es un descuento: es el otro precio del
          producto. Se escribe el monto o el %, lo que sea más cómodo, y el otro
          se completa solo. Vacío = se cobra lo mismo en efectivo. */}
      <div className="border-t border-neutral-200 pt-3 space-y-2">
        <h4 className="text-sm font-semibold text-neutral-900">
          💵 Precio pagando en efectivo
          <Ayuda texto="Los descuentos NO se suman. La oferta se aplica al precio de tarjeta, y el que paga en efectivo se lleva el más barato de los dos. Ejemplo con lista $3.000 y efectivo $2.700: sin oferta paga $2.700; con oferta del 5% paga $2.700 (gana el de efectivo); con oferta del 20% paga $2.400 (gana el de oferta). Así el efectivo nunca sale más caro, y una oferta grande no termina siendo un descuento del 30% que nadie decidió." />
        </h4>
        <p className="text-xs text-neutral-500">
          Lo que se cobra si el cliente paga en efectivo. Lo de arriba es lo que se cobra con tarjeta o Mercado Pago.
          Dejalo vacío si en ese producto cobrás lo mismo de las dos formas.
        </p>

        {/* En efectivo no se paga la comisión de Mercado Pago. Ese ahorro alcanza
            para un descuento que deja la misma ganancia que la tarjeta: saberlo
            es la diferencia entre elegir el descuento y adivinarlo. */}
        {precioRedondeado > 0 && costoTotal > 0 && offGratis > 0 && (
          <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            Hasta <span className="font-semibold">{offGratis.toFixed(1)}%</span> de descuento (${pesos(
              precioMismaGanancia
            )}) ganás lo mismo que cobrando con tarjeta, porque en efectivo no pagás la comisión. Más que eso sale de
            tu margen.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="precio_efectivo_visible">
              Precio en efectivo
            </label>
            <input
              id="precio_efectivo_visible"
              type="number"
              step="0.01"
              value={efectivo || ""}
              onChange={(e) => cambiarEfectivoPorMonto(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input type="hidden" name="precio_efectivo" value={efectivo > 0 ? efectivoRedondeado : ""} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="efectivo_off">
              Es un % menos
              <Ayuda texto="Atajo: escribí acá cuánto más barato es en efectivo y el monto se calcula solo. En Animal Fitt, por ejemplo, es 14%." />
            </label>
            <input
              id="efectivo_off"
              type="number"
              step="0.1"
              value={Math.round(offEfectivo * 10) / 10 || ""}
              onChange={(e) => cambiarEfectivoPorPorcentaje(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        {efectivoRedondeado > 0 && precioRedondeado > 0 && (
          <p
            className={`text-xs rounded-lg px-3 py-2 ${
              efectivoRedondeado >= precioRedondeado
                ? "text-amber-700 bg-amber-50 border border-amber-200"
                : "text-emerald-800 bg-emerald-50 border border-emerald-200"
            }`}
          >
            {efectivoRedondeado >= precioRedondeado
              ? "⚠️ El precio en efectivo no es más barato que el de lista — revisalo, porque el cliente no va a ver ningún ahorro."
              : `El cliente ahorra $${pesos(precioRedondeado - efectivoRedondeado)} pagando en efectivo (${offReal.toFixed(1)}% menos).`}
          </p>
        )}

        {efectivoRedondeado > 0 && efectivoRedondeado < precioRedondeado && costoTotal > 0 && (
          <p
            className={`text-xs rounded-lg px-3 py-2 ${
              gananciaEfectivo >= ganancia - 0.5
                ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
                : "text-amber-700 bg-amber-50 border border-amber-200"
            }`}
          >
            {gananciaEfectivo >= ganancia - 0.5
              ? `Con ese precio ganás $${pesos(gananciaEfectivo)} en efectivo contra $${pesos(ganancia)} con tarjeta: este descuento no te cuesta nada.`
              : `⚠️ Con ese precio ganás $${pesos(gananciaEfectivo)} en efectivo contra $${pesos(ganancia)} con tarjeta — $${pesos(ganancia - gananciaEfectivo)} menos por unidad. El descuento que sale gratis es ${offGratis.toFixed(1)}%.`}
          </p>
        )}
      </div>
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
  // "Único" es plomería: el stock, el SKU y el código de barras cuelgan de
  // una variante, así que un producto sin variaciones necesita una igual.
  // Pero eso es problema del sistema, no de quien carga el producto — con una
  // sola variante el campo del nombre ni se muestra, y la sección deja de
  // hablar de variantes.
  const sinVariaciones = variantes.length <= 1;

  return (
    <div className="border border-neutral-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-neutral-900">
          {sinVariaciones ? "Stock y códigos" : "Variantes"}
        </h3>
        <button
          type="button"
          onClick={() =>
            setVariantes((prev) => [
              // Al pasar de una sola a varias, la que estaba deja de ser
              // "Único" y hay que ponerle nombre: si no, quedarían dos filas
              // y una llamada Único, que no significa nada.
              ...prev.map((x, i) => (i === 0 && prev.length === 1 ? { ...x, nombre: "" } : x)),
              { ...VARIANTE_VACIA },
            ])
          }
          className="text-xs text-accent"
        >
          + Este producto tiene variantes
        </button>
      </div>
      <p className="text-xs text-neutral-500 mb-3">
        {sinVariaciones
          ? "Si el envase ya trae código de barras, escaneálo y listo. Si no trae, el sistema le genera uno para imprimir en etiqueta."
          : "Sabores, tamaños, etc. Cada variante tiene su propio stock y su propio código de barras — se escanea del envase de cada una. Poneles un nombre a todas."}
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

      <div className="space-y-3">
        {variantes.map((v, i) => {
          const cambiar = (cambio: Partial<VarianteForm>) =>
            setVariantes((prev) => prev.map((x, j) => (j === i ? { ...x, ...cambio } : x)));

          return (
            <div
              key={i}
              // Con una sola variante las bandas van sueltas: encerrarlas en otra
              // caja sería una caja dentro de una caja dentro del modal. Con
              // varias sí hace falta el marco, para que se vea dónde termina una
              // variante y empieza la otra.
              className={
                sinVariaciones ? "space-y-2" : "rounded-xl border border-neutral-200 overflow-hidden"
              }
            >
              <input type="hidden" name="variante_id" value={v.id} />
              {sinVariaciones ? (
                // El nombre viaja igual en el envío; simplemente no se muestra.
                // Vacío el servidor lo guarda como "Único", que es lo correcto.
                <input type="hidden" name="variante_nombre" value={v.nombre} />
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-neutral-50 border-b border-neutral-200">
                  <input
                    name="variante_nombre"
                    value={v.nombre}
                    onChange={(e) => cambiar({ nombre: e.target.value })}
                    placeholder="Ej: Frutilla, 1 kg..."
                    className="flex-1 min-w-[120px] max-w-xs rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  {v.sku && (
                    <span className="ml-auto hidden sm:inline">
                      <ChipCodigo>{v.sku}</ChipCodigo>
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
              )}

              <div className={sinVariaciones ? "space-y-2" : "p-3"}>
                <Banda
                  plano={!sinVariaciones}
                  icono="📦"
                  titulo="Stock"
                  bajada="Cuándo avisarte que se está por acabar"
                >
                  <div
                    className={`grid gap-3 max-w-lg ${
                      mostrarStockInicial ? "sm:grid-cols-3" : "sm:grid-cols-2"
                    }`}
                  >
                    <CampoStock
                      id={`variante_stock_minimo_${i}`}
                      name="variante_stock_minimo"
                      etiqueta="Avisar cuando baje de"
                      valor={v.stockMinimo}
                      onCambio={(n) => cambiar({ stockMinimo: n })}
                    />
                    <CampoStock
                      id={`variante_stock_objetivo_${i}`}
                      name="variante_stock_objetivo"
                      etiqueta="Tener siempre"
                      valor={v.stockObjetivo}
                      onCambio={(n) => cambiar({ stockObjetivo: n })}
                    />
                    {mostrarStockInicial && (
                      <CampoStock
                        id={`variante_stock_inicial_${i}`}
                        name="variante_stock_inicial"
                        etiqueta="Entra ahora"
                        valor={v.stockInicial}
                        onCambio={(n) => cambiar({ stockInicial: n })}
                      />
                    )}
                  </div>
                </Banda>

                <Banda
                  plano={!sinVariaciones}
                  icono="🏷️"
                  titulo="Código de barras"
                  bajada="Lo que lee el tótem cuando el cliente escanea"
                >
                  <CodigoBarrasVariante variante={v} onCambio={cambiar} />
                </Banda>

                {sinVariaciones && (
                  <Banda
                    icono="🔖"
                    titulo="Identificación interna"
                    bajada="Para buscarlo en el sistema y en las órdenes"
                  >
                    {v.sku ? (
                      <ChipCodigo>{v.sku}</ChipCodigo>
                    ) : (
                      <p className="text-xs text-neutral-400">Se genera solo al guardar.</p>
                    )}
                  </Banda>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Un tema del bloque, con su título y su explicación de una línea.
 *
 * `plano` saca el marco: adentro de una variante ya hay un marco (el de la
 * variante) y anidar cajas hace que no se entienda cuál contiene a cuál.
 */
function Banda({
  icono,
  titulo,
  bajada,
  plano = false,
  children,
}: {
  icono: string;
  titulo: string;
  bajada: string;
  plano?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        plano
          ? "pt-3 mt-3 border-t border-neutral-200 first:pt-0 first:mt-0 first:border-t-0"
          : "rounded-xl border border-neutral-200 bg-white p-3.5"
      }
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span
          aria-hidden
          className="w-7 h-7 rounded-lg bg-neutral-100 grid place-items-center text-sm shrink-0"
        >
          {icono}
        </span>
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-neutral-900 leading-tight">{titulo}</h4>
          <p className="text-xs text-neutral-400 leading-tight">{bajada}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ChipCodigo({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block font-mono text-xs text-neutral-600 bg-neutral-100 border border-neutral-200 rounded px-2 py-1 whitespace-nowrap">
      {children}
    </span>
  );
}

/** Un número de stock con su unidad adentro, para que "15" no quede solo. */
function CampoStock({
  id,
  name,
  etiqueta,
  valor,
  onCambio,
}: {
  id: string;
  name: string;
  etiqueta: string;
  valor: number;
  onCambio: (n: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-neutral-500 mb-1" htmlFor={id}>
        {etiqueta}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type="number"
          min={0}
          value={valor}
          onChange={(e) => onCambio(Number(e.target.value))}
          // Sin esto las flechitas del navegador se montan sobre "unidades".
          className="w-full rounded-lg border border-neutral-300 pl-3 pr-[60px] py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-neutral-400 pointer-events-none">
          unidades
        </span>
      </div>
    </div>
  );
}

/**
 * El cartelito de color que dice si ese producto dejó trabajo pendiente.
 *
 * Verde: se escanea del envase, no hay nada que hacer. Ámbar: hay que imprimir
 * el código y pegarlo. Es el mismo código de colores que usa la pantalla de
 * Códigos de barras, así que lo que se ve acá es lo que se va a ver allá.
 */
function Estado({
  tono,
  titulo,
  codigo,
  children,
}: {
  tono: "verde" | "ambar";
  titulo: string;
  codigo?: string;
  children: React.ReactNode;
}) {
  const verde = tono === "verde";
  return (
    <div
      className={`mt-3 flex gap-3 rounded-xl border p-3 ${
        verde ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
      }`}
    >
      <span
        aria-hidden
        className={`w-5 h-5 mt-0.5 rounded-full grid place-items-center text-[11px] font-bold text-white shrink-0 ${
          verde ? "bg-emerald-600" : "bg-amber-600"
        }`}
      >
        {verde ? "✓" : "!"}
      </span>
      <div className="min-w-0">
        <strong className={`block text-[13px] font-semibold ${verde ? "text-emerald-700" : "text-amber-700"}`}>
          {titulo}
        </strong>
        {codigo && (
          <span className="block font-mono text-[15px] tracking-wider text-neutral-800 my-1">{codigo}</span>
        )}
        <span className="block text-xs text-neutral-600 leading-relaxed">{children}</span>
      </div>
    </div>
  );
}

/**
 * La pregunta que decide si hay que imprimir una etiqueta o no.
 *
 * La mayoría de los productos de marca ya traen su código impreso: para esos,
 * escanear el envase una vez y listo. Los que no traen (fraccionados, a granel)
 * usan el código que el sistema genera solo, y esos sí hay que etiquetarlos.
 *
 * Se pregunta acá, al cargar el producto, porque es el único momento en que
 * alguien tiene el envase en la mano.
 */
function CodigoBarrasVariante({
  variante,
  onCambio,
}: {
  variante: VarianteForm;
  onCambio: (cambio: Partial<VarianteForm>) => void;
}) {
  const [escaneando, setEscaneando] = useState(false);
  const codigo = limpiarCodigoBarras(variante.codigoPropio);
  // Solo se avisa cuando el largo es de un formato conocido: un código de 9
  // dígitos no es "inválido", es que todavía lo están tipeando.
  const digitoSospechoso = largoDeCodigoConocido(codigo) && !digitoVerificadorOk(codigo);

  return (
    <div>
      {/* Lo que realmente viaja al servidor. Vacío = "no tiene código propio",
          y el servidor se encarga de darle uno interno. */}
      <input
        type="hidden"
        name="variante_codigo_barras"
        value={variante.tienePropio ? codigo : ""}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-neutral-600">¿El envase ya trae el suyo impreso?</span>
        <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden bg-white">
          {[
            { valor: true, texto: "Sí, tiene" },
            { valor: false, texto: "No tiene" },
          ].map((op) => (
            <button
              key={String(op.valor)}
              type="button"
              onClick={() => onCambio({ tienePropio: op.valor })}
              className={`px-3 py-1.5 text-xs font-medium ${
                variante.tienePropio === op.valor
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {op.texto}
            </button>
          ))}
        </div>
      </div>

      {variante.tienePropio ? (
        <>
          <div className="flex items-center gap-2 mt-3">
            <input
              value={variante.codigoPropio}
              onChange={(e) => onCambio({ codigoPropio: limpiarCodigoBarras(e.target.value) })}
              // Un lector USB termina de "tipear" el código con un Enter. Sin
              // este freno, ese Enter guarda el producto a medio cargar.
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              inputMode="numeric"
              placeholder="Escaneá el envase o escribí el número"
              className="flex-1 min-w-[140px] rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => setEscaneando(true)}
              className="shrink-0 rounded-lg bg-accent text-white px-3.5 py-2 text-xs font-semibold hover:bg-accent-dark"
            >
              📷 Escanear
            </button>
          </div>

          {codigo &&
            (digitoSospechoso ? (
              <Estado tono="ambar" titulo="Revisá el número">
                No cierra con el dígito de control, así que puede haber un número mal tipeado. Si lo
                escaneaste con la cámara está bien igual — hay envases importados con códigos raros.
              </Estado>
            ) : (
              <Estado tono="verde" titulo="Se escanea del propio envase">
                No hay que imprimir ni pegar nada. Este producto ya se puede pasar por el tótem.
              </Estado>
            ))}
        </>
      ) : (
        <Estado
          tono="ambar"
          titulo="Hay que imprimirle el código y pegarlo"
          codigo={variante.codigoInterno ? formatearCodigo(variante.codigoInterno) : undefined}
        >
          {variante.codigoInterno
            ? "El sistema le generó este código. Se imprime en sticker desde Catálogo → Códigos de barras y se pega en el producto cuando entra la mercadería. No lleva precio."
            : "Al guardar, el sistema le va a generar un código para imprimir en sticker y pegar en el producto."}
        </Estado>
      )}

      {escaneando && (
        <EscanerCodigo
          onCerrar={() => setEscaneando(false)}
          onLeido={(valor) => {
            onCambio({ tienePropio: true, codigoPropio: limpiarCodigoBarras(valor) });
            setEscaneando(false);
          }}
        />
      )}
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
