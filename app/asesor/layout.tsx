import { figtree } from "@/app/fuentes/asesor";

// Texto corrido del Asesor. Los títulos y precios van en Bricolage Grotesque
// (ver components/AsesorApp.tsx). Las dos guardadas en app/fuentes.

export default function AsesorLayout({ children }: { children: React.ReactNode }) {
  return <div className={figtree.className}>{children}</div>;
}
