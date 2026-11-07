import { plex, plexMono } from "@/app/fuentes/precios";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { cargarDatosPrecios } from "@/lib/datosPrecios";
import { cargarCatalogoAlifrut } from "@/lib/catalogoProveedor";
import { cargarCompetencia } from "@/lib/competenciaLeer";
import { cargarGondola } from "@/lib/gondola";
import { cargarMarcasFabrica, conMarca } from "@/lib/marcaFabrica";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import PreciosApp from "@/components/PreciosApp";
import "./precios.css";

export const dynamic = "force-dynamic";
// "Actualizar ahora" de la competencia lee 5 páginas (Bela Vita y Mega Nuts son grandes): necesita más que los 10 s de siempre.
export const maxDuration = 60;

// La estética "Profesional" que eligió Gonzalo: números en tipografía de
// máquina, del mismo ancho, para compararlos en columna (IBM Plex, en app/fuentes).

// ?producto=<id>: viene del botón "Cambiar precio" de la ficha del producto.
// ?pestana=alifrut&cat=…&q=…: después de vincular en Productos Alifrut se recarga
// y vuelve ahí mismo, para seguir agregando (Gonzalo, 2026-11-06).
export default async function PreciosPage({ searchParams }: { searchParams: Promise<{ producto?: string; pestana?: string; cat?: string; q?: string }> }) {
  const { producto, pestana, cat, q } = await searchParams;
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "precios")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const [datos, conPermisos, alifrut, competencia, localesRes, marcasFabrica] = await Promise.all([
    cargarDatosPrecios(supabase),
    obtenerSesionConPermisos(),
    cargarCatalogoAlifrut(supabase),
    cargarCompetencia(supabase),
    supabase.from("locales").select("id_local, nombre").eq("estado", "ACTIVO").order("nombre"),
    // «(Entre Nuts)» al lado del nombre, como lo ve el cliente (Gonzalo: «así no me pierdo»). Solo para mostrar.
    cargarMarcasFabrica(supabase).catch(() => new Map<string, string>()),
  ]);
  // La góndola de cada local (sql/gondola.sql). null = falta el SQL.
  const locales = (localesRes.data ?? []) as { id_local: string; nombre: string }[];
  const gondolas = await Promise.all(locales.map(async (l) => ({ idLocal: l.id_local, nombre: l.nombre, modulos: await cargarGondola(supabase, l.id_local) })));
  // Los nombres de los lugares, con la marca de fábrica (solo para mostrar: se guarda por id).
  const gondola = gondolas.some((g) => g.modulos === null)
    ? null
    : gondolas.map((g) => ({
        ...g,
        modulos: (g.modulos ?? []).map((m) => ({ ...m, lugares: m.lugares.map((l) => ({ ...l, nombre: conMarca(l.nombre, marcasFabrica.get(l.idProducto)) })) })),
      }));
  // En la góndola van los productos de todas las marcas (las islas tienen
  // Crislo y la estantería es de Animalfit), no solo los de WiiGo.
  const { data: todosProductos } = await supabase
    .from("productos")
    .select("id_producto, nombre, marcas(nombre)")
    .eq("estado", "ACTIVO")
    .order("nombre");
  const productosGondola = (todosProductos ?? []).map((p) => ({
    id: p.id_producto as string,
    nombre: conMarca(p.nombre as string, marcasFabrica.get(p.id_producto as string)),
    marca: (p.marcas as unknown as { nombre: string } | null)?.nombre ?? null,
  }));

  if (!datos.disponible) {
    return (
      <div className="max-w-xl mx-auto bg-white border border-neutral-200 rounded-2xl p-6 text-center">
        <h1 className="text-lg font-bold mb-2">Precios</h1>
        <p className="text-sm text-neutral-600">
          Falta correr <code>sql/precios.sql</code> en Supabase (SQL Editor → New query → pegar → Run). Después recargá esta página.
        </p>
      </div>
    );
  }

  return (
    <div className={`${plex.variable} ${plexMono.variable}`}>
      <PreciosApp
        config={datos.config}
        marcas={datos.marcas}
        rubros={datos.rubros}
        productos={datos.productos}
        granel={datos.granel}
        envases={datos.envases}
        proveedores={datos.proveedores}
        puedeConfigurar={tienePermiso(conPermisos, PERMISOS.EDITAR_CONFIGURACION)}
        abrir={datos.productos.some((p) => p.id === producto) ? producto : null}
        pestanaInicial={pestana === "alifrut" ? "alifrut" : null}
        alifrutInicial={pestana === "alifrut" ? { cat: cat?.slice(0, 80) ?? null, buscar: q?.slice(0, 80) ?? null } : null}
        alifrut={alifrut}
        competencia={competencia}
        gondola={gondola}
        productosGondola={productosGondola}
        marcasFabrica={Object.fromEntries(marcasFabrica)}
      />
    </div>
  );
}
