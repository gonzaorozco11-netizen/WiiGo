"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// El aviso del fin del turno, en cualquier pantalla (no solo Ficha Asistencia).
//
// La salida cuenta hasta que se va: si ficha 21:15, son hasta las 21:15
// (Gonzalo, 2026-11-12). Por eso el aviso llega ANTES, para que cierre la caja
// a tiempo y no haga horas de más:
//   - 15 minutos antes, en ámbar: «andá cerrando la caja»;
//   - pasada la hora, en rojo, con los minutos de más que lleva.
// Se actualiza solo cada 30 segundos: antes aparecía recién al cambiar de
// pantalla, y quien se quedaba en la caja no lo veía. No tiene botón de
// cerrar: sigue hasta que ficha la salida.

const AVISO_ANTES_MIN = 15;

function minutosAhora() {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24;
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export default function AvisoSalidaBanner({ horaSalida }: { horaSalida: string | null }) {
  const pathname = usePathname();
  const [ahora, setAhora] = useState<number | null>(null);
  // La hora sale del reloj del navegador (no del servidor) para que el aviso
  // aparezca solo, sin recargar. Arranca vacío y se llena apenas monta.
  useEffect(() => {
    const primera = setTimeout(() => setAhora(minutosAhora()), 0);
    const t = setInterval(() => setAhora(minutosAhora()), 30_000);
    return () => {
      clearTimeout(primera);
      clearInterval(t);
    };
  }, []);

  if (!horaSalida || ahora === null || pathname === "/ficha-asistencia") return null;
  const [h, m] = horaSalida.split(":").map(Number);
  const fin = h * 60 + m;
  const faltan = fin - ahora;
  if (faltan > AVISO_ANTES_MIN) return null;
  const pasado = faltan <= 0;

  return (
    <div className={`border-b print:hidden ${pasado ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <p className={`text-sm font-medium ${pasado ? "text-red-800" : "text-amber-800"}`}>
          {pasado ? (
            <>
              ⏰ Tu turno terminó a las {horaSalida}
              {-faltan > 0 && <> — llevás <b>{-faltan} min de más</b></>}. Cerrá la caja y fichá la salida.
            </>
          ) : (
            <>
              ⏰ Tu turno termina a las {horaSalida} (en {faltan} min). Andá cerrando la caja para irte a horario.
            </>
          )}
        </p>
        <Link
          href="/ficha-asistencia"
          className={`text-xs font-bold rounded-lg px-3 py-1.5 whitespace-nowrap border ${
            pasado ? "text-red-900 bg-red-100 border-red-300" : "text-amber-900 bg-amber-100 border-amber-300"
          }`}
        >
          Ir a fichar salida →
        </Link>
      </div>
    </div>
  );
}
