import Link from "next/link";
import type { Tablero } from "@/lib/tablero";

// La pantalla de inicio. Tres secciones y nada más: lo que hay que resolver
// hoy, lo que hay que mirar de reojo, y cuatro números. El sistema recién
// arranca — es mejor que diga poco y verdadero.

const BORDE = {
  rojo: "border-l-red-500 bg-red-50",
  ambar: "border-l-amber-500 bg-amber-50",
  azul: "border-l-accent bg-white",
} as const;

const VALOR = {
  rojo: "text-red-600",
  ambar: "text-amber-700",
  azul: "text-neutral-900",
} as const;

export default function TableroInicio({ tablero }: { tablero: Tablero }) {
  const { urgentes, seguimiento, kpis } = tablero;

  const resumen =
    urgentes.length === 0
      ? seguimiento.length > 0
        ? `No hay nada urgente. ${seguimiento.length} ${seguimiento.length === 1 ? "cosa" : "cosas"} en seguimiento.`
        : "No tenés nada pendiente."
      : `${urgentes.length} ${urgentes.length === 1 ? "cosa para resolver" : "cosas para resolver"} hoy.` +
        (seguimiento.length > 0 ? ` ${seguimiento.length} en seguimiento.` : "");

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white border border-neutral-200 rounded-xl p-5 mb-4">
        <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">{tablero.fecha}</p>
        <h1 className="text-xl font-semibold text-neutral-900 mt-1">Buen día, {tablero.nombre}</h1>
        <p className="text-sm text-neutral-500 mt-0.5">{resumen}</p>
      </div>

      <Seccion titulo="🔥 Resolver hoy" items={urgentes} vacio="Nada urgente. Buen día." />
      <Seccion titulo="👁 En seguimiento" items={seguimiento} />

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

function Seccion({
  titulo,
  items,
  vacio,
}: {
  titulo: string;
  items: Tablero["urgentes"];
  vacio?: string;
}) {
  // Sin nada que mostrar y sin mensaje de vacío, la sección entera no va: una
  // sección vacía es ruido que hay que saltear todos los días.
  if (items.length === 0 && !vacio) return null;

  return (
    <div className="mb-5">
      <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">{titulo}</p>
      {items.length === 0 ? (
        <p className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-3.5 text-sm font-medium">
          ✓ {vacio}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((i) => (
            <Link
              key={`${i.titulo}-${i.href}`}
              href={i.href}
              className={`flex items-center gap-3 flex-wrap border border-neutral-200 border-l-[3px] rounded-xl px-4 py-3 hover:border-neutral-300 ${BORDE[i.color]}`}
            >
              <span className="flex-1 min-w-[200px]">
                <span className="block font-semibold text-[14.5px] text-neutral-900">{i.titulo}</span>
                <span className="block text-xs text-neutral-500 mt-0.5">{i.detalle}</span>
              </span>
              <span className={`text-lg font-bold tabular-nums whitespace-nowrap ${VALOR[i.color]}`}>{i.valor}</span>
              <span className="text-neutral-400">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
