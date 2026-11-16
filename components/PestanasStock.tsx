import Link from "next/link";

/**
 * «Stock y precios» (Gonzalo, 2026-11-16): arriba de la consulta de la góndola y
 * de Fraccionar, para pasar de una a la otra sin volver al menú. «A granel» es
 * lo que hay en el depósito para fraccionar; «Historial», quién fraccionó qué.
 */
export default function PestanasStock({ actual, conHistorial = true }: { actual: "gondola" | "granel" | "historial"; conHistorial?: boolean }) {
  const pestañas = [
    ["gondola", "/stock/consulta", "En góndola"],
    ["granel", "/fraccionar", "A granel"],
    ...(conHistorial ? [["historial", "/fraccionar/historial", "Historial"]] : []),
  ] as [string, string, string][];
  return (
    <div className="print:hidden mb-4">
      <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1.5">📦 Stock y precios</p>
      <div className="inline-flex gap-1 rounded-xl border border-neutral-200 bg-white p-1">
        {pestañas.map(([id, href, texto]) => (
          <Link
            key={id}
            href={href}
            aria-current={actual === id ? "page" : undefined}
            className={`px-4 py-2.5 text-[15px] rounded-lg ${actual === id ? "bg-neutral-900 text-white font-semibold" : "text-neutral-600 hover:bg-neutral-50"}`}
          >
            {texto}
          </Link>
        ))}
      </div>
    </div>
  );
}
