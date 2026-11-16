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
          // Uno nuevo (número distinto del último que sonó): timbre.
          if (d.n > 0 && d.numero && d.numero !== ultimoVisto.current) {
            if (ultimoVisto.current !== null || ultimoN.current === null) sonarAlarma();
            ultimoVisto.current = d.numero;
          }
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

  // Sin cartel grande en el medio (Gonzalo, 16/11): timbre y una franja roja
  // con el número latiendo; en el Inicio, el acceso «Pedidos online» late igual.
  if (estado.n === 0 || enLaPantalla) return null;
  return (
    <div className="bg-red-600 text-white print:hidden" role="alert">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="flex flex-wrap items-center gap-x-2 text-[15px] font-bold">
          <span className="late-corazon relative grid h-8 min-w-8 place-items-center rounded-full px-1.5 text-base font-black tabular-nums ring-2 ring-white" aria-hidden="true">
            <span className="relative">{estado.n}</span>
          </span>
          🛍️ {estado.n === 1 ? `Llegó un pedido online${estado.numero ? ` · #${estado.numero}` : ""}${estado.de ? ` · ${estado.de}` : ""}` : `Hay ${estado.n} pedidos online sin atender`}
          {estado.n === 1 && estado.total > 0 && <span className="font-medium opacity-90">· {pesos(estado.total)}</span>}
        </p>
        <Link href="/pedidos-online" className="whitespace-nowrap rounded-lg bg-white px-4 py-2 text-sm font-extrabold text-red-700 hover:bg-red-50">
          Atender →
        </Link>
      </div>
    </div>
  );
}
