import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { entradasQueNecesitanCodigo } from "@/lib/entradas";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import CodigosApp, { type ItemCodigo } from "@/components/CodigosApp";
import { PIE_ETIQUETA_DEFECTO } from "@/lib/rotulado";
import { cargarMarcasFabrica } from "@/lib/marcaFabrica";
import { cargarMarcasSinCodigo } from "@/lib/marcasSinCodigo";

export const dynamic = "force-dynamic";

export default async function CodigosPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "codigos")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const entradas = await entradasQueNecesitanCodigo();

  const BASE_PRODUCTO = "id_producto,nombre,imagen,id_marca,id_envase";
  const traerProductos = (columnas: string) =>
    supabase.from("productos").select(columnas).eq("estado", "ACTIVO");

  const [variantesRes, productosConRotulo, marcasRes, pieRes, marcasFabrica, marcasSinCodigo] = await Promise.all([
    supabase
      .from("variantes_producto")
      .select("id_variante,id_producto,nombre,sku,codigo_barras")
      .eq("estado", "ACTIVO"),
    traerProductos(`${BASE_PRODUCTO},peso_neto_g,dias_vida_util,alergenos,trazas`),
    supabase.from("marcas").select("id_marca,nombre,tipo_comercializacion").eq("estado", "ACTIVA"),
    supabase.from("configuracion").select("valor").eq("parametro", "ETIQUETA_PIE").maybeSingle(),
    // «(Entre Nuts)» al lado del nombre en la lista (no en la etiqueta impresa): lib/marcaFabrica.ts.
    cargarMarcasFabrica(supabase).catch(() => new Map<string, string>()),
    cargarMarcasSinCodigo(supabase).catch(() => new Set<string>()),
  ]);
  // Sin sql/rotulado.sql corrido, las etiquetas salen como antes.
  const productosRes = productosConRotulo.error ? await traerProductos(BASE_PRODUCTO) : productosConRotulo;

  const error = variantesRes.error || productosRes.error || marcasRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los códigos</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  type FilaProducto = {
    id_producto: string;
    nombre: string;
    imagen: string | null;
    id_marca: string;
    id_envase: string | null;
    peso_neto_g?: number | null;
    dias_vida_util?: number | null;
    alergenos?: string | null;
    trazas?: string | null;
  };
  type FilaMarca = { id_marca: string; nombre: string; tipo_comercializacion: string };
  type FilaVariante = {
    id_variante: string;
    id_producto: string;
    nombre: string;
    sku: string | null;
    codigo_barras: string | null;
  };

  const productos = new Map(
    ((productosRes.data ?? []) as unknown as FilaProducto[]).map((p) => [p.id_producto, p])
  );
  const marcasPorId = new Map(((marcasRes.data ?? []) as FilaMarca[]).map((m) => [m.id_marca, m]));
  const marcas = new Map([...marcasPorId].map(([id, m]) => [id, m.nombre]));
  const rotuloSql = !productosConRotulo.error;

  // Solo las variantes de productos activos: una variante activa colgando de un
  // producto dado de baja no va a la góndola, así que tampoco lleva etiqueta.
  const items: ItemCodigo[] = ((variantesRes.data ?? []) as FilaVariante[])
    .flatMap((v) => {
      const p = productos.get(v.id_producto);
      if (!p) return [];
      const propia = marcasPorId.get(p.id_marca)?.tipo_comercializacion === "PROPIA";
      return [
        {
          idVariante: v.id_variante,
          producto: p.nombre,
          marcaFabrica: marcasFabrica.get(p.id_producto) ?? null,
          // "Único" es plomería interna, no un sabor: no se muestra.
          variante: v.nombre === "Único" ? null : v.nombre,
          sku: v.sku,
          imagen: p.imagen,
          codigo: v.codigo_barras,
          // Las marcas que no están ACTIVA no salen ni en el asesor ni en el
          // tótem; se agrupan aparte para que no ensucien la cuenta.
          marca: marcas.get(p.id_marca) ?? null,
          propia,
          // Lo que embolsamos nosotros (marca propia con envase WiiGo) y las
          // marcas que mandan sus envases sin código (Alta, Fruppi) llevan
          // sticker. Todo lo demás viene cerrado de fábrica con el suyo
          // (aceites, mieles, Animalfit...) y se escanea, no se imprime.
          idMarca: p.id_marca,
          marcaSinCodigo: marcasSinCodigo.has(p.id_marca),
          envasado: !(propia && p.id_envase) && !marcasSinCodigo.has(p.id_marca),
          // Solo lo que fraccionamos nosotros lleva rótulo: lo de las marcas
          // en consignación ya trae el suyo impreso de fábrica.
          // Lo cerrado de marca propia (un aceite que compramos hecho) tampoco:
          // el rótulo ya lo trae la botella.
          rotulo:
            rotuloSql && propia && p.id_envase
              ? {
                  pesoG: p.peso_neto_g ?? null,
                  dias: p.dias_vida_util ?? null,
                  alergenos: p.alergenos ?? null,
                  trazas: p.trazas ?? null,
                }
              : null,
        },
      ];
    })
    .sort((a, b) => a.producto.localeCompare(b.producto, "es"));

  const pie = (pieRes.data?.valor as string | undefined)?.trim() || PIE_ETIQUETA_DEFECTO;

  return <CodigosApp items={items} entradas={entradas} pieEtiqueta={pie} />;
}
