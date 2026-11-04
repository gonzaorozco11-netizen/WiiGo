import localFont from "next/font/local";

// Ver LEEME.md. Portal de marcas y espacio de las profesionales.
// Los valores van escritos tal cual: next/font no acepta constantes.

export const outfit = localFont({
  src: [{ path: "./outfit-500-700.woff2", weight: "500 700", style: "normal" }],
  variable: "--f-titulo",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});
export const manrope = localFont({
  src: [{ path: "./manrope-400-700.woff2", weight: "400 700", style: "normal" }],
  variable: "--f-texto",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});
export const jetbrainsMono = localFont({
  src: [{ path: "./jetbrains-mono-400-600.woff2", weight: "400 600", style: "normal" }],
  variable: "--f-mono",
  fallback: ["ui-monospace", "Consolas", "Menlo", "monospace"],
  adjustFontFallback: false,
});
