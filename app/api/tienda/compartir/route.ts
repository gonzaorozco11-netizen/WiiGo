import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

/**
 * Link de un producto para compartir (Gonzalo, 16/11: «que lo pueda reenviar por WhatsApp a un amigo»).
 *
 * wiigo.com.ar/?p=<id_producto> es la misma tienda (public/tienda), que abre la ficha de ese
 * producto. El proxy manda acá solo ese caso: se devuelve el mismo index.html con la vista previa
 * del producto para WhatsApp y las redes (título, precio y foto en las etiquetas og:). El navegador
 * del amigo ve la tienda igual que siempre.
 *
 * Solo datos públicos (nombre, precio de lista, foto) de un producto activo con precio.
 */
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const pesos = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("p") ?? "";
  const base = await fetch(new URL("/tienda/index.html", req.nextUrl.origin), { cache: "no-store" });
  let html = await base.text();
  if (!base.ok) return NextResponse.redirect(new URL("/", req.url));

  if (/^[0-9a-f-]{36}$/i.test(id)) {
    try {
      const supabase = getSupabaseServerClient();
      const { data: p } = await supabase.from("productos").select("nombre, imagen, precio_venta, estado").eq("id_producto", id).maybeSingle();
      if (p && p.estado === "ACTIVO" && Number(p.precio_venta) > 0) {
        const titulo = `${p.nombre} · WiiGo`;
        const desc = `${pesos(Number(p.precio_venta))} · Pedilo online en WiiGo y retiralo listo en 15 minutos en Arístides Villanueva 256, Mendoza.`;
        const url = new URL(`/?p=${id}`, req.nextUrl.origin).toString();
        const meta =
          `<meta property="og:type" content="product">` +
          `<meta property="og:site_name" content="WiiGo · Estaciones de Bienestar">` +
          `<meta property="og:title" content="${esc(titulo)}">` +
          `<meta property="og:description" content="${esc(desc)}">` +
          `<meta property="og:url" content="${esc(url)}">` +
          (p.imagen ? `<meta property="og:image" content="${esc(String(p.imagen))}"><meta name="twitter:card" content="summary_large_image">` : "");
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(titulo)}</title>${meta}`);
      }
    } catch {
      // Sin vista previa: igual se ve la tienda.
    }
  }
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=600" } });
}
