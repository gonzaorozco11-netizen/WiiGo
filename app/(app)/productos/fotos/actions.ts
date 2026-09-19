"use server";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";

// Importar fotos de producto desde una URL.
//
// Existe porque las marcas mandan sus fotos como salen del celular, o las
// tienen en su propia tienda online: distintos tamaños, distintos formatos y
// pesadas. En el tótem eso se nota — es una placa RK3566 con un WebView
// viejo, y una foto de 2 MB por producto hace que la grilla tarde en pintar.
//
// Todo lo que entra sale igual: 1000×1000 WebP, fondo blanco, bajo 150 KB.
// Ese es el estándar que se les pide a las marcas.

/** El estándar. Cambiarlo acá lo cambia para todas las marcas. */
const FOTO = {
  lado: 1000,
  calidad: 80,
  /** Si con calidad 80 se pasa del peso, se reintenta bajando hasta acá. */
  calidadMinima: 50,
  pesoMaximoKB: 150,
};

export type ResultadoFoto = {
  producto: string;
  ok: boolean;
  fotos: number;
  /** Lo que pesó cada foto ya convertida, en KB. */
  pesos: number[];
  error?: string;
};

async function requireAcceso() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "productos")) return "No tenés permiso para hacer esto.";
  return null;
}

/**
 * Baja una imagen y la deja en el estándar.
 *
 * `contain` y no `cover`: recortar un envase para que entre en el cuadrado le
 * corta la tapa o la etiqueta. Se encaja entero y lo que sobra se rellena de
 * blanco, que además empareja las fotos de marcas distintas.
 */
async function normalizar(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`no se pudo bajar (${res.status})`);
  const original = Buffer.from(await res.arrayBuffer());

  const base = sharp(original).resize(FOTO.lado, FOTO.lado, {
    fit: "contain",
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  });

  // Se baja la calidad solo si hace falta. La mayoría entra cómoda en 80, y
  // recomprimir de más se nota en las etiquetas con letra chica.
  for (let q = FOTO.calidad; q >= FOTO.calidadMinima; q -= 10) {
    const salida = await base.clone().webp({ quality: q }).toBuffer();
    if (salida.byteLength <= FOTO.pesoMaximoKB * 1024 || q === FOTO.calidadMinima) return salida;
  }
  return base.webp({ quality: FOTO.calidadMinima }).toBuffer();
}

/**
 * Importa las fotos de UN producto, buscándolo por nombre.
 *
 * De a uno y no las 72 juntas: bajar y convertir 200 imágenes tarda varios
 * minutos, y cualquier corte a mitad de camino dejaría el trabajo sin saber
 * dónde quedó. Así la pantalla va de a uno, muestra el avance y puede
 * reintentar solo lo que falló.
 */
export async function importarFotosDeProducto(
  nombreProducto: string,
  urls: string[]
): Promise<ResultadoFoto> {
  const permisoError = await requireAcceso();
  if (permisoError) return { producto: nombreProducto, ok: false, fotos: 0, pesos: [], error: permisoError };

  const supabase = getSupabaseServerClient();

  const { data: producto } = await supabase
    .from("productos")
    .select("id_producto")
    .eq("nombre", nombreProducto)
    .maybeSingle();
  if (!producto) {
    return { producto: nombreProducto, ok: false, fotos: 0, pesos: [], error: "no existe ese producto" };
  }
  const idProducto = producto.id_producto as string;

  const publicas: string[] = [];
  const pesos: number[] = [];
  let aviso: string | undefined;

  for (const [i, url] of urls.slice(0, 3).entries()) {
    try {
      const buffer = await normalizar(url);
      const path = `${idProducto}-${i + 1}.webp`;

      const { error: errorUpload } = await supabase.storage
        .from("fotos-productos")
        .upload(path, buffer, { upsert: true, contentType: "image/webp" });
      if (errorUpload) throw new Error(errorUpload.message);

      const { data } = supabase.storage.from("fotos-productos").getPublicUrl(path);
      publicas.push(data.publicUrl);
      pesos.push(Math.round(buffer.byteLength / 1024));
    } catch (err) {
      // Una foto rota no tira abajo las otras: se guarda lo que sí salió y se
      // avisa cuál falló, para poder reintentar solo esa.
      aviso = `foto ${i + 1}: ${err instanceof Error ? err.message : "falló"}`;
    }
  }

  if (publicas.length === 0) {
    return { producto: nombreProducto, ok: false, fotos: 0, pesos, error: aviso ?? "no se pudo bajar ninguna" };
  }

  // La principal va también en `productos.imagen`, que es de donde la leen el
  // POS, el tótem y las listas. `ficha_producto` guarda las tres, para el
  // detalle del catálogo asesor.
  const { error: errorProducto } = await supabase
    .from("productos")
    .update({ imagen: publicas[0], fecha_actualizacion: new Date().toISOString() })
    .eq("id_producto", idProducto);
  if (errorProducto) {
    return { producto: nombreProducto, ok: false, fotos: 0, pesos, error: friendlyDbError(errorProducto) };
  }

  const { error: errorFicha } = await supabase.from("ficha_producto").upsert(
    {
      id_producto: idProducto,
      imagen_principal: publicas[0],
      foto_extra_1: publicas[1] ?? null,
      foto_extra_2: publicas[2] ?? null,
    },
    { onConflict: "id_producto" }
  );
  if (errorFicha) {
    return { producto: nombreProducto, ok: false, fotos: 0, pesos, error: friendlyDbError(errorFicha) };
  }

  revalidatePath("/productos");
  revalidatePath("/catalogo-asesor");
  return { producto: nombreProducto, ok: true, fotos: publicas.length, pesos, error: aviso };
}
