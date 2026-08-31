"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Local, Marca, Producto, VarianteProducto, Stock } from "@/lib/supabase";
import type { Clima } from "@/lib/clima";
import { WIIGO_LOGO_DATA_URI } from "@/lib/wiigo-logo-data";
import {
  confirmarPedido,
  estadoPedido,
  cancelarPedidoCliente,
  buscarProfesionalPorDniAction,
  buscarClientePorDniAction,
  buscarCodigoProfesionalAction,
  previsualizarDescuentoReferidoAction,
  infoCanjePuntosAction,
  obtenerStockLocal,
} from "@/app/self-checkout/[idLocal]/actions";

const STOCK_POLL_MS = 8000;

type Item = {
  variante: VarianteProducto;
  producto: Producto;
  marca: Marca | undefined;
  precio: number;
  cantidadDisponible: number;
};

type ItemCarrito = Item & { cantidad: number };

type Paso = "reposo" | "escaneo" | "identificar" | "pagar" | "efectivo-esperando" | "mp-esperando" | "pagado" | "cancelado";
type MedioPago = "EFECTIVO" | "MERCADO_PAGO";

const POLL_MS = 3000;
const TOAST_MS = 2500;

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearPedido(numero: number) {
  return `VTA-${String(numero).padStart(4, "0")}`;
}

function precioFinal(producto: Producto, variante: VarianteProducto) {
  const base = variante.precio_venta ?? producto.precio_venta ?? 0;
  const descuento = producto.descuento_porcentaje ?? 0;
  return descuento > 0 ? Math.round(base * (1 - descuento / 100)) : base;
}

// Tormenta reusa la misma foto de lluvia, oscurecida por CSS (ver
// .sc-tormenta-foto) — no hace falta una cuarta foto para eso.
const FOTOS_CLIMA: Record<Clima, string> = {
  soleado: "/clima/soleado.jpg",
  nublado: "/clima/nublado.jpg",
  lluvia: "/clima/lluvia.jpg",
  tormenta: "/clima/lluvia.jpg",
};

// ============================================================================
// Esta pantalla NO usa Tailwind — tiene su propia hoja de estilos, escrita a
// mano acá abajo, y se inyecta tal cual en el HTML sin pasar por ningún
// procesador.
//
// Por qué: el totem de autopedido es una placa Rockchip con Android 11 y
// WebView 83 (de 2020). El fabricante dejó ese motor fijo — no se puede
// actualizar desde Play Store ni cambiar por otro (probado: la lista de
// "Implementación de WebView" solo ofrece la 83). Tailwind 4 genera CSS con
// @layer y colores oklch que ese navegador no entiende, y al no entenderlos
// descarta la hoja ENTERA: la app cargaba y funcionaba, pero se veía como
// texto pelado sin ningún estilo.
//
// Reglas al tocar este archivo — todo esto NO existe en Chrome 83:
//   - `gap` en flexbox (llegó en Chrome 84) → usar margin
//   - `inset` como atajo (Chrome 87)        → usar top/right/bottom/left
//   - oklch(), color-mix()                  → usar hex o rgba()
//   - :where(), :is()                       → escribir el selector completo
//   - aspect-ratio                          → usar alto/ancho fijos
// Las demás pantallas del sistema sí usan Tailwind normalmente; solo esta
// corre en ese hardware.
// ============================================================================
const CSS_TOTEM = `
/* El reset de Tailwind tampoco llega a aplicarse en el totem, así que el
   margen que traen los navegadores por defecto queda a la vista como un
   marco blanco alrededor de todo. Se resetea acá. */
html, body { margin: 0; padding: 0; height: 100%; background: #fafafa; }

.sc-root {
  --sc-accent: #2563eb;
  --sc-accent-dark: #1d4ed8;
  --sc-accent-tint: #eff6ff;
  --sc-fg: #171717;
  --sc-muted: #737373;
  --sc-faint: #a3a3a3;
  --sc-line: #e5e5e5;
  --sc-line-soft: #f5f5f5;
  --sc-bg: #fafafa;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative;
  background: #fafafa;
  color: #171717;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.45;
}
.sc-root *, .sc-root *::before, .sc-root *::after { box-sizing: border-box; }
.sc-root p, .sc-root h1, .sc-root h2 { margin: 0; }
.sc-root button { font-family: inherit; cursor: pointer; }
.sc-root input { font-family: inherit; }

/* ---------- Encabezado ---------- */
.sc-header {
  flex-shrink: 0;
  border-bottom: 1px solid #e5e5e5;
  background: #ffffff;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sc-header-brand { font-weight: 800; letter-spacing: -0.02em; color: #171717; font-size: 18px; }
.sc-btn-cancel {
  font-size: 13px;
  color: #a3a3a3;
  background: transparent;
  border: 1px solid #e5e5e5;
  border-radius: 999px;
  padding: 6px 14px;
}
.sc-header-local { font-size: 13px; color: #a3a3a3; text-align: right; line-height: 1.25; }

/* ---------- Pantalla de reposo ---------- */
/* El degradé de cielo va dibujado por CSS detrás de la foto, no como
   adorno: en el totem las imágenes no cargan, y sin esto la pantalla de
   reposo quedaba en blanco con el texto flotando. Con el degradé se ve
   como un cielo aunque la foto nunca llegue. */
.sc-reposo {
  flex: 1 1 auto;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 40px;
  cursor: pointer;
}
.sc-cielo-soleado { background: linear-gradient(180deg, #1e6fd9 0%, #4d9ae8 45%, #a9d3f5 100%); }
.sc-cielo-nublado { background: linear-gradient(180deg, #6d7f92 0%, #94a5b5 50%, #c3ced8 100%); }
.sc-cielo-lluvia { background: linear-gradient(180deg, #3f5064 0%, #5d7186 55%, #8b9aa9 100%); }
.sc-cielo-tormenta { background: linear-gradient(180deg, #1d2733 0%, #33414f 55%, #55636f 100%); }

/* Nubes que cruzan la pantalla. Son degradés radiales movidos con
   transform: translateX — lo único que anima suave en la placa del totem
   (no usar filter: blur acá, lo hace arrastrarse). */
.sc-nubes {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
}
.sc-nube {
  position: absolute;
  border-radius: 999px;
  background: radial-gradient(closest-side, rgba(255,255,255,.9), rgba(255,255,255,0));
  animation-name: sc-nube-deriva;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
@keyframes sc-nube-deriva {
  from { transform: translateX(-50vw); }
  to { transform: translateX(120vw); }
}
.sc-cielo-nublado .sc-nube { background: radial-gradient(closest-side, rgba(255,255,255,.75), rgba(255,255,255,0)); }
.sc-cielo-lluvia .sc-nube { background: radial-gradient(closest-side, rgba(206,216,226,.6), rgba(206,216,226,0)); }
.sc-cielo-tormenta .sc-nube { background: radial-gradient(closest-side, rgba(150,163,177,.5), rgba(150,163,177,0)); }

/* Resplandor del sol, solo con cielo despejado. */
.sc-sol {
  position: absolute;
  top: -14%;
  left: -10%;
  width: 70%;
  height: 45%;
  background: radial-gradient(closest-side, rgba(255,248,214,.75), rgba(255,248,214,0));
  pointer-events: none;
  z-index: 1;
  animation: sc-sol-latido 9s ease-in-out infinite;
}
@keyframes sc-sol-latido {
  0%, 100% { opacity: .65; transform: scale(1); }
  50% { opacity: .95; transform: scale(1.08); }
}
.sc-clima-foto {
  position: absolute;
  top: -4%; right: -4%; bottom: -4%; left: -4%;
  width: 108%;
  height: 108%;
  object-fit: cover;
  animation: sc-kenburns 22s ease-in-out infinite alternate;
}
.sc-tormenta-foto { filter: brightness(0.5) contrast(1.15) saturate(0.85); }
@keyframes sc-kenburns {
  0% { transform: scale(1) translate(0, 0); }
  100% { transform: scale(1.14) translate(-1.5%, -2%); }
}
@keyframes sc-gota-caer {
  from { transform: translate(0, 0); }
  to { transform: translate(-30px, 900px); }
}
/* La lluvia va por delante de las nubes (que están en z-index 1). */
.sc-gota {
  position: absolute;
  top: -8%;
  width: 2px;
  z-index: 2;
  background: linear-gradient(rgba(220,235,255,0), rgba(220,235,255,.85));
  animation: sc-gota-caer linear infinite;
}
.sc-niebla {
  position: absolute; left: 0; right: 0; bottom: 0; height: 30%;
  z-index: 2;
  background: linear-gradient(180deg, rgba(180,195,210,0), rgba(180,195,210,.32));
  pointer-events: none;
}
.sc-relampago {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  z-index: 3;
  background: #d9e6ff;
  opacity: 0;
  pointer-events: none;
}
.sc-relampago.sc-flash { animation: sc-flash-anim .5s ease-out; }
@keyframes sc-flash-anim {
  0% { opacity: 0; }
  8% { opacity: .8; }
  18% { opacity: .08; }
  26% { opacity: .55; }
  40% { opacity: 0; }
  100% { opacity: 0; }
}
.sc-logo-wrap { position: relative; z-index: 2; }
.sc-logo-glow {
  position: absolute;
  top: -30px; right: -30px; bottom: -30px; left: -30px;
  background: radial-gradient(circle, rgba(212,221,180,.5), rgba(212,221,180,0) 68%);
  filter: blur(6px);
  z-index: -1;
  animation: sc-glow-pulse 6s ease-in-out infinite;
}
@keyframes sc-glow-pulse {
  0%, 100% { opacity: .55; transform: scale(0.96); }
  50% { opacity: .9; transform: scale(1.04); }
}
.sc-logo-card {
  position: relative;
  overflow: hidden;
  border-radius: 28px;
  padding: 32px 36px;
  width: 250px;
  background: linear-gradient(160deg, #ffffff 0%, #f4f5ef 100%);
  box-shadow: 0 40px 70px -24px rgba(0,0,0,.6), 0 14px 26px -12px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.8);
  animation: sc-float3d 6.5s ease-in-out infinite;
}
@keyframes sc-float3d {
  0%, 100% { transform: rotateX(9deg) rotateY(-11deg) translateY(0px); }
  50% { transform: rotateX(4deg) rotateY(11deg) translateY(-9px); }
}
.sc-logo-card::after {
  content: "";
  position: absolute;
  top: -60%; left: -20%;
  width: 60%; height: 220%;
  background: linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,.55) 48%, rgba(255,255,255,0) 66%);
  animation: sc-shine 5.5s ease-in-out infinite;
}
@keyframes sc-shine {
  0% { transform: translateX(-40%) rotate(8deg); }
  45%, 100% { transform: translateX(220%) rotate(8deg); }
}
.sc-logo-img { width: 100%; display: block; }
/* Respaldo cuando el archivo del logo no carga (ver .sc-reposo). */
.sc-logo-texto {
  font-size: 46px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #a9b498;
  line-height: 1;
}
.sc-titulo {
  font-size: 26px;
  font-weight: 800;
  color: #ffffff;
  position: relative;
  z-index: 10;
  margin-top: 26px;
  text-shadow: 0 2px 12px rgba(0,0,0,.35);
}
.sc-tap-hint {
  position: relative;
  z-index: 10;
  margin-top: 26px;
  width: 52px;
  height: 52px;
  border-radius: 999px;
  background: rgba(255,255,255,.12);
  border: 1px solid rgba(255,255,255,.28);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.sc-tap-hint::before {
  content: "";
  position: absolute;
  top: -10px; right: -10px; bottom: -10px; left: -10px;
  border-radius: 999px;
  border: 2px solid rgba(255,255,255,.5);
  animation: sc-pulse-ring 2.2s ease-out infinite;
}
@keyframes sc-pulse-ring {
  0% { transform: scale(0.85); opacity: .9; }
  100% { transform: scale(1.55); opacity: 0; }
}
.sc-tap-text {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: rgba(255,255,255,.75);
  position: relative;
  z-index: 10;
  margin-top: 14px;
  text-shadow: 0 1px 8px rgba(0,0,0,.35);
}

/* ---------- Buscador / escaneo ---------- */
.sc-pantalla { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.sc-buscador-caja {
  flex-shrink: 0;
  background: #ffffff;
  border-bottom: 1px solid #e5e5e5;
  padding: 12px 20px;
}
.sc-buscador-wrap { position: relative; }
.sc-buscador-icono {
  position: absolute;
  left: 14px;
  top: 50%;
  margin-top: -10px;
  color: #a3a3a3;
  font-size: 18px;
}
.sc-buscador-input {
  width: 100%;
  border-radius: 12px;
  border: 2px solid #2563eb;
  background: #eff6ff;
  padding: 14px 14px 14px 42px;
  font-size: 16px;
  font-weight: 500;
  color: #171717;
}
.sc-buscador-ayuda { font-size: 12px; color: #a3a3a3; margin-top: 6px; }
.sc-resultados {
  margin-top: 8px;
  border: 1px solid #e5e5e5;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 10px 22px -12px rgba(0,0,0,.28);
  overflow: hidden;
  max-height: 280px;
  overflow-y: auto;
}
.sc-resultado-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border: 0;
  border-bottom: 1px solid #f5f5f5;
  background: #ffffff;
  text-align: left;
}
.sc-resultado-item:last-child { border-bottom: 0; }
.sc-resultado-item:active { background: #eff6ff; }
.sc-resultado-texto { min-width: 0; padding-right: 10px; }
.sc-resultado-nombre {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: #171717;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-resultado-variante { display: block; font-size: 13px; color: #a3a3a3; }
.sc-resultado-precio { flex-shrink: 0; font-weight: 700; font-size: 15px; color: #1d4ed8; }
.sc-sin-resultados { text-align: center; font-size: 13px; color: #a3a3a3; padding: 12px 0; }

.sc-toast {
  flex-shrink: 0;
  margin: 12px 20px 0 20px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 12px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
}
.sc-toast-check { color: #059669; font-size: 18px; margin-right: 10px; }
.sc-toast-nombre { font-size: 15px; font-weight: 700; color: #065f46; }
.sc-toast-precio { font-size: 13px; color: #059669; }

.sc-error-caja {
  flex-shrink: 0;
  margin: 12px 20px 0 20px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 12px;
  padding: 10px 14px;
}
.sc-error-texto { font-size: 15px; font-weight: 600; color: #b91c1c; }

/* ---------- Carrito ---------- */
.sc-carrito { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; margin-top: 12px; }
.sc-carrito-head {
  flex-shrink: 0;
  padding: 0 20px 8px 20px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.sc-carrito-titulo { font-weight: 800; color: #171717; font-size: 17px; }
.sc-carrito-count { font-size: 13px; color: #a3a3a3; }
.sc-carrito-vacio {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 32px;
  color: #a3a3a3;
}
.sc-carrito-vacio-emoji { font-size: 34px; opacity: .5; margin-bottom: 8px; }
.sc-carrito-vacio-texto { font-size: 15px; max-width: 220px; }
.sc-carrito-lista { flex: 1 1 auto; overflow-y: auto; padding: 0 20px 12px 20px; }
.sc-item {
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1px solid #e5e5e5;
  border-radius: 12px;
  padding: 8px 12px;
  margin-bottom: 8px;
}
.sc-item-icono {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  margin-right: 10px;
}
.sc-item-info { flex: 1 1 auto; min-width: 0; }
.sc-item-nombre {
  font-size: 15px;
  font-weight: 600;
  color: #171717;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-item-detalle { font-size: 13px; color: #a3a3a3; }
.sc-item-cant { display: flex; align-items: center; flex-shrink: 0; margin: 0 8px; }
.sc-btn-cant {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid #d4d4d4;
  background: #ffffff;
  color: #737373;
  font-weight: 700;
  font-size: 16px;
  line-height: 1;
}
.sc-btn-cant[disabled] { opacity: .3; }
.sc-item-cant-num { width: 26px; text-align: center; font-weight: 700; font-size: 15px; }
.sc-item-total { width: 66px; text-align: right; font-size: 15px; font-weight: 700; color: #171717; flex-shrink: 0; }

.sc-footer {
  flex-shrink: 0;
  border-top: 1px solid #e5e5e5;
  background: #ffffff;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sc-footer-label { font-size: 13px; color: #a3a3a3; }
.sc-footer-total { font-size: 22px; font-weight: 800; color: #171717; }

/* ---------- Botones ---------- */
.sc-btn-primary {
  background: #2563eb;
  color: #ffffff;
  font-weight: 700;
  font-size: 16px;
  border: 0;
  border-radius: 12px;
  padding: 14px 26px;
}
.sc-btn-primary[disabled] { opacity: .4; }
.sc-btn-primary-full { display: block; width: 100%; border-radius: 16px; padding: 15px 0; }
.sc-btn-outline {
  border: 1px solid #d4d4d4;
  background: #ffffff;
  color: #404040;
  font-weight: 600;
  font-size: 15px;
  border-radius: 12px;
  padding: 13px 28px;
}
.sc-btn-link {
  display: block;
  width: 100%;
  text-align: center;
  font-size: 13px;
  color: #a3a3a3;
  font-weight: 600;
  background: transparent;
  border: 0;
  padding: 10px 0;
}

/* ---------- Modales (identificar / pagar) ---------- */
.sc-modal-pantalla { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; position: relative; }
.sc-modal-fondo-lista { flex: 1 1 auto; overflow-y: auto; padding: 16px 20px; opacity: .3; pointer-events: none; }
.sc-modal-capa {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  background: rgba(0,0,0,.4);
  display: flex;
  align-items: flex-end;
}
.sc-modal {
  background: #ffffff;
  border-radius: 24px 24px 0 0;
  width: 100%;
  max-height: 92%;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -20px 40px rgba(0,0,0,.25);
  padding: 20px;
  overflow-y: auto;
}
@media (min-width: 640px) {
  .sc-modal-capa { align-items: center; justify-content: center; padding: 16px; }
  .sc-modal { border-radius: 24px; max-width: 520px; }
}
.sc-modal-paso {
  font-size: 12px;
  font-weight: 700;
  color: #2563eb;
  text-transform: uppercase;
  letter-spacing: .06em;
  margin-bottom: 4px;
}
.sc-modal-titulo { font-weight: 800; font-size: 19px; color: #171717; margin-bottom: 2px; }
.sc-modal-sub { font-size: 13px; color: #737373; margin-bottom: 16px; }

.sc-card {
  border-radius: 16px;
  padding: 14px;
  margin-bottom: 10px;
}
.sc-card-accent { background: #eff6ff; border: 1px solid rgba(37,99,235,.3); }
.sc-card-neutral { background: #fafafa; border: 1px solid #e5e5e5; }
.sc-card-purple { background: #faf5ff; border: 1px solid #e9d5ff; }
.sc-card-amber { background: #fffbeb; border: 1px solid #fde68a; }
.sc-card-titulo { font-size: 15px; font-weight: 700; color: #171717; }
.sc-card-titulo-sm { font-size: 13px; font-weight: 700; color: #171717; }
.sc-opcional { font-weight: 400; color: #a3a3a3; }
.sc-input {
  width: 100%;
  border-radius: 10px;
  border: 1px solid #d4d4d4;
  padding: 11px 12px;
  font-size: 15px;
  margin-top: 6px;
  background: #ffffff;
  color: #171717;
}
.sc-input-sm { padding: 7px 10px; font-size: 13px; }
.sc-hint { font-size: 13px; margin-top: 6px; }
.sc-hint-neutral { color: #a3a3a3; }
.sc-hint-ok { color: #059669; font-weight: 600; }
.sc-hint-info { color: #737373; font-weight: 600; }
.sc-hint-error { color: #dc2626; font-weight: 600; }

.sc-canje-titulo { font-size: 15px; font-weight: 700; color: #6b21a8; margin-bottom: 8px; }
.sc-canje-fila {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  background: #ffffff;
  border: 1px solid #e9d5ff;
  border-radius: 10px;
  padding: 8px 12px;
  margin-bottom: 6px;
  cursor: pointer;
}
.sc-canje-marca { display: flex; align-items: center; }
.sc-canje-check { margin-right: 8px; width: 18px; height: 18px; }
.sc-canje-saldo { font-size: 12px; color: #9333ea; text-align: right; }

.sc-puntos-fila {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}
.sc-puntos-texto { font-size: 15px; font-weight: 700; color: #78350f; padding-right: 10px; }
.sc-puntos-check { width: 22px; height: 22px; flex-shrink: 0; }
.sc-puntos-detalle { font-size: 12px; color: #b45309; margin-top: 4px; }

.sc-resumen-fila {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 15px;
  margin-bottom: 4px;
}
.sc-resumen-desc-verde { color: #059669; }
.sc-resumen-desc-violeta { color: #9333ea; }
.sc-resumen-desc-ambar { color: #b45309; }
.sc-total-box {
  background: #eff6ff;
  border: 1px solid rgba(37,99,235,.3);
  border-radius: 16px;
  padding: 16px;
  text-align: center;
  margin: 14px 0;
}
.sc-total-label {
  font-size: 12px;
  font-weight: 700;
  color: #1d4ed8;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.sc-total-monto { font-size: 34px; font-weight: 800; color: #171717; letter-spacing: -0.02em; }

.sc-pago-btn {
  display: flex;
  align-items: center;
  text-align: left;
  width: 100%;
  border: 2px solid #e5e5e5;
  background: #ffffff;
  border-radius: 16px;
  padding: 12px 14px;
  margin-bottom: 10px;
}
.sc-pago-btn-sel { border-color: #2563eb; background: #eff6ff; }
.sc-pago-icono {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #e5e5e5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
  margin-right: 12px;
}
.sc-pago-nombre { display: block; font-weight: 700; font-size: 15px; color: #171717; }
.sc-pago-desc { display: block; font-size: 13px; color: #737373; }
.sc-pago-proximamente {
  display: flex;
  align-items: center;
  border: 2px dashed #e5e5e5;
  border-radius: 16px;
  padding: 12px 14px;
  margin-bottom: 4px;
  opacity: .45;
}

/* ---------- Pantallas finales ---------- */
.sc-final {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 32px;
}
.sc-final-emoji { font-size: 40px; margin-bottom: 8px; }
.sc-final-emoji-lg { font-size: 52px; margin-bottom: 8px; }
.sc-final-titulo { font-size: 23px; font-weight: 800; color: #171717; margin-bottom: 6px; }
.sc-final-texto { font-size: 15px; color: #737373; max-width: 320px; margin-bottom: 16px; }
.sc-final-monto { font-size: 30px; font-weight: 800; color: #171717; }
.sc-final-pedido { font-size: 13px; color: #a3a3a3; margin-bottom: 16px; }
.sc-esperando { display: flex; align-items: center; font-size: 13px; color: #a3a3a3; }
.sc-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #10b981;
  margin-right: 8px;
  animation: sc-latido 1.6s ease-in-out infinite;
}
@keyframes sc-latido { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
.sc-mp-badge {
  display: flex;
  align-items: center;
  background: #eef9f1;
  color: #00a650;
  font-weight: 700;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 999px;
  margin-bottom: 14px;
}
.sc-qr-box {
  width: 190px;
  height: 190px;
  background: #ffffff;
  border-radius: 16px;
  border: 1px solid #e5e5e5;
  box-shadow: 0 6px 16px -8px rgba(0,0,0,.25);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
  overflow: hidden;
}
.sc-qr-img { width: 100%; height: 100%; object-fit: contain; }
.sc-qr-error { color: #d4d4d4; font-size: 13px; padding: 0 8px; text-align: center; }
`;

export default function SelfCheckoutApp({
  local,
  productos,
  variantes,
  marcas,
  stock,
  clima,
}: {
  local: Local;
  productos: Producto[];
  variantes: VarianteProducto[];
  marcas: Marca[];
  stock: Stock[];
  clima: Clima;
}) {
  const [paso, setPaso] = useState<Paso>("reposo");

  // En el totem las imágenes no llegan a cargar (ver el comentario grande de
  // CSS_TOTEM). Si fallan, se esconden y quedan el degradé de cielo y el
  // nombre escrito — así no se ven los íconos de imagen rota.
  const [fotoClimaFallo, setFotoClimaFallo] = useState(false);
  const [logoFallo, setLogoFallo] = useState(false);

  // El totem queda prendido todo el día sin que nadie lo recargue — el
  // stock que trajo el servidor al abrirse la pestaña se iría
  // desactualizando con cada entrega, ajuste o venta que pase mientras
  // tanto en cualquier otro lado (POS, otro totem, Stock). Se vuelve a
  // consultar solo, todo el tiempo, para que el disponible que ve el
  // cliente sea siempre el real.
  const [stockEnVivo, setStockEnVivo] = useState<Map<string, number>>(
    () => new Map(stock.map((s) => [s.id_variante, s.cantidad]))
  );
  useEffect(() => {
    let cancelado = false;
    async function actualizar() {
      try {
        const filas = await obtenerStockLocal(local.id_local);
        if (cancelado || filas.length === 0) return;
        // Se actualiza solo lo que efectivamente llegó en esta consulta —
        // nunca se reemplaza el mapa entero. Así, si una consulta viene
        // incompleta (falta algún producto puntual, algo que puede pasar
        // ante un problema pasajero del lado de la base de datos), ese
        // producto conserva su último stock bueno conocido en vez de
        // quedar en 0 por error.
        setStockEnVivo((prev) => {
          const map = new Map(prev);
          filas.forEach((f) => map.set(f.idVariante, f.cantidad));
          return map;
        });
      } catch {
        // Falla de red pasajera — se mantiene el último stock conocido.
      }
    }
    const id = setInterval(actualizar, STOCK_POLL_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [local.id_local]);

  // El catálogo (productos/variantes/precios nuevos) sí necesita una
  // recarga completa — pero solo mientras está en reposo, nunca en medio
  // de una compra.
  useEffect(() => {
    if (paso !== "reposo") return;
    const id = setInterval(() => window.location.reload(), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [paso]);

  // Gotas de la pantalla de reposo con lluvia/tormenta — se calculan una
  // sola vez por clima (no en cada render) para que no "salten" de lugar.
  const gotas = useMemo(() => {
    if (clima !== "lluvia" && clima !== "tormenta") return [];
    const cantidad = clima === "tormenta" ? 75 : 45;
    const velocidad = clima === "tormenta" ? 1.6 : 0.9;
    const minLen = clima === "tormenta" ? 18 : 14;
    const maxLen = clima === "tormenta" ? 28 : 20;
    return Array.from({ length: cantidad }, () => ({
      left: Math.random() * 110 - 5,
      height: minLen + Math.random() * (maxLen - minLen),
      opacity: 0.4 + Math.random() * 0.5,
      duration: (0.45 + Math.random() * 0.35) / velocidad,
      delay: -Math.random() * 2,
    }));
  }, [clima]);

  // Nubes de la pantalla de reposo. Igual que las gotas, se calculan una
  // sola vez por clima para que no salten de lugar en cada render. Con
  // tormenta van más rápido y más bajas.
  const nubes = useMemo(() => {
    const apuradas = clima === "tormenta";
    return [
      { top: 6, ancho: 62, alto: 20, dur: apuradas ? 48 : 95, delay: 0, op: 0.55 },
      { top: 20, ancho: 44, alto: 14, dur: apuradas ? 34 : 68, delay: -22, op: 0.4 },
      { top: 38, ancho: 78, alto: 24, dur: apuradas ? 62 : 125, delay: -50, op: 0.32 },
      { top: 62, ancho: 52, alto: 16, dur: apuradas ? 42 : 84, delay: -12, op: 0.28 },
    ];
  }, [clima]);

  // Relámpago al azar en tormenta — cambiar la key remonta el div y
  // reinicia la animación CSS cada vez, sin necesidad de refs.
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (clima !== "tormenta") return;
    const id = setInterval(() => setFlashKey((k) => k + 1), 3200 + Math.random() * 2600);
    return () => clearInterval(id);
  }, [clima]);

  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [dni, setDni] = useState("");
  const [codigoProfesional, setCodigoProfesional] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [medioPagoElegido, setMedioPagoElegido] = useState<MedioPago>("EFECTIVO");

  const [pedido, setPedido] = useState<{
    idVenta: string;
    numero: number;
    total: number;
    descuento: number;
    qrImagen?: string;
  } | null>(
    null
  );
  const [profesional, setProfesional] = useState<{
    idProfesional: string;
    nombre: string;
    tienePin: boolean;
    saldosPorMarca: { idMarca: string; nombreMarca: string; saldo: number; tipoRecompensa: string }[];
  } | null>(null);
  const [marcasCanje, setMarcasCanje] = useState<Set<string>>(new Set());
  const [pinCanje, setPinCanje] = useState("");
  const [codigoInfo, setCodigoInfo] = useState<{ nombre: string | null; error: string | null } | null>(null);
  const [buscandoCodigo, setBuscandoCodigo] = useState(false);
  const [clienteInfo, setClienteInfo] = useState<{ existe: boolean; puntos: number; nombre: string | null } | null>(null);
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [infoPuntos, setInfoPuntos] = useState<{
    puntosDisponibles: number;
    valorPorPunto: number;
    topePorcentaje: number;
    maxDescuento: number;
    puntosNecesarios: number;
  } | null>(null);
  const [usarPuntosWiigo, setUsarPuntosWiigo] = useState(false);

  // El mismo DNI que identifica al cliente también identifica si es un
  // profesional que puede pagar con el saldo que acumuló vendiendo marcas.
  useEffect(() => {
    const dniLimpio = dni.trim();
    if (dniLimpio.length < 6) {
      setProfesional(null);
      setMarcasCanje(new Set());
      return;
    }
    const timeout = setTimeout(() => {
      buscarProfesionalPorDniAction(dniLimpio).then(setProfesional);
    }, 400);
    return () => clearTimeout(timeout);
  }, [dni]);

  // Aviso en vivo de que el DNI se está reconociendo — sin esto el campo
  // queda mudo mientras se escribe (el cliente se identifica/crea recién al
  // confirmar el pedido, ver confirmarPedido en actions.ts).
  useEffect(() => {
    const dniLimpio = dni.trim();
    if (dniLimpio.length < 6) {
      setClienteInfo(null);
      return;
    }
    setBuscandoCliente(true);
    const timeout = setTimeout(() => {
      buscarClientePorDniAction(dniLimpio)
        .then(setClienteInfo)
        .finally(() => setBuscandoCliente(false));
    }, 400);
    return () => clearTimeout(timeout);
  }, [dni]);

  // Confirmar en vivo si el código de profesional existe, misma idea que el DNI.
  useEffect(() => {
    const codigoLimpio = codigoProfesional.trim();
    if (!codigoLimpio) {
      setCodigoInfo(null);
      return;
    }
    setBuscandoCodigo(true);
    const timeout = setTimeout(() => {
      buscarCodigoProfesionalAction(codigoLimpio)
        .then(setCodigoInfo)
        .finally(() => setBuscandoCodigo(false));
    }, 400);
    return () => clearTimeout(timeout);
  }, [codigoProfesional]);

  const [toast, setToast] = useState<{ nombre: string; precio: number } | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [busquedaTexto, setBusquedaTexto] = useState("");

  const searchInputRef = useRef<HTMLInputElement>(null);

  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id_producto, p])), [productos]);
  const marcaPorId = useMemo(() => new Map(marcas.map((m) => [m.id_marca, m])), [marcas]);
  const stockPorVariante = stockEnVivo;

  const items = useMemo<Item[]>(() => {
    return variantes
      .map((variante) => {
        const producto = productoPorId.get(variante.id_producto);
        if (!producto) return null;
        const cantidadDisponible = stockPorVariante.get(variante.id_variante) ?? 0;
        if (cantidadDisponible <= 0) return null;
        return {
          variante,
          producto,
          marca: marcaPorId.get(producto.id_marca),
          precio: precioFinal(producto, variante),
          cantidadDisponible,
        };
      })
      .filter((i): i is Item => i !== null)
      .sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre));
  }, [variantes, productoPorId, marcaPorId, stockPorVariante]);

  const itemPorVariante = useMemo(() => new Map(items.map((i) => [i.variante.id_variante, i])), [items]);

  const resultadosBusqueda = useMemo(() => {
    const q = busquedaTexto.trim().toLowerCase();
    if (!q) return [];
    return items.filter((i) => i.producto.nombre.toLowerCase().includes(q)).slice(0, 20);
  }, [items, busquedaTexto]);

  const itemsCarrito = useMemo<ItemCarrito[]>(() => {
    return Object.entries(carrito)
      .map(([idVariante, cantidad]) => {
        const item = itemPorVariante.get(idVariante);
        return item ? { ...item, cantidad } : null;
      })
      .filter((i): i is ItemCarrito => i !== null);
  }, [carrito, itemPorVariante]);

  const totalItemsCarrito = itemsCarrito.reduce((acc, i) => acc + i.cantidad, 0);
  const subtotalCarrito = itemsCarrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0);

  // Marcas presentes en el carrito con el saldo del profesional para cada
  // una — si el saldo no cubre todo el importe de esa marca, se aplica como
  // descuento parcial (lo que haya disponible) y el resto se paga normal.
  const marcasEnCarrito = useMemo(() => {
    const subtotalPorMarca = new Map<string, number>();
    for (const i of itemsCarrito) {
      if (!i.producto.id_marca) continue;
      subtotalPorMarca.set(i.producto.id_marca, (subtotalPorMarca.get(i.producto.id_marca) ?? 0) + i.precio * i.cantidad);
    }
    if (!profesional) return [];
    return profesional.saldosPorMarca
      .filter((s) => subtotalPorMarca.has(s.idMarca))
      .map((s) => ({ ...s, subtotalCarrito: subtotalPorMarca.get(s.idMarca) ?? 0 }));
  }, [itemsCarrito, profesional]);

  const descuentoCanje = marcasEnCarrito
    .filter((m) => marcasCanje.has(m.idMarca))
    .reduce((acc, m) => acc + Math.min(m.subtotalCarrito, m.saldo), 0);

  // Vista previa en vivo del descuento que el código de profesional le da al
  // cliente (si la marca eligió "Descuento en el momento") — antes no se
  // consultaba nunca acá, así que el total en pantalla no bajaba aunque
  // confirmarPedido ya lo calculara bien.
  const [descuentoReferidoPreview, setDescuentoReferidoPreview] = useState(0);
  useEffect(() => {
    const codigoLimpio = codigoProfesional.trim();
    if (!codigoLimpio || itemsCarrito.length === 0) {
      setDescuentoReferidoPreview(0);
      return;
    }
    const timeout = setTimeout(() => {
      previsualizarDescuentoReferidoAction(
        codigoLimpio,
        itemsCarrito.map((i) => ({ idMarca: i.producto.id_marca, cantidad: i.cantidad, precioUnitario: i.precio })),
        dni
      ).then(setDescuentoReferidoPreview);
    }, 400);
    return () => clearTimeout(timeout);
  }, [codigoProfesional, itemsCarrito, dni]);

  // Mismo orden que confirmarPedido: primero el descuento de referido,
  // después el canje con saldo propio del profesional, y recién sobre lo
  // que queda se calculan los puntos WiiGo del cliente.
  const totalConCanje = Math.max(subtotalCarrito - descuentoReferidoPreview - descuentoCanje, 0);
  const descuentoPuntosPreview = usarPuntosWiigo && infoPuntos ? infoPuntos.maxDescuento : 0;
  const totalFinal = Math.max(totalConCanje - descuentoPuntosPreview, 0);

  // Cuánto puede cubrir con sus puntos WiiGo sobre lo que le queda por pagar
  // — solo vista previa, el server recalcula todo al confirmar el pedido.
  useEffect(() => {
    const dniLimpio = dni.trim();
    if (dniLimpio.length < 6 || totalConCanje <= 0) {
      setInfoPuntos(null);
      return;
    }
    const timeout = setTimeout(() => {
      infoCanjePuntosAction(dniLimpio, totalConCanje).then(setInfoPuntos);
    }, 400);
    return () => clearTimeout(timeout);
  }, [dni, totalConCanje]);

  function toggleMarcaCanje(idMarca: string) {
    setMarcasCanje((prev) => {
      const next = new Set(prev);
      if (next.has(idMarca)) next.delete(idMarca);
      else next.add(idMarca);
      return next;
    });
  }

  const mostrarToast = useCallback((nombre: string, precio: number) => {
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    setToast({ nombre, precio });
    toastTimeout.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    };
  }, []);

  function agregarAlCarrito(idVariante: string) {
    const item = itemPorVariante.get(idVariante);
    if (!item) return;
    let agregado = false;
    setCarrito((prev) => {
      const actual = prev[idVariante] ?? 0;
      if (actual >= item.cantidadDisponible) return prev;
      agregado = true;
      return { ...prev, [idVariante]: actual + 1 };
    });
    if (agregado) mostrarToast(item.producto.nombre, item.precio);
  }

  // El lector de código de barras conecta como teclado: "escribe" el
  // código leído y remata con Enter, todo en milisegundos, en el mismo
  // buscador de arriba. Si lo que se tipeó matchea un código de barras
  // exacto, se agrega solo (comportamiento de escaneo); si no matchea,
  // se deja el texto tal cual para que el cliente elija de la lista que
  // se despliega abajo (búsqueda manual por nombre).
  function handleBuscadorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const valor = e.currentTarget.value.trim();
    if (!valor) return;
    const coincidencia = items.find((i) => i.variante.codigo_barras === valor);
    if (coincidencia) {
      agregarAlCarrito(coincidencia.variante.id_variante);
      setBusquedaTexto("");
    }
  }

  useEffect(() => {
    if (paso !== "escaneo") return;
    searchInputRef.current?.focus();
  }, [paso]);

  function cambiarCantidad(idVariante: string, delta: number) {
    setCarrito((prev) => {
      const item = itemPorVariante.get(idVariante);
      const actual = prev[idVariante] ?? 0;
      const nueva = actual + delta;
      if (nueva <= 0) {
        const { [idVariante]: _omit, ...resto } = prev;
        return resto;
      }
      if (item && nueva > item.cantidadDisponible) return prev;
      return { ...prev, [idVariante]: nueva };
    });
  }

  function volverAEmpezar() {
    setCarrito({});
    setDni("");
    setCodigoProfesional("");
    setPedido(null);
    setError(null);
    setBusquedaTexto("");
    setProfesional(null);
    setMarcasCanje(new Set());
    setPinCanje("");
    setInfoPuntos(null);
    setUsarPuntosWiigo(false);
    setPaso("reposo");
  }

  function handleConfirmar(medioPago: MedioPago) {
    setError(null);
    setEnviando(true);
    confirmarPedido(
      local.id_local,
      itemsCarrito.map((i) => ({
        idVariante: i.variante.id_variante,
        idMarca: i.producto.id_marca,
        cantidad: i.cantidad,
        precioUnitario: i.precio,
      })),
      dni,
      codigoProfesional,
      medioPago,
      profesional && marcasCanje.size > 0
        ? { idProfesional: profesional.idProfesional, pin: pinCanje, marcas: [...marcasCanje] }
        : undefined,
      usarPuntosWiigo
    )
      .then((r) => {
        if (r.error || !r.pedido) {
          setError(r.error ?? "Algo salió mal, probá de nuevo.");
          return;
        }
        setPedido(r.pedido);
        setPaso(medioPago === "EFECTIVO" ? "efectivo-esperando" : "mp-esperando");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Algo salió mal, probá de nuevo."))
      .finally(() => setEnviando(false));
  }

  // Mientras espera que confirmen el pago, el totem se fija solo cada
  // pocos segundos si ya cambió de estado — así pasa a la pantalla final
  // sin que el cliente tenga que tocar nada.
  useEffect(() => {
    if ((paso !== "efectivo-esperando" && paso !== "mp-esperando") || !pedido) return;
    const intervalo = setInterval(() => {
      estadoPedido(pedido.idVenta)
        .then((r) => {
          if (r.estado === "PAGADA") setPaso("pagado");
          else if (r.estado === "CANCELADA") setPaso("cancelado");
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(intervalo);
  }, [paso, pedido]);

  function handleCancelarPedido() {
    if (!pedido) {
      volverAEmpezar();
      return;
    }
    cancelarPedidoCliente(pedido.idVenta).finally(volverAEmpezar);
  }

  return (
    <div className="sc-root">
      <style>{CSS_TOTEM}</style>

      {paso !== "reposo" && (
        <header className="sc-header">
          <span className="sc-header-brand">WiiGo</span>
          {paso === "escaneo" || paso === "identificar" || paso === "pagar" || paso === "mp-esperando" ? (
            <button onClick={handleCancelarPedido} className="sc-btn-cancel">
              Cancelar
            </button>
          ) : (
            <span className="sc-header-local">
              {local.nombre}
              <br />
              Terminal
            </span>
          )}
        </header>
      )}

      {paso === "reposo" && (
        <div onClick={() => setPaso("escaneo")} className={`sc-reposo sc-cielo-${clima}`}>
          {!fotoClimaFallo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={FOTOS_CLIMA[clima]}
              alt=""
              onError={() => setFotoClimaFallo(true)}
              className={`sc-clima-foto${clima === "tormenta" ? " sc-tormenta-foto" : ""}`}
            />
          )}

          {clima === "soleado" && <div className="sc-sol" />}

          <div className="sc-nubes">
            {nubes.map((n, i) => (
              <span
                key={i}
                className="sc-nube"
                style={{
                  top: `${n.top}%`,
                  width: `${n.ancho}%`,
                  height: `${n.alto}%`,
                  opacity: n.op,
                  animationDuration: `${n.dur}s`,
                  animationDelay: `${n.delay}s`,
                }}
              />
            ))}
          </div>

          {(clima === "lluvia" || clima === "tormenta") && (
            <>
              {gotas.map((g, i) => (
                <span
                  key={i}
                  className="sc-gota"
                  style={{
                    left: `${g.left}%`,
                    height: g.height,
                    opacity: g.opacity,
                    animationDuration: `${g.duration}s`,
                    animationDelay: `${g.delay}s`,
                  }}
                />
              ))}
              <div className="sc-niebla" />
            </>
          )}
          {clima === "tormenta" && <div key={flashKey} className="sc-relampago sc-flash" />}

          <div className="sc-logo-wrap" style={{ perspective: "1100px" }}>
            <div className="sc-logo-glow" />
            <div className="sc-logo-card">
              {logoFallo ? (
                <p className="sc-logo-texto">WiiGo</p>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={WIIGO_LOGO_DATA_URI}
                  alt="WiiGo"
                  onError={() => setLogoFallo(true)}
                  className="sc-logo-img"
                  style={{ filter: "drop-shadow(0 10px 14px rgba(30,35,20,.28))" }}
                />
              )}
            </div>
          </div>

          <h1 className="sc-titulo">Tu compra, a tu ritmo</h1>

          <div className="sc-tap-hint">👆</div>
          <p className="sc-tap-text">Tocá la pantalla para empezar</p>
        </div>
      )}

      {paso === "escaneo" && (
        <div className="sc-pantalla">
          <div className="sc-buscador-caja">
            <div className="sc-buscador-wrap">
              <span className="sc-buscador-icono">🔍</span>
              <input
                ref={searchInputRef}
                value={busquedaTexto}
                onChange={(e) => setBusquedaTexto(e.target.value)}
                onKeyDown={handleBuscadorKeyDown}
                placeholder="Buscá un producto por nombre..."
                className="sc-buscador-input"
              />
            </div>
            <p className="sc-buscador-ayuda">📷 También podés escanear el código de barras en cualquier momento</p>

            {resultadosBusqueda.length > 0 && (
              <div className="sc-resultados">
                {resultadosBusqueda.map((i) => (
                  <button
                    key={i.variante.id_variante}
                    onClick={() => {
                      agregarAlCarrito(i.variante.id_variante);
                      setBusquedaTexto("");
                      searchInputRef.current?.focus();
                    }}
                    className="sc-resultado-item"
                  >
                    <span className="sc-resultado-texto">
                      <span className="sc-resultado-nombre">{i.producto.nombre}</span>
                      {i.variante.nombre !== "Único" && <span className="sc-resultado-variante">{i.variante.nombre}</span>}
                    </span>
                    <span className="sc-resultado-precio">${formatearMonto(i.precio)}</span>
                  </button>
                ))}
              </div>
            )}
            {busquedaTexto.trim() && resultadosBusqueda.length === 0 && (
              <p className="sc-sin-resultados">No encontramos productos con ese nombre.</p>
            )}
          </div>

          {toast && (
            <div className="sc-toast">
              <span className="sc-toast-check">✓</span>
              <div>
                <p className="sc-toast-nombre">{toast.nombre}</p>
                <p className="sc-toast-precio">Agregado · ${formatearMonto(toast.precio)}</p>
              </div>
            </div>
          )}

          {error && !toast && (
            <div className="sc-error-caja">
              <p className="sc-error-texto">{error}</p>
            </div>
          )}

          <div className="sc-carrito">
            <div className="sc-carrito-head">
              <h2 className="sc-carrito-titulo">Tu carrito</h2>
              <span className="sc-carrito-count">
                {totalItemsCarrito} producto{totalItemsCarrito === 1 ? "" : "s"}
              </span>
            </div>

            {itemsCarrito.length === 0 ? (
              <div className="sc-carrito-vacio">
                <span className="sc-carrito-vacio-emoji">🛒</span>
                <p className="sc-carrito-vacio-texto">Todavía no escaneaste ningún producto</p>
              </div>
            ) : (
              <div className="sc-carrito-lista">
                {itemsCarrito.map((i) => (
                  <div key={i.variante.id_variante} className="sc-item">
                    <div className="sc-item-icono">📦</div>
                    <div className="sc-item-info">
                      <p className="sc-item-nombre">{i.producto.nombre}</p>
                      <p className="sc-item-detalle">
                        {i.variante.nombre !== "Único" && `${i.variante.nombre} · `}${formatearMonto(i.precio)} c/u
                      </p>
                    </div>
                    <div className="sc-item-cant">
                      <button onClick={() => cambiarCantidad(i.variante.id_variante, -1)} className="sc-btn-cant">
                        −
                      </button>
                      <span className="sc-item-cant-num">{i.cantidad}</span>
                      <button
                        onClick={() => cambiarCantidad(i.variante.id_variante, 1)}
                        disabled={i.cantidad >= i.cantidadDisponible}
                        className="sc-btn-cant"
                      >
                        +
                      </button>
                    </div>
                    <p className="sc-item-total">${formatearMonto(i.precio * i.cantidad)}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="sc-footer">
              <div>
                <p className="sc-footer-label">Total</p>
                <p className="sc-footer-total">${formatearMonto(subtotalCarrito)}</p>
              </div>
              <button onClick={() => setPaso("identificar")} disabled={itemsCarrito.length === 0} className="sc-btn-primary">
                Ir a pagar →
              </button>
            </div>
          </div>
        </div>
      )}

      {paso === "identificar" && (
        <div className="sc-modal-pantalla">
          <div className="sc-modal-fondo-lista">
            {itemsCarrito.map((i) => (
              <div key={i.variante.id_variante} className="sc-item">
                <div className="sc-item-icono">📦</div>
                <p className="sc-item-nombre sc-item-info">{i.producto.nombre}</p>
                <p className="sc-item-total">${formatearMonto(i.precio * i.cantidad)}</p>
              </div>
            ))}
          </div>

          <div className="sc-modal-capa">
            <div className="sc-modal">
              <p className="sc-modal-paso">Paso 1 de 2</p>
              <h2 className="sc-modal-titulo">¿Sos cliente WiiGo Club?</h2>
              <p className="sc-modal-sub">¡Acumulá puntos con cada compra! Es opcional.</p>

              <div className="sc-card sc-card-accent">
                <p className="sc-card-titulo">
                  Tu DNI <span className="sc-opcional">Opcional</span>
                </p>
                <input
                  value={dni}
                  onChange={(e) => setDni(e.target.value)}
                  placeholder="Ingresá tu DNI"
                  inputMode="numeric"
                  className="sc-input"
                />
                {buscandoCliente && <p className="sc-hint sc-hint-neutral">Buscando...</p>}
                {!buscandoCliente && clienteInfo?.existe && (
                  <p className="sc-hint sc-hint-ok">
                    ¡Hola{clienteInfo.nombre ? ` ${clienteInfo.nombre}` : ""}! Tenés {clienteInfo.puntos} puntos WiiGo.
                  </p>
                )}
                {!buscandoCliente && clienteInfo && !clienteInfo.existe && (
                  <p className="sc-hint sc-hint-info">
                    Todavía no estás registrado — esta compra no suma puntos. Pedile a alguien del local que te registre para la próxima.
                  </p>
                )}
              </div>

              <div className="sc-card sc-card-neutral">
                <p className="sc-card-titulo-sm">
                  ¿Te recomendó una profesional? <span className="sc-opcional">Opcional</span>
                </p>
                <input
                  value={codigoProfesional}
                  onChange={(e) => setCodigoProfesional(e.target.value)}
                  placeholder="Código de la profesional"
                  className="sc-input sc-input-sm"
                />
                {buscandoCodigo && <p className="sc-hint sc-hint-neutral">Buscando...</p>}
                {!buscandoCodigo && codigoInfo?.nombre && <p className="sc-hint sc-hint-ok">✓ {codigoInfo.nombre}</p>}
                {!buscandoCodigo && codigoInfo?.error && <p className="sc-hint sc-hint-error">✗ {codigoInfo.error}</p>}
              </div>

              {profesional && marcasEnCarrito.length > 0 && (
                <div className="sc-card sc-card-purple">
                  <p className="sc-canje-titulo">🤝 {profesional.nombre}, podés pagar con tu saldo</p>
                  {marcasEnCarrito.map((m) => {
                    const alcanza = m.saldo >= m.subtotalCarrito;
                    const montoAplicado = Math.min(m.saldo, m.subtotalCarrito);
                    return (
                      <label key={m.idMarca} className="sc-canje-fila">
                        <span className="sc-canje-marca">
                          <input
                            type="checkbox"
                            className="sc-canje-check"
                            checked={marcasCanje.has(m.idMarca)}
                            onChange={() => toggleMarcaCanje(m.idMarca)}
                          />
                          {m.nombreMarca} — ${formatearMonto(m.subtotalCarrito)}
                        </span>
                        <span className="sc-canje-saldo">
                          Saldo: ${formatearMonto(m.saldo)}
                          {!alcanza && ` (descuenta $${formatearMonto(montoAplicado)}, resto se paga normal)`}
                        </span>
                      </label>
                    );
                  })}
                  {marcasCanje.size > 0 && (
                    <input
                      value={pinCanje}
                      onChange={(e) => setPinCanje(e.target.value)}
                      placeholder="Tu PIN"
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      className="sc-input"
                    />
                  )}
                </div>
              )}

              {infoPuntos && infoPuntos.maxDescuento > 0 && (
                <div className="sc-card sc-card-amber">
                  <label className="sc-puntos-fila">
                    <span className="sc-puntos-texto">
                      ⭐ Usar mis puntos WiiGo — cubre hasta ${formatearMonto(infoPuntos.maxDescuento)}
                    </span>
                    <input
                      type="checkbox"
                      className="sc-puntos-check"
                      checked={usarPuntosWiigo}
                      onChange={(e) => setUsarPuntosWiigo(e.target.checked)}
                    />
                  </label>
                  <p className="sc-puntos-detalle">
                    Usa {infoPuntos.puntosNecesarios} de tus {infoPuntos.puntosDisponibles} puntos.
                  </p>
                </div>
              )}

              <button
                onClick={() => setPaso("pagar")}
                disabled={marcasCanje.size > 0 && pinCanje.length < 4}
                className="sc-btn-primary sc-btn-primary-full"
              >
                Continuar
              </button>
              <button onClick={() => setPaso("pagar")} className="sc-btn-link">
                Omitir este paso
              </button>
              <button onClick={() => setPaso("escaneo")} className="sc-btn-link">
                ‹ Volver al carrito
              </button>
            </div>
          </div>
        </div>
      )}

      {paso === "pagar" && (
        <div className="sc-modal-pantalla">
          <div className="sc-modal-fondo-lista">
            {itemsCarrito.map((i) => (
              <div key={i.variante.id_variante} className="sc-item">
                <div className="sc-item-icono">📦</div>
                <p className="sc-item-nombre sc-item-info">{i.producto.nombre}</p>
                <p className="sc-item-total">${formatearMonto(i.precio * i.cantidad)}</p>
              </div>
            ))}
          </div>

          <div className="sc-modal-capa">
            <div className="sc-modal">
              <p className="sc-modal-paso">Paso 2 de 2</p>
              <h2 className="sc-modal-titulo" style={{ marginBottom: 14 }}>
                ¿Cómo querés pagar?
              </h2>

              <div className="sc-resumen-fila">
                <span>Subtotal</span>
                <span>${formatearMonto(subtotalCarrito)}</span>
              </div>
              {descuentoReferidoPreview > 0 && (
                <div className="sc-resumen-fila sc-resumen-desc-verde">
                  <span>Descuento por código de profesional</span>
                  <span>-${formatearMonto(descuentoReferidoPreview)}</span>
                </div>
              )}
              {descuentoCanje > 0 && (
                <div className="sc-resumen-fila sc-resumen-desc-violeta">
                  <span>Pagado con saldo de profesional</span>
                  <span>-${formatearMonto(descuentoCanje)}</span>
                </div>
              )}
              {descuentoPuntosPreview > 0 && (
                <div className="sc-resumen-fila sc-resumen-desc-ambar">
                  <span>Pagado con puntos WiiGo</span>
                  <span>-${formatearMonto(descuentoPuntosPreview)}</span>
                </div>
              )}

              <div className="sc-total-box">
                <p className="sc-total-label">Total a pagar</p>
                <p className="sc-total-monto">${formatearMonto(totalFinal)}</p>
              </div>

              <button
                onClick={() => setMedioPagoElegido("EFECTIVO")}
                className={`sc-pago-btn${medioPagoElegido === "EFECTIVO" ? " sc-pago-btn-sel" : ""}`}
              >
                <span className="sc-pago-icono">💵</span>
                <span>
                  <span className="sc-pago-nombre">Efectivo</span>
                  <span className="sc-pago-desc">Pagás en caja con el personal</span>
                </span>
              </button>
              <button
                onClick={() => setMedioPagoElegido("MERCADO_PAGO")}
                className={`sc-pago-btn${medioPagoElegido === "MERCADO_PAGO" ? " sc-pago-btn-sel" : ""}`}
              >
                <span className="sc-pago-icono">📱</span>
                <span>
                  <span className="sc-pago-nombre">Mercado Pago</span>
                  <span className="sc-pago-desc">Escaneás un QR y pagás desde tu celular</span>
                </span>
              </button>
              <div className="sc-pago-proximamente">
                <span className="sc-pago-icono">💳</span>
                <span>
                  <span className="sc-pago-nombre">Débito / Crédito</span>
                  <span className="sc-pago-desc">Próximamente</span>
                </span>
              </div>

              {error && (
                <p className="sc-hint sc-hint-error" role="alert">
                  {error}
                </p>
              )}

              <button
                onClick={() => handleConfirmar(medioPagoElegido)}
                disabled={enviando}
                className="sc-btn-primary sc-btn-primary-full"
                style={{ marginTop: 14 }}
              >
                {enviando ? "Confirmando..." : "Confirmar y pagar"}
              </button>
              <button onClick={() => setPaso("identificar")} className="sc-btn-link">
                ‹ Volver
              </button>
            </div>
          </div>
        </div>
      )}

      {paso === "efectivo-esperando" && pedido && (
        <div className="sc-final">
          <div className="sc-final-emoji">🧾</div>
          <h2 className="sc-final-titulo">Entregá el efectivo al personal</h2>
          <p className="sc-final-texto">
            Un miembro del equipo va a revisar los productos que seleccionaste y recibir el dinero antes de que te
            retires.
          </p>
          <p className="sc-final-monto">${formatearMonto(pedido.total)}</p>
          <p className="sc-final-pedido">Pedido #{formatearPedido(pedido.numero)}</p>
          <div className="sc-esperando">
            <span className="sc-dot" />
            Esperando confirmación del personal...
          </div>
        </div>
      )}

      {paso === "mp-esperando" && pedido && (
        <div className="sc-final">
          <div className="sc-mp-badge">📱 Mercado Pago</div>
          <p className="sc-final-texto">Escaneá este código con la app de Mercado Pago de tu celular</p>
          <div className="sc-qr-box">
            {pedido.qrImagen ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pedido.qrImagen} alt="Código QR de Mercado Pago" className="sc-qr-img" />
            ) : (
              <span className="sc-qr-error">No se pudo generar el QR</span>
            )}
          </div>
          <p className="sc-final-monto">${formatearMonto(pedido.total)}</p>
          <div className="sc-esperando" style={{ marginTop: 12 }}>
            <span className="sc-dot" />
            Esperando el pago...
          </div>
        </div>
      )}

      {paso === "pagado" && pedido && (
        <div className="sc-final">
          <div className="sc-final-emoji-lg">✅</div>
          <h2 className="sc-final-titulo">¡Perfecto!</h2>
          <p className="sc-final-texto" style={{ marginBottom: 8 }}>
            Mostrale tu ticket al personal para controlar antes de salir.
          </p>
          <p className="sc-final-pedido" style={{ marginBottom: 24 }}>
            Pedido #{formatearPedido(pedido.numero)} · ${formatearMonto(pedido.total)}
          </p>
          <button onClick={volverAEmpezar} className="sc-btn-outline">
            Nueva compra
          </button>
        </div>
      )}

      {paso === "cancelado" && (
        <div className="sc-final">
          <div className="sc-final-emoji">✕</div>
          <h2 className="sc-final-titulo">Pedido cancelado</h2>
          <p className="sc-final-texto" style={{ marginBottom: 24 }}>
            Podés empezar una compra nueva cuando quieras.
          </p>
          <button onClick={volverAEmpezar} className="sc-btn-primary">
            Empezar de nuevo
          </button>
        </div>
      )}
    </div>
  );
}
