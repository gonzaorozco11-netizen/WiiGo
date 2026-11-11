import Link from "next/link";

/**
 * Arriba de Códigos y de Carteles: las dos son «Etiquetas» y se pasa de una a
 * la otra sin volver al menú (Gonzalo, 2026-11-11).
 */
export default function PestanasEtiquetas({ actual }: { actual: "codigos" | "carteles" }) {
  return (
    <div className="print:hidden inline-flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 mb-4">
      {(
        [
          ["codigos", "/codigos", "Códigos de barras"],
          ["carteles", "/carteles", "Carteles de góndola"],
        ] as const
      ).map(([id, href, texto]) => (
        <Link
          key={id}
          href={href}
          aria-current={actual === id ? "page" : undefined}
          className={`px-4 py-2 text-sm rounded-lg ${actual === id ? "bg-neutral-900 text-white font-semibold" : "text-neutral-600 hover:bg-neutral-50"}`}
        >
          {texto}
        </Link>
      ))}
    </div>
  );
}
