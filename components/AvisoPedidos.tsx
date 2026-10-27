"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// La "alarmita" de Pedidos (pedido de Gonzalo): cuando llega un pedido nuevo
// de una profesional, suena un aviso y aparece un cartel, esté el equipo en
// la pantalla que esté. Mira cada 30 segundos; el número rojo del menú se
// pone al día con el mismo refresco.

const CADA_MS = 30000;

function sonar() {
  try {
    const Contexto = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Contexto) return;
    const ctx = new Contexto();
    // Dos notas cortas, como un timbre: se escucha pero no asusta.
    [880, 1175].forEach((frecuencia, i) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.frequency.value = frecuencia;
      osc.connect(vol);
      vol.connect(ctx.destination);
      const inicio = ctx.currentTime + i * 0.22;
      vol.gain.setValueAtTime(0.0001, inicio);
      vol.gain.exponentialRampToValueAtTime(0.25, inicio + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.2);
      osc.start(inicio);
      osc.stop(inicio + 0.21);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    // Sin sonido igual queda el cartel.
  }
}

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
