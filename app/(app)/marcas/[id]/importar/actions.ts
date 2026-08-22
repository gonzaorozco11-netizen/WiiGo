"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { leerFilasExcel, armarPreview, type FilaImportacion } from "@/lib/importarPrecios";

// Next.js redacta en producción el mensaje de un throw new Error() en una
// Server Action (queda solo un digest genérico) — por eso estas funciones
// devuelven { error } como dato, junto con el resultado si salió bien.
export async function previsualizarImportacion(
  idMarca: string,
  formData: FormData
): Promise<{ error: string | null; filas?: FilaImportacion[] }> {
  try {
    const archivo = formData.get("archivo");
    if (!(archivo instanceof File) || archivo.size === 0) {
      return { error: "Elegí un archivo de Excel para continuar." };
    }

    const filasExcel = await leerFilasExcel(archivo);
    if (filasExcel.length === 0) {
      return {
        error:
          'No encontré filas para importar. Revisá que la primera fila tenga los títulos "Producto", "Costo", "Precio" y "Descuento %".',
      };
    }

    const supabase = getSupabaseServerClient();
    const { data: productos, error } = await supabase
      .from("productos")
      .select("id_producto, nombre, costo_informado, precio_venta, descuento_porcentaje")
      .eq("id_marca", idMarca);
    if (error) return { error: error.message };

    return { error: null, filas: armarPreview(filasExcel, productos ?? []) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo leer el archivo" };
  }
}

export async function confirmarImportacion(
  idMarca: string,
  cambios: { idProducto: string; costo: number | null; precio: number | null; descuento: number | null }[]
): Promise<{ error: string | null; actualizados?: number }> {
  try {
    if (cambios.length === 0) return { error: "No hay cambios seleccionados para aplicar." };

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
      if (error) return { error: error.message };
    }

    revalidatePath("/productos");
    revalidatePath(`/marcas/${idMarca}`);

    return { error: null, actualizados: cambios.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo aplicar la importación" };
  }
}
