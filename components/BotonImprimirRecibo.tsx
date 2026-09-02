"use client";

// El recibo se arma como página del servidor; esto es solo el botón que
// dispara la impresión del navegador (y desde ahí se puede guardar en PDF).
export default function BotonImprimirRecibo() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-accent hover:bg-accent-dark text-white px-5 py-2.5 text-sm font-semibold"
    >
      🖨️ Imprimir / Guardar PDF
    </button>
  );
}
