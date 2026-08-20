import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: marca } = await supabase.from("marcas").select("nombre").eq("id_marca", id).maybeSingle();
  if (!marca) {
    return new NextResponse("Marca no encontrada", { status: 404 });
  }

  const { data: productos } = await supabase
    .from("productos")
    .select("nombre, costo_informado, precio_venta, descuento_porcentaje")
    .eq("id_marca", id)
    .order("nombre", { ascending: true });

  const filas = (productos ?? []).map((p) => ({
    Producto: p.nombre,
    Costo: p.costo_informado ?? "",
    Precio: p.precio_venta ?? "",
    "Descuento %": p.descuento_porcentaje ?? "",
  }));

  const hoja = XLSX.utils.json_to_sheet(filas);
  hoja["!cols"] = [{ wch: 45 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Precios");

  const buffer = XLSX.write(libro, { type: "buffer", bookType: "xlsx" });

  const nombreArchivo = `plantilla-precios-${marca.nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
    },
  });
}
