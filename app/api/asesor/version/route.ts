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

  const [ultimo, productos, marcas] = await Promise.all([
    supabase
      .from("productos")
      .select("fecha_actualizacion")
      .order("fecha_actualizacion", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("productos").select("id_producto", { count: "exact", head: true }).eq("estado", "ACTIVO"),
    supabase.from("marcas").select("id_marca", { count: "exact", head: true }).eq("estado", "ACTIVA"),
  ]);

  const huella = [
    ultimo.data?.fecha_actualizacion ?? "0",
    productos.count ?? 0,
    marcas.count ?? 0,
  ].join("|");

  return NextResponse.json(
    {
      huella,
      despliegue: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
