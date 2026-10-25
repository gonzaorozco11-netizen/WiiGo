// El mail de los reportes de la Junta: números grandes con su comparación,
// un gráfico de barras, las marcas y productos que más vendieron, lo que dice
// cada encargado y qué hacer.
//
// Los gráficos son tablas con celdas de color, no imágenes: es lo único que se
// ve igual en Gmail, en el celular y en Outlook, y no depende de ningún
// servicio de afuera. Todo con estilos inline, como lib/mail.ts.

import type { DatosReporte, Periodo, Redaccion } from "@/lib/juntaReportes";
import { ENCARGADOS } from "@/lib/juntaPersonajes";

const VERDE = "#536243";
const VERDE_OSCURO = "#3f4d33";
const KRAFT = "#d9c49b";
const TEXTO = "#2a2f26";
const SUAVE = "#5e6659";
const GRIS = "#8d9587";
const LINEA = "#e4e8dd";
const F = "font-family:Arial,Helvetica,sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const compacto = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M` : v >= 1000 ? `$${Math.round(v / 1000)} mil` : pesos(v));

/** El chip de la comparación: verde si subió, rojo si bajó. */
function variacion(actual: number, anterior: number) {
  if (anterior <= 0) return actual > 0 ? `<span style="${F};font-size:12px;color:${GRIS}">sin dato para comparar</span>` : "";
  const p = Math.round((actual / anterior - 1) * 100);
  const [color, fondo, flecha] = p > 0 ? ["#047857", "#e7f6ef", "▲"] : p < 0 ? ["#b42318", "#fdecea", "▼"] : [GRIS, "#f1f2ee", "="];
  return `<span style="${F};display:inline-block;font-size:12px;font-weight:bold;color:${color};background:${fondo};border-radius:10px;padding:2px 8px">${flecha} ${Math.abs(p)}%</span>`;
}

function tarjeta(etiqueta: string, valor: string, actual: number, anterior: number) {
  return `<td width="50%" valign="top" style="padding:6px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7faf3;border:1px solid ${LINEA};border-radius:12px">
    <tr><td style="padding:12px 14px">
      <p style="margin:0;${F};font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${GRIS}">${etiqueta}</p>
      <p style="margin:4px 0 6px;${F};font-size:24px;font-weight:bold;color:${VERDE_OSCURO};letter-spacing:-0.5px">${valor}</p>
      ${variacion(actual, anterior)}
    </td></tr>
  </table>
</td>`;
}

/** Barras dobles (este período y el anterior) dentro de una tabla de alto fijo. */
function graficoBarras(titulo: string, actual: Periodo, anterior: Periodo, etiquetaActual: string, etiquetaAnterior: string) {
  const ALTO = 120;
  const max = Math.max(...actual.barras.map((b) => b.valor), ...anterior.barras.map((b) => b.valor), 1);
  const alto = (v: number) => Math.max(Math.round((v / max) * ALTO), v > 0 ? 3 : 1);
  const pico = actual.barras.reduce((m, b) => (b.valor > m.valor ? b : m), actual.barras[0]);
  const columnas = actual.barras
    .map((b, i) => {
      const a = anterior.barras[i]?.valor ?? 0;
      return `<td valign="bottom" align="center" style="padding:0 2px;height:${ALTO}px">
        <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
          <td valign="bottom" style="padding-right:2px"><div style="width:9px;height:${alto(b.valor)}px;background:${b === pico && b.valor > 0 ? "#c0892f" : VERDE};border-radius:3px 3px 0 0;font-size:1px;line-height:1px">&nbsp;</div></td>
          <td valign="bottom"><div style="width:9px;height:${alto(a)}px;background:${KRAFT};border-radius:3px 3px 0 0;font-size:1px;line-height:1px">&nbsp;</div></td>
        </tr></table>
      </td>`;
    })
    .join("");
  const etiquetas = actual.barras.map((b) => `<td align="center" style="${F};font-size:10px;color:${GRIS};padding-top:5px">${esc(b.etiqueta)}</td>`).join("");
  return `<tr><td style="padding:18px 26px 4px">
  <p style="margin:0 0 4px;${F};font-size:15px;font-weight:bold;color:${TEXTO}">${titulo}</p>
  <p style="margin:0 0 12px;${F};font-size:12px;color:${GRIS}">
    <span style="display:inline-block;width:9px;height:9px;background:${VERDE};border-radius:2px"></span> ${etiquetaActual}
    &nbsp;&nbsp;<span style="display:inline-block;width:9px;height:9px;background:${KRAFT};border-radius:2px"></span> ${etiquetaAnterior}
    ${pico.valor > 0 ? `&nbsp;&nbsp;<span style="display:inline-block;width:9px;height:9px;background:#c0892f;border-radius:2px"></span> el pico: ${esc(pico.etiqueta)}${actual.barras.length === 13 ? " hs" : ""} (${compacto(pico.valor)})` : ""}
  </p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${LINEA}"><tr>${columnas}</tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${etiquetas}</tr></table>
</td></tr>`;
}

/** Las marcas que más vendieron, con una barra horizontal cada una. */
function graficoMarcas(p: Periodo) {
  if (!p.marcas.length) return "";
  const total = p.marcas.reduce((s, m) => s + m.vendido, 0) || 1;
  const max = p.marcas[0].vendido || 1;
  const filas = p.marcas
    .map((m) => {
      const ancho = Math.max(Math.round((m.vendido / max) * 100), 2);
      return `<tr>
        <td style="${F};font-size:13px;color:${TEXTO};padding:5px 10px 5px 0;white-space:nowrap" width="34%">${esc(m.nombre)}</td>
        <td style="padding:5px 0" width="46%">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="${ancho}%" style="background:${VERDE};height:12px;border-radius:6px;font-size:1px;line-height:1px">&nbsp;</td>
            <td style="font-size:1px;line-height:1px">&nbsp;</td>
          </tr></table>
        </td>
        <td align="right" style="${F};font-size:12px;color:${SUAVE};padding:5px 0 5px 10px;white-space:nowrap" width="20%">${compacto(m.vendido)} · ${Math.round((m.vendido / total) * 100)}%</td>
      </tr>`;
    })
    .join("");
  return `<tr><td style="padding:18px 26px 4px">
  <p style="margin:0 0 8px;${F};font-size:15px;font-weight:bold;color:${TEXTO}">Marcas que más vendieron</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
</td></tr>`;
}

function listaProductos(p: Periodo) {
  if (!p.productos.length) return "";
  const filas = p.productos
    .map(
      (x, i) => `<tr>
      <td valign="top" style="${F};font-size:13px;font-weight:bold;color:${VERDE};padding:6px 8px 6px 0" width="18">${i + 1}</td>
      <td style="${F};font-size:13px;color:${TEXTO};padding:6px 0;border-bottom:1px solid #f0f2ec">${esc(x.nombre)}<br><span style="color:${GRIS};font-size:12px">${esc(x.marca)} · ${x.unidades} u.</span></td>
      <td align="right" valign="top" style="${F};font-size:13px;font-weight:bold;color:${TEXTO};padding:6px 0 6px 10px;border-bottom:1px solid #f0f2ec;white-space:nowrap">${pesos(x.vendido)}</td>
    </tr>`
    )
    .join("");
  return `<tr><td style="padding:18px 26px 4px">
  <p style="margin:0 0 4px;${F};font-size:15px;font-weight:bold;color:${TEXTO}">Lo que más se vendió</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
</td></tr>`;
}

function encargados(r: Redaccion, base: string) {
  if (!r.encargados.length) return "";
  const filas = r.encargados
    .map((x) => {
      const e = ENCARGADOS.find((y) => y.id === x.id);
      if (!e) return "";
      const foto = base
        ? `<img src="${base}/junta/mail/${e.id}.jpg" width="38" height="38" alt="${esc(e.nombre)}" style="display:block;width:38px;height:38px;border-radius:19px;border:2px solid ${e.color}">`
        : `<div style="width:38px;height:38px;border-radius:19px;background:${e.color};color:#fff;${F};font-weight:bold;font-size:15px;line-height:38px;text-align:center">${e.nombre[0]}</div>`;
      return `<tr>
        <td valign="top" width="48" style="padding:8px 10px 8px 0">${foto}</td>
        <td valign="top" style="padding:8px 0;border-bottom:1px solid #f0f2ec">
          <p style="margin:0 0 2px;${F};font-size:12px;font-weight:bold;color:${e.color}">${esc(e.nombre)} · ${esc(e.area)}</p>
          <p style="margin:0;${F};font-size:14px;color:${TEXTO};line-height:1.5">${esc(x.texto)}</p>
        </td>
      </tr>`;
    })
    .join("");
  return `<tr><td style="padding:18px 26px 4px">
  <p style="margin:0 0 4px;${F};font-size:15px;font-weight:bold;color:${TEXTO}">Lo que dice la Junta</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
</td></tr>`;
}

function franja(titulo: string, items: string[], fondo: string, borde: string, color: string) {
  if (!items.length) return "";
  const lista = items.map((x, i) => `<p style="margin:${i ? "6" : "8"}px 0 0;${F};font-size:14px;color:${color};line-height:1.45"><strong>${i + 1}.</strong> ${esc(x)}</p>`).join("");
  return `<tr><td style="padding:18px 26px 4px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="background:${fondo};border:1px solid ${borde};border-radius:12px;padding:14px 18px">
      <strong style="${F};font-size:16px;color:${TEXTO}">${titulo}</strong>${lista}
    </td>
  </tr></table>
</td></tr>`;
}

function tareas(d: DatosReporte, propuestas: number) {
  const total = d.tareas.hechas + d.tareas.vencidas + d.tareas.pendientes;
  if (!total && !propuestas) return "";
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const barra = total
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:7px;overflow:hidden"><tr>
        ${d.tareas.hechas ? `<td width="${pct(d.tareas.hechas)}%" style="background:#059669;height:12px;font-size:1px;line-height:1px">&nbsp;</td>` : ""}
        ${d.tareas.pendientes ? `<td width="${pct(d.tareas.pendientes)}%" style="background:#f2c16b;height:12px;font-size:1px;line-height:1px">&nbsp;</td>` : ""}
        ${d.tareas.vencidas ? `<td width="${pct(d.tareas.vencidas)}%" style="background:#dc5b4b;height:12px;font-size:1px;line-height:1px">&nbsp;</td>` : ""}
      </tr></table>
      <p style="margin:6px 0 0;${F};font-size:12px;color:${SUAVE}">${d.tareas.hechas} hechas · ${d.tareas.pendientes} pendientes · ${d.tareas.vencidas} vencidas</p>`
    : "";
  const aviso = propuestas
    ? `<p style="margin:${total ? "10" : "0"}px 0 0;${F};font-size:14px;color:#4f5c43;background:#edf1e7;border:1px solid #d2d9c8;border-radius:10px;padding:10px 12px"><strong>${propuestas} ${propuestas === 1 ? "tarea nueva espera" : "tareas nuevas esperan"} tu aprobación.</strong> Aprobalas y le llegan al equipo en Mis Tareas.</p>`
    : "";
  return `<tr><td style="padding:18px 26px 4px">
  <p style="margin:0 0 8px;${F};font-size:15px;font-weight:bold;color:${TEXTO}">Tareas del equipo</p>
  ${barra}${aviso}
</td></tr>`;
}

export function armarMailReporte(d: DatosReporte, r: Redaccion, base: string): string {
  const b = base.replace(/\/+$/, "");
  const a = d.actual;
  const ant = d.anterior;
  const diario = d.tipo === "DIARIO";
  const logo = b
    ? `<img src="${b}/wiigo-isotipo.png" width="26" alt="WiiGo" style="display:inline-block;border:0;width:26px;height:auto;vertical-align:middle">`
    : `<span style="${F};font-size:22px;font-weight:bold;color:${VERDE}">W</span>`;
  const sinVentas = a.ventas === 0;

  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#f3f5f0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f0;padding:24px 10px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border:1px solid ${LINEA};border-radius:16px;overflow:hidden">

<tr><td style="background:${VERDE};padding:18px 26px" align="left">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;background:#ffffff;border-radius:20px;line-height:40px">${logo}</td>
    <td style="padding-left:12px;${F};color:#ffffff">
      <span style="font-size:18px;font-weight:bold">Junta WiiGo</span><br>
      <span style="font-size:12px;opacity:.85">${esc(d.bajada)}</span>
    </td>
  </tr></table>
</td></tr>

<tr><td style="padding:24px 26px 6px">
  <h1 style="margin:0;${F};font-size:24px;font-weight:bold;color:${TEXTO};line-height:1.2">${esc(d.titulo)}</h1>
  ${r.titular ? `<p style="margin:8px 0 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:17px;color:${SUAVE};line-height:1.4">${esc(r.titular)}</p>` : ""}
</td></tr>

<tr><td style="padding:10px 20px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>${tarjeta("Vendido", compacto(a.vendido), a.vendido, ant.vendido)}${tarjeta("Ventas", String(a.ventas), a.ventas, ant.ventas)}</tr>
    <tr>${tarjeta("Ticket promedio", compacto(a.ticket), a.ticket, ant.ticket)}${tarjeta("Clientes nuevos", String(a.clientesNuevos), a.clientesNuevos, ant.clientesNuevos)}</tr>
  </table>
  <p style="margin:2px 6px 0;${F};font-size:12px;color:${GRIS}">Comparado con ${esc(d.contra)}.</p>
</td></tr>

${sinVentas ? `<tr><td style="padding:18px 26px 4px;${F};font-size:14px;color:${SUAVE}">No hubo ventas en este período.</td></tr>` : graficoBarras(diario ? "Ventas por hora" : "Ventas por día", a, ant, diario ? "este día" : "esta semana", esc(d.contra))}
${graficoMarcas(a)}
${listaProductos(a)}
${encargados(r, b)}
${franja(diario ? "Para hoy" : "Lo que haríamos esta semana", r.acciones, "#fbf1dd", "#ecdcbb", "#6b5420")}
${tareas(d, r.tareas.length)}

<tr><td align="center" style="padding:22px 26px 0">
  <a href="${b || "#"}/junta" style="display:inline-block;background:${VERDE};color:#ffffff;${F};font-size:15px;font-weight:bold;text-decoration:none;padding:14px 30px;border-radius:11px">${r.tareas.length ? "Aprobar las tareas" : "Abrir la Junta"}</a>
</td></tr>
<tr><td style="height:22px;line-height:22px">&nbsp;</td></tr>
<tr><td style="padding:14px 26px 18px;border-top:1px solid #eef1e9;background:#fafbf7;${F};color:${GRIS};font-size:12px;line-height:1.55">
  Lo escriben los encargados de la Junta con los números del sistema. Solo opinan: nada cambia hasta que vos lo decidas.
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}
