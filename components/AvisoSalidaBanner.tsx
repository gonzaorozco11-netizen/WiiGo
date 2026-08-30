"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Aparece en cualquier pantalla (no solo Ficha Asistencia) apenas pasa la
// hora de salida del horario y todavía no fichó — a propósito no tiene
// botón de "cerrar": vuelve a aparecer en cada pantalla hasta que la
// persona realmente vaya y fiche la salida.
export default function AvisoSalidaBanner({ horaSalida }: { horaSalida: string | null }) {
  const pathname = usePathname();
  if (pathname === "/ficha-asistencia") return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-amber-800 font-medium">
          ⏰ Tu horario terminó a las {horaSalida} — no te olvides de fichar tu salida.
        </p>
        <Link href="/ficha-asistencia" className="text-xs font-bold text-amber-900 bg-amber-100 border border-amber-300 rounded-lg px-3 py-1.5 whitespace-nowrap">
          Ir a fichar salida →
        </Link>
      </div>
    </div>
  );
}
