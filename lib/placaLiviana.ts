"use client";

import { useSyncExternalStore } from "react";

// La pantalla asesora corre en una Raspberry Pi 4 con LineageOS 20 (Android 13)
// conectada al monitor Joog de 27" (Gonzalo, 2026-11-11). La placa de video de
// la Raspberry (VideoCore VI, «V3D») no da para animar el local en 3D ni para
// sombras y animaciones continuas: todo se veía trabado. En esa placa la
// pantalla pasa a «modo liviano»: sin el recorrido animado (va directo al
// mueble), sin sombras, sin el producto flotando y sin el grano del fondo.
//
// Se reconoce por la placa de video (WebGL) o por el navegador. A mano:
// ?liviano=1 lo fuerza y ?liviano=0 lo apaga, para probar desde una compu.

let cache: boolean | null = null;

function placaDeVideo(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || "";
  } catch {
    return "";
  }
}

export function esPlacaLiviana(): boolean {
  if (cache !== null) return cache;
  try {
    const q = new URLSearchParams(window.location.search).get("liviano");
    if (q === "1") return (cache = true);
    if (q === "0") return (cache = false);
  } catch {}
  const ua = navigator.userAgent || "";
  cache = /raspberry|rpi/i.test(ua) || /v3d|videocore|llvmpipe|swiftshader/i.test(placaDeVideo());
  return cache;
}

/** Datos del aparato para el panel de diagnóstico (?diagnostico=1). */
export function datosDelAparato() {
  return {
    navegador: navigator.userAgent,
    placaVideo: placaDeVideo() || "—",
    pantalla: `${window.innerWidth} × ${window.innerHeight} (zoom ${window.devicePixelRatio})`,
    pantallaFisica: `${screen.width} × ${screen.height}`,
    anchoPagina: document.documentElement.scrollWidth,
    liviano: esPlacaLiviana(),
  };
}

/**
 * El monitor Joog corta un pedazo del borde derecho de la imagen (overscan) y
 * por HDMI no deja cambiarlo (Gonzalo, 2026-11-11). La pantalla se achica
 * para no usar ese borde: ?derecha=40 (y abajo, izquierda, arriba), en
 * píxeles. Se guarda en el aparato, así no hace falta dejarlo en la dirección.
 * ?derecha=0 lo vuelve a sacar. ?calibrar=1 muestra una regla en los bordes.
 */
export type MargenPantalla = Partial<Record<"arriba" | "derecha" | "abajo" | "izquierda", number>>;

/** Guarda el margen en el aparato y lo aplica al toque (el panel de 5 toques en el logo). */
export function guardarMargenDePantalla(margen: MargenPantalla) {
  try {
    localStorage.setItem("asesor.margen", JSON.stringify(margen));
  } catch {}
  return aplicarMargenDePantalla();
}

export function aplicarMargenDePantalla() {
  const lados = ["arriba", "derecha", "abajo", "izquierda"] as const;
  let margen: MargenPantalla = {};
  try {
    margen = JSON.parse(localStorage.getItem("asesor.margen") || "{}") as MargenPantalla;
  } catch {}
  const q = new URLSearchParams(window.location.search);
  let cambio = false;
  for (const l of lados) {
    const v = q.get(l);
    if (v !== null && Number.isFinite(Number(v))) {
      margen[l] = Math.max(0, Math.min(300, Math.round(Number(v))));
      cambio = true;
    }
  }
  if (cambio) {
    try {
      localStorage.setItem("asesor.margen", JSON.stringify(margen));
    } catch {}
  }
  const px = (l: (typeof lados)[number]) => margen[l] ?? 0;
  const b = document.body.style;
  if (!lados.some((l) => px(l) > 0)) {
    for (const p of ["position", "top", "left", "width", "height", "overflow", "contain"]) b.removeProperty(p);
  } else {
    // `contain` hace que lo fijo (las ventanas, el recorrido) también quede
    // adentro del recuadro, no solo lo que se desliza.
    b.position = "fixed";
    b.top = `${px("arriba")}px`;
    b.left = `${px("izquierda")}px`;
    b.width = `calc(100vw - ${px("izquierda") + px("derecha")}px)`;
    b.height = `calc(100vh - ${px("arriba") + px("abajo")}px)`;
    b.overflow = "hidden";
    b.setProperty("contain", "layout paint");
  }
  return { margen, calibrar: q.get("calibrar") === "1" };
}

const sinSuscribir = () => () => {};

export function usePlacaLiviana(): boolean {
  return useSyncExternalStore(sinSuscribir, esPlacaLiviana, () => false);
}
