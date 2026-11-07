"use client";

import { useEffect, useState } from "react";
import type { FichaProducto } from "@/lib/supabase";
import "./nutricionAsesor.css";

// La información nutricional de la ficha en la pantalla asesora (opción C,
// elegida por Gonzalo el 2026-11-05: https://claude.ai/artifact/FibMQbQys4Yrq7wmrXV1Vd).
// Las kcal suben de 0 al valor con una barrita de cuánto es del día, y cada
// nutriente es una tarjeta de color que se da vuelta al abrir. Con «Tu porción»
// se recalcula todo para lo que el cliente se sirve.
//
// Para la all-in-one: solo se animan transform y opacity; sin will-change.

type Idioma = "es" | "en" | "pt";

const T = {
  es: { titulo: "Información nutricional", cada: "Cada 100 g", porcion: "Tu porción", dia: (p: number) => `el ${p} % de la energía de un día`, vd: "del valor diario", nota: "Valores diarios sobre una dieta de 2.000 kcal.", tocar: "Tocá una tarjeta para saber más.", sodio: "Sodio", bajoSodio: "Bajo en sodio", altaFibra: "Alto en fibra", fibra: "Aporta fibra", proteina: "Alto en proteína", natural: "Natural", cadaPorcion: "Cada porción", sinCalorias: "Sin calorías" },
  en: { titulo: "Nutrition facts", cada: "Per 100 g", porcion: "Your serving", dia: (p: number) => `${p} % of a day's energy`, vd: "of daily value", nota: "Daily values based on a 2,000 kcal diet.", tocar: "Tap a card to learn more.", sodio: "Sodium", bajoSodio: "Low in sodium", altaFibra: "High in fibre", fibra: "Source of fibre", proteina: "High in protein", natural: "Natural", cadaPorcion: "Per serving", sinCalorias: "No calories" },
  pt: { titulo: "Informação nutricional", cada: "A cada 100 g", porcion: "Sua porção", dia: (p: number) => `${p} % da energia de um dia`, vd: "do valor diário", nota: "Valores diários com base em uma dieta de 2.000 kcal.", tocar: "Toque em um cartão para saber mais.", sodio: "Sódio", bajoSodio: "Baixo em sódio", altaFibra: "Rico em fibras", fibra: "Fonte de fibras", proteina: "Rico em proteína", natural: "Natural", cadaPorcion: "Por porção", sinCalorias: "Sem calorias" },
};

// Valores diarios de referencia (Código Alimentario Argentino): g por día.
const NUTRIENTES = [
  { clave: "carbohidratos", color: "#c9822f", vd: 300, nombre: { es: "Carbohidratos", en: "Carbs", pt: "Carboidratos" },
    explica: { es: "La principal fuente de energía del cuerpo.", en: "The body's main source of energy.", pt: "A principal fonte de energia do corpo." } },
  { clave: "proteinas", color: "#4f8c7c", vd: 75, nombre: { es: "Proteínas", en: "Protein", pt: "Proteínas" },
    explica: { es: "Ayudan a formar y reparar los músculos.", en: "Help build and repair muscles.", pt: "Ajudam a formar e reparar os músculos." } },
  { clave: "fibra", color: "#7a63ad", vd: 25, nombre: { es: "Fibra", en: "Fibre", pt: "Fibra" },
    explica: { es: "Da saciedad y ayuda a la digestión.", en: "Keeps you full and helps digestion.", pt: "Dá saciedade e ajuda na digestão." } },
  { clave: "grasas", color: "#b85a48", vd: 55, nombre: { es: "Grasas", en: "Fat", pt: "Gorduras" },
    explica: { es: "Energía concentrada; ayudan a absorber vitaminas.", en: "Concentrated energy; help absorb vitamins.", pt: "Energia concentrada; ajudam a absorver vitaminas." } },
] as const;

const fmt = (n: number, dec = 0) => n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** Los gramos de la porción sugerida ("60 g en crudo" → 60). null si no dice gramos. */
function gramosPorcion(texto: string | null | undefined) {
  const m = /(\d+(?:[.,]\d+)?)\s*g\b/i.exec(texto ?? "");
  const n = m ? Number(m[1].replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
}

/**
 * «Por porción (5 g): creatina monohidrato 5 g, sodio 10 mg» → título «Por porción (5 g)»
 * y cada activo con su cantidad aparte («creatina monohidrato» · «5 g»).
 */
function leerActivos(texto: string) {
  const dos = texto.indexOf(":");
  const titulo = dos > 0 && dos < 40 ? texto.slice(0, dos).trim() : null;
  const resto = dos > 0 && dos < 40 ? texto.slice(dos + 1) : texto;
  const items = resto
    .split(/[,;]\s*(?![^(]*\))/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .slice(0, 4)
    .map((s) => {
      const m = /^(.*?)[\s:]+(\d[\d.,]*\s*(?:mg|mcg|µg|g|ui|UI|%)[^\s]*)$/.exec(s);
      return m ? { que: m[1].trim(), cuanto: m[2].trim() } : { que: s, cuanto: null };
    });
  return { titulo, items };
}

/** Un número que sube de 0 hasta `hasta` (como un contador). */
function Contador({ hasta, dec = 0 }: { hasta: number; dec?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const quieto = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (quieto) {
      const id = requestAnimationFrame(() => setV(hasta));
      return () => cancelAnimationFrame(id);
    }
    const t0 = performance.now();
    let id = 0;
    const paso = (t: number) => {
      const x = Math.min(1, (t - t0) / 1300);
      setV(hasta * (1 - Math.pow(1 - x, 3)));
      if (x < 1) id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [hasta]);
  return <>{fmt(v, dec)}</>;
}

export default function NutricionAsesor({ ficha, idioma, claseTitular }: { ficha: FichaProducto; idioma: Idioma; claseTitular: string }) {
  const t = T[idioma] ?? T.es;
  const gPorcion = gramosPorcion(ficha.porcion);
  // Arranca en la porción si el producto la tiene: va primero (Gonzalo, 2026-11-07).
  const [porcion, setPorcion] = useState(Boolean(gPorcion));
  const [listo, setListo] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);
  // Cambia en cada 100 g ↔ porción: las tarjetas y el contador arrancan de nuevo.
  const [vuelta, setVuelta] = useState(0);

  // Al abrir (y al cambiar 100 g ↔ porción) las tarjetas arrancan dadas vuelta y giran.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setListo(true)));
    return () => cancelAnimationFrame(id);
  }, [porcion]);
  function cambiar(p: boolean) {
    if (p === porcion) return;
    setVuelta((v) => v + 1);
    setListo(false);
    setElegido(null);
    setPorcion(p);
  }

  const f = porcion && gPorcion ? gPorcion / 100 : 1;
  const kcal = ficha.kcal_100g != null ? Math.round(ficha.kcal_100g * f) : null;
  const pctDia = kcal != null ? Math.round((kcal / 2000) * 100) : null;
  const tarjetas = NUTRIENTES.map((n) => ({ ...n, g: ficha[n.clave] })).filter((n): n is (typeof n & { g: number }) => n.g != null);
  const sodioMg = ficha.sodio != null ? Math.round(ficha.sodio * 1000 * f) : null;
  const sodio100 = ficha.sodio != null ? ficha.sodio * 1000 : null;

  // Destacados: salen solos de los números de cada 100 g.
  const destacados: string[] = [];
  if (sodio100 != null && sodio100 <= 120) destacados.push(`🧂 ${t.bajoSodio}`);
  if (ficha.fibra != null && ficha.fibra >= 6) destacados.push(`🌾 ${t.altaFibra}`);
  else if (ficha.fibra != null && ficha.fibra >= 3) destacados.push(`🌾 ${t.fibra}`);
  if (ficha.proteinas != null && ficha.proteinas >= 20) destacados.push(`💪 ${t.proteina}`);
  if (ficha.clasificacion === "NATURAL") destacados.push(`💚 ${t.natural}`);

  const sel = tarjetas.find((n) => n.clave === elegido);

  // Sin macros (creatinas, cápsulas): en vez de cuatro tarjetas en 0 se destaca
  // lo que trae cada porción, sacado de «Por porción (5 g): creatina 5 g, …»
  // (Gonzalo, 2026-11-05: «distinguí el ingrediente que tenga»).
  const sinMacros = (ficha.kcal_100g ?? 0) === 0 && tarjetas.every((n) => n.g === 0);
  const textoActivos = idioma === "en" ? ficha.micronutrientes_en ?? ficha.micronutrientes : idioma === "pt" ? ficha.micronutrientes_pt ?? ficha.micronutrientes : ficha.micronutrientes;
  const activos = sinMacros && textoActivos ? leerActivos(textoActivos) : null;
  if (activos && activos.items.length > 0) {
    return (
      <div className="na listo">
        <div className="na-cab">
          <p className="na-eyebrow">{t.titulo}</p>
        </div>
        <div className="na-activo">
          <small>{activos.titulo ?? t.cadaPorcion}</small>
          {activos.items.map((x, i) => (
            <div key={x.que + i} style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
              <span>{x.que}</span>
              {x.cuanto && <b className={claseTitular}>{x.cuanto}</b>}
            </div>
          ))}
        </div>
        <div className="na-chips">
          {ficha.kcal_100g === 0 && <span style={{ transitionDelay: ".5s" }}>⚡ {t.sinCalorias}</span>}
          {destacados.map((d, i) => (
            <span key={d} style={{ transitionDelay: `${0.6 + i * 0.12}s` }}>
              {d}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`na${listo ? " listo" : ""}`}>
      <div className="na-cab">
        <p className="na-eyebrow">{t.titulo}</p>
        {gPorcion && (kcal != null || tarjetas.length > 0) && (
          <div className="na-toggle" role="group" aria-label={t.titulo}>
            {/* Primero la porción y después cada 100 g, en todos los productos (Gonzalo, 2026-11-07). */}
            <button type="button" className={porcion ? "on" : undefined} onClick={() => cambiar(true)}>
              {t.porcion} · {fmt(gPorcion)} g
            </button>
            <button type="button" className={!porcion ? "on" : undefined} onClick={() => cambiar(false)}>
              {t.cada}
            </button>
          </div>
        )}
      </div>

      {kcal != null && (
        <div className="na-kcal">
          <div>
            <b className={claseTitular}>
              <Contador key={`k${vuelta}`} hasta={kcal} />
            </b>
            <small>KCAL</small>
          </div>
          {pctDia != null && (
            <div className="na-dia">
              <span>{t.dia(pctDia)}</span>
              <div>
                <i style={{ transform: `scaleX(${listo ? Math.min(1, pctDia / 100) : 0})` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {tarjetas.length > 0 && (
        <div className="na-cartas">
          {tarjetas.map((n, i) => {
            const g = n.g * f;
            return (
              <button
                key={`${n.clave}-${vuelta}`}
                type="button"
                className={`na-carta${elegido && elegido !== n.clave ? " apagada" : ""}`}
                style={{ transitionDelay: listo ? `${0.2 + i * 0.18}s` : "0s" }}
                onClick={() => setElegido(elegido === n.clave ? null : n.clave)}
                aria-pressed={elegido === n.clave}
              >
                <span className="frente" style={{ background: n.color }}>
                  <small>{n.nombre[idioma]}</small>
                  <b className={claseTitular}>{fmt(g, 1)} g</b>
                  <span>
                    {Math.round((g / n.vd) * 100)} % {t.vd}
                  </span>
                </span>
                <span className="dorso" />
              </button>
            );
          })}
        </div>
      )}

      {tarjetas.length > 0 && (
        <p className="na-explica" style={sel ? { background: `${sel.color}1f` } : undefined}>
          {sel ? `${sel.nombre[idioma]}: ${sel.explica[idioma]}` : t.tocar}
        </p>
      )}

      {(destacados.length > 0 || sodioMg != null) && (
        <div className="na-chips">
          {sodioMg != null && (
            <span style={{ transitionDelay: "1.1s" }}>
              {t.sodio} · {fmt(sodioMg)} mg
            </span>
          )}
          {destacados.map((d, i) => (
            <span key={d} style={{ transitionDelay: `${1.25 + i * 0.12}s` }}>
              {d}
            </span>
          ))}
        </div>
      )}

      {tarjetas.length > 0 && <p className="na-nota">{t.nota}</p>}
    </div>
  );
}
