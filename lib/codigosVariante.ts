import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * El SKU y el código de barras que lleva toda variante nueva.
 *
 * Vive acá y no adentro de una pantalla porque hay dos caminos por los que
 * entra un producto: el formulario de Productos y la aprobación de un alta que
 * mandó una marca desde su portal. Si cada uno numerara por su cuenta, dos
 * productos podrían terminar con el mismo SKU o el mismo código — y dos
 * códigos iguales en el tótem significan que el cliente escanea uno y se le
 * carga el otro.
 */

// Prefijo de 3 letras a partir del nombre de la marca (sin tildes ni
// símbolos), para armar un SKU legible: ANI-0001, WII-0017...
function prefijoDesdeNombre(nombre: string) {
  const soloLetras = nombre
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  return soloLetras.slice(0, 3) || "PRD";
}

export async function generarSkuVariante(supabase: SupabaseClient, idMarca: string) {
  const { data: marca } = await supabase
    .from("marcas")
    .select("nombre")
    .eq("id_marca", idMarca)
    .maybeSingle();
  const prefijo = prefijoDesdeNombre(marca?.nombre ?? "PRD");

  const { data: productosDeLaMarca } = await supabase
    .from("productos")
    .select("id_producto")
    .eq("id_marca", idMarca);
  const idsProductos = (productosDeLaMarca ?? []).map((p: { id_producto: string }) => p.id_producto);

  let mayor = 0;
  if (idsProductos.length > 0) {
    const { data: existentes } = await supabase
      .from("variantes_producto")
      .select("sku")
      .in("id_producto", idsProductos)
      .like("sku", `${prefijo}-%`);
    (existentes ?? []).forEach((row: { sku: string | null }) => {
      const m = row.sku?.match(new RegExp(`^${prefijo}-(\\d+)$`));
      if (m) mayor = Math.max(mayor, parseInt(m[1], 10));
    });
  }

  return `${prefijo}-${String(mayor + 1).padStart(4, "0")}`;
}

// Código interno de 11 dígitos empezando en "20...", el rango que el estándar
// EAN reserva para uso interno/en tienda. No es un código registrado
// globalmente, pero se escanea igual en el tótem y nunca choca con el código
// real de un producto del mundo.
export async function generarCodigoBarrasVariante(supabase: SupabaseClient) {
  const { data: existentes } = await supabase.from("variantes_producto").select("codigo_barras");
  return String(mayorCodigoInterno(existentes ?? []) + 1);
}

/**
 * El mayor código del rango interno (11 dígitos que empiezan con "20").
 * Solo ese rango: si se mirara el mayor de todos, un código real de fábrica
 * (Animalfit tiene EAN como 0617395130757) arrastraría la numeración y el
 * próximo producto saldría con un número pegado al de una marca real
 * (pasó el 2026-11-04 con las viandas de Alta).
 */
export function mayorCodigoInterno(filas: { codigo_barras: string | null }[]) {
  const BASE = 20000000000;
  let mayor = BASE;
  for (const row of filas) {
    const c = (row.codigo_barras ?? "").trim();
    if (!/^20\d{9}$/.test(c)) continue;
    const n = Number(c);
    if (n > mayor) mayor = n;
  }
  return mayor;
}
