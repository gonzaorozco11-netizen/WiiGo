// Clima real para la pantalla de reposo del totem (self-checkout). Usa
// Open-Meteo (gratis, sin API key) — si el local todavía no tiene
// latitud/longitud cargada, cae en Mendoza capital como aproximación, y si
// el servicio falla por cualquier motivo, cae en "soleado" para no romper
// nunca la pantalla del totem.
//
// Documentación: https://open-meteo.com/en/docs

export type Clima = "soleado" | "nublado" | "lluvia" | "tormenta";

const LAT_MENDOZA = -32.8908;
const LON_MENDOZA = -68.8272;

// Códigos WMO que devuelve Open-Meteo en "weather_code".
function categorizarClima(weatherCode: number): Clima {
  if ([95, 96, 99].includes(weatherCode)) return "tormenta";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 85, 86].includes(weatherCode)) return "lluvia";
  if ([0, 1, 2].includes(weatherCode)) return "soleado";
  return "nublado"; // 3 (cubierto), 45/48 (niebla), o cualquier código no contemplado
}

export async function obtenerClimaActual(latitud: number | null, longitud: number | null): Promise<Clima> {
  const lat = latitud ?? LAT_MENDOZA;
  const lon = longitud ?? LON_MENDOZA;
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code`,
      { cache: "no-store" }
    );
    if (!res.ok) return "soleado";
    const data = await res.json();
    const code = data?.current?.weather_code;
    if (typeof code !== "number") return "soleado";
    return categorizarClima(code);
  } catch {
    return "soleado";
  }
}
