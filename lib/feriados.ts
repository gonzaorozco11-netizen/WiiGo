// Los feriados nacionales, calculados.
//
// Sin tabla y sin cargarlos a mano: son los mismos todos los años y las dos
// fechas que se mueven se pueden calcular. Una lista que hay que mantener es
// una lista que en marzo ya está desactualizada.
//
// OJO, LO QUE ACÁ NO ESTÁ: los puentes turísticos. Los fija el Poder
// Ejecutivo por decreto cada año y no salen de ninguna cuenta — no se pueden
// adivinar, así que no se inventan. Si hace falta que figuren, van cargados
// como evento del calendario, que es donde WiiGo pone lo que decide.

/** Domingo de Pascua, de donde salen Carnaval y Viernes Santo. */
function pascua(anio: number): Date {
  // Algoritmo de Meeus/Jones/Butcher para el calendario gregoriano.
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function masDias(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/** Los que caen siempre el mismo día y no se mueven. */
const FIJOS: [number, number, string][] = [
  [1, 1, "Año Nuevo"],
  [3, 24, "Día de la Memoria"],
  [4, 2, "Veteranos y Caídos en Malvinas"],
  [5, 1, "Día del Trabajador"],
  [5, 25, "Revolución de Mayo"],
  [6, 20, "Paso a la Inmortalidad del Gral. Belgrano"],
  [7, 9, "Día de la Independencia"],
  [12, 8, "Inmaculada Concepción"],
  [12, 25, "Navidad"],
];

/**
 * Los trasladables de la ley 27.399: si caen martes o miércoles se corren al
 * lunes anterior, y si caen jueves o viernes al lunes siguiente. Lunes, sábado
 * y domingo quedan donde están.
 */
const TRASLADABLES: [number, number, string][] = [
  [6, 17, "Paso a la Inmortalidad del Gral. Güemes"],
  [8, 17, "Paso a la Inmortalidad del Gral. San Martín"],
  [10, 12, "Respeto a la Diversidad Cultural"],
  [11, 20, "Día de la Soberanía Nacional"],
];

function trasladar(d: Date): Date {
  const dow = d.getUTCDay(); // 0 domingo … 6 sábado
  if (dow === 2 || dow === 3) return masDias(d, -(dow - 1));
  if (dow === 4 || dow === 5) return masDias(d, 8 - dow);
  return d;
}

/**
 * Los feriados nacionales de un año, por fecha.
 *
 * Se calcula entero en vez de guardarse: así el almanaque de 2027 ya está
 * bien hoy, sin que nadie se acuerde de cargarlo en enero.
 */
export function feriadosDelAnio(anio: number): Map<string, string> {
  const m = new Map<string, string>();

  for (const [mes, dia, nombre] of FIJOS) {
    m.set(iso(new Date(Date.UTC(anio, mes - 1, dia))), nombre);
  }
  for (const [mes, dia, nombre] of TRASLADABLES) {
    m.set(iso(trasladar(new Date(Date.UTC(anio, mes - 1, dia)))), nombre);
  }

  const p = pascua(anio);
  m.set(iso(masDias(p, -48)), "Carnaval");
  m.set(iso(masDias(p, -47)), "Carnaval");
  m.set(iso(masDias(p, -2)), "Viernes Santo");

  return m;
}

/**
 * Los feriados de varios años en un solo mapa.
 *
 * El almanaque cruza diciembre sin enterarse, así que pedirle los feriados de
 * "este año" dejaría enero en blanco cada vez.
 */
export function feriadosEntre(anioDesde: number, anioHasta: number): Map<string, string> {
  const todos = new Map<string, string>();
  for (let a = anioDesde; a <= anioHasta; a++) {
    for (const [fecha, nombre] of feriadosDelAnio(a)) todos.set(fecha, nombre);
  }
  return todos;
}
