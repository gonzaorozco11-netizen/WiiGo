import { getSupabaseServerClient } from "@/lib/supabase";
import { armarCatalogoTienda } from "@/lib/tiendaCatalogo";

/**
 * El catálogo de la tienda online, como un script: `window.WIIGO = {...}`.
 * public/tienda/index.html lo carga antes que app.js (el formato es el del
 * prototipo aprobado, que lo leía de un archivo).
 *
 * Es público (está bajo /api, que no pide login) y solo lleva lo que el cliente
 * ve en el local: ver lib/tiendaCatalogo.ts.
 *
 * Vercel lo guarda 1 minuto: con mucha gente mirando, la base recibe un pedido
 * por minuto y no uno por visita. Un precio, un stock o un producto dado de baja
 * tarda eso en verse (como mucho 2 minutos).
 *
 * Antes eran 2 minutos más 10 de «stale-while-revalidate»: con poca gente
 * entrando, el primero que llegaba veía el catálogo de hace 12 minutos — un
 * producto inactivado seguía apareciendo (Gonzalo, 18/11). Pedirlo igual no se
 * podía: /api/tienda/pedido rechaza lo que no está ACTIVO.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const datos = await armarCatalogoTienda(getSupabaseServerClient());
    // `<` escapado: un nombre de producto nunca puede cerrar el script.
    const js = `window.WIIGO=${JSON.stringify(datos).replace(/</g, "\\u003c")};`;
    return new Response(js, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    console.error("[tienda/catalogo]", e);
    // Sin window.WIIGO, la tienda muestra «No pudimos cargar los productos».
    return new Response("/* catálogo no disponible */", {
      status: 503,
      headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
