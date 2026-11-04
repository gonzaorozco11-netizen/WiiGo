import localFont from "next/font/local";

// Ver LEEME.md. Módulo Precios.
export const plex = localFont({
  src: [{ path: "./ibm-plex-sans-400-700.woff2", weight: "400 700", style: "normal" }],
  variable: "--f-plex",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});
export const plexMono = localFont({
  src: [
    { path: "./ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--f-plex-mono",
  display: "swap",
  fallback: ["ui-monospace", "Consolas", "Menlo", "monospace"],
  adjustFontFallback: false,
});
