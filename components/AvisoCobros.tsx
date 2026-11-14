"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { sonarTimbre } from "@/lib/timbre";
import type { CobroEsperando, CobrosEsperando } from "@/lib/cobrosEsperando";

// La alarma de «hay un cliente esperando para pagar» (Gonzalo, 2026-11-12):
// cuando alguien elige pagar en efectivo en el tótem, al equipo que está
// trabajando le SALTA un cartel grande en el medio de la pantalla, esté en la
// pantalla que esté, con timbre (y vibración donde se puede). Nadie tiene que
// recargar nada: mira sola cada 5 segundos.
//
//   - «Cobrar ahora» lleva a Cobros en efectivo.
//   - «Ya voy» cierra el cartel y queda una franja roja arriba hasta que se cobra.
//   - Mientras el cartel está abierto, el timbre se repite cada 15 segundos
//     durante los primeros 5 minutos.
//   - El número sale también en «Cobrar pedidos» del inicio, en el ícono de la
//     app (donde el aparato lo permite) y en la pestaña de la compu.

// Cada 10 s (era 5 s): esta pantalla queda abierta todo el día en la tablet y
// cada pregunta cuenta para el tope del plan de Vercel (pausado el 2026-11-14).
const CADA_MS = 10_000;
const REPETIR_CADA_MS = 15_000;
const REPETIR_HASTA_MS = 5 * 60_000;

type Navegador = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

function ponerNumeroEnIcono(n: number) {
  try {
    const nav = navigator as Navegador;
    if (n > 0) nav.setAppBadge?.(n)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    // Aparato sin número en el ícono: queda el cartel.
  }
  const base = document.title.replace(/^\(\d+\)\s*/, "");
  document.title = n > 0 ? `(${n}) ${base}` : base;
}

/** Tres timbres seguidos y una vibración: que se note desde el otro lado del local. */
function sonarAlarma() {
  [0, 650, 1300].forEach((ms) => setTimeout(sonarTimbre, ms));
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {
    // Sin vibración.
  }
}

const formatearPedido = (numero: number) => `VTA-${String(numero).padStart(4, "0")}`;
const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export default function AvisoCobros() {
  const router = useRouter();
  const pathname = usePathname();
  const [estado, setEstado] = useState<{ n: number; numero: number | null; minutos: number }>({ n: 0, numero: null, minutos: 0 });
  // El pedido del cartel grande (el último que llegó y nadie atendió todavía).
  const [cartel, setCartel] = useState<CobroEsperando | null>(null);
  const cartelRef = useRef<CobroEsperando | null>(null);
  const vistos = useRef(new Set<number>());
  const ultimoN = useRef<number | null>(null);
  const ultimoTimbre = useRef(0);
  const enCobros = useRef(false);

  useEffect(() => {
    enCobros.current = pathname === "/cobros-efectivo";
    // Si entró a Cobros, lo que había ya lo está viendo.
    if (enCobros.current && cartelRef.current) {
      cartelRef.current = null;
      setTimeout(() => setCartel(null), 0);
    }
  }, [pathname]);

  useEffect(() => {
    let vivo = true;
    const mirar = () => {
      fetch("/api/cobros/esperando", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: CobrosEsperando | null) => {
          if (!vivo || !d) return;
          const ahora = Date.now();
          const pedidos = d.pedidos ?? [];
          const nuevos = pedidos.filter((p) => !vistos.current.has(p.numero));
          let abierto = cartelRef.current;
          // El del cartel ya se cobró o se canceló: se cierra solo.
          if (abierto && !pedidos.some((p) => p.numero === abierto!.numero)) abierto = null;

          if (enCobros.current) {
            // En Cobros la lista ya está a la vista: solo suena si llega otro.
            if (nuevos.length > 0) sonarAlarma();
            nuevos.forEach((p) => vistos.current.add(p.numero));
            abierto = null;
          } else if (nuevos.length > 0) {
            const ultimo = nuevos[nuevos.length - 1];
            if (!abierto || abierto.numero !== ultimo.numero) {
              sonarAlarma();
              ultimoTimbre.current = ahora;
            }
            abierto = ultimo;
          }

          // Cartel abierto sin atender: el timbre se repite un rato.
          if (abierto) {
            const espera = ahora - new Date(abierto.desde).getTime();
            if (espera < REPETIR_HASTA_MS && ahora - ultimoTimbre.current >= REPETIR_CADA_MS) {
              sonarAlarma();
              ultimoTimbre.current = ahora;
            }
          }

          cartelRef.current = abierto;
          setCartel(abierto);
          // Cambió la cantidad: el inicio vuelve a pedir sus números («Cobrar pedidos»).
          if (ultimoN.current !== null && d.n !== ultimoN.current) router.refresh();
          ultimoN.current = d.n;
          ponerNumeroEnIcono(d.n);
          const espera = d.desde ? Math.max(0, ahora - new Date(d.desde).getTime()) : 0;
          setEstado({ n: d.n, numero: d.numero, minutos: Math.floor(espera / 60_000) });
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

  function atender() {
    if (cartelRef.current) vistos.current.add(cartelRef.current.numero);
    cartelRef.current = null;
    setCartel(null);
  }

  if (pathname === "/cobros-efectivo") return null;

  return (
    <>
      {cartel && (
        <div className="fixed inset-0 z-[70] bg-black/55 grid place-items-center p-4 print:hidden" role="alertdialog" aria-modal="true" aria-labelledby="aviso-cobro-titulo">
          <div className="w-full max-w-md rounded-3xl bg-red-600 text-white text-center shadow-2xl px-6 py-8">
            <div className="text-6xl animate-bounce motion-reduce:animate-none" aria-hidden="true">
              🔔
            </div>
            <p id="aviso-cobro-titulo" className="text-2xl font-extrabold mt-3 leading-tight">
              Un cliente está esperando para pagar en efectivo
            </p>
            <p className="text-lg mt-2 opacity-95">
              Pedido {formatearPedido(cartel.numero)} · <b className="tabular-nums">{pesos(cartel.total)}</b>
            </p>
            {estado.n > 1 && <p className="text-sm mt-1 opacity-90">Hay {estado.n} pedidos esperando en total.</p>}
            <Link
              href="/cobros-efectivo"
              onClick={atender}
              className="mt-6 block w-full rounded-2xl bg-white text-red-700 text-xl font-extrabold py-4 hover:bg-red-50"
            >
              Cobrar ahora →
            </Link>
            <button type="button" onClick={atender} className="mt-3 text-sm font-semibold text-white/90 underline underline-offset-4">
              Ya voy
            </button>
          </div>
        </div>
      )}
      {!cartel && estado.n > 0 && (
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
      )}
    </>
  );
}
