"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sonarTimbre as sonar } from "@/lib/timbre";

// La "alarmita" de Pedidos (pedido de Gonzalo): cuando llega un pedido nuevo
// de una profesional, suena un aviso y aparece un cartel, esté el equipo en
// la pantalla que esté. Mira cada 30 segundos; el número rojo del menú se
// pone al día con el mismo refresco.

const CADA_MS = 30000;

export default function AvisoPedidos({ inicial }: { inicial: number }) {
  const router = useRouter();
  const ultimo = useRef(inicial);
  const [cartel, setCartel] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/pedidos/nuevos", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { nuevos: number; de: string | null } | null) => {
          if (!d) return;
          if (d.nuevos > ultimo.current) {
            sonar();
            setCartel(d.de ? `Llegó un pedido de ${d.de}` : "Llegó un pedido nuevo");
            router.refresh();
          } else if (d.nuevos !== ultimo.current) {
            router.refresh();
          }
          ultimo.current = d.nuevos;
        })
        .catch(() => {});
    }, CADA_MS);
    return () => clearInterval(t);
  }, [router]);

  if (!cartel) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 print:hidden" role="alert">
      <div className="flex items-center gap-3 bg-white border border-neutral-200 shadow-xl rounded-2xl pl-4 pr-2 py-3">
        <span className="w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold grid place-items-center" aria-hidden="true">!</span>
        <span className="text-sm font-semibold text-neutral-900">{cartel}</span>
        <Link href="/pedidos" onClick={() => setCartel(null)} className="bg-accent text-white text-sm font-bold rounded-lg px-3 py-1.5">
          Ver
        </Link>
        <button type="button" onClick={() => setCartel(null)} className="text-neutral-400 hover:text-neutral-700 px-2 text-lg leading-none" aria-label="Cerrar aviso">
          ×
        </button>
      </div>
    </div>
  );
}
