import { redirect } from "next/navigation";
import { Outfit, Manrope, JetBrains_Mono } from "next/font/google";
import { logout } from "@/app/login/actions";
import { obtenerSesionMarca, ETIQUETA_PLAN } from "@/lib/marcaSesion";
import { WIIGO_LOGO_DATA_URI } from "@/lib/wiigo-logo-data";
import "./portal.css";

// Tipografías propias del portal. Outfit es geométrica y redondeada, de la
// misma familia visual que el logo; Manrope para leer y la monoespaciada para
// que los números aliñen en columna. Van por next/font para que se sirvan
// desde el propio dominio: sin pedido a Google y sin el parpadeo de la fuente
// cambiando a mitad de carga.
const outfit = Outfit({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--f-titulo" });
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--f-texto" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--f-mono" });

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
  const sesion = await obtenerSesionMarca();
  // Sin sesión de marca no hay portal: ni admin, ni empleado, ni deslogueado.
  if (!sesion) redirect("/login?next=/portal");

  return (
    <div className={`portal ${outfit.variable} ${manrope.variable} ${mono.variable}`}>
      <header className="portal-top">
        <div className="portal-top-int">
          <div className="portal-identidad">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="portal-logo" src={WIIGO_LOGO_DATA_URI} alt="WiiGo — Estaciones de Bienestar" />
            <span className="portal-divisor" />
            <div style={{ minWidth: 0 }}>
              <p className="portal-marca-nom">{sesion.nombreMarca}</p>
              <p className="portal-marca-sub">Tu tablero de marca</p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className={`plan-chip plan-${sesion.plan}`}>
              <span className="punto" />
              {ETIQUETA_PLAN[sesion.plan]}
            </span>
            <form action={logout}>
              <button className="portal-salir" type="submit">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
