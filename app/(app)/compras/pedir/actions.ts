"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { friendlyDbError } from "@/lib/errors";
import { PENDIENTE, CANCELADA } from "@/lib/estadosOrden";
import { ESTADO_GRANEL } from "@/lib/granel";
import { PARAMETRO_NO_TENIA, cargarNoTenia, MARCA_ARMADO_EN_LOCAL } from "@/lib/pedidoProveedor";
import { avisarPedidoArmado } from "@/lib/avisoPedidoProveedor";
import { recepcionarOrdenCompra } from "@/app/(app)/proveedores/actions";

// El pedido a Alifrut (lib/pedidoProveedor.ts). Devuelven { error } como dato
// y no throw: Next 16 esconde el mensaje en producción.

type Linea = { idVariante: string; cantidad: number };

/** Los chicos arman el pedido: queda como orden de compra sin enviar, esperando a Gonzalo. */
export async function armarPedidoProveedor(
  idProveedor: string,
  idLocal: string,
  lineas: Linea[]
): Promise<{ error: string | null; idOrden?: string }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !(puedeVerPantalla(sesion, "compras-pedir") || puedeVerPantalla(sesion, "compras"))) {
    return { error: "No tenés habilitado armar pedidos." };
  }
  const validas = lineas.filter((l) => Number.isInteger(l.cantidad) && l.cantidad > 0);
  if (validas.length === 0) return { error: "Tildá al menos un producto para pedir." };

  const supabase = getSupabaseServerClient();
  // Solo productos de ese proveedor: así nadie le pide a Alifrut lo de otro.
  const { data: vars } = await supabase
    .from("variantes_producto")
    .select("id_variante, productos!inner(id_proveedor_liquidacion)")
    .in("id_variante", validas.map((l) => l.idVariante));
  const delProveedor = new Set(
    (vars ?? [])
      .filter((v) => (v.productos as unknown as { id_proveedor_liquidacion: string | null }).id_proveedor_liquidacion === idProveedor)
      .map((v) => v.id_variante as string)
  );
  if (validas.some((l) => !delProveedor.has(l.idVariante))) return { error: "Hay un producto que no es de este proveedor. Recargá la pantalla." };

  const quien = sesion.nombre ?? "el equipo";
  const { data: orden, error } = await supabase
    .from("ordenes_compra_proveedor")
    .insert({
      id_proveedor: idProveedor,
      id_local: idLocal,
      estado: PENDIENTE,
      // Igual que crearOrdenCompra: la suma de las cantidades (el granel va en gramos).
      total_unidades: validas.reduce((a, l) => a + l.cantidad, 0),
      observaciones: `${MARCA_ARMADO_EN_LOCAL} por ${quien}`,
      usuario: quien,
    })
    .select("id_orden")
    .single();
  if (error || !orden) return { error: error ? friendlyDbError(error) : "No se pudo guardar el pedido." };

  const { error: e2 } = await supabase
    .from("detalle_orden_compra")
    .insert(validas.map((l) => ({ id_orden: orden.id_orden, id_variante: l.idVariante, cantidad_solicitada: l.cantidad, cantidad_recibida: 0 })));
  if (e2) {
    await supabase.from("ordenes_compra_proveedor").delete().eq("id_orden", orden.id_orden);
    return { error: friendlyDbError(e2) };
  }

  // Aviso a Gonzalo por mail, con el link para cargarlo. Si no sale, el
  // pedido igual le aparece en Mis Tareas.
  await avisarPedidoArmado(orden.id_orden as string, quien, validas.length).catch(() => undefined);

  revalidatePath("/compras");
  revalidatePath("/compras/pedir");
  revalidatePath("/");
  return { error: null, idOrden: orden.id_orden as string };
}

/**
 * Gonzalo ya lo cargó en la web de Alifrut: lo que no tenían sale del pedido
 * (y vuelve solo al próximo), las cantidades quedan como las pidió, y el
 * pedido pasa a «enviado»: aparece en Recepción esperando que llegue.
 */
export async function confirmarPedidoHecho(
  idOrden: string,
  lineas: { idDetalle: string; cantidad: number; noTienen: boolean }[]
): Promise<{ error: string | null; pedidos?: number; noTenian?: number }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "compras")) return { error: "Solo quien maneja Compras carga el pedido en Alifrut." };
  const supabase = getSupabaseServerClient();

  const { data: orden } = await supabase.from("ordenes_compra_proveedor").select("estado, enviada_el").eq("id_orden", idOrden).maybeSingle();
  if (!orden) return { error: "No encontré ese pedido." };
  if (orden.estado !== PENDIENTE || orden.enviada_el) return { error: "Este pedido ya se marcó como hecho." };

  const { data: detalle } = await supabase.from("detalle_orden_compra").select("id_detalle, id_variante, cantidad_solicitada").eq("id_orden", idOrden);
  const actuales = new Map((detalle ?? []).map((d) => [d.id_detalle as string, d]));
  const quedan: { idDetalle: string; idVariante: string; cantidad: number }[] = [];
  const noTenian: string[] = [];
  for (const l of lineas) {
    const d = actuales.get(l.idDetalle);
    if (!d) continue;
    if (l.noTienen || !Number.isInteger(l.cantidad) || l.cantidad <= 0) noTenian.push(d.id_variante as string);
    else quedan.push({ idDetalle: l.idDetalle, idVariante: d.id_variante as string, cantidad: l.cantidad });
  }

  const sacar = (detalle ?? []).filter((d) => !quedan.some((q) => q.idDetalle === d.id_detalle)).map((d) => d.id_detalle as string);
  if (sacar.length) {
    const { error } = await supabase.from("detalle_orden_compra").delete().in("id_detalle", sacar);
    if (error) return { error: friendlyDbError(error) };
  }
  for (const q of quedan) {
    const d = actuales.get(q.idDetalle);
    if (d && Number(d.cantidad_solicitada) !== q.cantidad) {
      const { error } = await supabase.from("detalle_orden_compra").update({ cantidad_solicitada: q.cantidad }).eq("id_detalle", q.idDetalle);
      if (error) return { error: friendlyDbError(error) };
    }
  }

  const quien = sesion.nombre ?? "administración";
  const ahora = new Date().toISOString();
  if (quedan.length === 0) {
    // No tenían nada: el pedido no existe para Alifrut.
    await supabase
      .from("ordenes_compra_proveedor")
      .update({ estado: CANCELADA, observaciones: `${MARCA_ARMADO_EN_LOCAL} · Alifrut no tenía nada (${quien})` })
      .eq("id_orden", idOrden)
      .eq("estado", PENDIENTE);
  } else {
    const { error } = await supabase
      .from("ordenes_compra_proveedor")
      .update({ total_unidades: quedan.reduce((a, q) => a + q.cantidad, 0), enviada_el: ahora, enviada_por: quien })
      .eq("id_orden", idOrden)
      .is("enviada_el", null);
    if (error) return { error: friendlyDbError(error) };
  }

  // Lo que no tenían queda anotado para que el equipo lo vea en el próximo
  // pedido; lo que se pidió sale de la lista.
  const anotados = await cargarNoTenia(supabase);
  for (const q of quedan) delete anotados[q.idVariante];
  for (const id of noTenian) anotados[id] = ahora;
  await supabase.from("configuracion").upsert(
    {
      parametro: PARAMETRO_NO_TENIA,
      valor: JSON.stringify(anotados),
      descripcion: "Pedido a Alifrut: lo que no tenían la última vez (id_variante → fecha)",
      fecha_actualizacion: ahora,
    },
    { onConflict: "parametro" }
  );

  revalidatePath("/compras");
  revalidatePath("/compras/recepcion");
  revalidatePath("/compras/pedir");
  revalidatePath("/");
  return { error: null, pedidos: quedan.length, noTenian: noTenian.length };
}

/**
 * La carga, una sola vez, del granel que ya estaba guardado en el depósito.
 *
 * Es de Alifrut y se le paga cuando se vende (Gonzalo, 2026-11-12), así que no
 * puede entrar como un ajuste suelto: entra como una entrega de Alifrut con el
 * costo del día, igual que lo que llega por Recepción. Así cada bolsita que se
 * fraccione de ahí sale con su costo y va a la liquidación de Alifrut.
 */
export async function cargarGranelDelDeposito(
  idLocal: string,
  cargas: { idVarianteGranel: string; gramos: number }[]
): Promise<{ error: string | null; cargados?: number }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !(puedeVerPantalla(sesion, "fraccionar") || puedeVerPantalla(sesion, "compras"))) {
    return { error: "No tenés habilitado Fraccionar." };
  }
  const validas = cargas.filter((c) => Number.isInteger(c.gramos) && c.gramos > 0 && c.gramos <= 500_000);
  if (validas.length === 0) return { error: "Anotá los kilos de al menos un granel." };

  const supabase = getSupabaseServerClient();
  const { data: vars } = await supabase
    .from("variantes_producto")
    .select("id_variante, productos!inner(estado, id_proveedor_liquidacion)")
    .in("id_variante", validas.map((c) => c.idVarianteGranel));
  const proveedorDe = new Map<string, string>();
  for (const v of vars ?? []) {
    const p = v.productos as unknown as { estado: string; id_proveedor_liquidacion: string | null };
    if (p.estado === ESTADO_GRANEL && p.id_proveedor_liquidacion) proveedorDe.set(v.id_variante as string, p.id_proveedor_liquidacion);
  }
  if (validas.some((c) => !proveedorDe.has(c.idVarianteGranel))) return { error: "Hay un granel sin proveedor. Recargá la pantalla." };

  // Solo lo que todavía figura vacío: después de esta carga, el granel entra por Recepción.
  const { data: stock } = await supabase.from("stock").select("id_variante, cantidad").eq("id_local", idLocal).in("id_variante", validas.map((c) => c.idVarianteGranel));
  const yaTiene = (stock ?? []).filter((s) => Number(s.cantidad ?? 0) > 0).map((s) => s.id_variante as string);
  if (yaTiene.length) return { error: "Alguno ya tiene granel cargado. Recargá la pantalla: solo se cargan los que están en 0." };

  const quien = sesion.nombre ?? "el equipo";
  const fecha = new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  let cargados = 0;
  for (const idProveedor of new Set(proveedorDe.values())) {
    const suyas = validas.filter((c) => proveedorDe.get(c.idVarianteGranel) === idProveedor);
    const { data: orden, error } = await supabase
      .from("ordenes_compra_proveedor")
      .insert({
        id_proveedor: idProveedor,
        id_local: idLocal,
        estado: PENDIENTE,
        total_unidades: suyas.reduce((a, c) => a + c.gramos, 0),
        observaciones: `Granel que ya estaba en el depósito (carga inicial del ${fecha}, por ${quien})`,
        usuario: quien,
        enviada_el: new Date().toISOString(),
        enviada_por: quien,
      })
      .select("id_orden")
      .single();
    if (error || !orden) return { error: error ? friendlyDbError(error) : "No se pudo guardar." };
    const { data: lineas, error: e2 } = await supabase
      .from("detalle_orden_compra")
      .insert(suyas.map((c) => ({ id_orden: orden.id_orden, id_variante: c.idVarianteGranel, cantidad_solicitada: c.gramos, cantidad_recibida: 0 })))
      .select("id_detalle, id_variante, cantidad_solicitada");
    if (e2 || !lineas) {
      await supabase.from("ordenes_compra_proveedor").delete().eq("id_orden", orden.id_orden);
      return { error: e2 ? friendlyDbError(e2) : "No se pudo guardar." };
    }
    // La recepción de siempre: lote con el costo del día, stock en gramos y movimiento.
    const r = await recepcionarOrdenCompra(
      orden.id_orden as string,
      lineas.map((l) => ({
        idDetalle: l.id_detalle as string,
        idVariante: l.id_variante as string,
        cantidadSolicitada: Number(l.cantidad_solicitada),
        cantidadRecibida: Number(l.cantidad_solicitada),
      })),
      "Carga inicial del granel que ya estaba en el depósito"
    );
    if (r.error) return { error: r.error };
    cargados += suyas.length;
  }

  revalidatePath("/fraccionar");
  revalidatePath("/compras/pedir");
  revalidatePath("/stock");
  return { error: null, cargados };
}
