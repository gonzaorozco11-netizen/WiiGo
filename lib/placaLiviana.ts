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

const sinSuscribir = () => () => {};

export function usePlacaLiviana(): boolean {
  return useSyncExternalStore(sinSuscribir, esPlacaLiviana, () => false);
}
