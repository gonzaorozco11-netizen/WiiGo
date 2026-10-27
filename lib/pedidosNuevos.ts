import { getSupabaseServerClient } from "@/lib/supabase";

// Cuántos pedidos de profesionales hay sin armar. Para el número rojo del menú.
//
// Sin control de sesión adentro a propósito: lo llama el layout del sistema
// interno, que ya sabe quién está y si puede ver Pedidos, y así no se repite
// la consulta del usuario en cada pantalla. No es una server action: no se
// puede llamar desde el navegador.
export async function contarPedidosNuevosSinSesion(): Promise<number> {
  const supabase = getSupabaseServerClient();
  const { count, error } = await supabase.from("pedidos_profesional").select("id_pedido", { count: "exact", head: true }).eq("estado", "NUEVO");
  return error ? 0 : count ?? 0;
}
