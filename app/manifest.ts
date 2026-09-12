import type { MetadataRoute } from "next";

// Manifest de la app.
//
// Sirve para una sola cosa, pero importante: que el acceso directo en la
// tablet del mostrador abra **sin la barra de direcciones ni las pestañas**
// del navegador. Con `display: "standalone"` la pantalla completa es la app,
// y la empleada no puede irse a otro lado sin querer con un dedazo.
//
// Sin esto, "agregar a la pantalla de inicio" deja un ícono genérico que abre
// Chrome como cualquier página.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WiiGo — Gestión",
    short_name: "WiiGo",
    description: "Sistema de gestión de WiiGo",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    // El azul del sistema (--accent en globals.css). Pinta la barra de estado
    // del celular con el color de la app en vez de gris.
    theme_color: "#2563eb",
    lang: "es-AR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // "maskable" le avisa a Android que puede recortarlo en círculo o
      // cuadrado redondeado. El logo está centrado con margen justamente
      // para que ese recorte no le coma nada.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
