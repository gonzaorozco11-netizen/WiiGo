// Clima real para la pantalla de reposo del totem (self-checkout). Usa
// Open-Meteo (gratis, sin API key) — si el local todavía no tiene
// latitud/longitud cargada, cae en Mendoza capital como aproximación, y si
// el servicio falla por cualquier motivo, cae en "soleado" para no romper
// nunca la pantalla del totem.
//
// Documentación: https://open-meteo.com/en/docs

import { fechaHoraArgentina } from "@/lib/horarios";

export type Clima = "soleado" | "nublado" | "lluvia" | "tormenta";

// Si es de día o de noche lo decide Open-Meteo con el amanecer/atardecer
// reales de esa latitud (campo is_day), no una hora fija — así el cielo del
// totem acompaña al de afuera todo el año sin tocar nada.
//
// `amanecer` y `atardecer` (instantes en ms) viajan al tótem para que cada uno
// decida la noche con su propio reloj, minuto a minuto: los dos tótems pasan
// a la noche al mismo tiempo, en vez de esperar cada uno su próxima consulta
// (Gonzalo, 2026-11-12: uno quedaba de día y el otro de noche).
export type EstadoCielo = { clima: Clima; esDeNoche: boolean; amanecer?: number | null; atardecer?: number | null };

const LAT_MENDOZA = -32.8908;
const LON_MENDOZA = -68.8272;

// Códigos WMO que devuelve Open-Meteo en "weather_code".
function categorizarClima(weatherCode: number): Clima {
  if ([95, 96, 99].includes(weatherCode)) return "tormenta";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 85, 86].includes(weatherCode)) return "lluvia";
  if ([0, 1, 2].includes(weatherCode)) return "soleado";
  return "nublado"; // 3 (cubierto), 45/48 (niebla), o cualquier código no contemplado
}

// Respaldo por hora local cuando la API no responde: mejor un cielo
// nocturno aproximado que uno de día a las 3 de la mañana.
function esDeNochePorHora() {
  const { minutosDelDia } = fechaHoraArgentina();
  return minutosDelDia < 7 * 60 || minutosDelDia >= 20 * 60;
}

// La noche del tótem arranca un rato antes de que se ponga el sol y termina un
// rato después de que sale: con el sol bajo ya se ve oscuro afuera, y un cielo
// de día a las 20:12 con la calle a oscuras queda raro (Gonzalo, 2026-11-09).
const ANTES_DEL_ATARDECER_MIN = 30;
const DESPUES_DEL_AMANECER_MIN = 20;

/** ¿Es de noche a esta hora, con el amanecer y el atardecer de hoy? (también la usa el tótem) */
export function esDeNocheSegunSol(amanecer: number, atardecer: number, ahora: number): boolean {
  return ahora < amanecer + DESPUES_DEL_AMANECER_MIN * 60000 || ahora >= atardecer - ANTES_DEL_ATARDECER_MIN * 60000;
}

/**
 * El amanecer y el atardecer de hoy, en ms. Open-Meteo los da en hora local
 * del lugar (sin zona), con el desfase aparte. null si no vinieron.
 */
function solDeHoy(data: { utc_offset_seconds?: number; daily?: { sunrise?: string[]; sunset?: string[] } }): { amanecer: number; atardecer: number } | null {
  const sale = data?.daily?.sunrise?.[0];
  const pone = data?.daily?.sunset?.[0];
  const desfase = data?.utc_offset_seconds;
  if (!sale || !pone || typeof desfase !== "number") return null;
  const aUtc = (local: string) => Date.parse(`${local}:00Z`) - desfase * 1000;
  const amanecer = aUtc(sale);
  const atardecer = aUtc(pone);
  if (!Number.isFinite(amanecer) || !Number.isFinite(atardecer)) return null;
  return { amanecer, atardecer };
}

export async function obtenerClimaActual(latitud: number | null, longitud: number | null): Promise<EstadoCielo> {
  const lat = latitud ?? LAT_MENDOZA;
  const lon = longitud ?? LON_MENDOZA;
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=1`,
      { cache: "no-store" }
    );
    if (!res.ok) return { clima: "soleado", esDeNoche: esDeNochePorHora() };
    const data = await res.json();
    const code = data?.current?.weather_code;
    const isDay = data?.current?.is_day;
    const sol = solDeHoy(data);
    const esDeNoche = sol ? esDeNocheSegunSol(sol.amanecer, sol.atardecer, Date.now()) : typeof isDay === "number" ? isDay === 0 : esDeNochePorHora();
    const conSol = { amanecer: sol?.amanecer ?? null, atardecer: sol?.atardecer ?? null };
    if (typeof code !== "number") return { clima: "soleado", esDeNoche, ...conSol };
    return { clima: categorizarClima(code), esDeNoche, ...conSol };
  } catch {
    return { clima: "soleado", esDeNoche: esDeNochePorHora() };
  }
}
