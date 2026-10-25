"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Tablero, ItemTablero } from "@/lib/tablero";
import type { TareaVista } from "@/lib/tareasEquipo";
import { marcarTareaHecha } from "@/app/(app)/mis-tareas/actions";

// Mis Tareas: lo que cada uno tiene que hacer hoy.
//
// Dos clases de tareas:
//   - Las de Administración WiiGo (arriba): las aprobó el Dueño desde la
//     Junta. Se marcan como hechas a mano, porque el sistema no tiene forma de
//     saber si se limpiaron los vidrios.
//   - Los avisos del sistema: el motor es el mismo que arma el Inicio
//     (lib/tablero.ts). Nadie los marca: desaparecen cuando el problema se
//     resuelve de verdad. Una lista de avisos que hay que ir tachando a mano
//     siempre termina mintiendo.

const ICONO: Record<string, string> = {
  "/ficha-asistencia": "🕘",
  "/aprobaciones": "📋",
  "/ventas": "🧾",
  "/compras/recepcion": "📥",
  "/compras/costeo": "🧮",
  "/stock": "📦",
  "/turnos": "💵",
  "/rrhh/legajos": "📝",
  "/aprender/revisar": "🧠",
};

export default function MisTareasApp({ tablero, asignadas = [] }: { tablero: Tablero; asignadas?: TareaVista[] }) {
  // Tres baldes por urgencia. Salen del color que ya trae cada tarea, así que
  // agregar una tarea nueva en tablero.ts la ubica sola.
  const ahora = tablero.urgentes.filter((t) => t.color === "rojo");
  const esperan = tablero.urgentes.filter((t) => t.color === "ambar");
  const cuandoPuedas = [
    ...tablero.urgentes.filter((t) => t.color === "azul"),
    ...tablero.seguimiento,
  ];
  const pendientesAsignadas = asignadas.filter((t) => t.situacion !== "HECHA").length;
  const total = ahora.length + esperan.length + cuandoPuedas.length + pendientesAsignadas;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Sin saludo: el "buen día" es de Inicio, que es la pantalla a la que
          uno llega. Acá ya estás adentro y venís a trabajar. */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-neutral-900">Mis tareas</h1>
        <p className="text-sm text-neutral-500">
          {total === 0
            ? "No tenés nada pendiente"
            : `${total} ${total === 1 ? "cosa esperándote" : "cosas esperándote"}`}
        </p>
      </div>

      {asignadas.length > 0 && <TareasAdministracion tareas={asignadas} />}

      {total === 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-8 text-center">
          <p className="text-base font-semibold">✓ No tenés nada pendiente. Todo al día.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <Seccion titulo="Ahora" emoji="🔴" tono="rojo" tareas={ahora} />
          <Seccion titulo="Esperan tu respuesta" emoji="🟠" tono="ambar" tareas={esperan} />
          <Seccion titulo="Cuando puedas" emoji="🔵" tono="azul" tareas={cuandoPuedas} />
        </div>
      )}

      {/* Aprobaciones ya no está en el menú: se llega desde acá. El link va
          siempre, aunque no haya nada esperando — si no, cuando la bandeja
          queda vacía no habría forma de entrar a mirar el historial. */}
      <div className="mt-7 border-t border-neutral-200 pt-4 flex flex-wrap gap-x-5 gap-y-2">
        <Link href="/aprobaciones" className="text-sm font-semibold text-accent hover:underline">
          Ver todas las aprobaciones →
        </Link>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          Ir al Inicio
        </Link>
      </div>
    </div>
  );
}

/** Las tareas que asignó Administración WiiGo: se tildan cuando se hacen. */
function TareasAdministracion({ tareas }: { tareas: TareaVista[] }) {
  const router = useRouter();
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function tildar(t: TareaVista) {
    setError(null);
    setEnCurso(t.id);
    const r = await marcarTareaHecha(t.id, t.situacion !== "HECHA");
    setEnCurso(null);
    if (r.error) setError(r.error);
    else startTransition(() => router.refresh());
  }

  return (
    <div className="mb-6">
      <p className="text-xs font-bold uppercase tracking-wider mb-2.5 text-neutral-700">
        De parte de Administración WiiGo
        <span className="ml-2 text-[10px] font-bold bg-neutral-200 text-neutral-700 rounded-full px-1.5 py-0.5">
          {tareas.filter((t) => t.situacion !== "HECHA").length}
        </span>
      </p>
      <div className="flex flex-col gap-2">
        {tareas.map((t) => {
          const hecha = t.situacion === "HECHA";
          const vencida = t.situacion === "VENCIDA";
          return (
            <div
              key={t.id}
              className={`flex items-start gap-3 border border-l-[3px] rounded-xl px-4 py-3 ${
                hecha ? "border-neutral-200 border-l-emerald-500 bg-white" : vencida ? "border-red-200 border-l-red-500 bg-red-50" : "border-neutral-200 border-l-[#3d5a3a] bg-white"
              }`}
            >
              <button
                type="button"
                onClick={() => tildar(t)}
                disabled={enCurso === t.id}
                aria-label={hecha ? `Desmarcar: ${t.titulo}` : `Marcar como hecha: ${t.titulo}`}
                className={`mt-0.5 w-6 h-6 shrink-0 rounded-md border-2 grid place-items-center text-sm font-bold ${
                  hecha ? "bg-emerald-600 border-emerald-600 text-white" : "border-[#3d5a3a] bg-white text-transparent"
                } disabled:opacity-50`}
              >
                ✓
              </button>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-semibold ${hecha ? "line-through text-neutral-400" : vencida ? "text-red-800" : "text-neutral-900"}`}>{t.titulo}</span>
                <span className={`block text-xs ${vencida ? "text-red-700" : "text-neutral-500"}`}>
                  {hecha && t.hecha ? `Hecha por ${t.hecha.nombre} · ${t.hecha.hora}` : `${t.cuando}${vencida ? " · se pasó la fecha" : ""} · ${t.para}`}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      {error && (
        <p className="text-sm text-red-600 mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Seccion({
  titulo,
  emoji,
  tono,
  tareas,
}: {
  titulo: string;
  emoji: string;
  tono: "rojo" | "ambar" | "azul";
  tareas: ItemTablero[];
}) {
  if (tareas.length === 0) return null;
  const colorTitulo =
    tono === "rojo" ? "text-red-700" : tono === "ambar" ? "text-amber-700" : "text-accent";
  return (
    <div>
      <p className={`text-xs font-bold uppercase tracking-wider mb-2.5 ${colorTitulo}`}>
        {emoji} {titulo}
        <span className="ml-2 text-[10px] font-bold bg-neutral-200 text-neutral-700 rounded-full px-1.5 py-0.5">
          {tareas.length}
        </span>
      </p>
      <div className="flex flex-col gap-2">
        {tareas.map((t, i) => (
          <Tarea key={`${t.href}-${i}`} t={t} />
        ))}
      </div>
    </div>
  );
}

function Tarea({ t }: { t: ItemTablero }) {
  const estilo =
    t.color === "rojo"
      ? "border-red-200 border-l-red-500 bg-red-50"
      : t.color === "ambar"
        ? "border-amber-200 border-l-amber-500 bg-amber-50"
        : "border-neutral-200 border-l-accent bg-white";
  const texto = t.color === "rojo" ? "text-red-800" : t.color === "ambar" ? "text-amber-900" : "text-neutral-900";
  const suave = t.color === "rojo" ? "text-red-700" : t.color === "ambar" ? "text-amber-700" : "text-neutral-500";
  const boton =
    t.color === "rojo"
      ? "bg-red-600 hover:bg-red-700"
      : t.color === "ambar"
        ? "bg-amber-600 hover:bg-amber-700"
        : "bg-accent hover:bg-accent-dark";

  return (
    <Link
      href={t.href}
      className={`flex items-center gap-3 border border-l-[3px] rounded-xl px-4 py-3 ${estilo} hover:brightness-[0.985]`}
    >
      <span className="text-lg shrink-0" aria-hidden="true">
        {ICONO[t.href] ?? "•"}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm font-semibold ${texto}`}>{t.titulo}</span>
        {/* El detalle explica POR QUÉ importa, no qué es. Un número sin
            consecuencia no mueve a nadie. */}
        <span className={`block text-xs ${suave}`}>{t.detalle}</span>
      </span>
      <span className={`tipo-titulo text-xl font-bold tabular-nums shrink-0 ${texto}`}>{t.valor}</span>
      <span className={`text-xs font-bold text-white rounded-lg px-2.5 py-1.5 shrink-0 ${boton}`}>Ir</span>
    </Link>
  );
}
