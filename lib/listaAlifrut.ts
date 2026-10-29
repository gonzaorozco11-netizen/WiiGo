// Lee la lista de precios exclusiva de Alifrut tal como sale al copiarla de su
// página (Lista de precios → Ctrl+A, Ctrl+C) y la pega Gonzalo en Precios.
// Sin imports: corre en el servidor y en las pruebas.
//
// Cómo viene el texto (2026-10-29): arriba la página con las tarjetas, que se
// ignoran, y después la lista, un producto por bloque separado por una línea
// en blanco:
//
//   Aceites de oliva            ← categoría: sola, pegada al bloque anterior
//                               ← en blanco
//   Aceite De Ajo x500cc        ← nombre
//   Doña Juana                  ← marca (a veces no está)
//   1 unidad<TAB>$4.813,00      ← presentación y precio final con IVA
//   (3.977,69 sin IVA)          ← el costo que se usa
//
// Las tarjetas de arriba tienen el precio en una línea sola, sin presentación
// adelante, así que nunca coinciden con PRECIO.

export type UnidadLista = "KG" | "BOLSA" | "CAJA" | "UNIDAD";

export type ItemLista = {
  clave: string;
  categoria: string | null;
  nombre: string;
  marca: string | null;
  presentacion: string;
  precioFinal: number;
  costoNeto: number;
  unidad: UnidadLista;
  /** kg de la bolsa o unidades de la caja; 1 en KG y UNIDAD. */
  cantidad: number;
  /** false cuando la unidad salió de adivinar el nombre: conviene que la mire Gonzalo. */
  segura: boolean;
};

const PRECIO = /^(.*?\S)\s*\t\s*\$\s*([\d.]+,\d{1,2})\s*$|^(x?\s*[\d.,]+\s*(?:kg|gr?|u|unidad(?:es)?|bolsa|lt|cc|ml)\.?|1\s+unidad|x\s*1\s+unidad|x\s*1\s+bolsa|x1u)\s+\$\s*([\d.]+,\d{1,2})\s*$/i;
const SIN_IVA = /^\(\s*([\d.]+,\d{1,2})\s*sin\s+iva\s*\)$/i;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const aNumero = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

export function normalizar(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function claveItem(nombre: string, marca: string | null, presentacion: string) {
  const pres = normalizar(presentacion).replace(/\s/g, "").replace(/^x/, "").replace(/unidad(es)?/, "u");
  return `${normalizar(nombre)}|${normalizar(marca ?? "")}|${pres}`;
}

/** Cómo viene: por kg, en bolsa de tantos kg, en caja de tantas unidades, o de a una. */
export function detectarUnidad(nombre: string, presentacion: string): { unidad: UnidadLista; cantidad: number; segura: boolean } {
  const pres = normalizar(presentacion).replace(/\s/g, "");
  const kg = /^x?([\d.,]+)kg$/.exec(pres);
  if (kg) {
    const n = aNumero(kg[1]);
    if (n === 1) return { unidad: "KG", cantidad: 1, segura: true };
    if (n > 0) return { unidad: "BOLSA", cantidad: n, segura: true };
  }
  // Solo cuando dice que es una caja: "Cápsulas x90u" es un frasco de 90, que se vende entero.
  const caja = /(?:display|caja|pack|bulto)\s*x\s*(\d+)(?!\s*(?:kg|gr?|g)\b)/i.exec(nombre);
  if (caja && Number(caja[1]) > 1) return { unidad: "CAJA", cantidad: Number(caja[1]), segura: false };
  const bolsa = /x\s*([\d.,]+)\s*kg\b/i.exec(nombre);
  if (bolsa) {
    const n = aNumero(bolsa[1]);
    if (n > 1) return { unidad: "BOLSA", cantidad: n, segura: false };
  }
  return { unidad: "UNIDAD", cantidad: 1, segura: false };
}

function leerFecha(lineas: string[]): string | null {
  const i = lineas.findIndex((l) => /^última actualización/i.test(l.trim()));
  const texto = (i >= 0 ? `${lineas[i]} ${lineas[i + 1] ?? ""}` : "").toLowerCase();
  const m = /(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/.exec(texto);
  if (!m) return null;
  const mes = MESES.indexOf(normalizar(m[2]));
  return mes < 0 ? null : `${m[3]}-${String(mes + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function leerListaAlifrut(texto: string): { fecha: string | null; items: ItemLista[] } {
  const L = texto.replace(/\r/g, "").split("\n");
  const vacia = (s: string | undefined) => s === undefined || s.trim() === "";
  const porClave = new Map<string, ItemLista>();
  let categoria: string | null = null;

  for (let i = 0; i < L.length; i++) {
    const m = PRECIO.exec(L[i].trim());
    if (!m) continue;
    const costo = SIN_IVA.exec((L[i + 1] ?? "").trim());
    if (!costo) continue;
    const presentacion = (m[1] ?? m[3]).trim();
    const precioFinal = aNumero(m[2] ?? m[4]);

    // Hacia arriba: nombre y marca hasta la línea en blanco.
    const bloque: string[] = [];
    let j = i - 1;
    while (j >= 0 && !vacia(L[j]) && !SIN_IVA.test(L[j].trim()) && !PRECIO.test(L[j].trim())) {
      bloque.unshift(L[j].trim());
      j--;
    }
    if (bloque.length === 0) continue;
    // Si la categoría vino pegada al nombre, sin línea en blanco en el medio.
    if (bloque.length >= 3 && bloque[bloque.length - 3].length <= 60) categoria = bloque[bloque.length - 3];
    // Arriba de la línea en blanco: si no es el final de otro producto, es la categoría.
    if (vacia(L[j])) {
      let k = j;
      while (k >= 0 && vacia(L[k])) k--;
      const arriba = (L[k] ?? "").trim();
      if (arriba && !SIN_IVA.test(arriba) && !PRECIO.test(arriba) && arriba.length <= 60) categoria = arriba;
    }
    const [nombre, marca] = bloque.length >= 2 ? bloque.slice(-2) : [bloque[0], null];
    const u = detectarUnidad(nombre, presentacion);
    const clave = claveItem(nombre, marca, presentacion);
    porClave.set(clave, { clave, categoria, nombre, marca, presentacion, precioFinal, costoNeto: aNumero(costo[1]), ...u });
  }
  return { fecha: leerFecha(L), items: [...porClave.values()] };
}
