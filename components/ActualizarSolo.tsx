"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// La tablet del local queda abierta todo el día: cuando se sube algo nuevo,
// seguía con lo viejo hasta que alguien recargara a mano, y el equipo no sabe
// que tiene que hacerlo (Gonzalo, 2026-11-12, con el aviso de cobro). Esto se
// fija cada minuto si hay una versión nueva y recarga sola, pero solo en un
// momento tranquilo, para no borrar una venta a medio cargar:
//   - en el Inicio o en Mis tareas, sin estar escribiendo nada;
//   - o cuando la pantalla vuelve a verse después de estar en segundo plano.
// Es lo mismo que ya hacía el tótem (lib/version.ts).

const CADA_MS = 60_000;
const TRANQUILAS = ["/", "/mis-tareas"];

export default function ActualizarSolo({ version }: { version: string }) {
  const pathname = usePathname();
  const hayNueva = useRef(false);
  const ruta = useRef(pathname);
  // La versión con la que se cargó la página (el código que está corriendo).
  // No se pisa si el servidor manda la nueva en un refresco: el código sigue siendo el viejo.
  const cargada = useRef(version);

  useEffect(() => {
    ruta.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const version = cargada.current;
    // En la compu, sin Vercel, no hay número de versión: nunca se recarga.
    if (version === "local") return;
    const escribiendo = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    };
    const recargarSiSePuede = () => {
      if (hayNueva.current && TRANQUILAS.includes(ruta.current) && !escribiendo()) window.location.reload();
    };
    const mirar = () => {
      fetch("/api/version", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { version: string } | null) => {
          if (d?.version && d.version !== "local" && d.version !== version) {
            hayNueva.current = true;
            recargarSiSePuede();
          }
        })
        .catch(() => {});
    };
    const alVolver = () => {
      if (document.visibilityState === "visible" && hayNueva.current) window.location.reload();
    };
    const t = setInterval(mirar, CADA_MS);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  // Al volver al Inicio con una versión nueva esperando, se recarga ahí.
  useEffect(() => {
    if (hayNueva.current && TRANQUILAS.includes(pathname)) window.location.reload();
  }, [pathname]);

  return null;
}
