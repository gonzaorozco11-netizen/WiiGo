import { redirect } from "next/navigation";
import { outfit, manrope, jetbrainsMono as mono } from "@/app/fuentes/espacio";
import { logout } from "@/app/login/actions";
import { sesionDelPortal, ETIQUETA_PLAN } from "@/lib/marcaSesion";
import { dejarDeVerPortal } from "@/app/(app)/marcas/ver-portal-actions";
import { WIIGO_LOGO_DATA_URI } from "@/lib/wiigo-logo-data";
import PortalNav from "@/components/PortalNav";
import PortalLocal from "@/components/PortalLocal";
import { getSupabaseServerClient } from "@/lib/supabase";
import { misTareas, bienvenidaPortal } from "@/app/portal/actions";
import { cuantosFaltan } from "@/app/portal/reponer/actions";
import PortalBienvenida from "@/components/PortalBienvenida";
import GuiaWiigo from "@/components/GuiaWiigo";
import "./portal.css";

// Tipografías propias del portal. Outfit es geométrica y redondeada, de la
// misma familia visual que el logo; Manrope para leer y la monoespaciada para
// que los números aliñen en columna. Guardadas en app/fuentes: se sirven
// desde el propio dominio, sin pedido a Google y sin el parpadeo de la fuente
// cambiando a mitad de carga.

// Portal de marcas: árbol de rutas separado del sistema interno a propósito.
//
// Acá adentro nadie puede consultar nada que no sea de su propia marca. El
// control es este layout (rol "marca" o afuera) más el filtrado por sesión de
// cada consulta — nunca esconder cosas en pantalla, porque los datos igual
// habrían viajado al navegador.
//
// Tiene identidad visual propia (ver portal.css): la paleta sale del logo de
// WiiGo. No es el sistema con otro menú, es otro producto.
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Sin sesión de marca no hay portal: ni empleado, ni deslogueado. El admin
  // solo entra mirando una marca, en solo lectura (ver sesionDelPortal).
  const sesion = await sesionDelPortal();
  if (!sesion) redirect("/login?next=/portal");

  // De dónde son los números que está mirando. Va en el layout y no en el
  // tablero porque vale para todas las pantallas: el stock de Mis productos
  // también sale de acá.
  // El contador de "Mis tareas" va en el layout porque se ve desde cualquier
  // pantalla: es lo que trae de vuelta a la marca. Si falla, el menú sale sin
  // número en vez de tirar la página entera.
  const [{ data: locales }, tareas, bienvenida, faltan] = await Promise.all([
    getSupabaseServerClient()
      .from("locales")
      .select("nombre, direccion")
      .eq("estado", "ACTIVO")
      .order("nombre", { ascending: true }),
    misTareas().catch(() => null),
    bienvenidaPortal().catch(() => null),
    // El de reponer va al lado del de tareas y por el mismo motivo: una
    // góndola vacía que nadie mira es plata que no entra, y nadie entra a
    // mirar si no hay un número que lo reclame.
    cuantosFaltan().catch(() => 0),
  ]);

  return (
    <div className={`portal ${outfit.variable} ${manrope.variable} ${mono.variable}`}>
      {/* Gonzalo mirando el portal desde la ficha de la marca: que no se confunda. */}
      {sesion.soloLectura && (
        <div className="portal-mirando">
          <span>
            👁 Estás viendo el portal de <b>{sesion.nombreMarca}</b> tal como lo ve la marca. Solo para mirar: no podés mandar ni cambiar nada desde acá.
          </span>
          <form action={dejarDeVerPortal}>
            <button type="submit">Volver a la marca</button>
          </form>
        </div>
      )}
      <header className="portal-top">
        <div className="portal-top-int">
          <div className="portal-identidad">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="portal-logo" src={WIIGO_LOGO_DATA_URI} alt="WiiGo — Estaciones de Bienestar" />
            <span className="portal-divisor" />
            <div style={{ minWidth: 0 }}>
              <p className="portal-marca-nom">{sesion.nombreMarca}</p>
              <p className="portal-marca-sub">
                Tu tablero de marca
                <PortalLocal
                  locales={(locales ?? []).map((l) => ({
                    nombre: (l.nombre as string) ?? "Sucursal",
                    direccion: (l.direccion as string | null) ?? null,
                  }))}
                />
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <PortalNav pendientes={tareas?.pendientes ?? 0} reponer={faltan} />
            <PortalBienvenida datos={bienvenida} />
            <span className={`plan-chip plan-${sesion.plan}`}>
              <span className="punto" />
              {ETIQUETA_PLAN[sesion.plan]}
            </span>
            {/* Mirando, "Salir" cerraría la sesión de Gonzalo: no se muestra. */}
            {!sesion.soloLectura && (
              <form action={logout}>
                <button className="portal-salir" type="submit">
                  Salir
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      {children}
      <GuiaWiigo audiencia="marca" />
    </div>
  );
}
