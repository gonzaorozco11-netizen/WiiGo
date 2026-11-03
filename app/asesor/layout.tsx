import { Figtree } from "next/font/google";

// Texto corrido del Asesor. Los títulos y precios van en Bricolage Grotesque
// (ver components/AsesorApp.tsx).
const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export default function AsesorLayout({ children }: { children: React.ReactNode }) {
  return <div className={figtree.className}>{children}</div>;
}
