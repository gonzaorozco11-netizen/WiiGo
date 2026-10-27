import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import { precioDe } from "@/lib/precios";
import type { EstadoPedido } from "@/lib/pedidosProfesional";
import ArmarPedido, { type ProductoCatalogo, type PedidoHecho } from "./ArmarPedido";

export const dynamic = "force-dynamic";

// Armar el pedido de un paciente, en la consulta, con todo el catálogo de
// WiiGo a la vista. Ve precios de venta y lo que da cada marca; nunca costos.
export default async function PedidosEspacio() {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) redirect("/login?next=/mi-espacio/pedidos");
  const id = sesion.idProfesional;
  const supabase = getSupabaseServerClient();
  const hoy = new Date().toISOString().slice(0, 10);

  const [prodRes, varRes, marcasRes, confRes, relRes, objRes, propiosRes, localesRes, stockRes, pedidosRes] = await Promise.all([
    supabase.from("productos").select("id_producto, nombre, id_marca, imagen, precio_venta, precio_efectivo, descuento_porcentaje").eq("estado", "ACTIVO"),
    supabase.from("variantes_producto").select("id_variante, id_producto, nombre, precio_venta, precio_efectivo, orden").eq("estado", "ACTIVO"),
    supabase.from("marcas").select("id_marca, nombre").eq("estado", "ACTIVA"),
    supabase
      .from("config_profesionales_marca")
      .select("id_marca, porcentaje_cliente, porcentaje_profesional, tipo_beneficio_cliente, fecha_desde")
      .eq("estado", "ACTIVA")
      .eq("participa", true)
      .lte("fecha_desde", hoy)
      .or(`fecha_hasta.is.null,fecha_hasta.gte.${hoy}`)
      .order("fecha_desde", { ascending: false }),
    supabase.from("producto_objetivos").select("id_producto, id_objetivo"),
    supabase.from("objetivos").select("id_objetivo, nombre").eq("estado", "ACTIVO").order("orden"),
    supabase.from("profesional_objetivos").select("id_objetivo").eq("id_profesional", id),
    supabase.from("locales").select("id_local, nombre, direccion").eq("estado", "ACTIVO").order("nombre"),
    supabase.from("stock").select("id_variante, id_local, cantidad"),
    supabase
      .from("pedidos_profesional")
      .select("id_pedido, numero, paciente_nombre, paciente_apellido, estado, creado, nota_falta, pedidos_profesional_items(cantidad, precio_lista)")
      .eq("id_profesional", id)
      .order("creado", { ascending: false })
      .limit(15),
  ]);

  const nombreMarca = new Map((marcasRes.data ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const vigente = new Map<string, { cliente: number; profesional: number; descuento: boolean }>();
  for (const c of confRes.data ?? []) {
    if (!vigente.has(c.id_marca as string)) {
      vigente.set(c.id_marca as string, {
        cliente: Number(c.porcentaje_cliente ?? 0),
        profesional: Number(c.porcentaje_profesional ?? 0),
        descuento: c.tipo_beneficio_cliente === "DESCUENTO",
      });
    }
  }
  const objetivosDe = new Map<string, string[]>();
  for (const r of relRes.data ?? []) {
    const lista = objetivosDe.get(r.id_producto as string) ?? [];
    lista.push(r.id_objetivo as string);
    objetivosDe.set(r.id_producto as string, lista);
  }
  const stockPorVariante = new Map<string, number>();
  for (const s of stockRes.data ?? []) stockPorVariante.set(s.id_variante as string, (stockPorVariante.get(s.id_variante as string) ?? 0) + Number(s.cantidad ?? 0));

  const productoPorId = new Map((prodRes.data ?? []).map((p) => [p.id_producto as string, p]));
  const variantesPorProducto = new Map<string, number>();
  for (const v of varRes.data ?? []) variantesPorProducto.set(v.id_producto as string, (variantesPorProducto.get(v.id_producto as string) ?? 0) + 1);

  const catalogo: ProductoCatalogo[] = (varRes.data ?? [])
    .map((v) => {
      const p = productoPorId.get(v.id_producto as string);
      if (!p || !nombreMarca.has(p.id_marca as string)) return null;
      const conVariantes = (variantesPorProducto.get(p.id_producto as string) ?? 0) > 1;
      const config = vigente.get(p.id_marca as string) ?? null;
      const precioLista = precioDe(p, v, "OTRO");
      if (!precioLista) return null;
      return {
        idVariante: v.id_variante as string,
        nombre: conVariantes ? `${p.nombre} · ${v.nombre}` : (p.nombre as string),
        marca: nombreMarca.get(p.id_marca as string) ?? "",
        idMarca: p.id_marca as string,
        imagen: (p.imagen as string | null) ?? null,
        precioLista,
        precioEfectivo: precioDe(p, v, "EFECTIVO"),
        hayStock: (stockPorVariante.get(v.id_variante as string) ?? 0) > 0,
        objetivos: objetivosDe.get(p.id_producto as string) ?? [],
        porcentajeCliente: config?.cliente ?? 0,
        porcentajeProfesional: config?.profesional ?? 0,
        descuentoCliente: config?.descuento ?? false,
        participa: Boolean(config),
      };
    })
    .filter((x): x is ProductoCatalogo => x !== null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const pedidos: PedidoHecho[] = (pedidosRes.data ?? []).map((p) => {
    const items = (p.pedidos_profesional_items as { cantidad: number; precio_lista: number }[] | null) ?? [];
    return {
      idPedido: p.id_pedido as string,
      numero: Number(p.numero),
      paciente: `${p.paciente_nombre} ${p.paciente_apellido}`,
      estado: p.estado as EstadoPedido,
      creado: p.creado as string,
      notaFalta: (p.nota_falta as string | null) ?? null,
      total: items.reduce((t, i) => t + Number(i.precio_lista) * Number(i.cantidad), 0),
    };
  });

  return (
    <main className="esp-lienzo">
      <ArmarPedido
        catalogo={catalogo}
        objetivos={(objRes.data ?? []).map((o) => ({ id: o.id_objetivo as string, nombre: o.nombre as string }))}
        objetivosPropios={(propiosRes.data ?? []).map((o) => o.id_objetivo as string)}
        locales={(localesRes.data ?? []).map((l) => ({ id: l.id_local as string, nombre: l.nombre as string, direccion: (l.direccion as string | null) ?? null }))}
        pedidos={pedidos}
        disponible={!pedidosRes.error}
      />
    </main>
  );
}
