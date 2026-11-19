"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { personaDeUsuario } from "@/lib/conteoStock";
import { enBolsasOnline } from "@/lib/pedidosOnline";
import { sinEtiquetarPorVariante } from "@/lib/fraccionado";

// Las acciones del conteo de stock en el turno (lib/conteoStock.ts). Devuelven
// { error } como dato y no throw: Next 16 esconde el mensaje en producción.

const firmaValida = (firma: unknown): firma is string =>
  typeof firma === "string" && firma.length < 200_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(firma);

/** El ítem, si es de un conteo abierto de quien está usando la pantalla. */
async function itemPropio(idItem: string) {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "conteo")) return { error: "No tenés habilitado el conteo de stock." } as const;
  const supabase = getSupabaseServerClient();
  const persona = await personaDeUsuario(supabase, sesion.idUsuario);
  if (!persona) return { error: "Tu usuario no está vinculado a una persona del equipo." } as const;
  const { data: item } = await supabase
    .from("conteos_stock_items")
    .select("id_item, id_variante, primer_conteo, contado_en, conteos_stock!inner(id_conteo, id_local, id_persona, estado, nombre)")
    .eq("id_item", idItem)
    .maybeSingle();
  const conteo = item?.conteos_stock as unknown as { id_conteo: string; id_local: string; id_persona: string; estado: string; nombre: string | null } | undefined;
  if (!item || !conteo || conteo.id_persona !== persona.id_persona) return { error: "Ese producto no está en tu conteo." } as const;
  if (conteo.estado !== "ABIERTO") return { error: "Ese conteo ya está firmado." } as const;
  return { supabase, item, conteo } as const;
}

export type ResultadoConteo = { error?: string; resultado?: "OK" | "RECONTAR" | "CONFIRMAR" | "DIFERENCIA" };

/**
 * Guarda lo que contó de un producto, con la hora exacta.
 *
 * Se compara contra lo que dice el sistema EN ESE MOMENTO: si se vendió uno
 * antes de contarlo, el sistema ya lo descontó; si se vende después, lo
 * descuenta del número contado. Por eso nunca sale una diferencia falsa por
 * una venta en el medio.
 *
 *   coincide            → OK
 *   no coincide, 1.ª vez → RECONTAR (no se le dice cuánto esperaba)
 *   no coincide, 2.ª vez → CONFIRMAR: no se guarda nada; la tablet pregunta
 *                          «¿Estás seguro de que hay N unidades?» (Gonzalo, 18/11)
 *   confirmado            → DIFERENCIA: el stock queda en lo contado y la
 *                          diferencia le llega a Gonzalo
 */
export async function registrarConteo(idItem: string, cantidad: number, confirmado = false): Promise<ResultadoConteo> {
  const n = Math.round(Number(cantidad));
  if (!Number.isFinite(n) || n < 0 || n > 9999) return { error: "Poné cuántas unidades hay (0 si no hay ninguna)." };
  const r = await itemPropio(idItem);
  if ("error" in r) return { error: r.error };
  const { supabase, item, conteo } = r;
  if (item.contado_en) return { error: "Ese producto ya está contado." };

  const idVariante = item.id_variante as string;
  const [{ data: st }, bolsas, sinEtiq] = await Promise.all([
    supabase.from("stock").select("cantidad").eq("id_variante", idVariante).eq("id_local", conteo.id_local).maybeSingle(),
    enBolsasOnline(supabase, conteo.id_local, [idVariante]),
    sinEtiquetarPorVariante(supabase, conteo.id_local, [idVariante]),
  ]);
  // Bolsitas embolsadas que esperan la etiqueta: están en el local pero todavía
  // no en el stock (se suman al terminar la tanda). La pantalla pide no
  // contarlas; si igual las contó, el número es el mismo que esperaba (19/11).
  const sinEtiquetar = sinEtiq.get(idVariante) ?? 0;
  const enStock = Number(st?.cantidad ?? 0);
  // Lo que ya está en la bolsa de un pedido online sigue en el stock hasta la
  // entrega, pero no en la góndola: se compara contra lo que tiene que haber
  // en la góndola, y si se ajusta, el stock queda en lo contado + lo embolsado.
  const embolsado = Math.min(bolsas.get(idVariante)?.n ?? 0, Math.max(enStock, 0));
  const esperado = enStock - embolsado;
  const ahora = new Date().toISOString();
  const quien = conteo.nombre ?? "Equipo";

  const { data: abiertas } = await supabase
    .from("diferencias_stock")
    .select("id_diferencia")
    .eq("id_local", conteo.id_local)
    .eq("id_variante", idVariante)
    .eq("estado", "ABIERTA");

  // Primer conteo de algo que nunca tuvo stock cargado (hoy casi todo lo de
  // WiiGo está en 0): es la carga inicial, no una diferencia. Si no, el primer
  // mes le llenaría a Gonzalo la pantalla de diferencias que no son tales.
  if (esperado === 0 && n > 0) {
    const [{ count: antes }, { count: movs }] = await Promise.all([
      supabase
        .from("conteos_stock_items")
        .select("id_item, conteos_stock!inner(id_local)", { count: "exact", head: true })
        .eq("conteos_stock.id_local", conteo.id_local)
        .eq("id_variante", idVariante)
        .not("contado_en", "is", null),
      supabase.from("movimientos_stock").select("id_movimiento", { count: "exact", head: true }).eq("id_local", conteo.id_local).eq("id_variante", idVariante),
    ]);
    if ((antes ?? 0) === 0 && (movs ?? 0) === 0) {
      const { error } = await supabase
        .from("conteos_stock_items")
        .update({ contado: n, esperado, contado_en: ahora, resultado: "OK" })
        .eq("id_item", idItem);
      if (error) return { error: friendlyDbError(error) };
      await supabase
        .from("stock")
        .upsert({ id_variante: idVariante, id_local: conteo.id_local, cantidad: n + embolsado, fecha_actualizacion: ahora }, { onConflict: "id_variante,id_local" });
      await supabase.from("movimientos_stock").insert({
        id_variante: idVariante,
        id_local: conteo.id_local,
        tipo: "AJUSTE",
        cantidad: n,
        motivo: `Primer conteo (el stock estaba sin cargar): ${quien} contó ${n}`,
        usuario: quien,
      });
      revalidatePath("/conteo");
      revalidatePath("/stock");
      return { resultado: "OK" };
    }
  }

  if (n === esperado || (sinEtiquetar > 0 && n === esperado + sinEtiquetar)) {
    const { error } = await supabase
      .from("conteos_stock_items")
      .update({ contado: n === esperado ? n : esperado, esperado, contado_en: ahora, resultado: "OK" })
      .eq("id_item", idItem);
    if (error) return { error: friendlyDbError(error) };
    // Otra persona contó lo mismo que quedó después de la diferencia: se confirmó.
    if ((abiertas ?? []).length > 0) {
      await supabase
        .from("diferencias_stock")
        .update({ estado: "CONFIRMADA", recuento: n, recontado_por: quien, recontado_en: ahora })
        .in("id_diferencia", (abiertas ?? []).map((a) => a.id_diferencia as string));
    }
    revalidatePath("/conteo");
    return { resultado: "OK" };
  }

  if (item.primer_conteo == null) {
    const { error } = await supabase.from("conteos_stock_items").update({ primer_conteo: n }).eq("id_item", idItem);
    if (error) return { error: friendlyDbError(error) };
    return { resultado: "RECONTAR" };
  }

  // Segunda vez distinto: antes de tocar el stock, que confirme su número (sin decirle el del sistema).
  if (!confirmado) return { resultado: "CONFIRMAR" };

  // Confirmado: el stock queda en lo que contó, ya.
  const { error: e1 } = await supabase
    .from("conteos_stock_items")
    .update({ contado: n, esperado, contado_en: ahora, resultado: "DIFERENCIA" })
    .eq("id_item", idItem);
  if (e1) return { error: friendlyDbError(e1) };

  const { error: e2 } = await supabase
    .from("stock")
    .upsert({ id_variante: idVariante, id_local: conteo.id_local, cantidad: n + embolsado, fecha_actualizacion: ahora }, { onConflict: "id_variante,id_local" });
  if (e2) return { error: friendlyDbError(e2) };
  await supabase.from("movimientos_stock").insert({
    id_variante: idVariante,
    id_local: conteo.id_local,
    tipo: "AJUSTE",
    cantidad: n - esperado,
    motivo: `Conteo del turno: ${quien} contó ${n}, el sistema decía ${esperado}${embolsado ? ` (más ${embolsado} en pedidos online armados)` : ""}`,
    usuario: quien,
  });

  // Si ya había una abierta, este conteo no la confirmó: se anota el recuento
  // y la nueva queda al lado para que Gonzalo vea las dos.
  if ((abiertas ?? []).length > 0) {
    await supabase
      .from("diferencias_stock")
      .update({ recuento: n, recontado_por: quien, recontado_en: ahora })
      .in("id_diferencia", (abiertas ?? []).map((a) => a.id_diferencia as string));
  }
  const { error: e3 } = await supabase.from("diferencias_stock").insert({
    id_local: conteo.id_local,
    id_variante: idVariante,
    id_item: idItem,
    esperado,
    contado: n,
    diferencia: n - esperado,
    contado_por: quien,
    contado_en: ahora,
  });
  if (e3) return { error: friendlyDbError(e3) };

  revalidatePath("/conteo");
  revalidatePath("/stock");
  return { resultado: "DIFERENCIA" };
}

/** Firma la tanda: confirma que contó esos productos y que había lo anotado. */
export async function firmarConteo(idConteo: string, firma: string | null): Promise<{ error?: string; ok?: true }> {
  if (!firmaValida(firma)) return { error: "Firmá con el dedo en el recuadro." };
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "conteo")) return { error: "No tenés habilitado el conteo de stock." };
  const supabase = getSupabaseServerClient();
  const persona = await personaDeUsuario(supabase, sesion.idUsuario);
  const { data: conteo } = await supabase.from("conteos_stock").select("id_persona, estado").eq("id_conteo", idConteo).maybeSingle();
  if (!conteo || !persona || conteo.id_persona !== persona.id_persona) return { error: "Ese conteo no es tuyo." };
  if (conteo.estado !== "ABIERTO") return { error: "Ya estaba firmado." };

  const [{ count }, { count: productos }] = await Promise.all([
    supabase.from("conteos_stock_items").select("id_item", { count: "exact", head: true }).eq("id_conteo", idConteo).is("contado_en", null),
    supabase.from("conteos_stock_items").select("id_item", { count: "exact", head: true }).eq("id_conteo", idConteo),
  ]);
  if ((count ?? 0) > 0) return { error: `Te faltan ${count} ${count === 1 ? "producto" : "productos"} por contar.` };
  // Una tanda sin productos no se firma: todavía se está armando.
  if ((productos ?? 0) === 0) return { error: "Tu conteo todavía no tiene productos. Tocá «Ver mis productos»." };

  const { error } = await supabase
    .from("conteos_stock")
    .update({ estado: "FIRMADO", firma, firmado_en: new Date().toISOString() })
    .eq("id_conteo", idConteo);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/conteo");
  revalidatePath("/");
  return { ok: true };
}
