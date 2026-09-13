import Link from "next/link";

// La barra de las tres etapas, arriba de las tres pantallas de Compras.
//
// Va en todas y no solo en el menú: al terminar de recepcionar, lo natural es
// pasar a costear. Tener el recorrido a la vista evita volver al menú para
// dar el paso siguiente, y de paso muestra cuánto falta en cada etapa.

export type EtapaCompras = "ORDENES" | "RECEPCION" | "COSTEO";

const ETAPAS: { clave: EtapaCompras; href: string; ico: string; nombre: string; quien: string }[] = [
  { clave: "ORDENES", href: "/compras", ico: "🛒", nombre: "Órdenes de compra", quien: "Administración" },
  { clave: "RECEPCION", href: "/compras/recepcion", ico: "📥", nombre: "Recepción", quien: "Local" },
  { clave: "COSTEO", href: "/compras/costeo", ico: "🧮", nombre: "Costeo", quien: "Administración" },
];

export default function ComprasEtapas({
  actual,
  contadores,
  puedeVer,
}: {
  actual: EtapaCompras;
  contadores: { ordenesAbiertas: number; esperandoRecepcion: number; sinCostear: number; sinCostearVencidos: number };
  /** Qué etapas puede ver esta persona: las demás no se muestran. */
  puedeVer: (clave: EtapaCompras) => boolean;
}) {
  function contador(clave: EtapaCompras) {
    if (clave === "ORDENES") return { n: contadores.ordenesAbiertas, alerta: false };
    if (clave === "RECEPCION") return { n: contadores.esperandoRecepcion, alerta: false };
    return { n: contadores.sinCostear, alerta: contadores.sinCostearVencidos > 0 };
  }

  const visibles = ETAPAS.filter((e) => puedeVer(e.clave));
  // Con una sola etapa habilitada el recorrido no informa nada: esa persona
  // hace un solo paso y ya está parada en él.
  if (visibles.length < 2) return null;

  return (
    <div className="grid gap-2.5 sm:grid-cols-3 mb-5">
      {visibles.map((e) => {
        const esActual = e.clave === actual;
        const { n, alerta } = contador(e.clave);
        return (
          <Link
            key={e.clave}
            href={e.href}
            className={`border rounded-xl px-4 py-3 ${
              esActual
                ? "border-accent bg-accent-tint shadow-[inset_0_0_0_1px_var(--accent)]"
                : "border-neutral-200 bg-white hover:border-neutral-300"
            }`}
          >
            <span className="text-lg">{e.ico}</span>
            <span className="block font-semibold text-[14.5px] text-neutral-900 mt-0.5">{e.nombre}</span>
            <span className="block text-[11.5px] text-neutral-400">{e.quien}</span>
            {n > 0 && (
              <span
                className={`inline-block text-[11px] font-bold rounded-full px-2 py-0.5 mt-2 ${
                  alerta ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                }`}
              >
                {n} {e.clave === "COSTEO" ? "sin costear" : e.clave === "RECEPCION" ? "esperando" : "sin enviar"}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
