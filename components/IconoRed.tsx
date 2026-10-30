import { siFacebook, siInstagram, siTiktok, siYoutube } from "simple-icons";
import type { ClaveRed } from "@/lib/redesProfesional";

// El logo de cada red, en vez de las siglas (Gonzalo, 2026-10-30). Los logos
// salen de la librería simple-icons (licencia CC0, de uso libre). LinkedIn no
// está en esa librería y la página web no tiene logo: para esos dos va un
// dibujo propio simple.

const LOGOS: Partial<Record<ClaveRed, { path: string; hex: string }>> = {
  instagram: siInstagram,
  tiktok: siTiktok,
  facebook: siFacebook,
  youtube: siYoutube,
};

/** El color de fondo de la red (el de su marca). */
export function colorDeRed(clave: ClaveRed): string {
  if (clave === "linkedin") return "#1d5f9e";
  if (clave === "web") return "#4b5a43";
  return `#${LOGOS[clave]?.hex ?? "555555"}`;
}

/** El logo en blanco, para ir sobre el color de la red. */
export default function IconoRed({ clave, className }: { clave: ClaveRed; className?: string }) {
  const logo = LOGOS[clave];
  if (logo)
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <path d={logo.path} />
      </svg>
    );
  if (clave === "linkedin")
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <rect x="3.5" y="9" width="3.6" height="11" rx=".6" />
        <circle cx="5.3" cy="5.4" r="2.1" />
        <path d="M9.6 9h3.4v1.6c.6-1.1 1.9-1.9 3.6-1.9 2.8 0 3.9 1.8 3.9 4.7V20h-3.6v-5.8c0-1.4-.4-2.4-1.7-2.4-1.4 0-2 1-2 2.4V20H9.6z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9" />
    </svg>
  );
}
