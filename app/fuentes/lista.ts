import localFont from "next/font/local";

// Ver LEEME.md. Lista de precios para imprimir.
export const figtree = localFont({
  src: [{ path: "./figtree-400-800.woff2", weight: "400 800", style: "normal" }],
  variable: "--f-lista",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});
export const fraunces = localFont({
  src: [
    { path: "./fraunces-500-600.woff2", weight: "500 600", style: "normal" },
    { path: "./fraunces-italica-500-600.woff2", weight: "500 600", style: "italic" },
  ],
  variable: "--f-lista-titulo",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
  adjustFontFallback: "Times New Roman",
});
