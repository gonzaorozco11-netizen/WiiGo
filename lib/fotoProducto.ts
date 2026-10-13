/**
 * La foto de producto, revisada y normalizada en el navegador de la marca.
 *
 * El estándar de fotos existía como texto al pie del formulario, y un texto
 * al pie lo cumple el que ya iba a cumplirlo. Con ocho marcas subiendo a su
 * criterio, la góndola del tótem termina con una foto sobre madera, una
 * captura de pantalla con el logo de otra tienda encima y una de 400 px
 * borrosa. Después no hay forma de arreglarlo salvo pedirlas de nuevo una
 * por una.
 *
 * Así que la regla se aplica donde se elige el archivo: lo que no cumple no
 * llega a subirse, y lo que cumple sale de acá ya cuadrado, a LADO px y en
 * WebP, igual que todas las demás.
 *
 * Esto corre SOLO en el navegador (usa Image y canvas). No lo importes desde
 * un Server Component ni desde un "use server".
 *
 * Lo que NO puede ver una máquina —desenfoque, luz fea, el envase sucio, una
 * marca de agua en el medio— lo ve Gonzalo al aprobar la solicitud. Esto
 * filtra lo objetivo; el ojo sigue siendo el último candado.
 */

/** El lado de la foto que termina en la góndola y en el tótem. */
export const LADO = 1000;

/** Por debajo de esto no se puede agrandar sin que se note. */
export const LADO_MINIMO = 1000;

/** Un píxel "blanco de fondo": claro y sin color. */
const CLARO = 232;
const SIN_COLOR = 14;

/** Cuánto del borde se mira, como fracción del lado. */
const ANCHO_BORDE = 0.04;

/** Desde acá el borde se considera limpio. */
const BORDE_LIMPIO = 0.97;

/** Lado de cada parche de esquina, como fracción del lado. */
const ESQUINA = 0.12;

/** Desde acá las esquinas dicen que el fondo es blanco. */
const ESQUINAS_BLANCAS = 0.8;

export type Regla = {
  id: "peso" | "tamano" | "fondo" | "encuadre";
  texto: string;
  ok: boolean;
};

export type RevisionFoto = {
  /** La foto ya cuadrada, a LADO px y en WebP. Null si no pasó. */
  archivo: File | null;
  /** Object URL de `archivo`, para el preview. Acordate de revocarlo. */
  vista: string | null;
  /** El problema, en castellano y con qué hacer. Null si está bien. */
  error: string | null;
  reglas: Regla[];
};

/** 8 MB: una foto de celular sin comprimir entra, un video no. */
const PESO_MAXIMO = 8 * 1024 * 1024;

export async function revisarFoto(archivo: File): Promise<RevisionFoto> {
  const reglas: Regla[] = [
    { id: "peso", texto: "Pesa menos de 8 MB", ok: false },
    { id: "tamano", texto: `Mide ${LADO_MINIMO} px o más de lado`, ok: false },
    { id: "fondo", texto: "El fondo es blanco", ok: false },
    { id: "encuadre", texto: "El producto entra entero, sin tocar los bordes", ok: false },
  ];
  const marcar = (id: Regla["id"], ok: boolean) => {
    const r = reglas.find((x) => x.id === id);
    if (r) r.ok = ok;
  };
  const fallo = (error: string): RevisionFoto => ({ archivo: null, vista: null, error, reglas });

  if (!archivo.type.startsWith("image/")) return fallo("Eso no es una imagen.");
  if (archivo.size > PESO_MAXIMO) {
    return fallo("La foto pesa más de 8 MB. Mandala un poco más chica.");
  }
  marcar("peso", true);

  let img: HTMLImageElement;
  try {
    img = await cargar(archivo);
  } catch {
    return fallo("No pudimos abrir esa imagen. Probá con un JPG o un PNG.");
  }

  const ancho = img.naturalWidth;
  const alto = img.naturalHeight;
  if (Math.min(ancho, alto) < LADO_MINIMO) {
    return fallo(
      `Esta foto mide ${ancho}×${alto}. Necesitamos ${LADO_MINIMO}×${LADO_MINIMO} como mínimo: ` +
        `más chica se ve borrosa en la pantalla del local.`
    );
  }
  marcar("tamano", true);

  // Dos medidas, porque los dos problemas se arreglan distinto y mandar a la
  // marca a cambiar el fondo cuando el fondo estaba bien le cuesta una tarde.
  //
  // Las ESQUINAS dicen de qué color es el fondo: un producto puede tocar un
  // borde, pero casi nunca ocupa las cuatro esquinas. Si están sucias, lo que
  // hay atrás es una mesa.
  //
  // El MARCO entero dice si el producto entra: con fondo blanco confirmado,
  // cualquier mancha en el marco es el producto saliéndose.
  const medidas = medirBordes(img);
  if (!medidas) {
    return fallo("No pudimos revisar esa imagen. Probá con un JPG o un PNG.");
  }
  if (medidas.esquinas < ESQUINAS_BLANCAS) {
    return fallo(
      "El fondo no es blanco. Sacala contra una pared blanca o apoyá el producto sobre una hoja."
    );
  }
  marcar("fondo", true);
  if (medidas.marco < BORDE_LIMPIO) {
    return fallo(
      "El producto se sale del encuadre. Alejá un poco la cámara: tiene que entrar entero y " +
        "quedar aire blanco alrededor."
    );
  }
  marcar("encuadre", true);

  const normalizada = await normalizar(img, archivo.name);
  if (!normalizada) return fallo("No pudimos preparar la foto. Probá con un JPG o un PNG.");

  return {
    archivo: normalizada,
    vista: URL.createObjectURL(normalizada),
    error: null,
    reglas,
  };
}

function cargar(archivo: File): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolver(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rechazar(new Error("no carga"));
    };
    img.src = url;
  });
}

/**
 * Qué parte del marco exterior y de las cuatro esquinas es blanco de fondo.
 *
 * Se mira sobre una copia chica: alcanza para los dos promedios y evita
 * recorrer doce millones de píxeles en el navegador de la marca.
 */
function medirBordes(img: HTMLImageElement): { marco: number; esquinas: number } | null {
  const lado = 240;
  const lienzo = document.createElement("canvas");
  lienzo.width = lado;
  lienzo.height = lado;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // Deformarla a un cuadrado no importa: solo se mira el color del borde.
  ctx.drawImage(img, 0, 0, lado, lado);

  let datos: ImageData;
  try {
    datos = ctx.getImageData(0, 0, lado, lado);
  } catch {
    return null;
  }

  const grosor = Math.max(2, Math.round(lado * ANCHO_BORDE));
  const esquina = Math.max(3, Math.round(lado * ESQUINA));
  let marcoTotal = 0;
  let marcoBlanco = 0;
  let esqTotal = 0;
  let esqBlanco = 0;

  for (let y = 0; y < lado; y++) {
    const enFilaDeMarco = y < grosor || y >= lado - grosor;
    const enFilaDeEsquina = y < esquina || y >= lado - esquina;
    for (let x = 0; x < lado; x++) {
      const enMarco = enFilaDeMarco || x < grosor || x >= lado - grosor;
      const enEsquina = enFilaDeEsquina && (x < esquina || x >= lado - esquina);
      if (!enMarco && !enEsquina) continue;

      const i = (y * lado + x) * 4;
      const r = datos.data[i];
      const g = datos.data[i + 1];
      const b = datos.data[i + 2];
      const a = datos.data[i + 3];
      // Un PNG con fondo transparente se compone sobre blanco al subirlo, así
      // que acá cuenta como blanco.
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const blanco = a < 24 || (min >= CLARO && max - min <= SIN_COLOR);

      if (enMarco) {
        marcoTotal++;
        if (blanco) marcoBlanco++;
      }
      if (enEsquina) {
        esqTotal++;
        if (blanco) esqBlanco++;
      }
    }
  }

  if (marcoTotal === 0 || esqTotal === 0) return null;
  return { marco: marcoBlanco / marcoTotal, esquinas: esqBlanco / esqTotal };
}

/**
 * La deja cuadrada, a LADO px y en WebP.
 *
 * El relleno para llegar al cuadrado es blanco, que es el mismo fondo que ya
 * se exigió: una foto vertical queda centrada sin que se note el agregado, y
 * así la marca no tiene que recortarla a mano antes de subirla.
 */
async function normalizar(img: HTMLImageElement, nombre: string): Promise<File | null> {
  const lienzo = document.createElement("canvas");
  lienzo.width = LADO;
  lienzo.height = LADO;
  const ctx = lienzo.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LADO, LADO);

  const escala = LADO / Math.max(img.naturalWidth, img.naturalHeight);
  const ancho = Math.round(img.naturalWidth * escala);
  const alto = Math.round(img.naturalHeight * escala);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, Math.round((LADO - ancho) / 2), Math.round((LADO - alto) / 2), ancho, alto);

  // WebP pesa la mitad que JPG con la misma calidad. Safari viejo no lo
  // codifica y devuelve null o un PNG enorme: ahí se cae a JPG, que entiende
  // todo el mundo.
  let blob = await aBlob(lienzo, "image/webp", 0.9);
  let extension = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await aBlob(lienzo, "image/jpeg", 0.9);
    extension = "jpg";
  }
  if (!blob) return null;

  const base = nombre.replace(/\.[^.]+$/, "").slice(0, 60) || "foto";
  return new File([blob], `${base}.${extension}`, { type: blob.type });
}

function aBlob(lienzo: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((resolver) => lienzo.toBlob(resolver, tipo, calidad));
}
