"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { leerFilasExcel, armarPreview, type FilaImportacion } from "@/lib/importarPrecios";

export async function previsualizarImportacion(idMarca: string, formData: FormData): Promise<FilaImportacion[]> {
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    throw new Error("Elegí un archivo de Excel para continuar.");
  }

  const filasExcel = await leerFilasExcel(archivo);
  if (filasExcel.length === 0) {
    throw new Error(
      'No encontré filas para importar. Revisá que la primera fila tenga los títulos "Producto", "Costo", "Precio" y "Descuento %".'
    );
  }

  const supabase = getSupabaseServerClient();
  const { data: productos, error } = await supabase
    .from("productos")
    .select("id_producto, nombre, costo_informado, precio_venta, descuento_porcentaje")
    .eq("id_marca", idMarca);
  if (error) throw new Error(error.message);

  return armarPreview(filasExcel, productos ?? []);
}

export async function confirmarImportacion(
  idMarca: string,
  cambios: { idProducto: string; costo: number | null; precio: number | null; descuento: number | null }[]
) {
  if (cambios.length === 0) throw new Error("No hay cambios seleccionados para aplicar.");

  const supabase = getSupabaseServerClient();

  for (const cambio of cambios) {
    const { error } = await supabase
      .from("productos")
      .update({
        costo_informado: cambio.costo,
        precio_venta: cambio.precio,
        descuento_porcentaje: cambio.descuento,
        fecha_actualizacion: new Date().toISOString(),
      })
      .eq("id_producto", cambio.idProducto);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/productos");
  revalidatePath(`/marcas/${idMarca}`);

  return { actualizados: cambios.length };
}
