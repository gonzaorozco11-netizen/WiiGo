import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import type { EstadoPedido } from "@/lib/pedidosProfesional";
import { devueltoPorDetalle } from "@/lib/devueltoPorDetalle";
import type { SupabaseClient } from "@supabase/supabase-js";
import MisPedidos, { type PedidoConItems, type Historial, type HistorialCompra } from "./MisPedidos";

export const dynamic = "force-dynamic";

// Los pedidos que armó ella, con lo que llevó cada uno. Antes estaban al pie
// de "Armar pedido"; Gonzalo pidió que fueran una solapa aparte (2026-11-02).
//
// Además, el historial de compras en WiiGo de sus pacientes, pero solo de
// los que le dieron permiso (Gonzalo, 2026-11-02): lo que se compra en una
// dietética dice mucho de la salud.
export default async function MisPedidosEspacio() {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) redirect("/login?next=/mi-espacio/mis-pedidos");
  const supabase = getSupabaseServerClient();

  // Con "*": la columna para_profesional puede no estar (sql/profesionales-pedido-propio.sql).
  const { data, error } = await supabase
    .from("pedidos_profesional")
    .select("*, pedidos_profesional_items(nombre, cantidad, precio_lista)")
    .eq("id_profesional", sesion.idProfesional)
    .order("creado", { ascending: false })
    .limit(300);

  const pedidos: PedidoConItems[] = (data ?? []).map((p) => {
    const items = ((p.pedidos_profesional_items as { nombre: string; cantidad: number; precio_lista: number }[] | null) ?? []).map((i) => ({
      nombre: i.nombre,
      cantidad: Number(i.cantidad),
      precio: Number(i.precio_lista),
    }));
    const paraVos = p.para_profesional === true;
    return {
      idPedido: p.id_pedido as string,
      numero: Number(p.numero),
      paciente: paraVos ? "Para vos" : [p.paciente_nombre, p.paciente_apellido].filter(Boolean).join(" "),
      // Para agrupar por paciente: el DNI si está, si no el nombre.
      clavePaciente: paraVos ? "para-vos" : String(p.paciente_dni ?? `${p.paciente_nombre} ${p.paciente_apellido}`).toLowerCase(),
      estado: p.estado as EstadoPedido,
      creado: p.creado as string,
      notaFalta: (p.nota_falta as string | null) ?? null,
      items,
      total: items.reduce((t, i) => t + i.precio * i.cantidad, 0),
    };
  });

  const historial = await historialDePacientes(supabase, sesion.idProfesional);

  return (
    <main className="esp-lienzo">
      <MisPedidos pedidos={pedidos} disponible={!error} historial={historial} />
    </main>
  );
}

const NOMBRE_VARIANTE_VACIO = /^(único|unico|default|-|)$/i;

/**
 * Lo que compraron en WiiGo sus pacientes vigentes, SOLO de los que dieron el
 * permiso (sql/profesionales-permiso-compras.sql), y desde que lo dieron.
 * Sin montos ni medio de pago: qué llevó y cuándo. A los demás se los lista
 * para que sepa que el permiso se pide en la caja.
 */
async function historialDePacientes(supabase: SupabaseClient, idProfesional: string): Promise<Historial> {
  const { data: vinculos, error } = await supabase
    .from("pacientes_profesional")
    .select("id_cliente, hasta, comparte_compras, comparte_compras_at")
    .eq("id_profesional", idProfesional)
    .is("cerrado_at", null)
    .gt("hasta", new Date().toISOString());
  if (error) return { disponible: false, pacientes: [] };

  const ids = [...new Set((vinculos ?? []).map((v) => v.id_cliente as string))];
  if (ids.length === 0) return { disponible: true, pacientes: [] };
  const { data: clientes } = await supabase.from("clientes").select("id_cliente, nombre, apellido").in("id_cliente", ids);
  const nombreDe = new Map((clientes ?? []).map((c) => [c.id_cliente as string, [c.nombre, c.apellido].filter(Boolean).join(" ")]));

  const conPermiso = (vinculos ?? []).filter((v) => v.comparte_compras && v.comparte_compras_at);
  const desdeDe = new Map(conPermiso.map((v) => [v.id_cliente as string, v.comparte_compras_at as string]));
  const comprasDe = new Map<string, HistorialCompra[]>();

  if (conPermiso.length > 0) {
    const masViejo = conPermiso.map((v) => v.comparte_compras_at as string).sort()[0];
    const { data: ventas } = await supabase
      .from("ventas")
      .select("id_venta, id_cliente, fecha")
      .in("id_cliente", [...desdeDe.keys()])
      .eq("estado", "PAGADA")
      .gte("fecha", masViejo)
      .order("fecha", { ascending: false })
      .limit(500);
    // Cada paciente, desde SU permiso: no lo que compró antes de darlo.
    const validas = (ventas ?? []).filter((v) => {
      const desde = desdeDe.get(v.id_cliente as string);
      return !!desde && new Date(v.fecha as string).getTime() >= new Date(desde).getTime();
    });
    const idsVenta = validas.map((v) => v.id_venta as string);
    const detalle: { id_detalle: string; id_venta: string; id_variante: string; cantidad: number }[] = [];
    for (let i = 0; i < idsVenta.length; i += 200) {
      const { data } = await supabase.from("detalle_ventas").select("id_detalle, id_venta, id_variante, cantidad").in("id_venta", idsVenta.slice(i, i + 200));
      detalle.push(...((data ?? []) as typeof detalle));
    }
    const devueltos = await devueltoPorDetalle(supabase, detalle.map((d) => d.id_detalle));
    const idsVariante = [...new Set(detalle.map((d) => d.id_variante))];
    const { data: variantes } = idsVariante.length
      ? await supabase.from("variantes_producto").select("id_variante, nombre, productos(nombre)").in("id_variante", idsVariante)
      : { data: [] };
    const nombreProducto = new Map(
      ((variantes ?? []) as { id_variante: string; nombre: string | null; productos: { nombre: string } | { nombre: string }[] | null }[]).map((v) => {
        const prod = Array.isArray(v.productos) ? v.productos[0] : v.productos;
        const base = prod?.nombre ?? "Producto";
        return [v.id_variante, v.nombre && !NOMBRE_VARIANTE_VACIO.test(v.nombre.trim()) ? `${base} · ${v.nombre}` : base];
      })
    );
    const itemsDe = new Map<string, { nombre: string; cantidad: number }[]>();
    for (const d of detalle) {
      const cantidad = Number(d.cantidad) - (devueltos.get(d.id_detalle)?.cantidad ?? 0);
      if (cantidad <= 0) continue;
      const lista = itemsDe.get(d.id_venta) ?? [];
      lista.push({ nombre: nombreProducto.get(d.id_variante) ?? "Producto", cantidad });
      itemsDe.set(d.id_venta, lista);
    }
    for (const v of validas) {
      const items = itemsDe.get(v.id_venta as string);
      if (!items?.length) continue; // devuelta entera
      const lista = comprasDe.get(v.id_cliente as string) ?? [];
      lista.push({ fecha: v.fecha as string, items });
      comprasDe.set(v.id_cliente as string, lista);
    }
  }

  const pacientes = ids
    .map((id) => {
      const v = (vinculos ?? []).find((x) => x.id_cliente === id)!;
      return {
        idCliente: id,
        nombre: nombreDe.get(id) ?? "Paciente",
        hasta: v.hasta as string,
        comparte: Boolean(v.comparte_compras),
        desde: (v.comparte_compras_at as string | null) ?? null,
        compras: comprasDe.get(id) ?? [],
      };
    })
    // Primero los que dieron permiso y compraron hace poco.
    .sort((a, b) => Number(b.comparte) - Number(a.comparte) || (b.compras[0]?.fecha ?? "").localeCompare(a.compras[0]?.fecha ?? "") || a.nombre.localeCompare(b.nombre, "es"));
  return { disponible: true, pacientes };
}
