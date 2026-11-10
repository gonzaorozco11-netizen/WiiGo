"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { consumirFifo, simularConsumoFifo } from "@/lib/fifoProveedor";
import { ESTADO_GRANEL } from "@/lib/granel";
import { textoGramos } from "@/lib/gramos";
import { localDeSesion } from "@/lib/fraccionado";

// Registrar lo que se embolsó (lib/granel.ts, sql/granel-fraccionado.sql).
// Devuelven { error } como dato: Next 16 esconde el mensaje de un throw.

type Supa = ReturnType<typeof getSupabaseServerClient>;

async function cantidadEnStock(supabase: Supa, idVariante: string, idLocal: string) {
  const { data } = await supabase.from("stock").select("cantidad").eq("id_variante", idVariante).eq("id_local", idLocal).maybeSingle();
  return Number(data?.cantidad ?? 0);
}

async function sumarStock(supabase: Supa, idVariante: string, idLocal: string, delta: number) {
  const actual = await cantidadEnStock(supabase, idVariante, idLocal);
  return supabase
    .from("stock")
    .upsert({ id_variante: idVariante, id_local: idLocal, cantidad: actual + delta, fecha_actualizacion: new Date().toISOString() }, { onConflict: "id_variante,id_local" });
}

/** El granel y su proveedor, si la variante es de un producto de granel. */
async function granelDe(supabase: Supa, idVarianteGranel: string) {
  const { data } = await supabase
    .from("variantes_producto")
    .select("id_variante, productos!inner(id_producto, nombre, estado, id_granel, id_proveedor_liquidacion, costo_informado)")
    .eq("id_variante", idVarianteGranel)
    .maybeSingle();
  const p = data?.productos as unknown as {
    nombre: string;
    estado: string;
    id_granel: string | null;
    id_proveedor_liquidacion: string | null;
    costo_informado: number | null;
  } | null;
  if (!p || p.estado !== ESTADO_GRANEL || !p.id_granel) return null;
  return p;
}

/**
 * «Armé N bolsitas de este producto»: los gramos salen del granel, del lote más
 * viejo de Alifrut al más nuevo, y las bolsitas entran a la góndola con un lote
 * propio que cuesta exactamente esos gramos. Cuando se vendan, se le liquidan a
 * Alifrut a ese costo (el del día en que mandó la mercadería).
 */
export async function registrarFraccionado(
  idVarianteGranel: string,
  idVarianteBolsa: string,
  bolsitas: number
): Promise<{ error?: string; ok?: true; gramos?: number }> {
  const n = Math.round(Number(bolsitas));
  if (!Number.isFinite(n) || n <= 0 || n > 999) return { error: "Poné cuántas bolsitas armaste." };
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "fraccionar")) return { error: "No tenés habilitado Fraccionar." };
  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) return { error: "No sé en qué local estás: tu usuario no tiene un local asignado." };

  const granel = await granelDe(supabase, idVarianteGranel);
  if (!granel) return { error: "Ese granel no existe." };
  const { data: bolsa } = await supabase
    .from("variantes_producto")
    .select("id_variante, productos!inner(nombre, id_granel, peso_neto_g, estado)")
    .eq("id_variante", idVarianteBolsa)
    .maybeSingle();
  const pb = bolsa?.productos as unknown as { nombre: string; id_granel: string | null; peso_neto_g: number | null; estado: string } | null;
  if (!pb || pb.id_granel !== granel.id_granel || pb.estado !== "ACTIVO") return { error: "Esa bolsita no sale de este granel." };
  const peso = Number(pb.peso_neto_g ?? 0);
  if (!(peso > 0)) return { error: `«${pb.nombre}» no tiene el peso neto cargado. Cargalo en Productos (por ejemplo, 250 g).` };

  const gramos = n * peso;
  const hay = await cantidadEnStock(supabase, idVarianteGranel, idLocal);
  if (gramos > hay) {
    return { error: `Para ${n} bolsitas de ${textoGramos(peso)} hacen falta ${textoGramos(gramos)} y en el depósito figuran ${textoGramos(hay)}. Si llegó más, cargalo en Compras → Recepción.` };
  }

  // Los gramos salen de los lotes de Alifrut, del más viejo al más nuevo.
  const consumo = granel.id_proveedor_liquidacion
    ? await consumirFifo(supabase, granel.id_proveedor_liquidacion, idVarianteGranel, gramos, Number(granel.costo_informado ?? 0) || null)
    : { consumos: [], costoTotal: gramos * Number(granel.costo_informado ?? 0), estimado: true };

  const quien = sesion.nombre ?? null;
  const { data: fila, error: e1 } = await supabase
    .from("fraccionados")
    .insert({ id_local: idLocal, id_variante_granel: idVarianteGranel, id_variante_bolsa: idVarianteBolsa, tipo: "FRACCIONADO", bolsitas: n, gramos, costo_total: Math.round(consumo.costoTotal * 100) / 100, usuario: quien })
    .select("id_fraccionado")
    .single();
  if (e1 || !fila) return { error: e1 ? friendlyDbError(e1) : "No se pudo guardar." };

  // El lote de las bolsitas cuelga de la recepción del último lote de granel
  // que se usó, así el FIFO de la bolsita sigue el orden de llegada.
  const ultimoLote = [...consumo.consumos].reverse().find((c) => c.idDetalleRecepcion !== "ESTIMADO");
  if (ultimoLote) {
    const { data: lote } = await supabase.from("detalle_recepcion_proveedor").select("id_recepcion").eq("id_detalle", ultimoLote.idDetalleRecepcion).maybeSingle();
    if (lote?.id_recepcion) {
      await supabase.from("detalle_recepcion_proveedor").insert({
        id_recepcion: lote.id_recepcion,
        id_variante: idVarianteBolsa,
        cantidad_solicitada: 0,
        cantidad_recibida: 0,
        estado_control: "COMPLETA",
        diferencia: 0,
        cantidad_disponible_fifo: n,
        costo_unitario: Math.round((consumo.costoTotal / n) * 100) / 100,
        id_fraccionado: fila.id_fraccionado,
      });
    }
  }

  const r1 = await sumarStock(supabase, idVarianteGranel, idLocal, -gramos);
  if (r1.error) return { error: friendlyDbError(r1.error) };
  const r2 = await sumarStock(supabase, idVarianteBolsa, idLocal, n);
  if (r2.error) return { error: friendlyDbError(r2.error) };
  await supabase.from("movimientos_stock").insert([
    { id_variante: idVarianteGranel, id_local: idLocal, tipo: "FRACCIONADO", cantidad: -gramos, motivo: `Embolsado en ${n} × ${pb.nombre}`, id_referencia: fila.id_fraccionado, usuario: quien },
    { id_variante: idVarianteBolsa, id_local: idLocal, tipo: "FRACCIONADO", cantidad: n, motivo: `Fraccionado de ${granel.nombre}`, id_referencia: fila.id_fraccionado, usuario: quien },
  ]);

  revalidatePath("/fraccionar");
  revalidatePath("/codigos");
  revalidatePath("/stock");
  return { ok: true, gramos };
}

/**
 * «Se terminó el granel»: lo que el sistema creía que quedaba y no está es
 * merma de fraccionado. Se registra como merma (se le paga a Alifrut: el
 * acuerdo es que lo que se pierde al fraccionar es de WiiGo) y el stock del
 * granel queda en lo que de verdad quedó.
 */
export async function cerrarGranel(idVarianteGranel: string, gramosQueQuedan: number): Promise<{ error?: string; ok?: true; merma?: number }> {
  const quedan = Math.max(0, Math.round(Number(gramosQueQuedan) || 0));
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "fraccionar")) return { error: "No tenés habilitado Fraccionar." };
  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) return { error: "No sé en qué local estás: tu usuario no tiene un local asignado." };
  const granel = await granelDe(supabase, idVarianteGranel);
  if (!granel) return { error: "Ese granel no existe." };

  const hay = await cantidadEnStock(supabase, idVarianteGranel, idLocal);
  const merma = hay - quedan;
  const quien = sesion.nombre ?? null;
  const ahora = new Date().toISOString();

  if (merma > 0) {
    const sim = granel.id_proveedor_liquidacion
      ? await simularConsumoFifo(supabase, granel.id_proveedor_liquidacion, idVarianteGranel, merma, Number(granel.costo_informado ?? 0) || null)
      : { costoTotal: merma * Number(granel.costo_informado ?? 0) };
    const { error: e1 } = await supabase.from("mermas").insert({
      id_variante: idVarianteGranel,
      id_local: idLocal,
      cantidad: merma,
      motivo: "OTRO",
      detalle: "Merma de fraccionado (gramos)",
      costo_unitario: merma > 0 ? sim.costoTotal / merma : 0,
      fecha: ahora,
      usuario: quien,
    });
    if (e1) return { error: friendlyDbError(e1) };
    await supabase.from("movimientos_stock").insert({ id_variante: idVarianteGranel, id_local: idLocal, tipo: "MERMA", cantidad: -merma, motivo: "Merma de fraccionado", usuario: quien });
  } else if (merma < 0) {
    // Quedó más de lo que figuraba: se corrige, sin merma.
    await supabase.from("movimientos_stock").insert({ id_variante: idVarianteGranel, id_local: idLocal, tipo: "AJUSTE", cantidad: -merma, motivo: "Cierre de granel: quedaba más de lo que figuraba", usuario: quien });
  }
  const r = await sumarStock(supabase, idVarianteGranel, idLocal, -merma);
  if (r.error) return { error: friendlyDbError(r.error) };
  await supabase.from("fraccionados").insert({ id_local: idLocal, id_variante_granel: idVarianteGranel, tipo: "CIERRE", merma_gramos: Math.max(0, merma), gramos: 0, usuario: quien });

  revalidatePath("/fraccionar");
  revalidatePath("/stock");
  return { ok: true, merma: Math.max(0, merma) };
}
