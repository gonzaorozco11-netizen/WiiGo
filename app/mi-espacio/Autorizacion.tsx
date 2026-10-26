"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { aceptarAutorizacion } from "./actions";

// Lo primero que ve la primera vez que entra. Sin aceptar no sigue: su foto y
// sus textos salen en la pantalla del local, y eso necesita su permiso.
export default function Autorizacion({ nombre, logo }: { nombre: string; logo: string }) {
  const router = useRouter();
  const [acepta, setAcepta] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function entrar() {
    setError(null);
    setGuardando(true);
    aceptarAutorizacion()
      .then((r) => {
        if (r.error) return setError(r.error);
        router.refresh();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="autorizar">
      <div className="tarjeta">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src={logo} alt="WiiGo" />
        <h1>Hola {nombre}, te damos la bienvenida a WiiGo</h1>
        <p className="texto">
          Acá vas a completar tu ficha de la pantalla del local, ver cuánta gente la mira y lo que sumás con tu código.
        </p>
        <label>
          <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
          <span>
            Autorizo a WiiGo a mostrar mi foto, mis textos y mi matrícula en sus pantallas y su web. Lo que cargo es verdadero y las
            fotos son mías o tengo permiso para usarlas.
          </span>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="button" className="boton" disabled={!acepta || guardando} onClick={entrar}>
          {guardando ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
}
