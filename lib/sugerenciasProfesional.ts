import type { SupabaseClient } from "@supabase/supabase-js";

// Productos para que una profesional recomiende a sus pacientes, según lo que
// trabaja (sus objetivos en el asesor, cruzados con los productos asignados a
// cada objetivo en Catálogo asesor). Solo de marcas que participan del
// programa de profesionales: si no, ella no suma nada.

export type Sugerencia = {
  idProducto: string;
  nombre: string;
  marca: string;
  precio: number | null;
  imagen: string | null;
  objetivo: string;
  porcentajeCliente: number;
  porcentajeProfesional: number;
};

export async function sugerenciasParaProfesional(supabase: SupabaseClient, idProfesional: string, limite = 4): Promise<Sugerencia[]> {
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: propios } = await supabase.from("profesional_objetivos").select("id_objetivo").eq("id_profesional", idProfesional);
  const idsObjetivo = (propios ?? []).map((o) => o.id_objetivo as string);
  if (idsObjetivo.length === 0) return [];

  const [relRes, objRes, confRes] = await Promise.all([
    supabase.from("producto_objetivos").select("id_producto, id_objetivo").in("id_objetivo", idsObjetivo),
    supabase.from("objetivos").select("id_objetivo, nombre").in("id_objetivo", idsObjetivo),
    supabase
      .from("config_profesionales_marca")
      .select("id_marca, porcentaje_cliente, porcentaje_profesional, fecha_desde")
      .eq("estado", "ACTIVA")
      .eq("participa", true)
      .lte("fecha_desde", hoy)
      .or(`fecha_hasta.is.null,fecha_hasta.gte.${hoy}`)
      .order("fecha_desde", { ascending: false }),
  ]);
  const idsProducto = [...new Set((relRes.data ?? []).map((r) => r.id_producto as string))];
  if (idsProducto.length === 0) return [];

  const vigente = new Map<string, { cliente: number; profesional: number }>();
  for (const c of confRes.data ?? []) {
    if (!vigente.has(c.id_marca as string)) {
      vigente.set(c.id_marca as string, { cliente: Number(c.porcentaje_cliente ?? 0), profesional: Number(c.porcentaje_profesional ?? 0) });
    }
  }

  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre, id_marca, precio_venta, imagen, estado, visible_asesor")
    .in("id_producto", idsProducto)
    .eq("estado", "ACTIVO");
  const idsMarca = [...new Set((productos ?? []).map((p) => p.id_marca as string))];
  const { data: marcas } = await supabase.from("marcas").select("id_marca, nombre").in("id_marca", idsMarca.length ? idsMarca : ["00000000-0000-0000-0000-000000000000"]);
  const nombreMarca = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const nombreObjetivo = new Map((objRes.data ?? []).map((o) => [o.id_objetivo as string, o.nombre as string]));
  const objetivoDe = new Map<string, string>();
  for (const r of relRes.data ?? []) {
    if (!objetivoDe.has(r.id_producto as string)) objetivoDe.set(r.id_producto as string, nombreObjetivo.get(r.id_objetivo as string) ?? "");
  }

  return (productos ?? [])
    .filter((p) => p.visible_asesor !== false && vigente.has(p.id_marca as string))
    // Primero los que tienen foto: en WhatsApp y en la pantalla se ven mucho mejor.
    .sort((a, b) => Number(Boolean(b.imagen)) - Number(Boolean(a.imagen)))
    .slice(0, limite)
    .map((p) => {
      const v = vigente.get(p.id_marca as string)!;
      return {
        idProducto: p.id_producto as string,
        nombre: p.nombre as string,
        marca: nombreMarca.get(p.id_marca as string) ?? "",
        precio: (p.precio_venta as number | null) ?? null,
        imagen: (p.imagen as string | null) ?? null,
        objetivo: objetivoDe.get(p.id_producto as string) ?? "",
        porcentajeCliente: v.cliente,
        porcentajeProfesional: v.profesional,
      };
    });
}
