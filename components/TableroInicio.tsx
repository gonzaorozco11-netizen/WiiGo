import Link from "next/link";
import type { Tablero } from "@/lib/tablero";

// La pantalla de inicio: cómo viene el día.
//
// La lista de tareas ya no vive acá — se mudó entera a Mis Tareas, y de eso
// queda solo el resumen con el link. Tener la misma lista en dos pantallas
// termina siempre igual: alguien mira la que quedó vieja.

export default function TableroInicio({ tablero }: { tablero: Tablero }) {
  const { urgentes, seguimiento, kpis } = tablero;

  // La lista de tareas se mudó a Mis Tareas. Acá queda solo el resumen con
  // el link: tener la misma lista en dos pantallas garantiza que una de las
  // dos quede vieja en la cabeza de la gente.
  const pendientes = urgentes.length + seguimiento.length;
  const rojas = urgentes.filter((u) => u.color === "rojo").length;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white border border-neutral-200 rounded-xl p-5 mb-4">
        <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">{tablero.fecha}</p>
        <h1 className="text-xl font-semibold text-neutral-900 mt-1">Buen día, {tablero.nombre}</h1>
        <p className="text-sm text-neutral-500 mt-0.5">Así viene el día.</p>
      </div>

      <Link
        href="/mis-tareas"
        className={`flex items-center gap-3 border border-l-[3px] rounded-xl px-4 py-3.5 mb-5 ${
          rojas > 0
            ? "border-red-200 border-l-red-500 bg-red-50"
            : pendientes > 0
              ? "border-neutral-200 border-l-accent bg-white"
              : "border-emerald-200 border-l-emerald-500 bg-emerald-50"
        }`}
      >
        <span className="text-lg shrink-0" aria-hidden="true">
          {pendientes > 0 ? "✅" : "✓"}
        </span>
        <span className="flex-1 min-w-0">
          <span
            className={`block text-sm font-semibold ${
              rojas > 0 ? "text-red-800" : pendientes > 0 ? "text-neutral-900" : "text-emerald-800"
            }`}
          >
            {pendientes === 0
              ? "No tenés nada pendiente"
              : `${pendientes} ${pendientes === 1 ? "cosa esperándote" : "cosas esperándote"}`}
          </span>
          <span className={`block text-xs ${rojas > 0 ? "text-red-700" : "text-neutral-500"}`}>
            {rojas > 0
              ? `${rojas} ${rojas === 1 ? "necesita" : "necesitan"} atención ahora`
              : pendientes > 0
                ? "Nada urgente"
                : "Todo al día"}
          </span>
        </span>
        {pendientes > 0 && (
          <>
            <span
              className={`tipo-titulo text-2xl font-bold tabular-nums shrink-0 ${
                rojas > 0 ? "text-red-700" : "text-neutral-900"
              }`}
            >
              {pendientes}
            </span>
            <span
              className={`text-xs font-bold text-white rounded-lg px-2.5 py-1.5 shrink-0 ${
                rojas > 0 ? "bg-red-600" : "bg-accent"
              }`}
            >
              Ver
            </span>
          </>
        )}
      </Link>

      {kpis.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">Números</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {kpis.map((k) => (
              <div key={k.etiqueta} className="bg-white border border-neutral-200 rounded-xl p-3.5">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">{k.etiqueta}</p>
                <p
                  className={`text-xl font-bold mt-0.5 tabular-nums ${
                    k.tono === "rojo" ? "text-red-600" : k.tono === "verde" ? "text-emerald-700" : "text-neutral-900"
                  }`}
                >
                  {k.valor}
                </p>
                <p className="text-[11.5px] text-neutral-400">{k.pie}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

