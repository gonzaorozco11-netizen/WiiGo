import { redirect } from "next/navigation";
import { Outfit, Manrope, JetBrains_Mono } from "next/font/google";
import { logout } from "@/app/login/actions";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import { dejarDeVerEspacio } from "@/app/(app)/profesionales/actions";
import { WIIGO_LOGO_DATA_URI } from "@/lib/wiigo-logo-data";
import EspacioNav from "./EspacioNav";
import Autorizacion from "./Autorizacion";
import "./espacio.css";

// El espacio de cada profesional: completa su ficha, ve su código y su saldo.
//
// Árbol de rutas separado del sistema interno a propósito, igual que el
// portal de marcas. El control es doble: proxy.ts no deja a una profesional
// salir de /mi-espacio, y este layout no deja entrar a nadie que no sea una
// profesional con usuario activo. Las mismas fuentes que el portal de marcas.
const outfit = Outfit({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--f-titulo" });
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--f-texto" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--f-mono" });

export const dynamic = "force-dynamic";

export default async function EspacioLayout({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) redirect("/login?next=/mi-espacio");

  const nombreCompleto = [sesion.nombre, sesion.apellido].filter(Boolean).join(" ");

  return (
    <div className={`espacio ${outfit.variable} ${manrope.variable} ${mono.variable}`}>
      {/* Gonzalo mirando desde la ficha interna: que no se confunda con su propia sesión. */}
      {sesion.soloLectura && (
        <div className="esp-mirando">
          <span>
            👁 Estás viendo el espacio de <b>{sesion.nombre}</b> tal como lo ve ella. Solo para mirar: no podés cambiar nada desde acá.
          </span>
          <form action={dejarDeVerEspacio}>
            <button type="submit">Volver a su ficha</button>
          </form>
        </div>
      )}
      <header className="esp-cab">
        <div className="esp-cab-int">
          <div className="esp-id">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={WIIGO_LOGO_DATA_URI} alt="WiiGo — Estaciones de Bienestar" />
            <span className="divisor" />
            <div style={{ minWidth: 0 }}>
              <b>{nombreCompleto}</b>
              <span>Tu espacio en WiiGo</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {sesion.autorizoImagenAt && <EspacioNav />}
            {/* Mirando, "Salir" cerraría la sesión de Gonzalo: no se muestra. */}
            {!sesion.soloLectura && (
              <form action={logout}>
                <button className="esp-salir" type="submit">
                  Salir
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      {/* Sin la autorización no ve nada más: es lo primero que se le pide. */}
      {sesion.autorizoImagenAt ? children : <Autorizacion nombre={sesion.nombre} logo={WIIGO_LOGO_DATA_URI} />}
    </div>
  );
}
