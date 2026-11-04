import localFont from "next/font/local";

// Ver LEEME.md. Títulos y números del sistema interno. Sin precarga: el totem
// y el asesor no la usan.
export const archivo = localFont({
  src: [{ path: "./archivo-600-700.woff2", weight: "600 700", style: "normal" }],
  variable: "--font-archivo",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});
