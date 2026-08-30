// Argentina no tiene horario de verano desde 2009 (UTC-3 fijo todo el año),
// pero el servidor (Vercel) corre en UTC — sin esto, comparar la hora
// "ahora" contra un horario tipo "09:00" con Date.setHours()/getHours()
// compara en el huso horario del servidor, no el de Argentina, y todo
// fichaje sale con ~3hs de diferencia de más. Se resuelve con
// Intl.DateTimeFormat, que sí permite fijar la zona horaria a mano.
const ZONA = "America/Argentina/Buenos_Aires";

export function fechaHoraArgentina(momento: Date | string = new Date()) {
  const fecha = typeof momento === "string" ? new Date(momento) : momento;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(fecha);
  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value])) as Record<string, string>;
  const horaNum = mapa.hour === "24" ? 0 : Number(mapa.hour);

  const diaSemanaISO = (() => {
    const d = new Date(`${mapa.year}-${mapa.month}-${mapa.day}T12:00:00Z`);
    const dow = d.getUTCDay();
    return dow === 0 ? 7 : dow;
  })();

  return {
    fecha: `${mapa.year}-${mapa.month}-${mapa.day}`,
    hora: `${String(horaNum).padStart(2, "0")}:${mapa.minute}`,
    minutosDelDia: horaNum * 60 + Number(mapa.minute),
    diaSemanaISO,
  };
}

export function minutosDeHora(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}
