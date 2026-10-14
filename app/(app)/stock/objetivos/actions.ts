"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos } from "@/lib/permisos";
import { friendlyDbError } from "@/lib/errors";
import { leerDias, huecoMasLargo } from "@/lib/recepcion";

// Cargar los mínimos y objetivos de toda una góndola de una vez.
//
// Existe porque antes de abrir hay 149 variantes para definir y hacerlo de a
// una es media tarde. Y porque el número correcto casi nunca es por producto:
// es por góndola. Toda la estantería de proteínas aguanta lo mismo, lo que
// cambia es cuántos frascos entran en cada estante.
//
// Es pantalla de WiiGo, no del portal: el espacio de góndola lo decide quien
// es dueño de la góndola. La marca después puede pedir cambiarlo como pide
// cualquier otra cosa, y eso pasa por Aprobaciones.

async function sesionInterna() {
  const sesion = await obtenerSesionConPermisos();
  if (!sesion || sesion.rol === "marca") return null;
  return sesion;
}

export type VarianteObjetivo = {
  idVariante: string;
  producto: string;
  variante: string;
  minimo: number;
  objetivo: number;
};

export type GondolaObjetivos = {
  idSubcategoria: string;
  nombre: string;
  variantes: VarianteObjetivo[];
};

export type MarcaObjetivos = {
  idMarca: string;
  nombre: string;
  gondolas: GondolaObjetivos[];
};

export type DatosObjetivos = {
  marcas: MarcaObjetivos[];
  /** Cuántos días seguidos puede estar sin recibir. Manda para el objetivo. */
  huecoDias: number;
};

export async function datosObjetivos(): Promise<DatosObjetivos | null> {
  if (!(await sesionInterna())) return null;

  const supabase = getSupabaseServerClient();

  const [{ data: marcas }, { data: subcategorias }, { data: productos }, { data: config }] =
    await Promise.all([
      supabase.from("marcas").select("id_marca, nombre").eq("estado", "ACTIVA").order("nombre"),
      supabase.from("subcategorias").select("id_subcategoria, id_marca, nombre").order("nombre"),
      supabase
        .from("productos")
        .select("id_producto, id_marca, id_subcategoria, nombre")
        .eq("estado", "ACTIVO"),
      supabase.from("configuracion").select("valor").eq("parametro", "RECEPCION_DIAS").maybeSingle(),
    ]);

  const idsProducto = (productos ?? []).map((p) => p.id_producto as string);
  const { data: variantes } = idsProducto.length
    ? await supabase
        .from("variantes_producto")
        .select("id_variante, id_producto, nombre, stock_minimo, stock_objetivo")
        .in("id_producto", idsProducto)
        .eq("estado", "ACTIVO")
        .order("orden", { ascending: true })
    : { data: [] as Record<string, unknown>[] };

  const nombreProducto = new Map(
    (productos ?? []).map((p) => [p.id_producto as string, (p.nombre as string) ?? "Producto"])
  );
  const subcatDeProducto = new Map(
    (productos ?? []).map((p) => [p.id_producto as string, (p.id_subcategoria as string) ?? ""])
  );
  const marcaDeProducto = new Map(
    (productos ?? []).map((p) => [p.id_producto as string, (p.id_marca as string) ?? ""])
  );

  // Las variantes caen en la góndola de su producto. "" es la bolsa de las
  // que no tienen subcategoría: se muestran igual, porque esconderlas es
  // justamente cómo quedan en cero sin que nadie se entere.
  const porMarcaYGondola = new Map<string, Map<string, VarianteObjetivo[]>>();
  for (const v of variantes ?? []) {
    const idProducto = v.id_producto as string;
    const idMarca = marcaDeProducto.get(idProducto) ?? "";
    const idSub = subcatDeProducto.get(idProducto) ?? "";
    if (!porMarcaYGondola.has(idMarca)) porMarcaYGondola.set(idMarca, new Map());
    const gondolas = porMarcaYGondola.get(idMarca)!;
    const fila: VarianteObjetivo = {
      idVariante: v.id_variante as string,
      producto: nombreProducto.get(idProducto) ?? "Producto",
      variante: (v.nombre as string) ?? "Único",
      minimo: (v.stock_minimo as number | null) ?? 0,
      objetivo: (v.stock_objetivo as number | null) ?? 0,
    };
    gondolas.set(idSub, [...(gondolas.get(idSub) ?? []), fila]);
  }

  const nombreSub = new Map(
    (subcategorias ?? []).map((s) => [s.id_subcategoria as string, (s.nombre as string) ?? "—"])
  );

  return {
    huecoDias: huecoMasLargo(leerDias(config?.valor as string | undefined)),
    marcas: (marcas ?? [])
      .map((m) => {
        const idMarca = m.id_marca as string;
        const gondolas = [...(porMarcaYGondola.get(idMarca) ?? new Map()).entries()]
          .map(([idSub, filas]) => ({
            idSubcategoria: idSub,
            nombre: idSub ? (nombreSub.get(idSub) ?? "—") : "Sin subcategoría",
            variantes: (filas as VarianteObjetivo[]).sort((a, b) =>
              `${a.producto}${a.variante}`.localeCompare(`${b.producto}${b.variante}`)
            ),
          }))
          // Las sin subcategoría al final: son las que hay que arreglar, no
          // las que se miran primero.
          .sort((a, b) =>
            a.idSubcategoria === "" ? 1 : b.idSubcategoria === "" ? -1 : a.nombre.localeCompare(b.nombre)
          );
        return { idMarca, nombre: (m.nombre as string) ?? "Marca", gondolas };
      })
      .filter((m) => m.gondolas.length > 0),
  };
}

/**
 * Guardar lo que se tocó.
 *
 * Llega la lista completa de lo editado en vez de un guardado por fila: con
 * una góndola de veinte variantes, veinte viajes a la base es lento y además
 * deja la pantalla a medio guardar si uno falla.
 */
export async function guardarObjetivos(
  cambios: { idVariante: string; minimo: number; objetivo: number }[]
): Promise<{ error: string | null; guardados: number }> {
  if (!(await sesionInterna())) return { error: "No tenés permiso.", guardados: 0 };
  if (cambios.length === 0) return { error: null, guardados: 0 };

  for (const c of cambios) {
    if (!Number.isInteger(c.minimo) || !Number.isInteger(c.objetivo)) {
      return { error: "Los valores tienen que ser números enteros.", guardados: 0 };
    }
    if (c.minimo < 0 || c.objetivo < 0) return { error: "No puede haber negativos.", guardados: 0 };
    // Un mínimo por encima del objetivo deja el producto pidiendo reposición
    // para siempre: nunca llega a estar "bien".
    if (c.minimo > c.objetivo) {
      return { error: "El mínimo no puede ser mayor que el objetivo.", guardados: 0 };
    }
    if (c.objetivo > 999) return { error: "999 por variante es el tope.", guardados: 0 };
  }

  const supabase = getSupabaseServerClient();
  for (const c of cambios) {
    const { error } = await supabase
      .from("variantes_producto")
      .update({ stock_minimo: c.minimo, stock_objetivo: c.objetivo })
      .eq("id_variante", c.idVariante);
    if (error) return { error: friendlyDbError(error), guardados: 0 };
  }

  revalidatePath("/stock/objetivos");
  revalidatePath("/stock");
  return { error: null, guardados: cambios.length };
}
