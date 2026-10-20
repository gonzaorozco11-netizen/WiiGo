import type { SupabaseClient } from "@supabase/supabase-js";

// Descontar del stock lo que se vendió — el único lugar donde una venta toca
// el stock, para el mostrador y para el totem.
//
// Qué pasa cuando el sistema dice 0 y el producto está en la mano del
// cliente: se vende igual. Frenar la venta no hace aparecer el stock, y lo
// que casi siempre pasó es que el número está mal (una entrega que no se
// cargó, un conteo viejo), no que el producto no existe. Lo que sí se hace es
// dejar rastro, en dos lugares:
//
//   - En el libro de movimientos, un AJUSTE por el faltante. Antes la venta
//     anotaba -1 pero el stock se frenaba en 0, y desde ese día el libro y el
//     stock no volvían a coincidir nunca. Con el ajuste la suma del libro da
//     exactamente el stock que quedó.
//   - En la venta, `a_revisar` con qué producto y cuánto, para que alguien
//     vaya a mirar la góndola y corrija el número de verdad.

export type LineaAVender = { idVariante: string; cantidad: number };

export type SinStock = {
  idVariante: string;
  producto: string;
  habia: number;
  vendidas: number;
};

export async function descontarStockDeVenta(
  supabase: SupabaseClient,
  params: {
    idVenta: string;
    numeroVenta: number;
    idLocal: string;
    lineas: LineaAVender[];
    /** Cómo se llama esta venta en el libro: "Venta mostrador (POS)", etc. */
    motivo: string;
    usuario: string | null;
  }
): Promise<{ error: string | null; sinStock: SinStock[] }> {
  const { idVenta, numeroVenta, idLocal, lineas, motivo, usuario } = params;
  const ahora = new Date().toISOString();
  const faltantes: { idVariante: string; habia: number; vendidas: number }[] = [];

  for (const linea of lineas) {
    const { data: actual } = await supabase
      .from("stock")
      .select("cantidad")
      .eq("id_variante", linea.idVariante)
      .eq("id_local", idLocal)
      .maybeSingle();
    const habia = (actual?.cantidad as number | undefined) ?? 0;
    const faltante = Math.max(linea.cantidad - habia, 0);

    const { error: errorStock } = await supabase
      .from("stock")
      .upsert(
        { id_variante: linea.idVariante, id_local: idLocal, cantidad: Math.max(habia - linea.cantidad, 0), fecha_actualizacion: ahora },
        { onConflict: "id_variante,id_local" }
      );
    if (errorStock) return { error: errorStock.message, sinStock: [] };

    await supabase.from("movimientos_stock").insert({
      id_variante: linea.idVariante,
      id_local: idLocal,
      tipo: "VENTA",
      cantidad: -linea.cantidad,
      motivo,
      id_referencia: idVenta,
      usuario,
    });

    if (faltante > 0) {
      // El ajuste compensa justo lo que el stock no tenía: -vendidas + faltante
      // = -habia, que es lo que de verdad bajó el stock (de `habia` a 0).
      await supabase.from("movimientos_stock").insert({
        id_variante: linea.idVariante,
        id_local: idLocal,
        tipo: "AJUSTE",
        cantidad: faltante,
        motivo: `Vendido sin stock registrado en venta #${numeroVenta} — había ${habia}, se vendieron ${linea.cantidad}. A revisar.`,
        id_referencia: idVenta,
        usuario,
      });
      faltantes.push({ idVariante: linea.idVariante, habia, vendidas: linea.cantidad });
    }
  }

  if (faltantes.length === 0) return { error: null, sinStock: [] };

  // Con nombre, que es como lo va a leer quien revise.
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_variante", faltantes.map((f) => f.idVariante));
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre")
    .in("id_producto", (variantes ?? []).map((v) => v.id_producto as string));
  const nombreProducto = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
  const nombreVariante = new Map(
    (variantes ?? []).map((v) => {
      const base = nombreProducto.get(v.id_producto as string) ?? "Producto";
      return [v.id_variante as string, v.nombre !== "Único" ? `${base} — ${v.nombre}` : base];
    })
  );

  const sinStock: SinStock[] = faltantes.map((f) => ({
    ...f,
    producto: nombreVariante.get(f.idVariante) ?? "Producto",
  }));

  const texto =
    "Se vendió sin stock registrado: " +
    sinStock.map((s) => `${s.producto} (había ${s.habia}, se vendieron ${s.vendidas})`).join("; ") +
    ". Revisar la góndola y corregir el stock.";

  // Si la columna todavía no existe (sql/ventas-a-revisar.sql sin correr) la
  // venta ya está hecha y el ajuste ya quedó en el libro con el mismo texto:
  // no se frena la venta por una marca que no se pudo poner.
  await supabase.from("ventas").update({ a_revisar: texto }).eq("id_venta", idVenta);

  return { error: null, sinStock };
}
