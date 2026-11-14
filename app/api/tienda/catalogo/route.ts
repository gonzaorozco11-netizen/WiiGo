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
 * Vercel lo guarda 2 minutos: con mucha gente mirando, la base recibe un pedido
 * cada 2 minutos y no uno por visita. Un precio o un stock nuevo tarda eso en verse.
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
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
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
