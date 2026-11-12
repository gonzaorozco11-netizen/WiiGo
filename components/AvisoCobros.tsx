"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { sonarTimbre } from "@/lib/timbre";
import type { CobrosEsperando } from "@/lib/cobrosEsperando";

// El aviso de «hay un cliente esperando para pagar» (Gonzalo, 2026-11-12):
// cuando alguien elige pagar en efectivo en el tótem, al equipo que está
// trabajando le aparece una franja roja arriba, en cualquier pantalla, con un
// timbre y un botón para ir a cobrar. Mira cada 10 segundos.
//
// También:
//   - el número del acceso «Cobrar pedidos» del inicio se pone al día solo;
//   - el ícono de WiiGo en la tablet o el celular muestra el número, donde el
//     aparato lo permite (app instalada como acceso directo);
//   - en la compu, la pestaña dice «(1) …».
// El timbre suena cuando llega uno nuevo y se repite cada minuto mientras
// espera, durante los primeros 5 minutos: después queda la franja sola.

const CADA_MS = 10_000;
const RECORDAR_CADA_MS = 60_000;
const RECORDAR_HASTA_MS = 5 * 60_000;

type Navegador = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

function ponerNumeroEnIcono(n: number) {
  try {
    const nav = navigator as Navegador;
    if (n > 0) nav.setAppBadge?.(n)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    // Aparato sin número en el ícono: queda la franja.
  }
  const base = document.title.replace(/^\(\d+\)\s*/, "");
  document.title = n > 0 ? `(${n}) ${base}` : base;
}

const formatearPedido = (numero: number) => `VTA-${String(numero).padStart(4, "0")}`;

export default function AvisoCobros() {
  const router = useRouter();
  const pathname = usePathname();
  const [estado, setEstado] = useState<CobrosEsperando & { minutos: number }>({ n: 0, numero: null, desde: null, minutos: 0 });
  const ultimo = useRef<number | null>(null);
  const ultimoTimbre = useRef(0);

  useEffect(() => {
    let vivo = true;
    const mirar = () => {
      fetch("/api/cobros/esperando", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: CobrosEsperando | null) => {
          if (!vivo || !d) return;
          const ahora = Date.now();
          const esperaMs = d.desde ? Math.max(0, ahora - new Date(d.desde).getTime()) : 0;
          const antes = ultimo.current;
          const llegoOtro = antes !== null && d.n > antes;
          const recordar = d.n > 0 && esperaMs < RECORDAR_HASTA_MS && ahora - ultimoTimbre.current >= RECORDAR_CADA_MS;
          if (llegoOtro || recordar) {
            sonarTimbre();
            ultimoTimbre.current = ahora;
          }
          // Cambió la cantidad: el inicio vuelve a pedir sus números (el del acceso «Cobrar pedidos»).
          if (antes !== null && d.n !== antes) router.refresh();
          ultimo.current = d.n;
          ponerNumeroEnIcono(d.n);
          setEstado({ ...d, minutos: Math.floor(esperaMs / 60_000) });
        })
        .catch(() => {});
    };
    const primera = setTimeout(mirar, 0);
    const t = setInterval(mirar, CADA_MS);
    return () => {
      vivo = false;
      clearTimeout(primera);
      clearInterval(t);
    };
  }, [router]);

  // En la pantalla de cobrar ya se ve la lista: la franja sobra.
  if (estado.n === 0 || pathname === "/cobros-efectivo") return null;
  return (
    <div className="bg-red-600 text-white print:hidden" role="alert">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] font-bold flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="relative flex w-3 h-3" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping motion-reduce:hidden" />
            <span className="relative inline-flex w-3 h-3 rounded-full bg-white" />
          </span>
          {estado.n === 1 ? "Hay un cliente esperando para pagar en efectivo" : `Hay ${estado.n} clientes esperando para pagar en efectivo`}
          {estado.numero !== null && (
            <span className="font-medium opacity-90">
              · pedido {formatearPedido(estado.numero)}
              {estado.minutos > 0 ? `, hace ${estado.minutos} min` : ""}
            </span>
          )}
        </p>
        <Link href="/cobros-efectivo" className="bg-white text-red-700 text-sm font-extrabold rounded-lg px-4 py-2 whitespace-nowrap hover:bg-red-50">
          Cobrar ahora →
        </Link>
      </div>
    </div>
  );
}
