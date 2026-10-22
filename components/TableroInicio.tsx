import Link from "next/link";
import type { Tablero } from "@/lib/tablero";
import InicioDueno from "@/components/InicioDueno";

// La pantalla de inicio: cómo viene el día.
//
// La lista de tareas ya no vive acá — se mudó entera a Mis Tareas, y de eso
// queda solo el resumen con el link. Tener la misma lista en dos pantallas
// termina siempre igual: alguien mira la que quedó vieja.

export default function TableroInicio({ tablero }: { tablero: Tablero }) {
  const { urgentes, seguimiento, kpis } = tablero;
  if (tablero.operativo) return <InicioLocal tablero={tablero} />;

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
        <p className="text-sm text-neutral-500 mt-0.5">{tablero.dueno ? "Así viene el día y el mes." : "Así viene el día."}</p>
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

      {tablero.dueno ? (
        <InicioDueno datos={tablero.dueno} turno={kpis.find((k) => k.etiqueta === "Turno de caja")} />
      ) : tablero.errorDueno ? (
        <p className="text-sm text-red-600 bg-white border border-red-200 rounded-xl p-4">
          No se pudieron calcular las ventas del inicio: {tablero.errorDueno}
        </p>
      ) : null}

      {!tablero.dueno && kpis.length > 0 && (
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

// ---------- El inicio del equipo en el local ----------
//
// Arriba el botón grande con lo que toca hacer ahora (cambia solo según el
// momento: fichar, abrir caja, vender, cerrar y salir), abajo los accesos de
// todos los días con un número cuando hay algo pendiente, las tareas de hoy
// y cuántas ventas hubo (sin montos). Ver lib/inicioOperativo.ts.

const TONO_PRINCIPAL = {
  verde: "bg-emerald-600 hover:bg-emerald-700",
  azul: "bg-accent hover:bg-accent-dark",
  naranja: "bg-amber-600 hover:bg-amber-700",
} as const;

function InicioLocal({ tablero }: { tablero: Tablero }) {
  const o = tablero.operativo!;
  // Fichar ya está en el botón grande: no se repite en la lista.
  const tareas = [...tablero.urgentes, ...tablero.seguimiento].filter((t) => t.href !== "/ficha-asistencia");
  return (
    <div className="max-w-4xl mx-auto space-y-3">
      <div className="bg-white border border-neutral-200 rounded-xl px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">{tablero.fecha}</p>
          <h1 className="text-xl font-semibold text-neutral-900 mt-0.5">Buen día, {tablero.nombre.split(" ")[0]}</h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {o.estado.map((e) => (
            <span
              key={e.texto}
              className={`text-xs font-semibold rounded-full px-2.5 py-1 ${e.tono === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
            >
              {e.texto}
            </span>
          ))}
        </div>
      </div>

      <Link href={o.principal.href} className={`flex items-center gap-4 rounded-2xl px-5 py-5 text-white shadow-sm ${TONO_PRINCIPAL[o.principal.tono]}`}>
        <span className="text-4xl" aria-hidden="true">
          {o.principal.icono}
        </span>
        <span className="min-w-0">
          <span className="block text-xl font-bold">{o.principal.titulo}</span>
          <span className="block text-sm opacity-90">{o.principal.detalle}</span>
        </span>
        <span className="ml-auto text-2xl" aria-hidden="true">
          →
        </span>
      </Link>

      {o.accesos.length > 0 && (
        <div className={`grid grid-cols-2 gap-2.5 ${o.accesos.length > 6 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
          {o.accesos.map((a) => {
            const contenido = (
              <>
                {a.badge !== null && (
                  <span
                    className={`absolute top-2.5 right-2.5 text-[11px] font-extrabold rounded-full px-2 py-0.5 ${
                      a.badgeTono === "rojo" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {a.badge}
                  </span>
                )}
                <span className="text-2xl" aria-hidden="true">
                  {a.icono}
                </span>
                <span className="block text-[15px] font-semibold text-neutral-900 mt-1">{a.titulo}</span>
                <span className="block text-xs text-neutral-500 leading-snug">{a.deshabilitado ? "Primero abrí la caja" : a.detalle}</span>
              </>
            );
            const clase = "relative bg-white border border-neutral-200 rounded-xl p-3.5 min-h-[104px] block";
            return a.deshabilitado ? (
              <div key={a.clave} className={`${clase} opacity-45 cursor-not-allowed`} aria-disabled="true">
                {contenido}
              </div>
            ) : (
              <Link key={a.clave} href={a.href} className={`${clase} hover:border-accent hover:shadow-sm`}>
                {contenido}
              </Link>
            );
          })}
        </div>
      )}

      {tareas.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">Para hacer hoy</p>
          {tareas.slice(0, 4).map((t) => (
            <Link
              key={t.titulo}
              href={t.href}
              className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm ${
                t.color === "rojo" ? "bg-red-50 text-red-800" : t.color === "ambar" ? "bg-amber-50 text-amber-800" : "bg-white border border-neutral-200 text-neutral-800"
              }`}
            >
              <span className="font-semibold">{t.titulo}</span>
              <span className="hidden sm:inline text-xs opacity-80 truncate">{t.detalle}</span>
              <span className="ml-auto font-bold tabular-nums">{t.valor}</span>
            </Link>
          ))}
          {tareas.length > 4 && (
            <Link href="/mis-tareas" className="block text-xs font-semibold text-accent px-1">
              Ver las {tareas.length} en Mis Tareas →
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-white border border-neutral-200 rounded-xl p-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">Ventas de hoy</p>
          <p className="text-xl font-bold tabular-nums text-neutral-900">{o.ventasHoy}</p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl p-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">Productos vendidos</p>
          <p className="text-xl font-bold tabular-nums text-neutral-900">{o.productosHoy}</p>
        </div>
      </div>
    </div>
  );
}

