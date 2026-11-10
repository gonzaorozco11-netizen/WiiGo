"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cartelesUrgentesAhora } from "@/app/(app)/carteles/actions";

// Una marca cambió el precio, la caja ya cobra el nuevo y en la góndola sigue
// el cartel viejo. Sale arriba de cualquier pantalla, en rojo y sin botón de
// cerrar, hasta que se ponen los carteles (Gonzalo, 2026-11-10). En Carteles
// no, porque ahí ya está la lista. Se fija cada dos minutos: al cambio de
// turno aparece solo, sin recargar.
const CADA_MS = 2 * 60 * 1000;

export default function AvisoCartelesBanner({ inicial }: { inicial: number }) {
  const pathname = usePathname();
  const [cantidad, setCantidad] = useState(inicial);

  useEffect(() => {
    const id = setInterval(() => {
      cartelesUrgentesAhora()
        .then(setCantidad)
        .catch(() => {});
    }, CADA_MS);
    return () => clearInterval(id);
  }, []);

  // Al volver de Carteles (donde se marcan puestos) se vuelve a contar.
  useEffect(() => {
    if (pathname === "/carteles") return;
    cartelesUrgentesAhora()
      .then(setCantidad)
      .catch(() => {});
  }, [pathname]);

  if (cantidad <= 0 || pathname === "/carteles") return null;

  return (
    <div className="bg-red-600 text-white print:hidden">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-semibold">
          🔴 {cantidad === 1 ? "1 cartel tiene" : `${cantidad} carteles tienen`} el precio viejo: la caja ya cobra el nuevo. Cambialos ahora.
        </p>
        <Link href="/carteles" className="text-xs font-bold text-red-700 bg-white rounded-lg px-3 py-1.5 whitespace-nowrap">
          Ir a Carteles →
        </Link>
      </div>
    </div>
  );
}
