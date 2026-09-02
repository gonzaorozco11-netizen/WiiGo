"use client";

import { useState } from "react";
import type { Local } from "@/lib/supabase";

function BotonPantalla({ label, href, baseUrl }: { label: string; href: string; baseUrl: string }) {
  const [copiado, setCopiado] = useState(false);

  // Link absoluto al dominio público. Antes era relativo, y eso hacía que el
  // totem quedara abierto en el mismo dominio por el que se entró al sistema
  // — incluida la URL interna de un deploy de Vercel, que está protegida con
  // login. El cliente escaneaba el QR del comprobante y terminaba en una
  // pantalla de Vercel pidiéndole datos.
  const url = baseUrl ? baseUrl + href : href;

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(baseUrl ? url : window.location.origin + href);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sin permiso de portapapeles — no es grave, el link abre igual.
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg bg-accent hover:bg-accent-dark text-white px-3 py-1.5 text-sm font-medium"
      >
        {label} ↗
      </a>
      <button
        onClick={copiarLink}
        title="Copiar link"
        className="rounded-lg border border-neutral-200 hover:bg-neutral-50 text-neutral-500 px-2 py-1.5 text-xs"
      >
        {copiado ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

export default function PantallasApp({ locales, baseUrl }: { locales: Local[]; baseUrl: string }) {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-neutral-900">Pantallas</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Accesos directos a las pantallas táctiles de cada local — el totem de autopedido (donde se
          paga) y la pantalla asesora (donde se recomiendan productos, sin cobrar). Se abren en una
          pestaña nueva; también podés copiar el link para dejarlo cargado en el navegador del equipo
          físico.
        </p>
        {baseUrl && (
          <p className="text-xs text-neutral-400 mt-2">
            Las pantallas se abren en <span className="font-mono text-neutral-500">{baseUrl}</span>. Si en el
            equipo físico ves otra dirección, volvé a cargar el link desde acá.
          </p>
        )}
      </div>

      {locales.length === 0 ? (
        <p className="text-sm text-neutral-500 py-12 text-center">
          Todavía no cargaste ningún local activo.
        </p>
      ) : (
        <ul className="space-y-2">
          {locales.map((l) => (
            <li
              key={l.id_local}
              className="bg-white border border-neutral-200 rounded-xl px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="min-w-0">
                <p className="font-medium text-neutral-900">{l.nombre}</p>
                {l.direccion && <p className="text-sm text-neutral-500">{l.direccion}</p>}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <BotonPantalla label="Totem autopedido" href={`/self-checkout/${l.id_local}`} baseUrl={baseUrl} />
                <BotonPantalla label="Pantalla asesora" href={`/asesor/${l.id_local}`} baseUrl={baseUrl} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
