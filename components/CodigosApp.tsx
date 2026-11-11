"use client";

import { createContext, Fragment, useContext, useEffect, useMemo, useState, useSyncExternalStore, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import PestanasEtiquetas from "@/components/PestanasEtiquetas";
import { esCodigoInterno, limpiarCodigoBarras, formatearCodigo } from "@/lib/codigos";
import {
  PIE_ETIQUETA_DEFECTO,
  calcularVencimiento,
  duracionSugerida,
  fechaCorta,
  pesoEtiqueta,
} from "@/lib/rotulado";
import { nombreBase } from "@/lib/nombreProducto";
import FiltroSeleccion, { coincide, subcategoriasDe } from "@/components/FiltroSeleccion";
import { anotarCodigosImpresos, guardarCodigoBarras, marcarMarcaSinCodigo, marcarProductoSinCodigo, volverAEtiquetaWiigo } from "@/app/(app)/codigos/actions";
import type { EntradaPendiente } from "@/lib/entradas";
import EscanerCodigo from "@/components/EscanerCodigo";
import CodigoDeBarras from "@/components/CodigoDeBarras";

export type ItemCodigo = {
  idVariante: string;
  producto: string;
  /** El sabor o el tamaño. null cuando el producto no tiene variaciones. */
  variante: string | null;
  sku: string | null;
  imagen: string | null;
  codigo: string | null;
  marca: string | null;
  /** Marca propia (WiiGo Dietética): la etiqueta dice WiiGo y no el nombre de la marca. */
  propia?: boolean;
  /** Solo en lo que fraccionamos nosotros (marca propia): va el rótulo completo. */
  rotulo?: RotuloItem | null;
  /** La marca de fábrica, para mostrar en la lista al lado del nombre (no va en la etiqueta). */
  marcaFabrica?: string | null;
  /**
   * Viene cerrado de fábrica y trae su código impreso: se escanea una vez en
   * vez de imprimirle sticker. false = lo embolsamos nosotros y lleva el nuestro.
   */
  envasado?: boolean;
  idMarca?: string;
  /** La marca está marcada como «sus envases no traen código» (Alta, Fruppi). */
  marcaSinCodigo?: boolean;
  idProducto?: string;
  /** Este producto suelto viene cerrado pero sin código (granolas de 1 kg): lleva sticker. */
  productoSinCodigo?: boolean;
  /** Unidades en stock: al marcarlo para imprimir, la cantidad arranca en esto (Gonzalo, 2026-11-11). */
  stock?: number;
  /** Para elegir qué imprimir por subcategoría («Frutos secos»). */
  subcategoria?: string | null;
};

export type RotuloItem = {
  pesoG: number | null;
  /** null = no está cargado y se usa la duración sugerida. */
  dias: number | null;
  alergenos: string | null;
  trazas: string | null;
};

/**
 * Lo que vale para toda la tanda que se imprime: el pie y las fechas.
 * conVencimiento: si va la fecha impresa o «Vto: ____» para escribirla a mano
 * (Gonzalo, 2026-11-06: «como no tengo la fecha de venc. de momento, que no salga»).
 */
type DatosTanda = { pie: string; envasado: string; venceBolsa: string | null; conVencimiento: boolean };
const TandaContext = createContext<DatosTanda>({ pie: PIE_ETIQUETA_DEFECTO, envasado: hoyIso(), venceBolsa: null, conVencimiento: false });

function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Los primeros de una lista larga y cuántos más quedan. */
function resumirLista(textos: string[], hasta = 6) {
  const resto = textos.length - hasta;
  return textos.slice(0, hasta).join(" · ") + (resto > 0 ? ` y ${resto} más` : "");
}

/** El rótulo completo no entra en una etiqueta chica: hace falta 60 × 30 mm o más. */
function entraRotulo(medida: { ancho: number; alto: number }) {
  return medida.ancho >= 60 && medida.alto >= 30;
}

const SIN_MARCA = "Marcas que no están activas";

/** El ajuste de la hoja: x/y mueven todo; fx/fy es lo que se corre cada renglón (se acumula). */
type AjusteHoja = { x: number; y: number; fx: number; fy: number };
const SIN_AJUSTE: AjusteHoja = { x: 0, y: 0, fx: 0, fy: 0 };
const SIN_SUBCATEGORIA = "Sin subcategoría";

/** Los productos de una marca por subcategoría, en orden, y lo que no tiene al final. */
function subgruposDe(items: ItemCodigo[]): [string, ItemCodigo[]][] {
  const m = new Map<string, ItemCodigo[]>();
  for (const i of items) {
    const k = i.subcategoria?.trim() || SIN_SUBCATEGORIA;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(i);
  }
  return [...m.entries()].sort(([a], [b]) => (a === SIN_SUBCATEGORIA ? 1 : b === SIN_SUBCATEGORIA ? -1 : a.localeCompare(b, "es")));
}

// Cuándo se imprimió cada código por última vez (id_variante → fecha). Se anota
// al confirmar «Sí, salió bien» o con «Ya tienen sticker». Se guarda en este
// aparato (para que se vea al toque) y en la base (anotarCodigosImpresos), así
// lo ya etiquetado sale de «Sin sticker todavía» en cualquier aparato.
const CLAVE_IMPRESOS = "codigos.impresos";
const SIN_IMPRESOS: Record<string, string> = {};
let impresosTexto: string | null = null;
let impresosCache: Record<string, string> = SIN_IMPRESOS;
function leerImpresos(): Record<string, string> {
  let t: string | null = null;
  try {
    t = localStorage.getItem(CLAVE_IMPRESOS);
  } catch {}
  if (t !== impresosTexto) {
    impresosTexto = t;
    try {
      impresosCache = t ? (JSON.parse(t) as Record<string, string>) : SIN_IMPRESOS;
    } catch {
      impresosCache = SIN_IMPRESOS;
    }
  }
  return impresosCache;
}
function suscribirImpresos(avisar: () => void) {
  window.addEventListener("storage", avisar);
  window.addEventListener(CLAVE_IMPRESOS, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(CLAVE_IMPRESOS, avisar);
  };
}
function anotarImpresos(ids: string[]) {
  const ahora = new Date().toISOString();
  const nuevo = { ...leerImpresos() };
  for (const id of ids) nuevo[id] = ahora;
  try {
    localStorage.setItem(CLAVE_IMPRESOS, JSON.stringify(nuevo));
  } catch {}
  window.dispatchEvent(new Event(CLAVE_IMPRESOS));
  anotarCodigosImpresos(Object.fromEntries(ids.map((id) => [id, ahora]))).catch(() => {});
}
/** «hoy», «ayer» o «el 5/11». */
function cuandoImpreso(iso: string) {
  const dia = (d: Date) => d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  const d = new Date(iso);
  if (dia(d) === dia(new Date())) return "hoy";
  if (dia(d) === dia(new Date(Date.now() - 86400000))) return "ayer";
  return `el ${d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric" })}`;
}

/**
 * Las planchas de etiquetas que se consiguen acá.
 *
 * Las medidas son las que vienen impresas en el paquete. `margenX` y `margenY`
 * son el borde de papel que la plancha deja antes de la primera etiqueta: si no
 * se respeta, todo sale corrido media etiqueta y se arruina la hoja entera.
 */
const PLANCHAS = [
  // La que usa el local: paquete de 25 hojas, 2000 etiquetas, 5 columnas por
  // 16 filas. Medida por Gonzalo con regla sobre la plancha real (2026-11-07):
  // 2 mm de borde al costado, 5 mm arriba y 1 mm entre sticker y sticker. Con
  // eso, cada sticker mide (210 − 2 × 2 − 4 × 1) / 5 = 40,4 mm de ancho y
  // (297 − 2 × 5 − 15 × 1) / 16 = 17 mm de alto: el alto cierra justo con lo
  // del paquete. Antes se suponían pegados y con 7,5 / 12,5 mm de borde.
  // 2026-11-11: impresa, la primera columna salía al medio y la quinta corrida
  // a la derecha (unos 3 mm: cada columna se corría un poco más). Gonzalo:
  // «que la separación entre código y código sea un poco menor». El paso entre
  // columnas baja de 41,4 a 40,6 mm; el alto quedaba bien y no se toca.
  { id: "39x17-80", nombre: "39 × 17 mm — 80 por hoja", ancho: 39.6, alto: 17, cols: 5, filas: 16, margenX: 2, margenY: 5, sepX: 1, sepY: 1 },
  { id: "70x35", nombre: "70 × 35 mm — 24 por hoja", ancho: 70, alto: 35, cols: 3, filas: 8, margenX: 0, margenY: 8.5, sepX: 0, sepY: 0 },
  { id: "63x34", nombre: "63,5 × 33,9 mm — 24 por hoja (Avery L7159)", ancho: 63.5, alto: 33.9, cols: 3, filas: 8, margenX: 7.2, margenY: 13.1, sepX: 2.5, sepY: 0 },
  { id: "105x37", nombre: "105 × 37 mm — 16 por hoja", ancho: 105, alto: 37, cols: 2, filas: 8, margenX: 0, margenY: 0.5, sepX: 0, sepY: 0 },
  { id: "105x48", nombre: "105 × 48 mm — 12 por hoja", ancho: 105, alto: 48, cols: 2, filas: 6, margenX: 0, margenY: 4.5, sepX: 0, sepY: 0 },
  { id: "38x21", nombre: "38,1 × 21,2 mm — 65 por hoja", ancho: 38.1, alto: 21.2, cols: 5, filas: 13, margenX: 4.7, margenY: 10.7, sepX: 2.5, sepY: 0 },
  // Sin separación entre etiquetas: 5 × 39 = 195 mm y 17 × 17 = 289 mm entran
  // justos en la A4, y lo que sobra se reparte como margen. Es la plancha más
  // chica de la lista — el código entra, pero sin lugar de sobra.
  { id: "39x17", nombre: "39 × 17 mm — 85 por hoja", ancho: 39, alto: 17, cols: 5, filas: 17, margenX: 7.5, margenY: 4, sepX: 0, sepY: 0 },
] as const;

type Plancha = (typeof PLANCHAS)[number];

/**
 * Corrección por renglón que viene puesta para cada plancha. Vacío a propósito:
 * con la HP Smart Tank del local cada hoja de stickers patina distinto (una se
 * fue bajando, la siguiente, con −0,2 puesto, se fue subiendo: 2026-11-10), así
 * que un número fijo no lo arregla y empeora otras hojas. Si se ajusta a mano
 * en la pantalla, queda guardado en esa tablet.
 */
const POR_RENGLON_INICIAL: Record<string, { fx: number; fy: number }> = {};

/**
 * Los rollos de una impresora térmica de etiquetas.
 *
 * Es otra forma de imprimir, no otra medida: acá cada etiqueta es una página
 * suya y la impresora corta sola. No hay plancha que desperdiciar —seis
 * stickers son seis etiquetas— y el código sale mucho más nítido, porque la
 * térmica quema el papel en vez de tirarle tinta encima. Las rayitas finas con
 * tinta se engordan y ahí es donde el lector deja de enganchar.
 *
 * Para que ande desde la tablet, la impresora tiene que ser de red o WiFi:
 * Android la ve como impresora y el botón de imprimir del navegador la
 * encuentra. Las térmicas solo-Bluetooth funcionan nada más que desde la app
 * del fabricante y desde el navegador no hay forma de usarlas.
 */
const ROLLOS = [
  { id: "r50x25", nombre: "50 × 25 mm", ancho: 50, alto: 25 },
  { id: "r40x30", nombre: "40 × 30 mm", ancho: 40, alto: 30 },
  { id: "r58x40", nombre: "58 × 40 mm", ancho: 58, alto: 40 },
  { id: "r60x40", nombre: "60 × 40 mm", ancho: 60, alto: 40 },
  { id: "r70x35", nombre: "70 × 35 mm", ancho: 70, alto: 35 },
  { id: "r30x20", nombre: "30 × 20 mm", ancho: 30, alto: 20 },
] as const;

type Rollo = (typeof ROLLOS)[number];

// ---------- Que el nombre entre entero (Gonzalo, 2026-11-06: «tienen que entrar todo») ----------
//
// Antes el nombre tenía un renglón fijo y lo largo se cortaba con «…» (pasaba
// con «Emulsión de Limpieza Glow Rose 120 ml» en la de 39 × 17). Ahora se mide
// con la letra que de verdad usa el navegador y se elige el cuerpo más grande
// con el que entra entero en el lugar que tiene: uno, dos o tres renglones.

const LETRA_ETIQUETA = "'Arial Narrow', Arial, sans-serif";
const INTERLINEA = 1.12;
let lienzoMedidas: CanvasRenderingContext2D | null = null;

/** Ancho en mm de un texto en mayúsculas, con letra de `cuerpo` mm. Sin navegador, una estimación. */
function anchoTexto(texto: string, cuerpo: number) {
  if (typeof document !== "undefined") {
    lienzoMedidas ??= document.createElement("canvas").getContext("2d");
    if (lienzoMedidas) {
      lienzoMedidas.font = `700 100px ${LETRA_ETIQUETA}`;
      return (lienzoMedidas.measureText(texto.toUpperCase()).width / 100) * cuerpo;
    }
  }
  return texto.length * 0.62 * cuerpo;
}

/** Cuántos renglones ocupa, cortando entre palabras como el navegador. */
function renglonesDe(texto: string, cuerpo: number, ancho: number) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const espacio = anchoTexto(" ", cuerpo);
  let renglones = 1;
  let usado = 0;
  for (const p of palabras) {
    const w = anchoTexto(p, cuerpo);
    if (usado > 0 && usado + espacio + w > ancho) {
      renglones++;
      usado = w;
    } else usado += (usado > 0 ? espacio : 0) + w;
  }
  return renglones;
}

/** El cuerpo más grande (mm) con el que el nombre entra entero en ancho × alto, en hasta 3 renglones. */
function cuerpoQueEntra(texto: string, ancho: number, alto: number, maximo: number, minimo = 1.2) {
  // 4 % de aire: la impresora y el redondeo de los píxeles nunca dan justo.
  const util = ancho * 0.96;
  for (let c = maximo; c > minimo; c = Math.round((c - 0.05) * 100) / 100) {
    const r = renglonesDe(texto, c, util);
    if (r <= 3 && r * c * INTERLINEA <= alto) return c;
  }
  return minimo;
}

const sinServidor = () => () => {};
/** Falso en el servidor y en el primer dibujo; verdadero cuando ya se puede medir la letra. */
function useSePuedeMedir() {
  return useSyncExternalStore(sinServidor, () => true, () => false);
}

/** El nombre del producto, entero, con el cuerpo que le entre en ese lugar. */
function NombreQueEntra({
  texto,
  ancho,
  alto,
  maximo,
  centrado = false,
  style,
}: {
  texto: string;
  ancho: number;
  alto: number;
  maximo: number;
  centrado?: boolean;
  style?: CSSProperties;
}) {
  const medir = useSePuedeMedir();
  const cuerpo = useMemo(() => cuerpoQueEntra(texto, ancho, alto, maximo), [texto, ancho, alto, maximo, medir]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      style={{
        fontSize: `${cuerpo}mm`,
        lineHeight: INTERLINEA,
        fontWeight: 700,
        textTransform: "uppercase",
        textAlign: centrado ? "center" : undefined,
        maxWidth: "100%",
        overflowWrap: "anywhere",
        ...style,
      }}
    >
      {texto}
    </div>
  );
}

/**
 * El nombre como va impreso en la etiqueta.
 *
 * Los productos de suplementos traen la marca metida en el propio nombre
 * ("... x315gr 45 servicios - STAR NUTRITION"). En 70 mm eso se come el lugar
 * del nombre real, y además la marca ya se sabe: se saca el sufijo.
 */
function nombreParaEtiqueta(item: ItemCodigo) {
  const sinMarca = item.producto.replace(/\s+-\s+[A-ZÁÉÍÓÚÑ0-9 .&]{3,}$/u, "").trim();
  // Solo se saca si lo que queda sigue identificando al producto. Si sacarlo
  // dejara un nombre de cuatro letras, es que ese sufijo no era la marca.
  return sinMarca.length >= 12 ? sinMarca : item.producto;
}

/**
 * El equipo del local escanea y carga el código que falta; cambiar o sacar uno
 * ya cargado, y decir qué marca trae código, lo hace solo el Dueño (Gonzalo,
 * 2026-11-07). Las acciones lo vuelven a controlar del lado del servidor.
 */
const EsAdminContext = createContext(false);

export default function CodigosApp({
  items,
  entradas = [],
  pieEtiqueta = PIE_ETIQUETA_DEFECTO,
  esAdmin = false,
  impresos = {},
}: {
  items: ItemCodigo[];
  entradas?: EntradaPendiente[];
  /** Nombre y dirección del local, al pie de la etiqueta de lo fraccionado. */
  pieEtiqueta?: string;
  esAdmin?: boolean;
  /** Lo que ya tiene sticker impreso, guardado en la base (lib/codigosImpresos.ts). */
  impresos?: Record<string, string>;
}) {
  const [escaneando, setEscaneando] = useState<ItemCodigo | "libre" | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "mal" } | null>(null);
  const llevanSticker = items.filter((i) => !i.envasado).length;
  const faltaEscanear = items.filter((i) => i.envasado && (!i.codigo || esCodigoInterno(i.codigo))).length;

  return (
    <EsAdminContext.Provider value={esAdmin}>
    <div className="max-w-5xl mx-auto">
      <PestanasEtiquetas actual="codigos" />
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Códigos de barras</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {items.length} productos · {llevanSticker} llevan sticker WiiGo · {items.length - llevanSticker} traen código de fábrica
            {faltaEscanear > 0 && <> · <b className="text-amber-700">a {faltaEscanear} falta escanearles el envase</b></>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEscaneando("libre")}
          className="rounded-lg bg-accent text-white px-4 py-2.5 text-sm font-semibold hover:bg-accent-dark"
        >
          📷 Escanear un envase
        </button>
      </div>

      {aviso && (
        <p
          className={`mb-4 text-sm rounded-lg px-3 py-2 ${
            aviso.tono === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {aviso.texto}
        </p>
      )}

      <Imprimir
        items={items}
        entradas={entradas}
        impresosServidor={impresos}
        pie={pieEtiqueta}
        onEscanear={setEscaneando}
        onAviso={setAviso}
      />

      {escaneando && (
        <EscanerDeLista
          item={escaneando === "libre" ? null : escaneando}
          items={items}
          onCerrar={() => setEscaneando(null)}
          onAviso={setAviso}
        />
      )}
    </div>
    </EsAdminContext.Provider>
  );
}

/**
 * Para las marcas que mandan los envases sin código (Alta, Fruppi): pasan a
 * imprimir el nuestro. Se puede volver atrás si la marca empieza a traerlo.
 */
function MarcaSinCodigo({
  idMarca,
  sinCodigo,
  marca,
  onAviso,
}: {
  idMarca: string;
  sinCodigo: boolean;
  marca: string;
  onAviso: (a: { texto: string; tono: "ok" | "mal" } | null) => void;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() =>
        startTransition(async () => {
          const res = await marcarMarcaSinCodigo(idMarca, !sinCodigo);
          if (res.error) onAviso({ texto: res.error, tono: "mal" });
          else {
            onAviso({
              texto: sinCodigo
                ? `${marca}: sus envases traen código, se escanean.`
                : `${marca}: sus envases no traen código, pasan a Imprimir códigos.`,
              tono: "ok",
            });
            router.refresh();
          }
        })
      }
      className="shrink-0 text-xs text-accent disabled:opacity-40"
    >
      {sinCodigo ? "Sí traen código" : "No traen código"}
    </button>
  );
}

/**
 * El escáner, con el producto al que se le va a asignar el código.
 *
 * Cuando se abre sin producto ("Escanear un envase") busca a quién pertenece el
 * código leído: si ya está cargado avisa cuál es, y si no, pide elegirlo de la
 * lista. Ese es el camino rápido para hacer veinte seguidos con el envase en la
 * mano en vez de buscar cada producto primero.
 */
function EscanerDeLista({
  item,
  items,
  onCerrar,
  onAviso,
}: {
  item: ItemCodigo | null;
  items: ItemCodigo[];
  onCerrar: () => void;
  onAviso: (a: { texto: string; tono: "ok" | "mal" } | null) => void;
}) {
  const router = useRouter();
  const [leido, setLeido] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  // Sin producto elegido es la tanda: con la caja de envases al lado se hacen
  // uno atrás del otro, así que la cámara vuelve a abrirse sola después de
  // cada uno. Lo que pasó con el anterior se lee arriba de la cámara.
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [hechos, setHechos] = useState<Set<string>>(() => new Set());
  // Para volver a abrir la cámara cuando lo leído ya estaba cargado.
  const [vuelta, setVuelta] = useState(0);
  const [, startTransition] = useTransition();

  function asignar(destino: ItemCodigo, codigo: string) {
    startTransition(async () => {
      const res = await guardarCodigoBarras(destino.idVariante, codigo);
      if (res.error) {
        onAviso({ texto: res.error, tono: "mal" });
        setUltimo(`✕ ${res.error}`);
      } else {
        onAviso({ texto: `${destino.producto}: código ${limpiarCodigoBarras(codigo)} guardado.`, tono: "ok" });
        setUltimo(`✓ ${destino.producto} guardado. Escaneá el siguiente`);
        setHechos((prev) => new Set(prev).add(destino.idVariante));
        router.refresh();
      }
      if (item) onCerrar();
      else {
        setLeido(null);
        setBusqueda("");
      }
    });
  }

  if (!leido) {
    return (
      <EscanerCodigo
        key={vuelta}
        onCerrar={onCerrar}
        titulo={item ? undefined : (ultimo ?? "Escaneá el envase y después elegí qué producto es")}
        onLeido={(valor) => {
          const codigo = limpiarCodigoBarras(valor);
          if (item) return asignar(item, codigo);

          const yaEs = items.find((i) => i.codigo === codigo);
          if (yaEs) {
            onAviso({ texto: `Ese código ya es de ${yaEs.producto}.`, tono: "ok" });
            // Se cierra y se vuelve a abrir para que la cámara lea el siguiente.
            setUltimo(`Ese ya estaba: ${yaEs.producto}. Escaneá el siguiente`);
            setVuelta((n) => n + 1);
            return;
          }
          setLeido(codigo);
        }}
      />
    );
  }

  // Se leyó un código que no está en el sistema: hay que decir de quién es.
  const q = busqueda.trim().toLowerCase();
  // Los envasados que faltan; los recién guardados salen aunque la lista
  // todavía no se haya refrescado.
  const candidatos = items
    .filter((i) => i.envasado && !hechos.has(i.idVariante) && (!i.codigo || esCodigoInterno(i.codigo)))
    .filter((i) => !q || [i.producto, i.variante, i.sku].filter(Boolean).some((t) => String(t).toLowerCase().includes(q)))
    .slice(0, 40);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(20,17,13,.8)" }}
      onClick={onCerrar}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-neutral-200">
          <p className="text-sm font-semibold">
            Leí <span className="font-mono">{leido}</span>
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">¿De qué producto es este envase?</p>
        </div>
        <div className="p-3 border-b border-neutral-200">
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar el producto…"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="overflow-y-auto">
          {candidatos.length === 0 ? (
            <p className="text-sm text-neutral-500 p-6 text-center">Ninguno coincide.</p>
          ) : (
            candidatos.map((c) => (
              <button
                key={c.idVariante}
                type="button"
                onClick={() => asignar(c, leido)}
                className="w-full text-left px-4 py-2.5 hover:bg-neutral-50 border-b border-neutral-100"
              >
                <span className="block text-sm font-medium truncate">
                  {c.producto}
                  {c.variante && <span className="text-neutral-500"> — {c.variante}</span>}
                </span>
                <span className="block text-xs text-neutral-400">
                  {c.marca ?? "sin marca"} · {c.sku ?? "sin SKU"}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="flex border-t border-neutral-200">
          <button
            type="button"
            onClick={() => {
              setUltimo("Salteado. Escaneá el siguiente");
              setLeido(null);
              setBusqueda("");
            }}
            className="flex-1 px-4 py-3 text-sm text-neutral-700 border-r border-neutral-200"
          >
            Saltear y seguir escaneando
          </button>
          <button type="button" onClick={onCerrar} className="flex-1 px-4 py-3 text-sm text-neutral-500">
            Terminar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pestaña 2: imprimir la hoja                                        */
/* ------------------------------------------------------------------ */

// Una sola pantalla con dos partes (Gonzalo, 2026-11-11: «se está complicando,
// que sea fácil»): «Para imprimir ahora», lo que entró por Recepción o se
// fraccionó, con su cantidad; y «Todos los productos», de todas las marcas,
// donde cada uno dice si trae código de fábrica o lleva sticker WiiGo.
type QueMostrar = "todos" | "sticker" | "fabrica" | "falta";

function Imprimir({
  items,
  entradas,
  impresosServidor,
  pie,
  onEscanear,
  onAviso,
}: {
  items: ItemCodigo[];
  entradas: EntradaPendiente[];
  impresosServidor: Record<string, string>;
  pie: string;
  onEscanear: (i: ItemCodigo) => void;
  onAviso: (a: { texto: string; tono: "ok" | "mal" } | null) => void;
}) {
  const esAdmin = useContext(EsAdminContext);
  // Lo ya etiquetado: lo de la base más lo de esta tablet (que es al toque).
  const impresosLocal = useSyncExternalStore(suscribirImpresos, leerImpresos, () => SIN_IMPRESOS);
  const impresos = useMemo(() => {
    const m = { ...impresosServidor };
    for (const [id, f] of Object.entries(impresosLocal)) if (!m[id] || m[id] < f) m[id] = f;
    return m;
  }, [impresosServidor, impresosLocal]);
  // Lo que esta tablet imprimió antes de que se guardara en la base, se sube
  // una vez (así lo que ya se etiquetó no vuelve a figurar en ningún aparato).
  useEffect(() => {
    const local = leerImpresos();
    const faltan = Object.fromEntries(Object.entries(local).filter(([id, f]) => !impresosServidor[id] || impresosServidor[id] < f));
    if (Object.keys(faltan).length) anotarCodigosImpresos(faltan).catch(() => {});
  }, [impresosServidor]);
  const porVariante = useMemo(() => new Map(entradas.map((e) => [e.idVariante, e])), [entradas]);
  // Para imprimir ahora: lo que lleva sticker, entró (Recepción o Fraccionar)
  // y todavía no se le imprimió después de entrar.
  const ahora = useMemo(
    () =>
      items.filter((i) => {
        if (i.envasado) return false;
        const e = porVariante.get(i.idVariante);
        return e && !(impresos[i.idVariante] && impresos[i.idVariante] >= e.ultima);
      }),
    [items, porVariante, impresos]
  );
  const [modo, setModo] = useState<"ahora" | "todos">(ahora.length > 0 ? "ahora" : "todos");
  const [queMostrar, setQueMostrar] = useState<QueMostrar>("todos");
  const faltaEscanear = (i: ItemCodigo) => Boolean(i.envasado) && (!i.codigo || esCodigoInterno(i.codigo));
  const cuenta = {
    sticker: items.filter((i) => !i.envasado).length,
    fabrica: items.filter((i) => i.envasado).length,
    falta: items.filter(faltaEscanear).length,
  };
  const todos = useMemo(
    () =>
      items.filter((i) =>
        queMostrar === "sticker" ? !i.envasado : queMostrar === "fabrica" ? i.envasado : queMostrar === "falta" ? faltaEscanear(i) : true
      ),
    [items, queMostrar]
  );
  const visibles = modo === "ahora" ? ahora : todos;
  // En «Todos» arranca todo destildado: se elige qué imprimir. Al marcar uno
  // trae lo que hay en stock (Gonzalo, 2026-11-11).
  const unidades = (i: ItemCodigo) => (modo === "ahora" ? porVariante.get(i.idVariante)?.cantidad ?? 1 : 0);
  const alMarcar = (i: ItemCodigo) =>
    modo === "ahora" ? porVariante.get(i.idVariante)?.cantidad ?? 1 : Math.max(1, Math.round(i.stock ?? 0));

  return (
    <>
      {/* Este bloque desaparece al imprimir; la hoja, que va adentro de
          ConfigurarImpresion, no — por eso no se puede envolver todo junto:
          `print:hidden` es display:none y se lleva puesto lo que tenga adentro. */}
      <div className="print:hidden">
        <div className="inline-flex flex-wrap gap-1 bg-neutral-100 rounded-xl p-1 mb-3">
          {(
            [
              ["ahora", `Para imprimir ahora · ${ahora.length}`],
              ["todos", `Todos los productos · ${items.length}`],
            ] as const
          ).map(([id, texto]) => (
            <button
              key={id}
              type="button"
              onClick={() => setModo(id)}
              className={`px-4 py-2 text-sm rounded-lg ${modo === id ? "bg-white shadow-sm font-semibold" : "text-neutral-600 hover:text-neutral-900"}`}
            >
              {texto}
            </button>
          ))}
        </div>

        <p className="text-xs text-neutral-500 mb-3 leading-relaxed max-w-2xl">
          {modo === "ahora" ? (
            <>
              Lo que entró por <b>Recepción</b> o se <b>fraccionó</b> en los últimos 7 días y lleva sticker WiiGo. La cantidad es la que
              entró. Al imprimir, sale de acá.
            </>
          ) : (
            <>
              Todos los productos de todas las marcas. En cada uno se elige una vez si <b>trae código de fábrica</b> (se escanea el envase)
              o lleva <b>sticker WiiGo</b>. Para reimprimir, marcalo y listo.
            </>
          )}{" "}
          Los stickers llevan el nombre y el código de barras, <b>no el precio</b>: el precio va en el cartel de góndola.
        </p>

        {modo === "todos" && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(
              [
                ["todos", `Todos · ${items.length}`],
                ["sticker", `Llevan sticker · ${cuenta.sticker}`],
                ["fabrica", `Traen código de fábrica · ${cuenta.fabrica}`],
                ["falta", `Falta escanear el envase · ${cuenta.falta}`],
              ] as const
            ).map(([id, texto]) => (
              <button
                key={id}
                type="button"
                onClick={() => setQueMostrar(id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  queMostrar === id
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : id === "falta" && cuenta.falta > 0
                      ? "bg-amber-50 border-amber-200 text-amber-800"
                      : "bg-white border-neutral-300 text-neutral-700"
                }`}
              >
                {texto}
              </button>
            ))}
          </div>
        )}

        {modo === "ahora" && ahora.length === 0 && (
          <p className="text-sm text-neutral-500 py-10 text-center border border-dashed border-neutral-300 rounded-xl mb-4">
            No hay nada nuevo para imprimir. Cuando se reciba mercadería o se fraccione, aparece acá con su cantidad.
          </p>
        )}
      </div>

      {/* El `key` remonta la lista al cambiar de modo: las cantidades se
          recalculan solas en vez de arrastrar las del modo anterior. */}
      {visibles.length > 0 && (
        <ConfigurarImpresion
          key={`${modo}-${queMostrar}`}
          items={visibles}
          unidadesIniciales={unidades}
          alMarcar={alMarcar}
          pie={pie}
          // También en «Para imprimir ahora»: lo que ya se imprimió y no se
          // confirmó sale de la lista (Gonzalo, 2026-11-11, los 3 de Fruppi).
          onYaTienen={(ids) => anotarImpresos(ids)}
          abrirTodo={modo === "ahora"}
          extraFila={modo === "todos" ? (i) => <TipoDeCodigo item={i} onEscanear={onEscanear} onAviso={onAviso} /> : undefined}
          cabeceraMarca={
            modo === "todos" && esAdmin
              ? (marca, deLaMarca) =>
                  !deLaMarca[0]?.propia && deLaMarca[0]?.idMarca ? (
                    <MarcaSinCodigo idMarca={deLaMarca[0].idMarca} sinCodigo={Boolean(deLaMarca[0].marcaSinCodigo)} marca={marca} onAviso={onAviso} />
                  ) : null
              : undefined
          }
        />
      )}
    </>
  );
}

/**
 * En cada renglón de «Todos»: si trae código de fábrica o lleva sticker WiiGo,
 * a la vista. Lo cambia solo el Dueño (el servidor lo vuelve a controlar). Lo
 * que se fracciona acá y las marcas sin código lo llevan siempre.
 */
function TipoDeCodigo({
  item,
  onEscanear,
  onAviso,
}: {
  item: ItemCodigo;
  onEscanear: (i: ItemCodigo) => void;
  onAviso: (a: { texto: string; tono: "ok" | "mal" } | null) => void;
}) {
  const router = useRouter();
  const esAdmin = useContext(EsAdminContext);
  const [pendiente, startTransition] = useTransition();
  const codigoFabrica = Boolean(item.codigo) && !esCodigoInterno(item.codigo);
  // Sin envasado, sin «No trae código» y sin marca sin código, solo queda lo que embolsamos nosotros.
  const fijo = item.marcaSinCodigo ? "Sticker WiiGo (toda la marca)" : !item.envasado && !item.productoSinCodigo ? "Se fracciona acá: sticker" : null;

  function cambiar(sticker: boolean) {
    if (!item.idProducto || sticker === Boolean(item.productoSinCodigo)) return;
    startTransition(async () => {
      const res = await marcarProductoSinCodigo(item.idProducto as string, sticker);
      if (res.error) onAviso({ texto: res.error, tono: "mal" });
      else {
        onAviso({
          texto: sticker ? `${item.producto}: lleva sticker WiiGo, ya figura para imprimir.` : `${item.producto}: trae código de fábrica, se escanea el envase.`,
          tono: "ok",
        });
        router.refresh();
      }
    });
  }

  function quitar() {
    startTransition(async () => {
      const res = await volverAEtiquetaWiigo(item.idVariante);
      if (res.error) onAviso({ texto: res.error, tono: "mal" });
      else {
        onAviso({ texto: `${item.producto} vuelve a llevar código WiiGo para imprimir.`, tono: "ok" });
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
      {fijo ? (
        <span className="text-[11px] font-semibold rounded-full bg-neutral-100 text-neutral-600 px-2.5 py-1">{fijo}</span>
      ) : esAdmin && item.idProducto ? (
        <span className="inline-flex rounded-full border border-neutral-300 overflow-hidden text-[11px] font-semibold" role="group" aria-label="Código">
          {(
            [
              [false, "Trae de fábrica"],
              [true, "Sticker WiiGo"],
            ] as const
          ).map(([sticker, texto]) => {
            const activo = sticker === Boolean(item.productoSinCodigo);
            return (
              <button
                key={texto}
                type="button"
                disabled={pendiente}
                aria-pressed={activo}
                onClick={() => cambiar(sticker)}
                className={`px-2.5 py-1 disabled:opacity-50 ${activo ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
              >
                {texto}
              </button>
            );
          })}
        </span>
      ) : (
        <span className="text-[11px] font-semibold rounded-full bg-neutral-100 text-neutral-600 px-2.5 py-1">
          {item.envasado ? "Trae de fábrica" : "Sticker WiiGo"}
        </span>
      )}
      {/* Lo que trae su código: escanearlo una vez, o «Listo» si ya está. */}
      {item.envasado &&
        (codigoFabrica ? (
          <span className="text-[11px] font-semibold rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1">Listo</span>
        ) : (
          <button
            type="button"
            onClick={() => onEscanear(item)}
            className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-2.5 py-1 text-xs font-semibold hover:bg-amber-100"
          >
            📷 Escanear
          </button>
        ))}
      {item.envasado && codigoFabrica && esAdmin && (
        <button type="button" onClick={() => onEscanear(item)} className="text-xs text-accent">
          Cambiar
        </button>
      )}
      {/* Se embolsa acá pero quedó con un código de fábrica: casi siempre es un error (Almendra Guara, 2026-11-09). */}
      {!item.envasado && codigoFabrica && !item.productoSinCodigo && !item.marcaSinCodigo && esAdmin && (
        <button
          type="button"
          onClick={quitar}
          disabled={pendiente}
          title="Tiene un código de fábrica pero se embolsa acá: volver al código WiiGo"
          className="text-[11px] font-semibold text-amber-700 disabled:opacity-40"
        >
          ¿Código de fábrica? ✕
        </button>
      )}
    </div>
  );
}

function ConfigurarImpresion({
  items,
  unidadesIniciales,
  alMarcar: alMarcarBase = (i) => Math.max(1, unidadesIniciales(i)),
  pie,
  onYaTienen,
  extraFila,
  cabeceraMarca,
  abrirTodo = false,
}: {
  items: ItemCodigo[];
  unidadesIniciales: (i: ItemCodigo) => number;
  /** Cuántos al marcarlo: lo que entró o lo que hay en stock. */
  alMarcar?: (i: ItemCodigo) => number;
  pie: string;
  /** «Ya tienen sticker»: los marcados salen de la lista sin imprimir. */
  onYaTienen?: (ids: string[]) => void;
  /** Lo que va en cada renglón antes de la cantidad: si trae código o lleva sticker, escanear. */
  extraFila?: (i: ItemCodigo) => ReactNode;
  cabeceraMarca?: (marca: string, deLaMarca: ItemCodigo[]) => ReactNode;
  abrirTodo?: boolean;
}) {
  // Lo que trae su código de fábrica no se imprime: en «Todos» se ve para
  // decir si trae o no, pero no se puede marcar.
  const alMarcar = (i: ItemCodigo) => (i.envasado ? 0 : alMarcarBase(i));
  const [papel, setPapel] = useState<"plancha" | "rollo">("plancha");
  // Las fechas valen para toda la tanda: se fracciona e imprime de una vez.
  const [envasado, setEnvasado] = useState(hoyIso);
  const [venceBolsa, setVenceBolsa] = useState("");
  // Por ahora sin fecha: Gonzalo la completa con lapicera hasta tener los vencimientos.
  const [conVencimiento, setConVencimiento] = useState(false);
  const [plancha, setPlancha] = useState<Plancha>(PLANCHAS[0]);
  const [rollo, setRollo] = useState<Rollo>(ROLLOS[0]);
  const [desde, setDesde] = useState(1);
  // Ajuste fino: casi todas las impresoras corren la hoja uno o dos
  // milímetros al tomarla. Se mide una vez con la prueba en papel común y
  // queda guardado en esta compu, para esa plancha.
  // fy y fx: lo que se va corriendo CADA renglón (la hoja de stickers patina o
  // entra apenas torcida y abajo se nota: Gonzalo, 2026-11-10). Se suman por
  // renglón: con fy = −0,2 el renglón 10 sube 2 mm.
  const [ajuste, setAjuste] = useState<AjusteHoja>(SIN_AJUSTE);

  // Recordar la última plancha elegida y su ajuste. Solo comodidad: si el
  // navegador no deja guardar, arranca con la primera y sin ajuste.
  useEffect(() => {
    try {
      const id = localStorage.getItem("codigos.plancha");
      const p = PLANCHAS.find((x) => x.id === id);
      if (p) setPlancha(p);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("codigos.plancha", plancha.id);
      const guardado = JSON.parse(localStorage.getItem(`codigos.ajuste.${plancha.id}`) ?? "null");
      // Lo de cada renglón: lo guardado en esta tablet; si nunca se tocó, lo medido para esa plancha.
      const inicial = POR_RENGLON_INICIAL[plancha.id] ?? { fx: 0, fy: 0 };
      const porRenglon = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
      setAjuste(
        guardado && typeof guardado.x === "number" && typeof guardado.y === "number"
          ? // Lo por renglón que quedó guardado antes del 2026-11-10 (sin «v: 2») no se usa:
            // Gonzalo pidió volver a como estaba, sin corrección por renglón.
            guardado.v === 2
            ? { x: guardado.x, y: guardado.y, fy: porRenglon(guardado.fy, inicial.fy), fx: porRenglon(guardado.fx, inicial.fx) }
            : { x: guardado.x, y: guardado.y, fy: inicial.fy, fx: inicial.fx }
          : { ...SIN_AJUSTE, ...inicial }
      );
      const d = Number(localStorage.getItem(`codigos.desde.${plancha.id}`));
      setDesde(Number.isInteger(d) && d >= 1 && d <= plancha.cols * plancha.filas ? d : 1);
    } catch {
      setAjuste({ ...SIN_AJUSTE, ...(POR_RENGLON_INICIAL[plancha.id] ?? {}) });
      setDesde(1);
    }
  }, [plancha.id, plancha.cols, plancha.filas]);

  // Dónde empieza la hoja empezada que quedó en la bandeja. Se guarda en esta
  // compu para esa plancha, así la próxima tanda sigue donde quedó la otra.
  function cambiarDesde(n: number) {
    const limpio = Math.min(Math.max(1, Math.round(n) || 1), plancha.cols * plancha.filas);
    setDesde(limpio);
    try {
      localStorage.setItem(`codigos.desde.${plancha.id}`, String(limpio));
    } catch {}
  }

  // Después de imprimir se pregunta si salió bien antes de dar las etiquetas
  // por usadas: si la impresión se canceló o salió corrida, la hoja sigue igual.
  const [pendiente, setPendiente] = useState<number | null>(null);

  function cambiarAjuste(eje: keyof AjusteHoja, valor: number) {
    // Los de toda la hoja van de a medio milímetro; los de cada renglón, de a 0,05.
    const porRenglon = eje === "fx" || eje === "fy";
    const tope = porRenglon ? 1 : 10;
    const paso = porRenglon ? 20 : 2;
    const limpio = Math.round(Math.min(Math.max(valor, -tope), tope) * paso) / paso;
    const nuevo = { ...ajuste, [eje]: Number.isFinite(limpio) ? limpio : 0 };
    setAjuste(nuevo);
    try {
      localStorage.setItem(`codigos.ajuste.${plancha.id}`, JSON.stringify({ ...nuevo, v: 2 }));
    } catch {}
  }
  const [cantidades, setCantidades] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.idVariante, unidadesIniciales(i)]))
  );

  const porHoja = plancha.cols * plancha.filas;
  const aImprimir = useMemo(
    () =>
      items.flatMap((i) => Array(Math.max(0, cantidades[i.idVariante] ?? 0)).fill(i) as ItemCodigo[]),
    [items, cantidades]
  );
  // Los casilleros que se saltean al empezar más abajo cuentan como usados.
  const hojas = Math.ceil((aImprimir.length + desde - 1) / porHoja) || 0;
  // Buscar y filtrar solo achica lo que se ve: lo marcado se imprime igual.
  const [busqueda, setBusqueda] = useState("");
  const [subcategoria, setSubcategoria] = useState("");
  const subcategorias = useMemo(() => subcategoriasDe(items), [items]);
  const mostrados = useMemo(
    () =>
      items.filter(
        (i) =>
          (!subcategoria || i.subcategoria === subcategoria) &&
          coincide([i.producto, i.variante, i.marcaFabrica, i.sku, i.codigo, i.subcategoria], busqueda)
      ),
    [items, subcategoria, busqueda]
  );
  const marcados = items.filter((i) => (cantidades[i.idVariante] ?? 0) > 0).length;
  const porMarca = useMemo(() => agruparPorMarca(mostrados), [mostrados]);
  const filtrando = busqueda.trim() !== "" || subcategoria !== "";
  // Las subcategorías de cada marca arrancan cerradas: con 90 productos de
  // WiiGo, abrir solo la que vas a imprimir (Gonzalo, 2026-11-07).
  const [subAbiertas, setSubAbiertas] = useState<Set<string>>(() => new Set());
  // Cuándo se imprimió por última vez cada uno, en esta tablet: para no
  // imprimir dos veces lo mismo sin darse cuenta.
  const impresos = useSyncExternalStore(suscribirImpresos, leerImpresos, () => SIN_IMPRESOS);

  function poner(id: string, n: number) {
    setCantidades((prev) => ({ ...prev, [id]: Math.min(Math.max(0, n), 99) }));
  }

  // Lo fraccionado que va en esta tanda: de ahí salen las fechas y los avisos.
  const medida = papel === "plancha" ? plancha : rollo;
  const fraccionados = items.filter((i) => i.rotulo && (cantidades[i.idVariante] ?? 0) > 0);
  const sinDias = fraccionados.filter((i) => i.rotulo?.dias == null);
  const sinPeso = fraccionados.filter((i) => i.rotulo?.pesoG == null);
  const conAlergenos = fraccionados.filter((i) => i.rotulo?.alergenos || i.rotulo?.trazas);
  const tanda: DatosTanda = { pie, envasado: envasado || hoyIso(), venceBolsa: venceBolsa || null, conVencimiento };

  return (
    <TandaContext.Provider value={tanda}>
      {fraccionados.length > 0 && (
        <div className="print:hidden rounded-xl border border-amber-200 bg-amber-50/60 p-4 mb-4 space-y-3">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-neutral-600 mb-1" htmlFor="envasado">
                Fecha de envasado
              </label>
              <input
                id="envasado"
                type="date"
                value={envasado}
                onChange={(e) => setEnvasado(e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-700 rounded-lg border border-neutral-300 bg-white px-3 py-2 cursor-pointer">
              <input id="con-vencimiento" type="checkbox" checked={conVencimiento} onChange={(e) => setConVencimiento(e.target.checked)} className="w-4 h-4 accent-[var(--color-accent,#2563eb)]" />
              Imprimir la fecha de vencimiento
            </label>
            {conVencimiento && (
              <div>
                <label className="block text-xs text-neutral-600 mb-1" htmlFor="vence-bolsa">
                  Vence la bolsa grande (opcional)
                </label>
                <input
                  id="vence-bolsa"
                  type="date"
                  value={venceBolsa}
                  onChange={(e) => setVenceBolsa(e.target.value)}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
            <p className="text-xs text-neutral-600 max-w-sm leading-relaxed">
              {conVencimiento ? (
                <>
                  El vencimiento sale solo: envasado + los días que dura cada producto, sin pasarse nunca del de la bolsa grande. Si imprimís productos de
                  bolsas distintas, cargá ese vencimiento imprimiendo de a uno.
                </>
              ) : (
                <>
                  Sin la fecha: sale <b>«Vto: ______»</b> con una línea para completarlo a mano con lapicera.
                </>
              )}
            </p>
          </div>
          {!entraRotulo(medida) && (
            <p className="text-sm text-amber-800">
              En {medida.ancho} × {medida.alto} mm sale <b>WiiGo Dietética, el nombre, el peso neto, el vencimiento{conVencimiento ? "" : " (para escribir a mano)"} y el código</b>.
              Los alérgenos no entran: para la bolsita completa elegí <b>70 × 35 mm</b>.
              {conAlergenos.length > 0 && (
                <>
                  {" "}
                  <b>Llevan alérgenos y conviene la de 70 × 35:</b> {resumirLista(conAlergenos.map((i) => i.producto))}.
                </>
              )}
            </p>
          )}
          {sinDias.length > 0 && (
            <p className="text-xs text-amber-800">
              Usan la duración sugerida porque no tienen sus días cargados:{" "}
              {resumirLista(sinDias.map((i) => `${i.producto} (${duracionSugerida(i.producto).dias} días)`))}. Cargalos
              en el producto con lo que diga tu proveedor.
            </p>
          )}
          {sinPeso.length > 0 && (
            <p className="text-xs text-amber-800">
              Sin peso neto cargado (sale sin peso): {resumirLista(sinPeso.map((i) => i.producto))}.
            </p>
          )}
        </div>
      )}

      <FiltroSeleccion
        busqueda={busqueda}
        setBusqueda={setBusqueda}
        subcategorias={subcategorias}
        subcategoria={subcategoria}
        setSubcategoria={setSubcategoria}
        visibles={mostrados.length}
        marcados={marcados}
        unidad="productos"
        onMarcarVisibles={() =>
          setCantidades((prev) => {
            const next = { ...prev };
            // Lo que ya tenía cantidad la conserva; lo demás arranca con la de siempre.
            mostrados.forEach((i) => {
              if (!(next[i.idVariante] > 0)) next[i.idVariante] = alMarcar(i);
            });
            return next;
          })
        }
        onDestildarTodo={() => setCantidades(Object.fromEntries(items.map((i) => [i.idVariante, 0])))}
      />
      {onYaTienen && marcados > 0 && (
        <div className="print:hidden -mt-1 mb-3 flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => {
              const ids = items.filter((i) => (cantidades[i.idVariante] ?? 0) > 0).map((i) => i.idVariante);
              onYaTienen(ids);
              setCantidades((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, 0])) }));
            }}
            className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 px-3 py-1.5 font-semibold hover:bg-emerald-100"
          >
            ✓ Ya tienen sticker ({marcados})
          </button>
          <span className="text-xs text-neutral-500">Si los marcados ya lo tienen pegado: salen de la lista sin imprimir.</span>
        </div>
      )}
      {mostrados.length === 0 && (
        <p className="print:hidden text-sm text-neutral-500 py-8 text-center">Ningún producto coincide con la búsqueda.</p>
      )}

      <div className="print:hidden border border-neutral-200 rounded-xl overflow-hidden bg-white mb-4 empty:hidden">
        {porMarca.map(([marca, deLaMarca]) => {
          const totalMarca = deLaMarca.reduce((a, i) => a + (cantidades[i.idVariante] ?? 0), 0);
          return (
            <div key={marca}>
              <div className="flex items-center justify-between gap-2 bg-neutral-50 px-4 py-2 border-b border-neutral-200">
                <span className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 mr-auto">
                  {marca} · {deLaMarca.length} productos
                </span>
                {cabeceraMarca?.(marca, deLaMarca)}
                <button
                  type="button"
                  onClick={() =>
                    setCantidades((prev) => {
                      const next = { ...prev };
                      // Si ya hay alguno marcado, el botón apaga la marca entera.
                      const apagar = totalMarca > 0;
                      deLaMarca.forEach((i) => (next[i.idVariante] = apagar ? 0 : alMarcar(i)));
                      return next;
                    })
                  }
                  className="text-xs text-accent"
                >
                  {totalMarca > 0 ? "Ninguno" : "Todos"}
                </button>
              </div>
              {subgruposDe(deLaMarca).map(([sub, delSub]) => {
                const clave = `${marca}|${sub}`;
                const marcadosSub = delSub.filter((i) => (cantidades[i.idVariante] ?? 0) > 0).length;
                // Buscando, todo abierto: si no, lo encontrado quedaría escondido.
                // En «Para imprimir ahora» (son pocos) todo abierto: se ve qué se va a imprimir.
                const abierto = filtrando || abrirTodo || subAbiertas.has(clave);
                return (
                  <div key={clave}>
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100 bg-white">
                      <button
                        type="button"
                        onClick={() =>
                          setSubAbiertas((prev) => {
                            const s = new Set(prev);
                            if (s.has(clave)) s.delete(clave);
                            else s.add(clave);
                            return s;
                          })
                        }
                        className="flex-1 min-w-0 text-left text-sm font-semibold text-neutral-800"
                        aria-expanded={abierto}
                      >
                        <span className="text-neutral-400 mr-1.5">{abierto ? "▾" : "▸"}</span>
                        {sub}
                        <span className="ml-2 text-xs font-normal text-neutral-500">
                          {delSub.length} {delSub.length === 1 ? "producto" : "productos"}
                          {marcadosSub > 0 && <b className="text-accent"> · {marcadosSub} marcados</b>}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCantidades((prev) => {
                            const next = { ...prev };
                            const apagar = marcadosSub > 0;
                            delSub.forEach((i) => (next[i.idVariante] = apagar ? 0 : alMarcar(i)));
                            return next;
                          })
                        }
                        className="shrink-0 text-xs text-accent"
                      >
                        {marcadosSub > 0 ? "Ninguno" : "Todos"}
                      </button>
                    </div>
              {abierto && delSub.map((i) => (
                <div
                  key={i.idVariante}
                  className="flex items-center gap-3 pl-8 pr-4 py-2 border-b border-neutral-100 last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">
                      {i.producto}
                      {i.marcaFabrica && <span className="text-neutral-500"> ({i.marcaFabrica})</span>}
                      {i.variante && <span className="text-neutral-500"> — {i.variante}</span>}
                    </span>
                    <span className="block text-xs text-neutral-400">
                      {i.sku ?? "sin SKU"} ·{" "}
                      <span className="font-mono">
                        {i.codigo ? formatearCodigo(i.codigo) : "se genera al guardar"}
                      </span>
                      {impresos[i.idVariante] && <span className="ml-1.5 text-emerald-700">· impreso {cuandoImpreso(impresos[i.idVariante])}</span>}
                      {i.stock != null && <span className="ml-1.5">· {Math.max(0, Math.round(i.stock))} en stock</span>}
                    </span>
                  </span>
                  {extraFila?.(i)}
                  {!i.envasado && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => poner(i.idVariante, (cantidades[i.idVariante] ?? 0) - 1)}
                      className="w-7 h-7 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={cantidades[i.idVariante] ?? 0}
                      onChange={(e) => poner(i.idVariante, Number(e.target.value))}
                      aria-label={`Cuántos stickers de ${i.producto}`}
                      className="w-14 text-center rounded-lg border border-neutral-300 px-1 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      // De 0, el primer toque ya pone lo que hay en stock; después, de a uno.
                      onClick={() => poner(i.idVariante, (cantidades[i.idVariante] ?? 0) > 0 ? (cantidades[i.idVariante] ?? 0) + 1 : alMarcar(i))}
                      className="w-7 h-7 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                    >
                      +
                    </button>
                  </div>
                  )}
                </div>
              ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="print:hidden rounded-xl bg-neutral-50 border border-neutral-200 p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-neutral-500 mb-1" htmlFor="papel">
            Cómo imprimís
          </label>
          <select
            id="papel"
            value={papel}
            onChange={(e) => {
              setPapel(e.target.value as "plancha" | "rollo");
              setPendiente(null);
            }}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="plancha">Hoja A4 de etiquetas</option>
            <option value="rollo">Impresora térmica (rollo)</option>
          </select>
        </div>

        {papel === "plancha" ? (
          <>
            <div>
              <label className="block text-xs text-neutral-500 mb-1" htmlFor="plancha">
                Plancha de etiquetas
              </label>
              <select
                id="plancha"
                value={plancha.id}
                onChange={(e) => {
                  const p = PLANCHAS.find((x) => x.id === e.target.value);
                  if (p) {
                    setPlancha(p);
                    setPendiente(null);
                  }
                }}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {PLANCHAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>

            <ElegirInicio plancha={plancha} desde={desde} cantidad={aImprimir.length} onElegir={cambiarDesde} />

            <div>
              <label className="block text-xs text-neutral-500 mb-1" htmlFor="ajuste-y">
                Bajar (mm)
              </label>
              <input
                id="ajuste-y"
                type="number"
                step={0.5}
                min={-10}
                max={10}
                value={ajuste.y}
                onChange={(e) => cambiarAjuste("y", Number(e.target.value))}
                title="Positivo baja todo, negativo lo sube"
                className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1" htmlFor="ajuste-x">
                Correr a la derecha (mm)
              </label>
              <input
                id="ajuste-x"
                type="number"
                step={0.5}
                min={-7}
                max={7}
                value={ajuste.x}
                onChange={(e) => cambiarAjuste("x", Number(e.target.value))}
                title="Positivo corre todo a la derecha, negativo a la izquierda"
                className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            {/* Lo que se va corriendo cada renglón: arriba sale bien y abajo se
                descuadra (la hoja patina o entra apenas torcida). */}
            <div>
              <label className="block text-xs text-neutral-500 mb-1" htmlFor="ajuste-fy">
                ↕ Por renglón (mm)
              </label>
              <input
                id="ajuste-fy"
                type="number"
                step={0.05}
                min={-1}
                max={1}
                value={ajuste.fy}
                onChange={(e) => cambiarAjuste("fy", Number(e.target.value))}
                title="Si cada renglón baja un poco más que el anterior, poné un número negativo (por ejemplo −0,2)"
                className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1" htmlFor="ajuste-fx">
                ↔ Por renglón (mm)
              </label>
              <input
                id="ajuste-fx"
                type="number"
                step={0.05}
                min={-1}
                max={1}
                value={ajuste.fx}
                onChange={(e) => cambiarAjuste("fx", Number(e.target.value))}
                title="Si cada renglón se va un poco más a la derecha, poné un número negativo (por ejemplo −0,15)"
                className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </>
        ) : (
          <div>
            <label className="block text-xs text-neutral-500 mb-1" htmlFor="rollo">
              Medida del rollo
            </label>
            <select
              id="rollo"
              value={rollo.id}
              onChange={(e) => {
                const r = ROLLOS.find((x) => x.id === e.target.value);
                if (r) setRollo(r);
              }}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {ROLLOS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        <span className="text-sm text-neutral-600 mr-auto">
          <b className="text-neutral-900">{aImprimir.length}</b> stickers
          {papel === "plancha" && (
            <>
              {" · "}
              <b className="text-neutral-900">{hojas}</b> {hojas === 1 ? "hoja" : "hojas"}
            </>
          )}
        </span>

        <button
          type="button"
          onClick={() => {
            window.print();
            if (papel === "plancha") setPendiente(((desde - 1 + aImprimir.length) % porHoja) + 1);
          }}
          disabled={aImprimir.length === 0}
          className="rounded-lg bg-accent text-white px-4 py-2.5 text-sm font-semibold hover:bg-accent-dark disabled:opacity-40"
        >
          🖨️ Imprimir
        </button>
      </div>

      {papel === "plancha" && pendiente != null && (
        <div className="print:hidden mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-emerald-900 mr-auto">
            ¿Salió bien?{" "}
            {pendiente === 1 ? (
              <>La hoja quedó llena: la próxima vez arranca en una hoja nueva.</>
            ) : (
              <>
                La próxima vez que pongas esta hoja, arranca en el{" "}
                <b>renglón {Math.floor((pendiente - 1) / plancha.cols) + 1}</b>
                {(pendiente - 1) % plancha.cols > 0 && <>, etiqueta {((pendiente - 1) % plancha.cols) + 1}</>}.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              cambiarDesde(pendiente);
              setPendiente(null);
              anotarImpresos(aImprimir.map((i) => i.idVariante));
            }}
            className="rounded-lg bg-emerald-700 text-white px-3 py-2 text-sm font-semibold hover:bg-emerald-800"
          >
            Sí, salió bien
          </button>
          <button
            type="button"
            onClick={() => setPendiente(null)}
            className="rounded-lg border border-emerald-300 bg-white text-emerald-900 px-3 py-2 text-sm hover:bg-emerald-100"
          >
            No, la repito
          </button>
        </div>
      )}

      <p className="print:hidden text-xs text-neutral-500 mt-3 leading-relaxed max-w-2xl">
        {papel === "plancha" ? (
          <>
            Al imprimir, poné el tamaño en <b>A4</b> y los márgenes en <b>ninguno</b>, y desactivá
            &ldquo;ajustar al papel&rdquo; — si el navegador achica la página, las etiquetas salen
            corridas y se arruina la plancha entera. Hacé una prueba en papel común y ponela sobre la
            plancha a contraluz antes de gastar la primera. Si los códigos caen corridos, medí cuánto
            con una regla y ponelo en <b>Bajar</b> o <b>Correr a la derecha</b> (en negativo para el
            otro lado). Si arriba sale bien y abajo se va descuadrando, usá los de <b>Por renglón</b>:
            medí cuánto se corrió el último renglón y dividilo por cuántos renglones hay (por ejemplo, 2 mm
            para abajo en el renglón 10 → −0,2). Queda guardado en esta compu para las próximas veces.
          </>
        ) : (
          <>
            Cada sticker sale como una etiqueta suya y la impresora corta sola. Elegí la térmica en
            el menú de impresión de la tablet y poné los márgenes en <b>ninguno</b> y la escala en{" "}
            <b>100%</b>. Si la impresora no aparece en ese menú, es que es solo-Bluetooth: esas
            andan nada más que con la app del fabricante.
          </>
        )}
      </p>

      {aImprimir.length > 0 && <EjemploEtiqueta item={aImprimir[0]} medida={papel === "plancha" ? plancha : rollo} />}
      {aImprimir.length > 0 && (
        <TodasLasEtiquetas
          items={items.filter((i) => (cantidades[i.idVariante] ?? 0) > 0)}
          cantidades={cantidades}
          medida={papel === "plancha" ? plancha : rollo}
        />
      )}

      {papel === "plancha" ? (
        <HojaDeEtiquetas plancha={plancha} desde={desde} items={aImprimir} ajuste={ajuste} />
      ) : (
        <TiraDeEtiquetas rollo={rollo} items={aImprimir} />
      )}
    </TandaContext.Provider>
  );
}

/**
 * Una etiqueta en grande, arriba de la hoja: la hoja entera se ve chica y no
 * se llega a leer cómo queda (pedido de Gonzalo). Solo en pantalla: al
 * imprimir sale únicamente la hoja.
 */
function EjemploEtiqueta({ item, medida }: { item: ItemCodigo; medida: { ancho: number; alto: number } }) {
  // Hasta 3 veces, sin pasar de unos 12 cm de ancho en pantalla.
  const escala = Math.min(3, 120 / medida.ancho);
  return (
    <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4 print:hidden">
      <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">Así sale cada etiqueta (ampliada para verla mejor)</p>
      <div className="mx-auto" style={{ width: `${medida.ancho * escala}mm`, height: `${medida.alto * escala}mm`, maxWidth: "100%" }}>
        <div
          className="bg-white shadow-sm"
          style={{
            width: `${medida.ancho}mm`,
            height: `${medida.alto}mm`,
            transform: `scale(${escala})`,
            transformOrigin: "top left",
            outline: ".2mm dashed #d4d4d4",
            overflow: "hidden",
          }}
        >
          <Etiqueta item={item} medida={medida} />
        </div>
      </div>
      <p className="text-xs text-neutral-500 mt-3 text-center">
        {nombreParaEtiqueta(item)} · tamaño real {String(medida.ancho).replace(".", ",")} × {String(medida.alto).replace(".", ",")} mm
      </p>
    </div>
  );
}

/**
 * Todas las que se van a imprimir, una por producto, al doble de tamaño y con
 * cuántas salen (Gonzalo, 2026-11-06: «como los precios de góndola»). En la
 * hoja achicada de abajo las de 39 × 17 no se llegan a leer. Solo en pantalla.
 */
function TodasLasEtiquetas({
  items,
  cantidades,
  medida,
}: {
  items: ItemCodigo[];
  cantidades: Record<string, number>;
  medida: { ancho: number; alto: number };
}) {
  const escala = Math.min(2, 90 / medida.ancho);
  const total = items.reduce((t, i) => t + (cantidades[i.idVariante] ?? 0), 0);
  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 print:hidden">
      <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">
        Las que se van a imprimir · {items.length} {items.length === 1 ? "producto" : "productos"} · {total} {total === 1 ? "etiqueta" : "etiquetas"}
      </p>
      <div className="flex flex-wrap gap-4">
        {items.map((i) => (
          <div key={i.idVariante} className="flex flex-col items-center gap-1.5">
            <div style={{ width: `${medida.ancho * escala}mm`, height: `${medida.alto * escala}mm` }}>
              <div
                className="bg-white shadow-sm"
                style={{
                  width: `${medida.ancho}mm`,
                  height: `${medida.alto}mm`,
                  transform: `scale(${escala})`,
                  transformOrigin: "top left",
                  outline: ".2mm dashed #d4d4d4",
                  overflow: "hidden",
                }}
              >
                <Etiqueta item={i} medida={medida} />
              </div>
            </div>
            <span className="text-xs font-bold text-neutral-600 tabular-nums">× {cantidades[i.idVariante] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * La hoja en chiquito para decir dónde arranca: se toca la primera etiqueta
 * libre de una hoja ya empezada (o el número del renglón). Gris = ya usada,
 * color de la marca = lo que sale en esta tanda.
 */
function ElegirInicio({
  plancha,
  desde,
  cantidad,
  onElegir,
}: {
  plancha: Plancha;
  desde: number;
  cantidad: number;
  onElegir: (n: number) => void;
}) {
  const porHoja = plancha.cols * plancha.filas;
  const renglon = Math.floor((desde - 1) / plancha.cols) + 1;
  const etiqueta = ((desde - 1) % plancha.cols) + 1;
  return (
    <div>
      <span className="block text-xs text-neutral-500 mb-1">Dónde arranca en la hoja</span>
      <div className="flex gap-3 items-start">
        <div
          className="grid gap-[2px] rounded border border-neutral-300 bg-white p-1"
          style={{ gridTemplateColumns: `14px repeat(${plancha.cols}, 22px)` }}
        >
          {Array.from({ length: plancha.filas }, (_, f) => (
            <Fragment key={f}>
              <button
                type="button"
                onClick={() => onElegir(f * plancha.cols + 1)}
                title={`Empezar en el renglón ${f + 1}`}
                className="text-[8px] leading-[10px] text-neutral-400 hover:text-neutral-900 tabular-nums text-right"
              >
                {f + 1}
              </button>
              {Array.from({ length: plancha.cols }, (_, c) => {
                const n = f * plancha.cols + c + 1;
                const usada = n < desde;
                const sale = !usada && n < desde + cantidad;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onElegir(n)}
                    title={`Renglón ${f + 1}, etiqueta ${c + 1}`}
                    className={`h-[10px] rounded-[2px] border ${
                      usada
                        ? "bg-neutral-300 border-neutral-300"
                        : sale
                          ? "bg-accent border-accent"
                          : "bg-white border-neutral-300 hover:border-neutral-500"
                    }`}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
        <div className="text-xs text-neutral-600 space-y-2 max-w-[11rem]">
          <p>
            {desde === 1 ? (
              <>Hoja nueva, desde arriba.</>
            ) : (
              <>
                Arranca en el <b className="text-neutral-900">renglón {renglon}</b>
                {etiqueta > 1 && <>, etiqueta {etiqueta}</>}. Lo gris ya está usado.
              </>
            )}
          </p>
          <p className="text-neutral-500">Tocá la primera etiqueta libre, o elegila acá:</p>
          <div className="flex gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] text-neutral-500">Renglón</span>
              <select
                value={renglon}
                onChange={(e) => onElegir((Number(e.target.value) - 1) * plancha.cols + etiqueta)}
                className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {Array.from({ length: plancha.filas }, (_, f) => (
                  <option key={f} value={f + 1}>
                    {f + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] text-neutral-500">Etiqueta</span>
              <select
                value={etiqueta}
                onChange={(e) => onElegir((renglon - 1) * plancha.cols + Number(e.target.value))}
                className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {Array.from({ length: plancha.cols }, (_, c) => (
                  <option key={c} value={c + 1}>
                    {c + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {desde > 1 && (
            <button
              type="button"
              onClick={() => onElegir(1)}
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-100"
            >
              Hoja nueva
            </button>
          )}
          {desde - 1 + cantidad > porHoja && (
            <p className="text-amber-700">Lo que no entra sigue en otra hoja, desde arriba.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * La hoja tal cual sale de la impresora.
 *
 * En pantalla se muestra chica como vista previa; al imprimir, la regla
 * `@page` y las medidas en milímetros hacen que cada casillero caiga justo
 * sobre su etiqueta autoadhesiva.
 */
function HojaDeEtiquetas({
  plancha,
  desde,
  items,
  ajuste,
}: {
  plancha: Plancha;
  desde: number;
  items: ItemCodigo[];
  /** Milímetros que se corre toda la grilla, y lo que se corre cada renglón, para compensar la impresora. */
  ajuste: AjusteHoja;
}) {
  const porHoja = plancha.cols * plancha.filas;
  // Los casilleros que se saltean van vacíos adelante; el resto se corta en
  // hojas de `porHoja`.
  const casilleros: (ItemCodigo | null)[] = [...Array(desde - 1).fill(null), ...items];
  const hojas: (ItemCodigo | null)[][] = [];
  for (let i = 0; i < casilleros.length; i += porHoja) {
    const hoja = casilleros.slice(i, i + porHoja);
    while (hoja.length < porHoja) hoja.push(null);
    hojas.push(hoja);
  }

  return (
    <div className="hoja-etiquetas">
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden; }
          .hoja-etiquetas, .hoja-etiquetas * { visibility: visible; }
          .hoja-etiquetas { position: absolute; left: 0; top: 0; }
          .etq-hoja { page-break-after: always; }
          .etq-hoja:last-child { page-break-after: auto; }
        }
        @media screen {
          .hoja-etiquetas { margin-top: 28px; }
          .etq-hoja {
            transform: scale(.62); transform-origin: top left;
            margin-bottom: calc(-297mm * .38 + 24px);
            box-shadow: 0 4px 24px rgba(20,26,34,.16);
            border-radius: 2px;
          }
          .etq-casillero { outline: .2mm dashed #e2e2e2; outline-offset: -.1mm; }
        }
      `}</style>

      {hojas.map((hoja, h) => (
        <div
          key={h}
          className="etq-hoja bg-white"
          style={{
            width: "210mm",
            height: "297mm",
            // El ajuste nunca puede sacar la grilla del papel: el margen
            // resultante se frena en cero.
            paddingTop: `${Math.max(0, plancha.margenY + ajuste.y)}mm`,
            paddingLeft: `${Math.max(0, plancha.margenX + ajuste.x)}mm`,
            boxSizing: "border-box",
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: `repeat(${plancha.cols}, ${plancha.ancho}mm)`,
            gridAutoRows: `${plancha.alto}mm`,
            columnGap: `${plancha.sepX}mm`,
            rowGap: `${plancha.sepY}mm`,
          }}
        >
          {hoja.map((item, i) => {
            // Cada renglón se corre lo que se va acumulando (ajuste fy/fx).
            const renglon = Math.floor(i / plancha.cols);
            const corrimiento =
              ajuste.fx || ajuste.fy ? { transform: `translate(${(renglon * ajuste.fx).toFixed(2)}mm, ${(renglon * ajuste.fy).toFixed(2)}mm)` } : undefined;
            return item ? (
              <div key={i} style={{ width: "100%", height: "100%", ...corrimiento }}>
                <Etiqueta item={item} medida={plancha} />
              </div>
            ) : (
              <div key={i} className="etq-casillero" style={corrimiento} />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Lo mismo pero para una impresora térmica: cada sticker es una página suya y
 * la impresora corta sola. No hay grilla ni casilleros que desperdiciar.
 */
function TiraDeEtiquetas({ rollo, items }: { rollo: Rollo; items: ItemCodigo[] }) {
  return (
    <div className="hoja-etiquetas">
      <style>{`
        @media print {
          @page { size: ${rollo.ancho}mm ${rollo.alto}mm; margin: 0; }
          body * { visibility: hidden; }
          .hoja-etiquetas, .hoja-etiquetas * { visibility: visible; }
          .hoja-etiquetas { position: absolute; left: 0; top: 0; }
          .etq-rollo { page-break-after: always; }
          .etq-rollo:last-child { page-break-after: auto; }
        }
        @media screen {
          .hoja-etiquetas { margin-top: 28px; display: flex; flex-wrap: wrap; gap: 10px; }
          .etq-rollo {
            border: 1px solid #e5e5e5; border-radius: 3px;
            box-shadow: 0 1px 4px rgba(20,26,34,.08);
          }
        }
      `}</style>

      {items.map((item, i) => (
        <div
          key={i}
          className="etq-rollo bg-white"
          style={{ width: `${rollo.ancho}mm`, height: `${rollo.alto}mm`, overflow: "hidden" }}
        >
          <Etiqueta item={item} medida={rollo} />
        </div>
      ))}
    </div>
  );
}

function Etiqueta({ item, medida }: { item: ItemCodigo; medida: { ancho: number; alto: number } }) {
  if (item.rotulo && entraRotulo(medida)) return <EtiquetaRotulada item={item} rotulo={item.rotulo} />;
  if (item.rotulo && medida.alto >= 15) return <EtiquetaChicaPropia item={item} rotulo={item.rotulo} medida={medida} />;
  return <EtiquetaSimple item={item} medida={medida} />;
}

/** Nombre, código y (en la grande) de quién es: lo de las marcas y lo cerrado que lleva sticker. */
function EtiquetaSimple({ item, medida }: { item: ItemCodigo; medida: { ancho: number; alto: number } }) {
  // En las etiquetas chicas no entra el mismo cuerpo de letra.
  const escala = medida.ancho < 50 ? 0.72 : 1;
  const chica = medida.alto < 30;
  // En la chica el sabor no tiene renglón propio: va pegado al nombre, así se sabe cuál es.
  const nombre = nombreParaEtiqueta(item) + (chica && item.variante ? ` ${item.variante}` : "");
  const numeros = 2.6 * escala;
  const maximo = 3.2 * escala;
  // El lugar que le queda al nombre: lo que sobra después del código y lo demás.
  const anchoNombre = medida.ancho - (chica ? 3.2 : 6);
  const altoNombreCon = (altoCodigo: number) =>
    chica
      ? medida.alto - 2.8 - altoCodigo - numeros - 1.2
      : medida.alto - 4.8 - altoCodigo - numeros - 2.7 - (item.variante ? 2.7 * escala * 1.2 : 0) - 1.4;
  // Un nombre largo («Granola Casera Tradicional Sin Coco 1 kg») pasa a dos
  // renglones en vez de achicarse: el código baja un poco de alto (el ancho,
  // que es lo que lee el lector, no cambia). Gonzalo, 2026-11-11.
  const altoCodigoNormal = chica ? (medida.alto >= 16 ? 7 : 5.5) : 9;
  const altoCodigoBajo = chica ? 5.5 : 7.5;
  const medir = useSePuedeMedir();
  const altoCodigo = useMemo(() => {
    const entra = cuerpoQueEntra(nombre, anchoNombre, altoNombreCon(altoCodigoNormal), maximo);
    return entra >= maximo * 0.88 ? altoCodigoNormal : altoCodigoBajo;
  }, [nombre, anchoNombre, altoCodigoNormal, altoCodigoBajo, maximo, medir]); // eslint-disable-line react-hooks/exhaustive-deps
  const altoNombre = altoNombreCon(altoCodigo);

  return (
    <div
      className="etq-casillero"
      style={{
        width: "100%",
        height: "100%",
        padding: `${chica ? 1.4 : 2.4}mm ${chica ? 1.6 : 3}mm`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
        color: "#000",
        fontFamily: "'Arial Narrow', Arial, sans-serif",
      }}
    >
      {/* Siempre al medio (Gonzalo, 2026-11-11). */}
      <div style={{ textAlign: "center" }}>
        <NombreQueEntra texto={nombre} ancho={anchoNombre} alto={altoNombre} maximo={maximo} centrado />
        {item.variante && !chica && (
          <div style={{ fontSize: `${2.7 * escala}mm`, color: "#333", lineHeight: 1.2 }}>
            {item.variante}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: ".4mm" }}>
        {/* En una etiqueta chica el código usa casi todo el ancho.
            Un código interno son 132 módulos contando las zonas mudas, y la
            norma pide al menos 0,25 mm por módulo para que un lector barato lo
            lea. Con el 80% de 39 mm quedaban 0,236 — por debajo del mínimo, y
            con tinta de inyección que se expande un poco, ilegible. Con el 92%
            quedan 0,272. En las planchas grandes no hace falta y el 80% se ve
            mejor. */}
        <CodigoDeBarras
          valor={item.codigo ?? ""}
          ancho={`${medida.ancho * (medida.ancho < 50 ? 0.92 : 0.8)}mm`}
          alto={`${altoCodigo}mm`}
        />
        <div
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: `${numeros}mm`,
            lineHeight: 1,
            letterSpacing: ".3mm",
            fontWeight: 500,
          }}
        >
          {formatearCodigo(item.codigo ?? "")}
        </div>
      </div>

      {!chica && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "2.2mm", color: "#666" }}>
          {/* De quién es el producto: lo nuestro dice WiiGo, lo de cada marca
              en consignación dice esa marca. */}
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.propia ? "WiiGo · Estaciones de Bienestar" : item.marca ?? ""}
          </span>
          <span style={{ flexShrink: 0, marginLeft: "1mm" }}>{item.sku ?? ""}</span>
        </div>
      )}
    </div>
  );
}

/** «Vto: ______»: sin la fecha impresa, para completarla con lapicera (Gonzalo, 2026-11-06). */
function LineaParaEscribir({ ancho }: { ancho: number }) {
  return <span style={{ display: "inline-block", width: `${ancho}mm`, height: ".9em", borderBottom: ".15mm solid #000", verticalAlign: "baseline" }} />;
}

/**
 * La etiqueta chica de lo nuestro (la plancha del local, 39 × 17 mm, 80 por
 * hoja): el nombre grande arriba, «Peso neto: 250 gr · Vto: ____» con aire
 * debajo, y el código. Desde el 2026-11-07 sin «WIIGO DIETÉTICA» arriba: la
 * letra salía muy chica y la bolsa ya es de WiiGo.
 * Sin lote: la fecha de vencimiento sirve de identificación del lote.
 * Los alérgenos no entran con letra legible: para eso está la de 70 × 35.
 */
function EtiquetaChicaPropia({ item, rotulo, medida }: { item: ItemCodigo; rotulo: RotuloItem; medida: { ancho: number; alto: number } }) {
  const { envasado, venceBolsa, conVencimiento } = useContext(TandaContext);
  const completo = nombreParaEtiqueta(item) + (item.variante ? ` ${item.variante}` : "");
  const nombre = rotulo.pesoG != null ? nombreBase(completo) : completo;
  const vence = calcularVencimiento(envasado, rotulo.dias ?? duracionSugerida(item.producto).dias, venceBolsa);
  // De 22 mm de alto para arriba (50 × 25, 40 × 30) hay lugar para letra más grande.
  const media = medida.alto >= 22;
  const altoCodigo = media ? 7 : 4.8;
  const numeros = media ? 1.9 : 1.5;
  // Sin «WIIGO DIETÉTICA» arriba (Gonzalo, 2026-11-07: «sale muy chiquito…
  // sacale el WiiGo Dietética»): ese renglón va a letra más grande y a dejar
  // aire entre el nombre y «Peso neto · Vto».
  const datos = media ? 2.5 : 2.15;
  const aire = media ? 1.1 : 0.9;
  // Lo que le queda al nombre después del aire, el peso y el código.
  // Separación entre las barras y los números de abajo: pegados se leían mal
  // (Gonzalo, 2026-11-09).
  const separacionNumeros = media ? 0.8 : 0.6;
  const altoNombre = media
    ? medida.alto - 3.2 - aire - datos * 1.15 - 0.6 - altoCodigo - separacionNumeros - numeros
    : medida.alto - 2.2 - aire - datos * 1.15 - 0.4 - altoCodigo - separacionNumeros - numeros;

  return (
    <div
      className="etq-casillero"
      style={{
        width: "100%",
        height: "100%",
        padding: media ? "1.8mm 2.2mm 1.4mm" : "1.2mm 1.6mm 1mm",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        overflow: "hidden",
        color: "#000",
        fontFamily: "'Arial Narrow', Arial, sans-serif",
      }}
    >
      <NombreQueEntra texto={nombre} ancho={medida.ancho - (media ? 4.4 : 3.2)} alto={altoNombre} maximo={media ? 3.8 : 3.3} centrado />
      <div style={{ marginTop: `${aire}mm`, display: "flex", gap: "2mm", justifyContent: "center", alignItems: "baseline", fontSize: `${datos}mm`, lineHeight: 1.15, whiteSpace: "nowrap" }}>
        {rotulo.pesoG != null && (
          <span>
            Peso neto: <b>{pesoEtiqueta(rotulo.pesoG)}</b>
          </span>
        )}
        <span>
          Vto: {conVencimiento ? <b>{fechaCorta(vence)}</b> : <LineaParaEscribir ancho={media ? 13 : 9} />}
        </span>
      </div>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: `${separacionNumeros}mm` }}>
        {/* Igual de ancho que antes (0,27 mm por barra): baja solo de alto para que entre todo el nombre. */}
        <CodigoDeBarras valor={item.codigo ?? ""} ancho={`${medida.ancho * (medida.ancho < 50 ? 0.92 : 0.8)}mm`} alto={`${altoCodigo}mm`} />
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: `${numeros}mm`, letterSpacing: ".15mm", lineHeight: 1 }}>
          {formatearCodigo(item.codigo ?? "")}
        </div>
      </div>
    </div>
  );
}

/**
 * La etiqueta de lo que fraccionamos nosotros: la bolsita lleva todo lo que no
 * cambia (qué es, cuánto pesa, cuándo vence, qué alérgenos tiene y quién la
 * armó). El precio no, a propósito: va en el cartel de góndola, así un aumento
 * no obliga a reetiquetar las bolsas. Medida pensada para 70 × 35 mm; en una
 * más grande sobra aire, en una más chica no se usa (ver entraRotulo).
 */
function EtiquetaRotulada({ item, rotulo }: { item: ItemCodigo; rotulo: RotuloItem }) {
  const { pie, envasado, venceBolsa, conVencimiento } = useContext(TandaContext);
  const nombre = nombreParaEtiqueta(item) + (item.variante ? ` ${item.variante}` : "");
  const textoNombre = rotulo.pesoG != null ? nombreBase(nombre) : nombre;
  const dias = rotulo.dias ?? duracionSugerida(item.producto).dias;
  const vence = calcularVencimiento(envasado, dias, venceBolsa);
  const alergenos = [
    rotulo.alergenos && `Contiene ${rotulo.alergenos.replace(/\.$/, "")}.`,
    rotulo.trazas && `Puede contener trazas de ${rotulo.trazas.replace(/\.$/, "")}.`,
  ].filter(Boolean) as string[];

  return (
    <div
      className="etq-casillero"
      style={{
        width: "100%",
        height: "100%",
        padding: "1.8mm 2.2mm",
        display: "flex",
        flexDirection: "column",
        gap: ".6mm",
        overflow: "hidden",
        color: "#000",
        fontFamily: "'Arial Narrow', Arial, sans-serif",
      }}
    >
      {/* Como la chica (Gonzalo, 2026-11-06): WIIGO DIETÉTICA arriba y el nombre en el medio. */}
      <div style={{ fontSize: "1.9mm", fontWeight: 700, letterSpacing: ".28mm", lineHeight: 1, textTransform: "uppercase", textAlign: "center" }}>
        WiiGo Dietética
      </div>
      {/* El peso va abajo como "Peso neto": acá el nombre sin el tamaño. Entero, sin «…». */}
      <NombreQueEntra texto={textoNombre} ancho={65.6} alto={alergenos.length > 0 ? 7.2 : 9.5} maximo={3.6} centrado />


      {/* Sin lote: la fecha de vencimiento sirve de identificación del lote. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1.5mm",
          fontSize: "2mm",
          borderTop: ".2mm solid #000",
          borderBottom: ".2mm solid #000",
          padding: ".4mm 0",
          whiteSpace: "nowrap",
        }}
      >
        {rotulo.pesoG != null && (
          <span>
            Peso neto: <b>{pesoEtiqueta(rotulo.pesoG)}</b>
          </span>
        )}
        <span>
          Envasado: <b>{fechaCorta(envasado)}</b>
        </span>
        <span>
          Vto: {conVencimiento ? <b>{fechaCorta(vence)}</b> : <LineaParaEscribir ancho={13} />}
        </span>
      </div>

      {alergenos.length > 0 && (
        <div
          style={{
            fontSize: "1.8mm",
            lineHeight: 1.2,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {alergenos.map((t, i) => (i === 0 ? <b key={i}>{t} </b> : <span key={i}>{t}</span>))}
        </div>
      )}

      <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1.5mm" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: ".3mm" }}>
          {/* 34 mm: un código interno son 132 módulos y la norma pide 0,25 mm
              por módulo como mínimo para que lo lea un lector barato. */}
          <CodigoDeBarras valor={item.codigo ?? ""} ancho="34mm" alto="7mm" />
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.9mm", letterSpacing: ".2mm" }}>
            {formatearCodigo(item.codigo ?? "")}
          </div>
        </div>
        <div style={{ fontSize: "1.55mm", lineHeight: 1.25, textAlign: "right" }}>
          {pie.split("\n").map((linea, i) => (
            <div key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>
              {linea}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function agruparPorMarca(items: ItemCodigo[]): [string, ItemCodigo[]][] {
  const mapa = new Map<string, ItemCodigo[]>();
  for (const i of items) {
    const k = i.marca ?? SIN_MARCA;
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k)!.push(i);
  }
  return [...mapa.entries()].sort((a, b) => {
    // Las marcas inactivas al final: no van a la góndola.
    if (a[0] === SIN_MARCA) return 1;
    if (b[0] === SIN_MARCA) return -1;
    return b[1].length - a[1].length;
  });
}
