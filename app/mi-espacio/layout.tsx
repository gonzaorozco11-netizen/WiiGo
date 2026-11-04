import { redirect } from "next/navigation";
import { outfit, manrope, jetbrainsMono as mono } from "@/app/fuentes/espacio";
import { logout } from "@/app/login/actions";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import { dejarDeVerEspacio } from "@/app/(app)/profesionales/actions";
import { WIIGO_LOGO_DATA_URI } from "@/lib/wiigo-logo-data";
import EspacioNav from "./EspacioNav";
import GuiaWiigo from "@/components/GuiaWiigo";
import Presentacion from "./Presentacion";
import { Suspense } from "react";
import { getSupabaseServerClient } from "@/lib/supabase";
import { datosPresentacion, vioPresentacion } from "@/lib/primerosPasos";
import Autorizacion from "./Autorizacion";
import "./espacio.css";

// El espacio de cada profesional: completa su ficha, ve su código y su saldo.
//
// Árbol de rutas separado del sistema interno a propósito, igual que el
// portal de marcas. El control es doble: proxy.ts no deja a una profesional
// salir de /mi-espacio, y este layout no deja entrar a nadie que no sea una
// profesional con usuario activo. Las mismas fuentes que el portal de marcas.

export const dynamic = "force-dynamic";

export default async function EspacioLayout({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) redirect("/login?next=/mi-espacio");

  const nombreCompleto = [sesion.nombre, sesion.apellido].filter(Boolean).join(" ");
  // Ella no pasa de la autorización hasta aceptarla. Gonzalo mirando no la
  // puede aceptar por ella (solo lectura), así que a él se le muestra el
  // espacio igual, con el aviso de que todavía falta.
  const veElEspacio = Boolean(sesion.autorizoImagenAt) || sesion.soloLectura;

  // La presentación de bienvenida: se abre sola la primera vez que entra ella
  // (no cuando Gonzalo mira; él la abre con «Ver de nuevo la presentación»).
  const supabase = getSupabaseServerClient();
  const [datosBienvenida, yaLaVio] = veElEspacio
    ? await Promise.all([datosPresentacion(supabase, sesion.idProfesional, sesion.nombre), vioPresentacion(supabase, sesion.idProfesional)])
    : [null, true];

  return (
    <div className={`espacio ${outfit.variable} ${manrope.variable} ${mono.variable}`}>
      {/* Gonzalo mirando desde la ficha interna: que no se confunda con su propia sesión. */}
      {sesion.soloLectura && (
        <div className="esp-mirando">
          <span>
            👁 Estás viendo el espacio de <b>{sesion.nombre}</b> tal como lo ve ella. Solo para mirar: no podés cambiar nada desde acá.
            {!sesion.autorizoImagenAt && (
              <>
                {" "}
                <b>Todavía no aceptó la autorización de imagen:</b> es lo primero que le va a aparecer cuando entre.
              </>
            )}
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
            {veElEspacio && <EspacioNav />}
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
      {veElEspacio ? children : <Autorizacion nombre={sesion.nombre} logo={WIIGO_LOGO_DATA_URI} />}
      {veElEspacio && <GuiaWiigo audiencia="profesional" />}
      {datosBienvenida && (
        <Suspense fallback={null}>
          <Presentacion datos={datosBienvenida} abrirSola={!yaLaVio && !sesion.soloLectura} />
        </Suspense>
      )}
    </div>
  );
}
