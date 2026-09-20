import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

/**
 * Devuelve una "huella" de lo que hoy muestra el Asesor.
 *
 * El tótem la pide cada pocos segundos: si la huella cambió, recarga los datos.
 * La gracia es que esto son tres consultas de contar —no trae ni un producto—,
 * así que preguntarlo seguido sale prácticamente gratis. Recargar la pantalla
 * entera cada 3 segundos, en cambio, serían catorce mil pedidos por día con
 * trece consultas cada uno.
 *
 * `despliegue` cambia cuando subimos una versión nueva de la app: así el tótem
 * también se entera de un deploy sin que nadie vaya a apretar F5.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseServerClient();

  const [ultimo, productos, marcas, subcategorias, profesionales] = await Promise.all([
    supabase
      .from("productos")
      .select("fecha_actualizacion")
      .order("fecha_actualizacion", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("productos").select("id_producto", { count: "exact", head: true }).eq("estado", "ACTIVO"),
    // De marcas se traen los campos, no un conteo: la tabla no tiene fecha de
    // modificación, así que cambiar un logo o renombrar una marca no movería
    // ningún número. Son tres o cuatro filas de texto corto.
    supabase.from("marcas").select("nombre,logo,estado,visible_asesor").order("nombre"),
    supabase.from("subcategorias").select("nombre,estado").order("nombre"),
    supabase.from("profesionales").select("id_profesional", { count: "exact", head: true }).eq("publicado", true),
  ]);

  const huella = [
    ultimo.data?.fecha_actualizacion ?? "0",
    productos.count ?? 0,
    (marcas.data ?? []).map((m) => `${m.nombre}${m.logo ?? ""}${m.estado}${m.visible_asesor}`).join(","),
    (subcategorias.data ?? []).map((s) => `${s.nombre}${s.estado}`).join(","),
    profesionales.count ?? 0,
  ].join("|");

  return NextResponse.json(
    {
      huella,
      despliegue: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
