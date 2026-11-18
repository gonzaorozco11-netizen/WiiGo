/**
 * El clima de ahora en el lugar de donde viene cada producto («Del mundo» de la tienda, Gonzalo 18/11).
 *
 * GET /api/tienda/clima?k=egipto → { t: 27, cond: "despejado", ic: "☀️", efecto: "", dia: true }
 *
 * Lo da el instituto meteorológico de Noruega (api.met.no, gratis y se puede usar en un negocio; pide
 * identificarse y no preguntar de más). Vercel guarda cada respuesta 30 minutos: aunque mucha gente mire,
 * son como mucho 2 pedidos por hora por lugar. Solo se pide cuando alguien toca un lugar (nada de
 * consultas solas cada pocos segundos, que gastan el plan de Vercel).
 *
 * Los puntos son el lugar de la foto / de donde sale el producto, no el centro del país.
 */
export const dynamic = "force-dynamic";

const PUNTOS: Record<string, [number, number]> = {
  egipto: [29.98, 31.13], // Giza
  argelia: [32.49, 3.67], // oasis del Sahara (Ghardaïa)
  pakistan: [32.65, 73.01], // Khewra, la mina de sal rosa
  bolivia: [-20.46, -66.83], // Uyuni
  vietnam: [11.75, 106.72], // Bình Phước, zona del cajú
  brasil: [-3.73, -38.52], // nordeste (Fortaleza)
  china: [40.65, 109.84], // norte de China
  eeuu: [41.76, -70.72], // los campos de arándanos de Massachusetts
  misiones: [-27.49, -55.12], // Oberá
  mendoza: [-32.89, -68.84],
  argentina: [-33.89, -60.57], // la pampa (Pergamino)
};

type Clima = { t: number; cond: string; ic: string; efecto: "" | "lluvia" | "nieve"; dia: boolean | null };

// met.no manda un «symbol_code» como «clearsky_day», «lightrain», «heavysnowshowers_night».
function traducir(codigo: string): Omit<Clima, "t"> {
  const dia = codigo.endsWith("_day") ? true : codigo.endsWith("_night") ? false : null;
  const c = codigo.replace(/_(day|night|polartwilight)$/, "");
  if (/thunder/.test(c)) return { cond: "tormenta", ic: "⛈️", efecto: "lluvia", dia };
  if (/snow|sleet/.test(c)) return { cond: "nevando", ic: "❄️", efecto: "nieve", dia };
  if (/rain|showers/.test(c)) return { cond: /light/.test(c) ? "llovizna" : "lluvia", ic: "🌧️", efecto: "lluvia", dia };
  if (c === "fog") return { cond: "niebla", ic: "🌫️", efecto: "", dia };
  if (c === "cloudy") return { cond: "nublado", ic: "☁️", efecto: "", dia };
  if (c === "partlycloudy" || c === "fair") return { cond: "algo nublado", ic: dia === false ? "☁️" : "⛅", efecto: "", dia };
  return { cond: "despejado", ic: dia === false ? "🌙" : "☀️", efecto: "", dia };
}

export async function GET(req: Request) {
  const k = new URL(req.url).searchParams.get("k") ?? "";
  const p = PUNTOS[k];
  if (!p) return Response.json({ error: "Lugar desconocido." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${p[0]}&lon=${p[1]}`, {
      headers: { "User-Agent": "WiiGoTienda/1.0 (+https://wiigo.com.ar)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error("met.no " + r.status);
    const j = (await r.json()) as {
      properties?: { timeseries?: { data?: { instant?: { details?: { air_temperature?: number } }; next_1_hours?: { summary?: { symbol_code?: string } }; next_6_hours?: { summary?: { symbol_code?: string } } } }[] };
    };
    const ahora = j.properties?.timeseries?.[0]?.data;
    const t = ahora?.instant?.details?.air_temperature;
    const codigo = ahora?.next_1_hours?.summary?.symbol_code ?? ahora?.next_6_hours?.summary?.symbol_code ?? "";
    if (typeof t !== "number" || !codigo) throw new Error("respuesta sin datos");
    const clima: Clima = { t: Math.round(t), ...traducir(codigo) };
    return Response.json(clima, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=1800" } });
  } catch (e) {
    console.error("[tienda/clima]", k, e);
    // Sin clima la tienda muestra solo la hora: no es para cortar nada.
    return Response.json({ error: "Sin clima por ahora." }, { status: 503, headers: { "Cache-Control": "public, s-maxage=300" } });
  }
}
