"use client";

import { useMemo } from "react";
import { barrasCode128 } from "@/lib/codigo128";

/**
 * El código de barras dibujado, listo para imprimir.
 *
 * Se dibuja en SVG y no en imagen: una imagen se imprime a la resolución de
 * pantalla y las barras salen con el borde sucio, que es justo lo que hace que
 * un lector no enganche. El SVG lo rasteriza la impresora a su resolución real.
 *
 * `preserveAspectRatio="none"` a propósito: las barras se estiran a lo alto sin
 * deformarse a lo ancho, porque el ancho lo fija el viewBox en módulos.
 */
export default function CodigoDeBarras({
  valor,
  ancho,
  alto,
}: {
  valor: string;
  /** Ancho final, en la unidad que sea (mm para imprimir). */
  ancho: string;
  alto: string;
}) {
  const dibujo = useMemo(() => barrasCode128(valor, 30), [valor]);
  if (dibujo.barras.length === 0) return null;

  return (
    <svg
      viewBox={`0 0 ${dibujo.ancho} ${dibujo.alto}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ width: ancho, height: alto, display: "block" }}
      fill="#000"
      aria-label={`Código de barras ${valor}`}
    >
      {dibujo.barras.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.ancho} height={dibujo.alto} />
      ))}
    </svg>
  );
}
