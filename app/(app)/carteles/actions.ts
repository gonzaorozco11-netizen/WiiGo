"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { aplicarPreciosDeCarteles, contarCartelesUrgentes } from "@/lib/tareasEtiqueta";
import { ponerPreciosAlDia } from "@/lib/preciosAlDia";

/**
 * Lo consulta el aviso rojo de arriba cada dos minutos: primero pone al día
 * los precios que ya llegaron a su hora (13:00, 21:00) y después cuenta los
 * carteles que quedaron con el precio viejo. Así el aviso sale a la hora
 * aunque nadie recargue la pantalla.
 */
export async function cartelesUrgentesAhora(): Promise<number> {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "carteles")) return 0;
  await ponerPreciosAlDia();
  return contarCartelesUrgentes(getSupabaseServerClient());
}

/**
 * Da por cambiados los carteles que se acaban de imprimir.
 *
 * Imprimir no es cambiar: entre que sale la hoja y alguien recorta y mete cada
 * cartel en su porta precios pasa un rato, y en el medio el precio de la caja
 * ya es el nuevo. Por eso se marca después, cuando la operativa confirma que
 * los puso — y no solo, al apretar Imprimir.
 */
export async function marcarCartelesPuestos(idsTarea: string[]) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "carteles")) return { error: "No tenés permiso para esta pantalla." };
  if (idsTarea.length === 0) return { ok: true as const, cuantas: 0 };

  const supabase = getSupabaseServerClient();
  const { error, count } = await supabase
    .from("tareas_etiqueta")
    .update(
      { estado: "HECHA", hecha_el: new Date().toISOString() },
      { count: "exact" }
    )
    .in("id_tarea", idsTarea)
    .in("estado", ["PENDIENTE", "VENCIDA"])
    // Los precios de marca que todavía no entraron quedan abiertos: el cartel
    // nuevo se pone recién a su hora.
    .or(`aplicar_al_poner.eq.true,vence_el.lte.${new Date().toISOString()}`);

  if (error) return { error: friendlyDbError(error) };

  // Los precios de la marca propia que esperaban el cartel entran ahora en la
  // caja, el tótem y el asesor (lib/tareasEtiqueta.ts).
  const aplicados = await aplicarPreciosDeCarteles(supabase, idsTarea, sesion?.idUsuario ?? null);

  revalidatePath("/carteles");
  revalidatePath("/aprobaciones");
  if (aplicados > 0) {
    revalidatePath("/precios");
    revalidatePath("/productos");
  }
  return { ok: true as const, cuantas: count ?? idsTarea.length, aplicados };
}
