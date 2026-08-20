import * as XLSX from "xlsx";

export type FilaImportacion = {
  fila: number;
  nombreExcel: string;
  encontrado: boolean;
  idProducto: string | null;
  nombreActual: string | null;
  costoActual: number | null;
  precioActual: number | null;
  descuentoActual: number | null;
  costoNuevo: number | null;
  precioNuevo: number | null;
  descuentoNuevo: number | null;
};

type FilaExcel = {
  Producto?: string;
  producto?: string;
  Costo?: number | string;
  costo?: number | string;
  Precio?: number | string;
  precio?: number | string;
  "Descuento %"?: number | string;
  "descuento %"?: number | string;
  Descuento?: number | string;
  descuento?: number | string;
};

function numeroONull(valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function normalizar(texto: string) {
  return texto.trim().toLowerCase();
}

export async function leerFilasExcel(archivo: File): Promise<
  { nombreExcel: string; costoNuevo: number | null; precioNuevo: number | null; descuentoNuevo: number | null }[]
> {
  const buffer = await archivo.arrayBuffer();
  const libro = XLSX.read(buffer, { type: "array" });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json<FilaExcel>(hoja, { defval: null });

  return filas
    .map((f) => ({
      nombreExcel: String(f.Producto ?? f.producto ?? "").trim(),
      costoNuevo: numeroONull(f.Costo ?? f.costo),
      precioNuevo: numeroONull(f.Precio ?? f.precio),
      descuentoNuevo: numeroONull(f["Descuento %"] ?? f["descuento %"] ?? f.Descuento ?? f.descuento),
    }))
    .filter((f) => f.nombreExcel.length > 0);
}

export function armarPreview(
  filasExcel: { nombreExcel: string; costoNuevo: number | null; precioNuevo: number | null; descuentoNuevo: number | null }[],
  productos: {
    id_producto: string;
    nombre: string;
    costo_informado: number | null;
    precio_venta: number | null;
    descuento_porcentaje: number | null;
  }[]
): FilaImportacion[] {
  const porNombre = new Map(productos.map((p) => [normalizar(p.nombre), p]));

  return filasExcel.map((f, i) => {
    const match = porNombre.get(normalizar(f.nombreExcel));
    return {
      fila: i + 2, // +2: la fila 1 es el encabezado
      nombreExcel: f.nombreExcel,
      encontrado: Boolean(match),
      idProducto: match?.id_producto ?? null,
      nombreActual: match?.nombre ?? null,
      costoActual: match?.costo_informado ?? null,
      precioActual: match?.precio_venta ?? null,
      descuentoActual: match?.descuento_porcentaje ?? null,
      costoNuevo: f.costoNuevo,
      precioNuevo: f.precioNuevo,
      descuentoNuevo: f.descuentoNuevo,
    };
  });
}
