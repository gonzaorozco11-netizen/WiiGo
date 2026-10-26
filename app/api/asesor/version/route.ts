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

// Resume un texto largo en un número corto: la huella viaja cada pocos
// segundos y no hace falta que lleve las fichas enteras.
function resumir(texto: string) {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function GET() {
  const supabase = getSupabaseServerClient();

  const [ultimo, productos, marcas, subcategorias, profesionales, consultorios, miembros] = await Promise.all([
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
    // Igual que marcas: sin fecha de modificación, se miran los campos que se
    // ven en la ficha. Antes era solo la cantidad de publicados, y cambiarle
    // la foto o el link de turnos a una no llegaba a la pantalla.
    supabase
      .from("profesionales")
      .select("id_profesional,nombre,apellido,foto,titulo,especialidad,bio,link_reserva,link_reserva_online,precio_presencial,precio_online")
      .eq("publicado", true)
      .eq("estado", "ACTIVO")
      .order("id_profesional"),
    // Si todavía no existe la tabla de consultorios, estas dos fallan y no suman nada.
    supabase.from("consultorios").select("id_consultorio,nombre,link_reserva,link_reserva_online,estado").order("id_consultorio"),
    supabase.from("profesionales").select("id_profesional,id_consultorio").not("id_consultorio", "is", null).order("id_profesional"),
  ]);

  const huella = [
    ultimo.data?.fecha_actualizacion ?? "0",
    productos.count ?? 0,
    (marcas.data ?? []).map((m) => `${m.nombre}${m.logo ?? ""}${m.estado}${m.visible_asesor}`).join(","),
    (subcategorias.data ?? []).map((s) => `${s.nombre}${s.estado}`).join(","),
    resumir(
      JSON.stringify([profesionales.data ?? [], consultorios.error ? [] : consultorios.data, miembros.error ? [] : miembros.data])
    ),
  ].join("|");

  return NextResponse.json(
    {
      huella,
      despliegue: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
