import localFont from "next/font/local";

// Ver LEEME.md. Pantalla asesora.
// Los valores van escritos tal cual: next/font no acepta constantes.

/** Títulos y precios. */
export const bricolage = localFont({
  src: [{ path: "./bricolage-500-800.woff2", weight: "500 800", style: "normal" }],
  fallback: ["system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});
/** Texto corrido. */
export const figtree = localFont({
  src: [{ path: "./figtree-400-800.woff2", weight: "400 800", style: "normal" }],
  fallback: ["system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});
