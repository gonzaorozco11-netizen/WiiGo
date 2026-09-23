import Link from "next/link";
import { entradasQueNecesitanCodigo } from "@/lib/entradas";

/**
 * El recordatorio de imprimir los códigos de lo que acaba de entrar.
 *
 * Va arriba de la pantalla de Recepción porque ese es el momento: la operativa
 * termina de contar las cajas y lo siguiente que tiene que hacer es imprimir
 * los stickers de lo que no trae código —los frutos secos, sobre todo— y
 * pegarlos antes de que la mercadería vaya a la góndola. Sin esto tendría que
 * acordarse sola, ir a otra pantalla y tipear las cantidades de memoria, que es
 * justo donde se equivoca.
 *
 * Si no hay nada pendiente no se muestra nada: un cartel que está siempre deja
 * de leerse.
 */
export default async function AvisoCodigosPendientes() {
  const entradas = await entradasQueNecesitanCodigo();
  if (entradas.length === 0) return null;

  const unidades = entradas.reduce((acc, e) => acc + e.cantidad, 0);

  return (
    <Link
      href="/codigos"
      className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-4 hover:bg-amber-100 transition-colors"
    >
      <span className="text-xl leading-none">🏷️</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-amber-800">
          Falta imprimir {unidades} {unidades === 1 ? "código" : "códigos"} de lo que entró
        </span>
        <span className="block text-xs text-amber-700/90">
          {entradas.length} {entradas.length === 1 ? "producto recibido" : "productos recibidos"} sin
          código en el envase. Hay que imprimirlos y pegarlos antes de que vayan a la góndola.
        </span>
      </span>
      <span className="text-sm font-semibold text-amber-800 shrink-0">Imprimir →</span>
    </Link>
  );
}
