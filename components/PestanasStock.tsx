import Link from "next/link";

/**
 * «Stock y precios» (Gonzalo, 2026-11-16): arriba de la consulta de la góndola y
 * de Fraccionar, para pasar de una a la otra sin volver al menú.
 *
 * 20/11 (Gonzalo: «un botón de stock de góndola y otro de depósito»): se llaman
 * «Góndola» (lo que está a la venta) y «Depósito» (el granel en kilos, que se
 * embolsa en Fraccionar). También van arriba de Stock (/stock), y ahí «Góndola»
 * es esa misma pantalla: `gondola` dice a cuál lleva.
 */
export default function PestanasStock({
  actual,
  conHistorial = true,
  gondola = "/stock/consulta",
}: {
  actual: "gondola" | "granel" | "historial";
  conHistorial?: boolean;
  gondola?: string;
}) {
  const pestañas = [
    ["gondola", gondola, "🛒 Góndola"],
    ["granel", "/fraccionar", "📦 Depósito"],
    ...(conHistorial ? [["historial", "/fraccionar/historial", "Historial"]] : []),
  ] as [string, string, string][];
  return (
    <div className="print:hidden mb-4">
      <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Stock y precios</p>
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
