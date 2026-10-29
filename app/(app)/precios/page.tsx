import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { cargarDatosPrecios } from "@/lib/datosPrecios";
import { cargarCatalogoAlifrut } from "@/lib/catalogoProveedor";
import { cargarCompetencia } from "@/lib/competenciaLeer";
import { cargarGondola } from "@/lib/gondola";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import PreciosApp from "@/components/PreciosApp";
import "./precios.css";

export const dynamic = "force-dynamic";
// "Actualizar ahora" de la competencia lee 5 páginas (Bela Vita y Mega Nuts son grandes): necesita más que los 10 s de siempre.
export const maxDuration = 60;

// La estética "Profesional" que eligió Gonzalo: números en tipografía de
// máquina, del mismo ancho, para compararlos en columna.
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--f-plex", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--f-plex-mono", display: "swap" });

// ?producto=<id>: viene del botón "Cambiar precio" de la ficha del producto.
export default async function PreciosPage({ searchParams }: { searchParams: Promise<{ producto?: string }> }) {
  const { producto } = await searchParams;
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "precios")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const [datos, conPermisos, alifrut, competencia, localesRes] = await Promise.all([
    cargarDatosPrecios(supabase),
    obtenerSesionConPermisos(),
    cargarCatalogoAlifrut(supabase),
    cargarCompetencia(supabase),
    supabase.from("locales").select("id_local, nombre").eq("estado", "ACTIVO").order("nombre"),
  ]);
  // La góndola de cada local (sql/gondola.sql). null = falta el SQL.
  const locales = (localesRes.data ?? []) as { id_local: string; nombre: string }[];
  const gondolas = await Promise.all(locales.map(async (l) => ({ idLocal: l.id_local, nombre: l.nombre, modulos: await cargarGondola(supabase, l.id_local) })));
  const gondola = gondolas.some((g) => g.modulos === null) ? null : gondolas.map((g) => ({ ...g, modulos: g.modulos ?? [] }));

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
        alifrut={alifrut}
        competencia={competencia}
        gondola={gondola}
      />
    </div>
  );
}
