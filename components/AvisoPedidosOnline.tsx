"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { sonarTimbre } from "@/lib/timbre";

// Llegó un pedido de la tienda online (Gonzalo, 2026-11-16): al equipo que
// está trabajando le salta un cartel rojo con timbre, esté en la pantalla que
// esté, igual que el de los cobros del tótem (AvisoCobros).
//
// Mira cada 30 segundos y no menos: esta pantalla queda abierta todo el día
// en la tablet y cada pregunta cuenta para el tope del plan de Vercel.
// Cuando cambia la cantidad, la pantalla Pedidos online se recarga sola.

const CADA_MS = 30_000;

type Estado = { n: number; numero: number | null; total: number; de: string | null };

function sonarAlarma() {
  [0, 650, 1300].forEach((ms) => setTimeout(sonarTimbre, ms));
  try {
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    // Sin vibración.
  }
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export default function AvisoPedidosOnline() {
  const router = useRouter();
  const pathname = usePathname();
  const [estado, setEstado] = useState<Estado>({ n: 0, numero: null, total: 0, de: null });
  const [cartel, setCartel] = useState(false);
  const ultimoVisto = useRef<number | null>(null);
  const ultimoN = useRef<number | null>(null);
  const enLaPantalla = pathname === "/pedidos-online";

  useEffect(() => {
    let vivo = true;
    const mirar = () => {
      fetch("/api/pedidos-online/nuevos", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Estado | null) => {
          if (!vivo || !d) return;
          // Uno nuevo (número más alto que el último que sonó): timbre y cartel.
          if (d.n > 0 && d.numero && d.numero !== ultimoVisto.current) {
            if (ultimoVisto.current !== null || ultimoN.current === null) sonarAlarma();
            ultimoVisto.current = d.numero;
            setCartel(true);
          }
          if (d.n === 0) setCartel(false);
          if (ultimoN.current !== null && d.n !== ultimoN.current) router.refresh();
          ultimoN.current = d.n;
          setEstado(d);
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

  if (estado.n === 0) return null;

  // En la misma pantalla de pedidos no hace falta el cartel: ya está la franja roja de ahí.
  if (cartel && !enLaPantalla) {
    return (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4 print:hidden" role="alertdialog" aria-modal="true" aria-labelledby="aviso-online-titulo">
        <div className="w-full max-w-md rounded-3xl bg-red-600 px-6 py-8 text-center text-white shadow-2xl">
          <div className="text-6xl animate-bounce motion-reduce:animate-none" aria-hidden="true">
            🛒
          </div>
          <p id="aviso-online-titulo" className="mt-3 text-2xl font-extrabold leading-tight">
            Llegó un pedido online
          </p>
          <p className="mt-2 text-lg opacity-95">
            #{estado.numero}
            {estado.de ? ` · ${estado.de}` : ""} · <b className="tabular-nums">{pesos(estado.total)}</b>
          </p>
          {estado.n > 1 && <p className="mt-1 text-sm opacity-90">Hay {estado.n} pedidos online sin atender.</p>}
          <Link href="/pedidos-online" onClick={() => setCartel(false)} className="mt-6 block w-full rounded-2xl bg-white py-4 text-xl font-extrabold text-red-700 hover:bg-red-50">
            Ver el pedido →
          </Link>
          <button type="button" onClick={() => setCartel(false)} className="mt-3 text-sm font-semibold text-white/90 underline underline-offset-4">
            Ya voy
          </button>
        </div>
      </div>
    );
  }
  if (enLaPantalla) return null;
  return (
    <div className="bg-red-600 text-white print:hidden" role="alert">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-[15px] font-bold">
          🛒 {estado.n === 1 ? "Hay un pedido online sin atender" : `Hay ${estado.n} pedidos online sin atender`}
        </p>
        <Link href="/pedidos-online" className="whitespace-nowrap rounded-lg bg-white px-4 py-2 text-sm font-extrabold text-red-700 hover:bg-red-50">
          Atender →
        </Link>
      </div>
    </div>
  );
}
