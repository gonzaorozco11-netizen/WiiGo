"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ambosPrecios } from "@/lib/precios";
import { bricolage } from "@/app/fuentes/asesor";
import type {
  Local,
  MarcaPublica,
  ProductoPublico,
  VarianteProductoPublica,
  Objetivo,
  FiltroProducto,
  FichaProducto,
  Subcategoria,
  ProfesionalPublico,
  ConsultorioEnFicha,
  ConocemeSlide,
  FormacionProfesional,
  TrayectoriaProfesional,
} from "@/lib/supabase";
import { colorDeProducto, ubicacionDe, type ModuloGondola, type UbicacionGondola } from "@/lib/gondola";
import ViajeGondola from "@/components/ViajeGondola";
import { aplicarMargenDePantalla, datosDelAparato, guardarMargenDePantalla, usePlacaLiviana, type MargenPantalla } from "@/lib/placaLiviana";
import NutricionAsesor from "@/components/NutricionAsesor";
import { CarruselProfesional, ModosAtencion, NumerosProfesional, OpinionesPacientes, PildorasRecorrido, type OpinionPaciente } from "@/components/PerfilProfesional";
import IconoRed, { colorDeRed } from "@/components/IconoRed";
import type { ClaveRed } from "@/lib/redesProfesional";

type Pantalla = "home" | "objetivo" | "resultado" | "marcas" | "ofertas" | "profesionales" | "fichaProfesional" | "conoceme" | "reservarTurno";

// Una red de la profesional, lista para mostrar: el usuario y el QR en SVG
// (se arma en el servidor; ver app/asesor/[idLocal]/page.tsx).
export type RedEnFicha = { clave: string; nombre: string; texto: string; qr: string };

const IDLE_WARNING_MS = 45000; // sin tocar nada
const IDLE_COUNTDOWN_S = 10; // después del aviso, segundos para volver sola al inicio

/* ---------------------------------------------------------------------------
   Mantener la pantalla al día, al instante

   El tótem abre la página a la mañana y queda prendido todo el día, así que sin
   esto un precio que cambiás al mediodía no aparece hasta que alguien recarga.

   El truco para que sea inmediato sin reventar el servidor: cada 3 segundos
   pregunta *si cambió algo* —tres consultas de contar, un pedido diminuto— y
   recién cuando la respuesta cambia pide los datos de verdad. Recargar todo
   cada 3 segundos serían catorce mil pedidos por día con trece consultas cada
   uno; así son catorce mil pedidos que no traen nada, y dos o tres recargas
   completas al día, cuando de verdad tocaste algo.

   Si lo que cambió es la versión de la app —subiste cambios— recarga la página
   entera en vez de solo los datos.

   Todo espera a que nadie esté tocando la pantalla: nunca se le mueve nada
   debajo de la mano a un cliente que está mirando un producto.
   --------------------------------------------------------------------------- */
const CHEQUEO_MS = 3000;
const QUIETO_MS = 4000; // hace cuánto que nadie toca la pantalla
// Para recargar la página entera se pide mucho más silencio: es lo único que
// parpadea, así que tiene que pasar cuando no hay nadie adelante.
const QUIETO_RECARGA_MS = 60000;
const RED_MAX_FALLOS = 20; // si se cae internet, deja de insistir tan seguido
// Red de seguridad: la huella cubre lo que se cambia seguido, pero no todo.
// Cada tanto refresca igual, por si tocaste algo que no está contemplado.
const REFRESCO_SEGURIDAD_MS = 10 * 60 * 1000;

const SAGE = "#b6bca2";
const SAGE_DARK = "#646759";
const SAGE_TINT = "#f0f2ec";
const CLAY = "#b97a52"; // acento cálido: destacados en el perfil de profesionales
const C1 = "#8fa377"; // encontrar productos
const C2 = "#d99a5b"; // marcas y productos
const C3 = "#d97561"; // ofertas
const C4 = "#5f92a8"; // profesionales

/** Pestaña que junta los productos de la marca a los que nadie les puso rubro. */
const SIN_RUBRO = "__sin_rubro__";

/**
 * Cada puerta de la principal tiñe la pantalla a la que lleva.
 *
 * `fondo` es el color de la pantalla —el mismo de la puerta pero muy lavado— y
 * `acento` el fuerte, que se usa en lo que está elegido: la marca activa, el
 * rubro activo, las preferencias puestas y los títulos. Así el cliente sabe
 * dónde está por el color, sin leer.
 *
 * Son colores planos a propósito: en la placa Android de la all-in-one un
 * degradé animado o un desenfoque cuestan carísimo y un color liso no cuesta
 * nada.
 */
type Tema = { fondo: string; acento: string; barra: string; barraAcento: string };

// Las pantallas de productos usan la paleta del rediseño (Gonzalo,
// 2026-11-02: «me gusta la tipografía y colores… para todos los productos»):
// fondo crema, menú verde bosque con lo elegido en crema y acentos naranja.
const TEMA_PRODUCTOS: Tema = { fondo: "#f5efe3", acento: "#e8743b", barra: "#22301f", barraAcento: "#f5efe3" };

const TEMAS: Record<string, Tema> = {
  objetivo: TEMA_PRODUCTOS,
  resultado: TEMA_PRODUCTOS,
  marcas: TEMA_PRODUCTOS,
  ofertas: TEMA_PRODUCTOS,
  profesionales: { fondo: "#e9f1f2", acento: "#2d585b", barra: "#16262b", barraAcento: "#8fc9cf" },
  fichaProfesional: { fondo: "#e9f1f2", acento: "#2d585b", barra: "#16262b", barraAcento: "#8fc9cf" },
  conoceme: { fondo: "#e9f1f2", acento: "#2d585b", barra: "#16262b", barraAcento: "#8fc9cf" },
  reservarTurno: { fondo: "#e9f1f2", acento: "#2d585b", barra: "#16262b", barraAcento: "#8fc9cf" },
};

const TEMA_POR_DEFECTO: Tema = {
  fondo: "#ededed",
  acento: "#4d7635",
  barra: "#1e2a18",
  barraAcento: "#cfe8a6",
};

// Los cuadros de objetivos (portada y pantalla de objetivos). Los objetivos los
// carga Gonzalo y pueden ser cualquier cantidad, así que el color va por
// posición y no por nombre: si mañana agrega uno, se pinta solo.
const TONOS_INICIO = [
  { fondo: "#e8743b", texto: "#ffffff" },
  { fondo: "#2e3f29", texto: "#f5efe3" },
  { fondo: "#f1c75b", texto: "#3b2f0e" },
  { fondo: "#a8c08a", texto: "#1f2b17" },
  { fondo: "#d9a37f", texto: "#3a2010" },
  { fondo: "#3f6b6d", texto: "#eef5f2" },
];

/** Fondo de las caras de las profesionales sin foto, en la tarjeta del inicio. */
const CARAS_PROFESIONALES = [
  "linear-gradient(150deg,#e8a77f,#c4683d)",
  "linear-gradient(150deg,#c9d7b4,#7f9668)",
  "linear-gradient(150deg,#a9c5c7,#4f7d80)",
  "linear-gradient(150deg,#d9c39a,#9b7a45)",
  "linear-gradient(150deg,#d8b4c4,#9a5f77)",
];

/** "a, b y c" / "a, b and c" / "a, b e c". */
function listaConY(items: string[], idioma: Idioma) {
  if (items.length <= 1) return items.join("");
  const y = idioma === "en" ? " and " : idioma === "pt" ? " e " : " y ";
  return `${items.slice(0, -1).join(", ")}${y}${items[items.length - 1]}`;
}

// Títulos y precios. El texto corrido va en Figtree (ver app/asesor/layout.tsx).
// Antes eran Bodoni en cursiva y Fredoka; se cambió con el rediseño del
// 2026-11-02 porque de lejos, en la pantalla de 27", la Bodoni fina no se leía.
// Guardada en app/fuentes.
const titular = bricolage;

// Idioma de la pantalla — arranca en español, y se auto-detecta el del
// dispositivo al cargar (ver el useEffect en AsesorApp). Por ahora solo
// traduce el texto fijo de la pantalla de Inicio; el resto del Asesor
// (Objetivo, Resultado, Marcas, etc.) queda pendiente de traducir después.
type Idioma = "es" | "en" | "pt";

// Elige el texto en el idioma actual — si no se cargó traducción para ese
// campo, muestra el original en español en vez de dejarlo vacío. A nivel de
// módulo (no dentro de AsesorApp) porque también la usa ProductoDetalleModal,
// que es un componente aparte.
function traducir(idioma: Idioma, base: string, en: string | null | undefined, pt: string | null | undefined): string {
  if (idioma === "en") return en || base;
  if (idioma === "pt") return pt || base;
  return base;
}

function contarProductos(n: number, idioma: Idioma, sufijo?: "descuento" | "disponibles"): string {
  if (idioma === "en") {
    const base = `${n} product${n === 1 ? "" : "s"}`;
    if (sufijo === "descuento") return `${base} on sale`;
    if (sufijo === "disponibles") return `${base} available at WiiGo`;
    return base;
  }
  if (idioma === "pt") {
    const base = `${n} produto${n === 1 ? "" : "s"}`;
    if (sufijo === "descuento") return `${base} com desconto`;
    if (sufijo === "disponibles") return `${base} disponíve${n === 1 ? "l" : "is"} na WiiGo`;
    return base;
  }
  const base = `${n} producto${n === 1 ? "" : "s"}`;
  if (sufijo === "descuento") return `${base} con descuento`;
  if (sufijo === "disponibles") return `${base} disponible${n === 1 ? "" : "s"} en WiiGo`;
  return base;
}
const HOME_I18N = {
  es: {
    inicioTitulo1: "¿Qué querés",
    inicioTituloAcento: "lograr",
    inicioTitulo2: "hoy?",
    inicioBajada: "Tocá lo que buscás y te mostramos qué te sirve y en qué mueble está.",
    inicioBajadaSinGondola: "Tocá lo que buscás y te mostramos qué te sirve.",
    verTodosProductos: "Ver todos los productos",
    verTodoDesc: "por marca y por rubro",
    nuestrasMarcas: "Nuestras marcas",
    ofertasHoy: "Ofertas de hoy",
    profesionalesWiigo: "Profesionales de WiiGo",
    conocerla: "Ver su ficha y reservar turno",
    conocelos: "Conocelos y reservá turno",
    objetivoTitulo: "¿Cuál es tu objetivo hoy?",
    resultadoTitulo: "Te recomendamos",
    objetivoSubtitulo: "Elegí uno y te recomendamos lo que mejor te queda",
    objetivoVacio: "Todavía no cargaste objetivos en Catálogo asesor.",
    marcasTitulo: "Marcas y productos",
    marcasVacio: "Todavía no hay marcas visibles en el Asesor.",
    marcasSinProductos: "Todavía no hay productos visibles acá.",
    ofertasTitulo: "Ofertas",
    ofertasVacio: "Por ahora no hay productos con descuento cargado.",
    preferenciaTitulo: "¿Tenés alguna preferencia?",
    preferenciaVacio: "Todavía no cargaste preferencias en Catálogo asesor.",
    sinResultados: "No encontramos productos con esa combinación — probá sacando alguna preferencia.",
    todas: "Todas",
    railRubro: "Rubro",
    railSin: "Preferencias",
    railObjetivo: "Objetivo",
    otros: "Otros",
    profesionalesTitulo: "Nuestros profesionales",
    profesionalesSub: "Conocelos y pedí tu turno presencial o por videollamada",
    profesionalesVacio: "Todavía no hay profesionales cargados acá.",
    verFicha: "Ver más",
    historiaTitulo: "Su historia",
    formacionTitulo: "Formación",
    trayectoriaTitulo: "Trayectoria",
    redesTitulo: "Sus redes",
    escaneaQr: "Escaneá el código con tu celular y entrá a su perfil",
    hoy: "hoy",
    matricula: "Matrícula",
    presencial: "Presencial",
    online: "Online",
    atiendeEn: "Atiende en",
    juntoA: "junto a",
    mismaAgenda: "Comparten la agenda de turnos.",
    fotosTitulo: "Fotos",
  },
  en: {
    inicioTitulo1: "What do you",
    inicioTituloAcento: "want",
    inicioTitulo2: "today?",
    inicioBajada: "Tap what you're after and we'll show you what fits and which shelf it's on.",
    inicioBajadaSinGondola: "Tap what you're after and we'll show you what fits.",
    verTodosProductos: "See all products",
    verTodoDesc: "by brand and category",
    nuestrasMarcas: "Our brands",
    ofertasHoy: "Today's offers",
    profesionalesWiigo: "WiiGo professionals",
    conocerla: "See profile and book",
    conocelos: "Meet them and book",
    objetivoTitulo: "What's your goal today?",
    resultadoTitulo: "We recommend",
    objetivoSubtitulo: "Pick one and we'll recommend what fits best",
    objetivoVacio: "No goals loaded in Advisor Catalog yet.",
    marcasTitulo: "Brands & products",
    marcasVacio: "No brands are visible in the Advisor yet.",
    marcasSinProductos: "No products visible here yet.",
    ofertasTitulo: "Offers",
    ofertasVacio: "No discounted products loaded yet.",
    preferenciaTitulo: "Do you have any preference?",
    preferenciaVacio: "No preferences loaded in Advisor Catalog yet.",
    sinResultados: "We couldn't find products matching that combination — try removing a preference.",
    todas: "All",
    railRubro: "Category",
    railSin: "Preferences",
    railObjetivo: "Goal",
    otros: "Other",
    profesionalesTitulo: "Our professionals",
    profesionalesSub: "Meet them and book in person or by video call",
    profesionalesVacio: "No professionals loaded here yet.",
    verFicha: "See more",
    historiaTitulo: "Her story",
    formacionTitulo: "Education",
    trayectoriaTitulo: "Experience",
    redesTitulo: "Social media",
    escaneaQr: "Scan the code with your phone to open the profile",
    hoy: "today",
    matricula: "License",
    presencial: "In person",
    online: "Online",
    atiendeEn: "Works at",
    juntoA: "with",
    mismaAgenda: "They share the same booking calendar.",
    fotosTitulo: "Photos",
  },
  pt: {
    inicioTitulo1: "O que você",
    inicioTituloAcento: "quer",
    inicioTitulo2: "hoje?",
    inicioBajada: "Toque no que procura e mostramos o que serve e em qual móvel está.",
    inicioBajadaSinGondola: "Toque no que procura e mostramos o que serve.",
    verTodosProductos: "Ver todos os produtos",
    verTodoDesc: "por marca e categoria",
    nuestrasMarcas: "Nossas marcas",
    ofertasHoy: "Ofertas de hoje",
    profesionalesWiigo: "Profissionais da WiiGo",
    conocerla: "Ver perfil e agendar",
    conocelos: "Conheça e agende",
    objetivoTitulo: "Qual é o seu objetivo hoje?",
    resultadoTitulo: "Recomendamos",
    objetivoSubtitulo: "Escolha um e recomendamos o que combina melhor com você",
    objetivoVacio: "Ainda não há objetivos cadastrados no Catálogo consultor.",
    marcasTitulo: "Marcas e produtos",
    marcasVacio: "Ainda não há marcas visíveis no Consultor.",
    marcasSinProductos: "Ainda não há produtos visíveis aqui.",
    ofertasTitulo: "Ofertas",
    ofertasVacio: "Por enquanto não há produtos com desconto cadastrados.",
    preferenciaTitulo: "Você tem alguma preferência?",
    preferenciaVacio: "Ainda não há preferências cadastradas no Catálogo consultor.",
    sinResultados: "Não encontramos produtos com essa combinação — tente remover alguma preferência.",
    todas: "Todas",
    railRubro: "Categoria",
    railSin: "Preferências",
    railObjetivo: "Objetivo",
    otros: "Outros",
    profesionalesTitulo: "Nossos profissionais",
    profesionalesSub: "Conheça-os e marque presencial ou por videochamada",
    profesionalesVacio: "Ainda não há profissionais cadastrados aqui.",
    verFicha: "Ver mais",
    historiaTitulo: "Sua história",
    formacionTitulo: "Formação",
    trayectoriaTitulo: "Trajetória",
    redesTitulo: "Redes sociais",
    escaneaQr: "Escaneie o código com seu celular para abrir o perfil",
    hoy: "hoje",
    matricula: "Registro",
    presencial: "Presencial",
    online: "Online",
    atiendeEn: "Atende em",
    juntoA: "junto com",
    mismaAgenda: "Compartilham a mesma agenda.",
    fotosTitulo: "Fotos",
  },
} as const;

function plataformaVideo(url: string): string {
  if (/instagram\.com/i.test(url)) return "Instagram";
  if (/(youtube\.com|youtu\.be)/i.test(url)) return "YouTube";
  if (/tiktok\.com/i.test(url)) return "TikTok";
  return "Video";
}

// Links que no se pueden mostrar "adentro" de otra pantalla (apps de chat,
// no páginas de reserva) — a esos hay que llevarlos afuera directo.
function esLinkNoEmbebible(url: string): boolean {
  return /(wa\.me|api\.whatsapp\.com|whatsapp\.com)/i.test(url);
}

function formatoPrecio(precio: number | null) {
  if (precio == null) return "";
  return "$" + new Intl.NumberFormat("es-AR").format(Math.round(precio));
}

function precioConDescuento(p: ProductoPublico) {
  const base = p.precio_venta ?? 0;
  const descuento = p.descuento_porcentaje ?? 0;
  return descuento > 0 ? Math.round(base * (1 - descuento / 100)) : base;
}

function IconoBolsa({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 8h11l-1 12.5h-9L6.5 8z" />
      <path d="M9 8V6.2a3 3 0 0 1 6 0V8" />
    </svg>
  );
}
function IconoEtiqueta({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.7 3.6l6.7 6.7a2 2 0 0 1 0 2.8l-6 6a2 2 0 0 1-2.8 0l-6.7-6.7V4.6a1 1 0 0 1 1-1h7.8z" />
      <circle cx="8.3" cy="8.3" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
/**
 * La bolsita de WiiGo dibujada, para el producto que todavía no tiene foto:
 * flotando en la ficha se ve como el producto y no como un ícono vacío.
 */
function Doypack({ nombre, chica = false }: { nombre: string; chica?: boolean }) {
  // La primera palabra; si es larga, cortada con punto ("ALMOHA."), para que
  // entre en la etiqueta sin desbordarse.
  const palabra = (nombre.trim().split(/\s+/)[0] ?? "").toUpperCase();
  const etiqueta = palabra.length > 7 ? `${palabra.slice(0, 6)}.` : palabra;
  return (
    <span
      // El alto va en padding (que se mide contra el ancho del que la contiene)
      // y no con aspect-ratio, que un navegador viejo no entiende.
      className="relative block w-[46%] rounded-[22px_22px_30px_30px]"
      style={{
        paddingBottom: "64%",
        background: "linear-gradient(160deg, #fbfaf6, #ece6d8)",
        boxShadow: "inset 0 -10px 18px rgba(0,0,0,.05), 0 18px 26px -18px rgba(0,0,0,.35)",
      }}
      aria-hidden
    >
      <span
        className="absolute left-[7%] right-[7%] top-[5%] h-[4%] rounded"
        style={{ background: "repeating-linear-gradient(90deg, #d8d0bf 0 4px, transparent 4px 7px)" }}
      />
      <span className="absolute left-[16%] right-[16%] top-[24%] h-[36%] rounded-[44px]" style={{ background: colorDeProducto(nombre) }} />
      <span
        className={`${titular.className} absolute left-[9%] right-[9%] bottom-[10%] h-[19%] rounded-[10px] grid place-items-center overflow-hidden whitespace-nowrap text-[#f5efe3] font-extrabold tracking-[.02em] ${
          chica ? "text-[11px]" : "text-[clamp(11px,1.3vw,18px)]"
        }`}
        style={{ background: "#22301f" }}
      >
        {etiqueta}
      </span>
    </span>
  );
}

/**
 * El ícono de un objetivo, elegido por las palabras de su nombre: así un
 * objetivo nuevo trae su dibujo sin tener que cargarle una imagen. Si no
 * coincide con nada, va la brújula. Si el objetivo tiene imagen, se usa la
 * imagen y esto no se dibuja.
 */
const ICONOS_OBJETIVO: { claves: RegExp; trazo: React.ReactNode }[] = [
  { claves: /energ|rendim|vital/, trazo: <path d="M13 2 3 14h8l-1 8 10-12h-8z" /> },
  { claves: /muscul|prote|fuerza|masa|deport|entren/, trazo: <path d="M6 12h12M9 6v12M15 6v12M4 9v6M20 9v6" /> },
  { claves: /desayun|merienda|cafe|mañana|manana/, trazo: <><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M16 10h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3" /></> },
  { claves: /snack|colacion|picar|fruta/, trazo: <><path d="M12 7c-2-2-7-2-7 4s3 10 5 10 1-1 2-1 1 1 2 1 5-4 5-10-5-6-7-4z" /><path d="M12 7c0-2 1-4 3-4" /></> },
  { claves: /caloria|peso|adelgaz|liviano|light|bajar/, trazo: <path d="M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0z" /> },
  { claves: /tacc|celiac|gluten/, trazo: <><path d="M12 21V9M12 9c-3 0-4-2-4-4 2 0 4 1 4 4zM12 9c3 0 4-2 4-4-2 0-4 1-4 4zM12 14c-3 0-4-2-4-4 2 0 4 1 4 4zM12 14c3 0 4-2 4-4-2 0-4 1-4 4z" /><path d="M4 4l16 16" /></> },
  { claves: /dormir|sueño|sueno|descans|relaj|estres/, trazo: <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" /> },
  { claves: /cocin|receta|harina|legumbre/, trazo: <path d="M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM2 10h20M9 6c0-1 1-2 3-2s3 1 3 2" /> },
  { claves: /sano|natural|vegan|veget|salud|organ/, trazo: <><path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15" /><path d="M5 19 13 11" /></> },
  { claves: /digest|intestin|fibra|panza/, trazo: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></> },
];

function IconoObjetivo({ nombre, className }: { nombre: string; className?: string }) {
  const texto = nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hallado = ICONOS_OBJETIVO.find((i) => i.claves.test(texto));
  if (!hallado) return <IconoBrujula className={className} />;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {hallado.trazo}
    </svg>
  );
}

/** La marca de la casa (WiiGo Dietética): la única que va en bolsita kraft. */
function esMarcaWiigo(marca: MarcaPublica | undefined) {
  return Boolean(marca && /wiigo/i.test(marca.nombre));
}

/**
 * Lo que se muestra cuando el producto no tiene foto. Si es de WiiGo, la
 * bolsita kraft con su nombre. Si es de otra marca, su logo apagado: una
 * crema de Crislo dibujada como bolsita de WiiGo sería mentirle al cliente
 * (Gonzalo, 2026-11-03).
 */
function SinFoto({ producto, logoMarca, bolsita, chica = false }: { producto: ProductoPublico; logoMarca: string | null; bolsita: boolean; chica?: boolean }) {
  if (bolsita) {
    return (
      <span className={`${chica ? "w-[86%]" : "w-full"} flex items-center justify-center`}>
        <Doypack nombre={producto.nombre} chica={chica} />
      </span>
    );
  }
  if (logoMarca) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoMarca} alt="" className={`${chica ? "w-[46%]" : "w-[42%]"} h-auto rounded-full opacity-60`} />
    );
  }
  return (
    <span style={{ color: SAGE_DARK }}>
      <IconoBolsa className={chica ? "w-8 h-8" : "w-14 h-14"} />
    </span>
  );
}

function IconoBrujula({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.6" />
      <path d="M15.4 8.6l-1.9 4.9-4.9 1.9 1.9-4.9 4.9-1.9z" />
    </svg>
  );
}

// Dibujadas a mano en vez de usar el emoji de bandera — en Windows el emoji
// de bandera se ve como el código de país en letras, sin ningún color.
function BanderaIdioma({ lng, className }: { lng: Idioma; className?: string }) {
  if (lng === "en") {
    return (
      <svg className={className} viewBox="0 0 20 14">
        <rect width="20" height="14" fill="#fff" />
        <g fill="#B22234">
          <rect y="0" width="20" height="1.08" />
          <rect y="2.15" width="20" height="1.08" />
          <rect y="4.3" width="20" height="1.08" />
          <rect y="6.45" width="20" height="1.08" />
          <rect y="8.6" width="20" height="1.08" />
          <rect y="10.75" width="20" height="1.08" />
          <rect y="12.9" width="20" height="1.08" />
        </g>
        <rect width="9" height="7.5" fill="#3C3B6E" />
      </svg>
    );
  }
  if (lng === "pt") {
    return (
      <svg className={className} viewBox="0 0 20 14">
        <rect width="20" height="14" fill="#009739" />
        <polygon points="10,1 19,7 10,13 1,7" fill="#FEDD00" />
        <circle cx="10" cy="7" r="3" fill="#012169" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 20 14">
      <rect width="20" height="14" fill="#AA151B" />
      <rect y="3.5" width="20" height="7" fill="#F1BF00" />
    </svg>
  );
}

function Navbar({ onVolver, onInicio, idioma }: { onVolver: () => void; onInicio: () => void; idioma: Idioma }) {
  const volverTxt = idioma === "en" ? "Back" : idioma === "pt" ? "Voltar" : "Volver";
  const inicioTxt = idioma === "en" ? "Home" : idioma === "pt" ? "Início" : "Inicio";
  // Del tamaño de un dedo y con contraste (2026-11-02): en la pantalla de 27"
  // los de antes se perdían. Los dos a la izquierda; a la derecha van los
  // idiomas (ver AsesorApp).
  return (
    <div className="flex items-center px-5 pt-5 [@media(max-height:820px)]:pt-3 pr-[250px] shrink-0">
      <button
        onClick={onVolver}
        className="inline-flex items-center rounded-full h-[54px] [@media(max-height:820px)]:h-[48px] px-5 text-[17px] font-extrabold text-white mr-2.5"
        style={{ background: "#22301f", boxShadow: "0 10px 20px -12px rgba(0,0,0,.6)" }}
      >
        <svg className="w-[22px] h-[22px] mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {volverTxt}
      </button>
      <button
        onClick={onInicio}
        className="inline-flex items-center rounded-full h-[54px] [@media(max-height:820px)]:h-[48px] px-5 text-[17px] font-extrabold bg-white border-2 border-[#e8dfcd]"
        style={{ color: "#22301f" }}
      >
        <svg className="w-[22px] h-[22px] mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
        </svg>
        {inicioTxt}
      </button>
    </div>
  );
}

/** Botón de marca en los resultados, con cuántos productos tiene. */
/**
 * Los dos precios de un producto en la tarjeta.
 *
 * Arriba el de lista —lo que se cobra con tarjeta o Mercado Pago— y debajo, en
 * verde, el de efectivo. El de efectivo solo aparece si está cargado y es más
 * barato: cuando la marca todavía no lo cargó se muestra un precio solo, sin
 * huecos ni "ahorrás $0".
 */
function PrecioTarjeta({ producto }: { producto: ProductoPublico }) {
  const { lista, efectivo, ahorro } = ambosPrecios(producto, null);
  return (
    <div className="mt-1 flex flex-col gap-1">
      <span className={`${titular.className} text-[17px] lg:text-[20px] font-extrabold leading-none tracking-[-.01em] text-[#1f261c]`}>
        {formatoPrecio(lista)}
      </span>
      {ahorro !== null && (
        <span
          className="self-start inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-1"
          style={{ background: "#e6eedb" }}
        >
          <span className="text-[9px] lg:text-[10px] font-extrabold uppercase tracking-[.1em]" style={{ color: "#5d7348" }}>
            Efectivo
          </span>
          <span className={`${titular.className} text-[13px] lg:text-[14px] font-bold`} style={{ color: "#33521f" }}>
            {formatoPrecio(efectivo)}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * Tarjeta de producto en los resultados.
 *
 * `compacta` es la versión de una sola fila que se usa con el teclado abierto:
 * mismo contenido, ancho fijo para que la fila se pueda correr con el dedo.
 */
/**
 * Un tramo de la hoja derecha de la ficha: historia, formación, trayectoria.
 *
 * Aparece cuando entra en pantalla, no de entrada. Leído de corrido, un panel
 * con todo puesto se parece a un formulario; apareciendo de a uno se lee como
 * alguien contando algo. El que no desliza no se pierde nada: el primero ya
 * está visible apenas se abre.
 */
function BloqueHistoria({
  titulo,
  contenedor,
  children,
}: {
  titulo: string;
  /** El panel que se desliza: es contra él que se mide, no contra la ventana. */
  contenedor: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const propio = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = propio.current;
    if (!el) return;
    // Sin IntersectionObserver —un navegador viejo del tótem— se muestra todo
    // de una: mejor sin animación que sin contenido.
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: contenedor.current ?? null, threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [contenedor]);

  return (
    <div
      ref={propio}
      className="mb-6 last:mb-0"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translate3d(0,0,0)" : "translate3d(0,18px,0)",
        transition: "opacity .55s ease, transform .55s cubic-bezier(.2,.8,.2,1)",
      }}
    >
      <p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-[#969d88] mb-2.5">{titulo}</p>
      {children}
    </div>
  );
}

function TarjetaResultado({
  producto,
  marca,
  etiqueta,
  nombre,
  onClick,
  compacta = false,
  bolsita = false,
  logoMarca = null,
  sinStock = null,
}: {
  producto: ProductoPublico;
  marca: MarcaPublica | undefined;
  etiqueta: string;
  nombre: string;
  onClick: () => void;
  compacta?: boolean;
  /** Es de WiiGo: sin foto se dibuja la bolsita kraft. */
  bolsita?: boolean;
  /** Logo de la marca, para los productos de otras marcas que no tienen foto. */
  logoMarca?: string | null;
  /** En 0 en el local: el texto «Sin stock» en el idioma de la pantalla. */
  sinStock?: string | null;
}) {
  return (
    <div
      onClick={onClick}
      // Rediseño 2026-11-02: más grande y redonda, la foto sobre un fondo crema
      // para que el doypack blanco no se pierda contra la tarjeta blanca.
      className={`rounded-[22px] bg-white overflow-hidden flex flex-col cursor-pointer border border-[#ece4d4] transition-transform active:scale-[.98] ${
        compacta ? "w-[160px] lg:w-[180px] shrink-0" : ""
      }`}
      style={{ boxShadow: "0 14px 26px -20px rgba(34,48,31,.55)" }}
    >
      <div
        // La foto es lo que vende: en una pantalla táctil de 27" 88px de alto
        // es una miniatura, no un producto. Crece con el ancho disponible.
        // En pantallas bajas (la Joog, 720 de alto) la foto más baja: entran dos filas y se asoma la tercera.
        className={`relative flex items-center justify-center m-2 mb-0 rounded-[16px] ${compacta ? "h-[110px] lg:h-[140px]" : "h-[110px] lg:h-[150px] xl:h-[176px] [@media(max-height:820px)]:h-[100px]"}`}
        // Con foto, fondo blanco: las fotos vienen sobre blanco y sobre crema
        // se veía el cuadrado de la foto.
        style={{ background: producto.imagen ? "#ffffff" : "linear-gradient(145deg, #f3ecdd, #e2d7c1)" }}
      >
        {marca && (
          <span
            className="absolute top-2 left-2 text-[8.5px] lg:text-[9.5px] font-extrabold uppercase tracking-wide bg-white px-2 py-0.5 rounded-full"
            style={{ color: "var(--acento, #4d7635)" }}
          >
            {marca.nombre}
          </span>
        )}
        <div className="w-full h-full flex items-center justify-center" style={sinStock ? { opacity: 0.45 } : undefined}>
          {producto.imagen ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={producto.imagen} alt="" className="w-full h-full object-contain p-2" />
          ) : (
            <SinFoto producto={producto} logoMarca={logoMarca} bolsita={bolsita} chica />
          )}
        </div>
        {/* Agotado en el local: bien visible arriba de la foto (Gonzalo, 2026-11-11). */}
        {sinStock && (
          <span
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] lg:text-[14px] font-extrabold uppercase tracking-wide text-white"
            style={{ background: "#22301f" }}
          >
            {sinStock}
          </span>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-3 [@media(max-height:820px)]:pt-2 [@media(max-height:820px)]:pb-2.5 flex flex-col gap-1">
        <p className="text-[13.5px] lg:text-[15px] [@media(max-height:820px)]:text-[14px] font-bold leading-tight line-clamp-2 text-[#1f261c]">{nombre}</p>
        {etiqueta && !compacta && (
          <span
            className="self-start text-[10px] font-extrabold px-2 py-0.5 rounded-full"
            style={{ background: "#fde7d9", color: "#a34713" }}
          >
            {etiqueta}
          </span>
        )}
        <PrecioTarjeta producto={producto} />
      </div>
    </div>
  );
}

/** Un logo de marca en la fila de arriba de la pantalla de productos. */
function DiscoMarca({
  nombre,
  logo,
  cantidad,
  activo,
  onClick,
}: {
  nombre: string;
  logo: string | null;
  cantidad: number;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 [@media(max-height:820px)]:gap-1 shrink-0 w-[86px] md:w-[116px] [@media(max-height:820px)]:w-[96px]">
      <span
        // El aro gris tenue en las no elegidas evita que un logo con fondo
        // blanco se funda con la barra y parezca que falta. En pantallas bajas
        // más chico, para que entren más filas de productos (Joog, 2026-11-11).
        className="rounded-full overflow-hidden grid place-items-center w-16 h-16 md:w-[92px] md:h-[92px] [@media(max-height:820px)]:w-[60px] [@media(max-height:820px)]:h-[60px] border-[3px] transition-all"
        style={{
          borderColor: activo ? "var(--acento, #4d7635)" : "rgba(0,0,0,.08)",
          background: "#fff",
          boxShadow: activo ? "0 8px 18px -10px rgba(0,0,0,.45)" : "none",
        }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-extrabold text-[20px] md:text-[26px]" style={{ color: "var(--acento, #4d7635)" }}>
            {nombre.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span
        className="text-[11px] md:text-[13px] leading-tight text-center"
        style={{ color: activo ? "#1f2419" : "#5c6353", fontWeight: activo ? 800 : 700 }}
      >
        {nombre}
      </span>
      <span className="text-[10px] md:text-[11px] font-semibold tabular-nums text-[#a3aa95]">{cantidad}</span>
    </button>
  );
}

/**
 * Una pestaña de rubro.
 *
 * Bajan de renglón en vez de correrse de costado: con 25 rubros —WiiGo
 * Dietética va para ahí— una fila que se corre esconde la mitad, y lo que el
 * cliente no ve, no existe. Prefiero que ocupe tres líneas y estén todos.
 */
function PestanaRubro({
  nombre,
  cantidad,
  activo,
  onClick,
}: {
  nombre: string;
  cantidad: number;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg px-3 py-2 text-[12.5px] md:text-[13px] font-bold flex items-baseline gap-1.5 whitespace-nowrap border transition-colors"
      style={
        activo
          ? { background: "var(--acento, #4d7635)", borderColor: "var(--acento, #4d7635)", color: "#fff" }
          : { background: "#fff", borderColor: "rgba(0,0,0,.09)", color: "#5c6353" }
      }
    >
      {nombre}
      <span className="text-[10.5px] tabular-nums font-semibold" style={{ opacity: activo ? 0.7 : 0.45 }}>
        {cantidad}
      </span>
    </button>
  );
}

/** Un bloque del panel de filtros de la izquierda. */
function GrupoRail({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p
        className="text-[9.5px] md:text-[10.5px] font-extrabold uppercase tracking-[.2em] mb-2 px-2.5"
        style={{ color: "var(--barra-acento, #cfe8a6)", opacity: 0.6 }}
      >
        {titulo}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

/**
 * Una opción del panel oscuro de la izquierda, con cuántos productos deja.
 *
 * `casilla` la dibuja con el cuadradito de tildar —para las preferencias, que
 * se pueden combinar— y sin él para los rubros, donde se elige uno solo.
 */
function OpcionRail({
  nombre,
  cantidad,
  activo,
  casilla = false,
  onClick,
}: {
  nombre: string;
  cantidad?: number;
  activo: boolean;
  casilla?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 py-2.5 [@media(max-height:820px)]:py-[7px] px-3 text-left w-full rounded-[14px] transition-colors"
      style={
        activo
          ? { background: "var(--barra-acento, #cfe8a6)", color: "var(--barra, #1e2a18)" }
          : { color: "rgba(255,255,255,.62)" }
      }
    >
      {casilla && (
        <span
          className="w-[15px] h-[15px] rounded-[4px] border-[1.5px] shrink-0"
          style={
            activo
              ? { background: "var(--barra, #1e2a18)", borderColor: "var(--barra, #1e2a18)" }
              : { borderColor: "rgba(255,255,255,.28)" }
          }
        />
      )}
      <span
        className="text-[13.5px] md:text-[15px] [@media(max-height:820px)]:text-[14px] leading-tight flex-1"
        style={{ fontWeight: activo ? 800 : 600 }}
      >
        {nombre}
      </span>
      {cantidad !== undefined && (
        // La cantidad en una pastilla; en lo elegido, naranja (como la vista previa).
        <span
          className="text-[11.5px] tabular-nums font-extrabold shrink-0 rounded-full px-2 py-px"
          style={activo ? { background: "#e8743b", color: "#fff" } : { background: "rgba(255,255,255,.1)", opacity: 0.8 }}
        >
          {cantidad}
        </span>
      )}
    </button>
  );
}

// El asesor no tiene buscador a propósito: en el tótem el teclado de Android
// tapa media pantalla y su botón de configuración es una forma de salirse del
// modo kiosco. Se navega tocando: objetivos, marcas y rubros.

export default function AsesorApp({
  local,
  marcas,
  productos,
  variantesPorProducto,
  subcategorias,
  profesionales,
  consultorioPorProfesional,
  fotosPorProfesional,
  fortalezasPorProfesional,
  objetivosPorProfesional,
  conocemePorProfesional,
  formacionPorProfesional,
  trayectoriaPorProfesional,
  redesPorProfesional,
  opinionesPorProfesional = {},
  objetivos,
  filtros,
  fichaPorProducto,
  objetivosPorProducto,
  filtrosPorProducto,
  gondola = [],
  sinStock = [],
}: {
  /** Los productos que en este local están en 0: la tarjeta dice «Sin stock». */
  sinStock?: string[];
  /** Opiniones de pacientes ya aprobadas (sql/profesionales-opiniones.sql). */
  opinionesPorProfesional?: Record<string, OpinionPaciente[]>;
  local: Local;
  marcas: MarcaPublica[];
  productos: ProductoPublico[];
  variantesPorProducto: Record<string, VarianteProductoPublica[]>;
  subcategorias: Subcategoria[];
  profesionales: ProfesionalPublico[];
  consultorioPorProfesional: Record<string, ConsultorioEnFicha>;
  fotosPorProfesional: Record<string, string[]>;
  fortalezasPorProfesional: Record<string, { nombre: string; principal: boolean }[]>;
  objetivosPorProfesional: Record<string, string[]>;
  conocemePorProfesional: Record<string, ConocemeSlide[]>;
  formacionPorProfesional: Record<string, FormacionProfesional[]>;
  trayectoriaPorProfesional: Record<string, TrayectoriaProfesional[]>;
  redesPorProfesional: Record<string, RedEnFicha[]>;
  objetivos: Objetivo[];
  filtros: FiltroProducto[];
  fichaPorProducto: Record<string, FichaProducto>;
  objetivosPorProducto: Record<string, string[]>;
  filtrosPorProducto: Record<string, string[]>;
  /** Los módulos del local y dónde va cada producto (Precios → Góndola). */
  gondola?: ModuloGondola[];
}) {
  const [pantalla, setPantalla] = useState<Pantalla>("home");
  const [objetivoId, setObjetivoId] = useState<string | null>(null);
  const [filtrosSeleccionados, setFiltrosSeleccionados] = useState<Set<string>>(new Set());
  const [marcaId, setMarcaId] = useState<string | null>(null);
  const [subcategoriaId, setSubcategoriaId] = useState<string | null>(null);
  const [categoriaProf, setCategoriaProf] = useState<string | null>(null);
  const [profesionalId, setProfesionalId] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [mostrarComoAyuda, setMostrarComoAyuda] = useState(false);
  const [modalidadTurno, setModalidadTurno] = useState<"presencial" | "online" | null>(null);
  const [productoAbierto, setProductoAbierto] = useState<string | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const agotados = useMemo(() => new Set(sinStock), [sinStock]);
  const textoSinStock = idioma === "en" ? "Out of stock" : idioma === "pt" ? "Sem estoque" : "Sin stock";
  // La Raspberry del monitor Joog: sin recorrido animado, sombras ni
  // animaciones continuas (lib/placaLiviana.ts). La clase va en <html> para
  // que alcance también a lo que se dibuja fuera de este árbol (el recorrido).
  const liviano = usePlacaLiviana();
  useEffect(() => {
    document.documentElement.classList.toggle("asesor-liviano", liviano);
  }, [liviano]);
  // El borde que corta el monitor Joog (lib/placaLiviana.ts). Se ajusta con 5
  // toques seguidos en el logo de WiiGo del inicio: aparece la regla y los
  // botones + y −, sin salir del modo kiosco ni tocar la dirección.
  const [calibrar, setCalibrar] = useState(false);
  const [margen, setMargen] = useState<MargenPantalla>({});
  const toquesLogo = useRef<number[]>([]);
  useEffect(() => {
    const r = aplicarMargenDePantalla();
    setCalibrar(r.calibrar);
    setMargen(r.margen);
  }, []);
  function tocarLogo() {
    const ahora = Date.now();
    toquesLogo.current = [...toquesLogo.current.filter((t) => ahora - t < 3000), ahora];
    if (toquesLogo.current.length >= 5) {
      toquesLogo.current = [];
      setCalibrar(true);
      // Con los datos del aparato a la vista (medida real, ancho de la página).
      setDiagnostico(datosDelAparato());
    }
  }
  function moverBorde(lado: "derecha" | "abajo", cuanto: number) {
    const nuevo = { ...margen, [lado]: Math.max(0, Math.min(300, (margen[lado] ?? 0) + cuanto)) };
    setMargen(nuevo);
    guardarMargenDePantalla(nuevo);
  }
  // ?diagnostico=1: qué aparato es, cuánto mide y si la página se pasa de ancho.
  const [diagnostico, setDiagnostico] = useState<ReturnType<typeof datosDelAparato> | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("diagnostico") !== "1") return;
    const leer = () => setDiagnostico(datosDelAparato());
    const id = window.setTimeout(leer, 1500);
    window.addEventListener("resize", leer);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", leer);
    };
  }, []);
  // Filtro por marca dentro de los resultados. Es aparte de `marcaId`, que es
  // la marca que se está mirando en la pantalla de Marcas.
  const [marcaResultado, setMarcaResultado] = useState<string | null>(null);

  // Detecta el idioma del navegador/dispositivo al abrir la pantalla — si no
  // es ninguno de los 3 soportados, arranca en español. Solo corre una vez.
  useEffect(() => {
    const detectado = (navigator.language || "es").slice(0, 2).toLowerCase();
    if (detectado === "en" || detectado === "pt") setIdioma(detectado);
  }, []);

  const t = (key: keyof (typeof HOME_I18N)["es"]) => HOME_I18N[idioma][key];
  const tr = (base: string, en: string | null | undefined, pt: string | null | undefined) => traducir(idioma, base, en, pt);
  const [idleWarning, setIdleWarning] = useState(false);
  const [idleCountdown, setIdleCountdown] = useState(IDLE_COUNTDOWN_S);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- mantener la pantalla al día (ver las constantes de arriba) ----
  const router = useRouter();
  const ultimoToqueRef = useRef(Date.now());

  useEffect(() => {
    const marcarToque = () => {
      ultimoToqueRef.current = Date.now();
    };
    const eventos: (keyof WindowEventMap)[] = ["pointerdown", "keydown"];
    eventos.forEach((ev) => window.addEventListener(ev, marcarToque));

    let huella: string | null = null;
    let despliegue: string | null = null;
    let despliegueCandidato: string | null = null;
    let fallos = 0;
    let vivo = true;

    async function chequear() {
      // Si alguien está usando la pantalla, se espera: el cambio entra al
      // próximo chequeo, apenas suelte.
      if (Date.now() - ultimoToqueRef.current < QUIETO_MS) return;
      if (document.hidden) return;

      try {
        const r = await fetch("/api/asesor/version", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const datos = (await r.json()) as { huella: string; despliegue: string };
        fallos = 0;

        // Primera vuelta: solo anota contra qué comparar.
        if (huella === null) {
          huella = datos.huella;
          despliegue = datos.despliegue;
          return;
        }
        if (datos.despliegue !== despliegue) {
          // Recargar la página entera hace un parpadeo feo, así que se hace lo
          // menos posible: solo con la app realmente nueva —el valor tiene que
          // repetirse dos veces seguidas, para no picar en un deploy a medio
          // publicar— y con la pantalla bien quieta, para que nadie lo vea.
          if (datos.despliegue === despliegueCandidato) {
            if (Date.now() - ultimoToqueRef.current > QUIETO_RECARGA_MS) {
              window.location.reload();
              return;
            }
          } else {
            despliegueCandidato = datos.despliegue;
          }
        } else {
          despliegueCandidato = null;
        }
        if (datos.huella !== huella) {
          huella = datos.huella;
          router.refresh();
        }
      } catch {
        // Sin internet no tiene sentido seguir golpeando cada 3 segundos.
        fallos += 1;
      }
    }

    const reloj = setInterval(() => {
      if (!vivo) return;
      if (fallos >= RED_MAX_FALLOS && fallos % 20 !== 0) {
        fallos += 1;
        return;
      }
      void chequear();
    }, CHEQUEO_MS);

    const seguridad = setInterval(() => {
      if (Date.now() - ultimoToqueRef.current < QUIETO_MS) return;
      router.refresh();
    }, REFRESCO_SEGURIDAD_MS);

    void chequear();

    return () => {
      vivo = false;
      eventos.forEach((ev) => window.removeEventListener(ev, marcarToque));
      clearInterval(reloj);
      clearInterval(seguridad);
    };
  }, [router]);

  const marcaPorId = useMemo(() => {
    const mapa: Record<string, MarcaPublica> = {};
    marcas.forEach((m) => (mapa[m.id_marca] = m));
    return mapa;
  }, [marcas]);

  const filtroPorId = useMemo(() => {
    const mapa: Record<string, FiltroProducto> = {};
    filtros.forEach((f) => (mapa[f.id_filtro] = f));
    return mapa;
  }, [filtros]);

  const objetivoSeleccionado = objetivoId ? objetivos.find((o) => o.id_objetivo === objetivoId) ?? null : null;

  // El orden lo elige Gonzalo desde la base (columna `orden` de marcas): la
  // marca propia primero y las demás como convenga. Las que no tengan número
  // van al final, alfabéticas entre ellas — así una marca nueva no se mete
  // adelante hasta que se le asigne lugar.
  const marcasOrdenadas = useMemo(
    () =>
      [...marcas].sort((a, b) => {
        const oa = a.orden ?? Number.MAX_SAFE_INTEGER;
        const ob = b.orden ?? Number.MAX_SAFE_INTEGER;
        return oa !== ob ? oa - ob : a.nombre.localeCompare(b.nombre, "es");
      }),
    [marcas]
  );

  // La pantalla de Marcas filtra en tres pasos —preferencia, marca, rubro— y en
  // ese orden. Cada paso se guarda aparte porque de ahí salen los números que
  // van al lado de cada marca y de cada rubro: si se filtrara todo junto, apenas
  // elegís una marca las demás mostrarían cero.
  const productosConPreferencia = useMemo(() => {
    if (filtrosSeleccionados.size === 0) return productos;
    return productos.filter((p) => {
      const propios = filtrosPorProducto[p.id_producto] ?? [];
      for (const f of filtrosSeleccionados) if (!propios.includes(f)) return false;
      return true;
    });
  }, [productos, filtrosSeleccionados, filtrosPorProducto]);

  const conteoProductosPorMarca = useMemo(() => {
    const mapa: Record<string, number> = {};
    productosConPreferencia.forEach((p) => {
      mapa[p.id_marca] = (mapa[p.id_marca] ?? 0) + 1;
    });
    return mapa;
  }, [productosConPreferencia]);

  const productosDeMarcaSinRubro = useMemo(
    () => (marcaId ? productosConPreferencia.filter((p) => p.id_marca === marcaId) : productosConPreferencia),
    [productosConPreferencia, marcaId]
  );

  // Solo los rubros que tienen algún producto de la marca (Gonzalo,
  // 2026-11-02: más minimalista). Se cuenta sin las preferencias: si no, al
  // tildar «Sin TACC» los rubros aparecerían y desaparecerían.
  const subcategoriasDeMarca = useMemo(() => {
    if (!marcaId) return [];
    const conProductos = new Set(productos.filter((p) => p.id_marca === marcaId).map((p) => p.id_subcategoria));
    return subcategorias
      .filter((s) => s.id_marca === marcaId && conProductos.has(s.id_subcategoria))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [subcategorias, marcaId, productos]);

  // Sin la pestaña "Todo", un producto al que nadie le puso rubro no tendría
  // dónde aparecer. La pestaña "Otros" los junta para que no se pierdan —hoy
  // son 4 de WiiGo Dietética— y de paso se ve de una que falta clasificarlos.
  const sinRubroDeMarca = useMemo(
    () => productosDeMarcaSinRubro.filter((p) => !p.id_subcategoria).length,
    [productosDeMarcaSinRubro]
  );

  const conteoPorSubcategoria = useMemo(() => {
    const mapa: Record<string, number> = {};
    productosDeMarcaSinRubro.forEach((p) => {
      if (p.id_subcategoria) mapa[p.id_subcategoria] = (mapa[p.id_subcategoria] ?? 0) + 1;
    });
    return mapa;
  }, [productosDeMarcaSinRubro]);

  const productosDeMarca = useMemo(() => {
    if (subcategoriaId === SIN_RUBRO) return productosDeMarcaSinRubro.filter((p) => !p.id_subcategoria);
    if (subcategoriaId) return productosDeMarcaSinRubro.filter((p) => p.id_subcategoria === subcategoriaId);
    return productosDeMarcaSinRubro;
  }, [productosDeMarcaSinRubro, subcategoriaId]);

  // En qué mueble del local está el rubro que se está mirando: el que tiene más
  // productos de ese rubro. Sale arriba del catálogo, para que el cliente
  // sepa adónde ir sin abrir cada producto.
  const muebleDelRubro = useMemo(() => {
    if (gondola.length === 0 || productosDeMarca.length === 0) return null;
    const ids = new Set(productosDeMarca.map((p) => p.id_producto));
    const modulos = gondola.filter((m) => m.tipo === "MODULO");
    let mejor: { texto: string; cuantos: number } | null = null;
    gondola.forEach((m) => {
      const cuantos = m.lugares.filter((l) => ids.has(l.idProducto)).length;
      if (cuantos === 0 || (mejor && cuantos <= mejor.cuantos)) return;
      // "Mueble 4 · «A cualquier hora»", "Isla 1", "Estantería Animalfit"
      const texto =
        m.tipo === "ISLA"
          ? `${idioma === "en" ? "Island" : idioma === "pt" ? "Ilha" : "Isla"} ${m.numero ?? ""}`
          : m.tipo === "ESTANTERIA"
            ? m.titulo
            : m.tipo === "FREEZER"
              ? `Freezer ${m.numero ?? ""}`.trim()
              : `${idioma === "en" ? "Shelf" : idioma === "pt" ? "Móvel" : "Mueble"} ${modulos.indexOf(m) + 1} · «${m.titulo}»`;
      mejor = { texto, cuantos };
    });
    return mejor as { texto: string; cuantos: number } | null;
  }, [gondola, productosDeMarca, idioma]);

  /**
   * El rubro que queda elegido al entrar a una marca: el primero que tenga
   * productos. Antes era el primero por orden alfabético, y en WiiGo Dietética
   * se entraba a "Aceite de coco" vacío (2026-11-02).
   */
  function primerRubroDe(idMarca: string): string | null {
    const deLaMarca = productos.filter((p) => p.id_marca === idMarca);
    const conProductos = new Set(deLaMarca.map((p) => p.id_subcategoria));
    const suyas = subcategorias
      .filter((s) => s.id_marca === idMarca)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const primera = suyas.find((s) => conProductos.has(s.id_subcategoria)) ?? suyas[0];
    if (primera && conProductos.has(primera.id_subcategoria)) return primera.id_subcategoria;
    if (deLaMarca.some((p) => !p.id_subcategoria)) return SIN_RUBRO;
    return primera?.id_subcategoria ?? null;
  }

  const productosEnOferta = useMemo(
    () => productos.filter((p) => (p.descuento_porcentaje ?? 0) > 0),
    [productos]
  );


  const marcasConOferta = useMemo(
    () => [...new Set(productosEnOferta.map((p) => p.id_marca))],
    [productosEnOferta]
  );

  const conteoOfertasPorMarca = useMemo(() => {
    const mapa: Record<string, number> = {};
    productosEnOferta.forEach((p) => {
      mapa[p.id_marca] = (mapa[p.id_marca] ?? 0) + 1;
    });
    return mapa;
  }, [productosEnOferta]);

  const categoriasProf = useMemo(() => {
    const set = new Set<string>();
    profesionales.forEach((p) => {
      if (p.categoria) set.add(p.categoria);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [profesionales]);

  /**
   * El botón del filtro habla de un grupo, no de una persona.
   *
   * En la ficha de cada una la profesión va en singular —"Nutricionista"— y
   * está bien. Pero el filtro agrupa a todas, así que en plural. Se pluraliza
   * acá y no en la base para no obligar a cargar la palabra dos veces.
   */
  const enPlural = (palabra: string) => {
    const p = palabra.trim();
    if (/[sx]$/i.test(p)) return p; // "Kinesiólogos" ya viene así
    if (/[aeiou]$/i.test(p)) return `${p}s`;
    if (/z$/i.test(p)) return `${p.slice(0, -1)}ces`;
    return `${p}es`;
  };

  const profesionalesFiltrados = useMemo(() => {
    if (!categoriaProf) return profesionales;
    return profesionales.filter((p) => p.categoria === categoriaProf);
  }, [profesionales, categoriaProf]);

  const profesionalActual = profesionalId ? profesionales.find((p) => p.id_profesional === profesionalId) ?? null : null;
  const consultorioActual = profesionalId ? consultorioPorProfesional[profesionalId] ?? null : null;

  const tieneReservaPresencial = Boolean(profesionalActual?.link_reserva);
  const tieneReservaOnline = Boolean(profesionalActual?.link_reserva_online);
  const eligiendoModalidadTurno = tieneReservaPresencial && tieneReservaOnline && !modalidadTurno;
  const linkReservaFinal =
    modalidadTurno === "online" ? profesionalActual?.link_reserva_online ?? null : profesionalActual?.link_reserva ?? null;

  const fortalezasDelProfesionalActual = useMemo(() => {
    if (!profesionalId) return [];
    const propias = fortalezasPorProfesional[profesionalId] ?? [];
    return [...propias].sort((a, b) => Number(b.principal) - Number(a.principal));
  }, [profesionalId, fortalezasPorProfesional]);

  const objetivosDelProfesionalActual = useMemo(() => {
    if (!profesionalId) return [];
    const ids = objetivosPorProfesional[profesionalId] ?? [];
    return ids.map((id) => objetivos.find((o) => o.id_objetivo === id)?.nombre).filter(Boolean) as string[];
  }, [profesionalId, objetivosPorProfesional, objetivos]);

  const slidesDelProfesionalActual = profesionalId ? conocemePorProfesional[profesionalId] ?? [] : [];
  const formacionDelProfesionalActual = profesionalId ? formacionPorProfesional[profesionalId] ?? [] : [];
  const trayectoriaDelProfesionalActual = profesionalId ? trayectoriaPorProfesional[profesionalId] ?? [] : [];
  const slideActual = slidesDelProfesionalActual[slideIndex] ?? null;

  const formacionOrdenada = useMemo(
    () => [...formacionDelProfesionalActual].sort((a, b) => (a.anio ?? 0) - (b.anio ?? 0)),
    [formacionDelProfesionalActual]
  );

  // El panel que se desliza. Los bloques de la historia se miden contra él y
  // no contra la ventana: lo que se mueve es el panel.
  const hojaHistoria = useRef<HTMLDivElement>(null);

  // ¿Hay algo para poner en la hoja derecha de la ficha? Si no, se abre de una
  // sola hoja: media ficha vacía se lee como que la pantalla está a medio hacer.
  const fotosDelProfesionalActual = profesionalId ? fotosPorProfesional[profesionalId] ?? [] : [];
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  const redesDelProfesionalActual = profesionalId ? redesPorProfesional[profesionalId] ?? [] : [];
  const opinionesDelProfesionalActual = profesionalId ? opinionesPorProfesional[profesionalId] ?? [] : [];
  // La red que se está mostrando. Si la elegida no la tiene esta profesional, va la primera.
  const [redElegida, setRedElegida] = useState<string | null>(null);
  const redActual = redesDelProfesionalActual.find((r) => r.clave === redElegida) ?? redesDelProfesionalActual[0] ?? null;
  const tieneHistoria =
    Boolean(profesionalActual?.biografia_completa) ||
    fotosDelProfesionalActual.length > 0 ||
    formacionDelProfesionalActual.length > 0 ||
    trayectoriaDelProfesionalActual.length > 0 ||
    redesDelProfesionalActual.length > 0 ||
    opinionesDelProfesionalActual.length > 0;
  const trayectoriaOrdenada = useMemo(
    () => [...trayectoriaDelProfesionalActual].sort((a, b) => (a.anio_desde ?? 0) - (b.anio_desde ?? 0)),
    [trayectoriaDelProfesionalActual]
  );

  // Cuenta qué se mira de cada profesional para mostrárselo en su espacio
  // ("14 personas abrieron tu ficha"). Son toques en la pantalla, sin nada
  // de quién toca. No se espera la respuesta: si no llega, la pantalla sigue
  // igual.
  function contarVisita(idProfesional: string | null, evento: "FICHA" | "CONOCEME_FIN" | "RESERVAR") {
    if (!idProfesional) return;
    fetch("/api/asesor/evento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idLocal: local.id_local, idProfesional, evento }),
      keepalive: true,
    }).catch(() => {});
  }

  function siguienteSlide() {
    const ultima = slidesDelProfesionalActual.length - 1;
    if (slideIndex < ultima && slideIndex + 1 === ultima) contarVisita(profesionalId, "CONOCEME_FIN");
    setSlideIndex((i) => Math.min(i + 1, ultima));
  }

  function atrasSlide() {
    setSlideIndex((i) => Math.max(i - 1, 0));
  }

  function irAObjetivo() {
    setObjetivoId(null);
    setFiltrosSeleccionados(new Set());
    setPantalla("objetivo");
  }

  function irAMarcas() {
    // Entra con la primera marca y su primer rubro ya elegidos: sin "Todas" ni
    // "Todo" no tiene sentido mostrar una pantalla vacía esperando un toque.
    const primera = marcasOrdenadas[0]?.id_marca ?? null;
    setMarcaId(primera);
    setSubcategoriaId(primera ? primerRubroDe(primera) : null);
    // Las preferencias son compartidas con la pantalla de resultados: si no se
    // limpian, el que viene de buscar entra a Marcas con filtros puestos que no
    // pidió y le parece que faltan productos.
    setFiltrosSeleccionados(new Set());
    setPantalla("marcas");
  }

  /** Desde los logos de la portada: entra a Marcas con esa marca ya elegida. */
  function irAMarca(idMarca: string) {
    setMarcaId(idMarca);
    setSubcategoriaId(primerRubroDe(idMarca));
    setFiltrosSeleccionados(new Set());
    setPantalla("marcas");
  }

  function irAOfertas() {
    setPantalla("ofertas");
  }

  function toggleMarca(id: string) {
    setSubcategoriaId(null);
    setMarcaId((actual) => (actual === id ? null : id));
  }

  function toggleCategoriaProf(categoria: string) {
    setCategoriaProf((actual) => (actual === categoria ? null : categoria));
  }

  function irAFichaProfesional(id: string) {
    contarVisita(id, "FICHA");
    setProfesionalId(id);
    setMostrarComoAyuda(false);
    setFotoAmpliada(null);
    setPantalla("fichaProfesional");
  }

  function irAConoceme() {
    // Un Conóceme de una sola filmina se vio entero apenas se abre.
    if (slidesDelProfesionalActual.length === 1) contarVisita(profesionalId, "CONOCEME_FIN");
    setSlideIndex(0);
    setPantalla("conoceme");
  }

  function irAReservarTurno() {
    contarVisita(profesionalId, "RESERVAR");
    setModalidadTurno(null);
    setPantalla("reservarTurno");
  }

  function elegirObjetivo(id: string) {
    setObjetivoId(id);
    setFiltrosSeleccionados(new Set());
    setMarcaResultado(null);
    setPantalla("resultado");
  }

  function volverAInicio() {
    setPantalla("home");
    setObjetivoId(null);
    setFiltrosSeleccionados(new Set());
    setMarcaResultado(null);
    setMarcaId(null);
    setSubcategoriaId(null);
    setCategoriaProf(null);
    setProfesionalId(null);
    setMostrarComoAyuda(false);
    setSlideIndex(0);
    setModalidadTurno(null);
    // La ficha del producto vive por encima de las pantallas: si no se cierra
    // acá, el que se va dejando abierto un producto hace que el siguiente
    // cliente se encuentre el inicio tapado por la ficha del anterior.
    setProductoAbierto(null);
  }

  function limpiarTimersInactividad() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (idleIntervalRef.current) clearInterval(idleIntervalRef.current);
  }

  function reiniciarInactividad() {
    limpiarTimersInactividad();
    setIdleWarning(false);
    setIdleCountdown(IDLE_COUNTDOWN_S);
    if (pantalla === "home") return;
    idleTimerRef.current = setTimeout(() => {
      setIdleWarning(true);
      let restante = IDLE_COUNTDOWN_S;
      idleIntervalRef.current = setInterval(() => {
        restante -= 1;
        setIdleCountdown(restante);
        if (restante <= 0) {
          limpiarTimersInactividad();
          volverAInicio();
        }
      }, 1000);
    }, IDLE_WARNING_MS);
  }

  useEffect(() => {
    reiniciarInactividad();
    const eventos: (keyof WindowEventMap)[] = ["pointerdown", "keydown"];
    eventos.forEach((ev) => window.addEventListener(ev, reiniciarInactividad));
    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, reiniciarInactividad));
      limpiarTimersInactividad();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantalla]);

  function volverDesdeResultado() {
    // A los resultados solo se llega eligiendo un objetivo, así que atrás
    // siempre es la pantalla de objetivos.
    setPantalla("objetivo");
  }

  function toggleFiltro(id: string) {
    setFiltrosSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Se filtra en dos pasos a propósito: el primero deja todo menos la marca, y
  // con eso se calcula cuántos productos tiene cada marca para mostrarlo en su
  // botón. Si la marca entrara en el mismo filtro, los números de las otras
  // marcas darían siempre cero apenas elegís una.
  const productosSinFiltroMarca = useMemo(() => {
    return productos.filter((p) => {
      if (objetivoId && !(objetivosPorProducto[p.id_producto] ?? []).includes(objetivoId)) return false;
      if (filtrosSeleccionados.size > 0) {
        const propios = filtrosPorProducto[p.id_producto] ?? [];
        for (const f of filtrosSeleccionados) {
          if (!propios.includes(f)) return false;
        }
      }
      return true;
    });
  }, [productos, objetivoId, filtrosSeleccionados, objetivosPorProducto, filtrosPorProducto]);

  // Las marcas en el mismo orden que la portada: WiiGo Dietética primero
  // (Gonzalo, 2026-11-06). Dentro de cada marca queda el orden de siempre.
  const lugarDeMarca = useMemo(() => new Map(marcasOrdenadas.map((m, i) => [m.id_marca, i])), [marcasOrdenadas]);

  const productosFiltrados = useMemo(
    () =>
      (marcaResultado ? productosSinFiltroMarca.filter((p) => p.id_marca === marcaResultado) : productosSinFiltroMarca)
        .map((p, i) => ({ p, i }))
        .sort((a, b) => (lugarDeMarca.get(a.p.id_marca) ?? 999) - (lugarDeMarca.get(b.p.id_marca) ?? 999) || a.i - b.i)
        .map((x) => x.p),
    [productosSinFiltroMarca, marcaResultado, lugarDeMarca]
  );

  const conteoPorMarca = useMemo(() => {
    const conteo: Record<string, number> = {};
    for (const p of productosSinFiltroMarca) conteo[p.id_marca] = (conteo[p.id_marca] ?? 0) + 1;
    return conteo;
  }, [productosSinFiltroMarca]);

  const marcasConResultados = useMemo(
    () => marcasOrdenadas.filter((m) => (conteoPorMarca[m.id_marca] ?? 0) > 0),
    [marcasOrdenadas, conteoPorMarca]
  );

  // Cuántos productos deja cada objetivo con la marca y las preferencias que ya
  // están puestas. Se cuenta sin mirar el objetivo elegido, para que el número
  // de los demás no se caiga a cero al elegir uno.
  const conteoPorObjetivo = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const p of productos) {
      if (marcaResultado && p.id_marca !== marcaResultado) continue;
      if (filtrosSeleccionados.size > 0) {
        const propios = filtrosPorProducto[p.id_producto] ?? [];
        let pasa = true;
        for (const f of filtrosSeleccionados) if (!propios.includes(f)) pasa = false;
        if (!pasa) continue;
      }
      for (const id of objetivosPorProducto[p.id_producto] ?? []) mapa[id] = (mapa[id] ?? 0) + 1;
    }
    return mapa;
  }, [productos, marcaResultado, filtrosSeleccionados, filtrosPorProducto, objetivosPorProducto]);

  // Un objetivo sin ningún producto detrás no se le muestra al cliente.
  //
  // Tocarlo y que no aparezca nada se lee como que la pantalla está rota, y en
  // una tienda eso es peor que ofrecer un camino menos. El objetivo sigue
  // existiendo en el sistema: aparece solo cuando tenga productos asignados.
  //
  // Se cuenta sin los filtros de marca y preferencias a propósito: esta lista
  // es la de la portada, antes de que el cliente haya elegido nada.
  const objetivosConProductos = useMemo(() => {
    const conAlgo = new Set<string>();
    for (const p of productos) {
      for (const id of objetivosPorProducto[p.id_producto] ?? []) conAlgo.add(id);
    }
    return objetivos.filter((o) => conAlgo.has(o.id_objetivo));
  }, [objetivos, productos, objetivosPorProducto]);

  // En la portada van seis objetivos (3 x 2), los primeros en el orden que
  // elige Gonzalo. Si hay más, un link lleva a la pantalla con todos: así
  // pueden ser 10 o 20 y la portada no cambia.
  const objetivosEnInicio = objetivosConProductos.slice(0, 6);
  const hayMasObjetivos = objetivosConProductos.length > 6;

  function porQue(p: ProductoPublico): { texto: string; tag: string } {
    const propios = filtrosPorProducto[p.id_producto] ?? [];
    const nombresFiltros = propios
      .filter((id) => filtrosSeleccionados.size === 0 || filtrosSeleccionados.has(id))
      .map((id) => {
        const f = filtroPorId[id];
        return f ? tr(f.nombre, f.nombre_en, f.nombre_pt) : undefined;
      })
      .filter(Boolean) as string[];

    if (nombresFiltros.length > 0) {
      return { texto: nombresFiltros.slice(0, 2).join(" · "), tag: nombresFiltros[0] };
    }
    if (objetivoSeleccionado) {
      const nombreObjetivo = tr(objetivoSeleccionado.nombre, objetivoSeleccionado.nombre_en, objetivoSeleccionado.nombre_pt);
      return { texto: nombreObjetivo, tag: nombreObjetivo };
    }
    const marca = marcaPorId[p.id_marca]?.nombre;
    return { texto: marca ?? "", tag: marca ?? "" };
  }

  const tema = TEMAS[pantalla] ?? TEMA_POR_DEFECTO;

  // Los idiomas, siempre a la vista y del tamaño de un dedo (2026-11-02). En
  // el inicio van adentro de lo que se desliza (fijos, al bajar se encimaban
  // con las marcas) y con la ficha de un producto abierta no van (tapaban la
  // ✕): Gonzalo, 2026-11-11, en el monitor Joog.
  const selectorIdioma = (posicion: string) => (
    <div
      className={`${posicion} z-50 flex rounded-full border-2 border-[#e8dfcd] bg-white p-1`}
      role="group"
      aria-label="Idioma / Language"
    >
      {(["es", "en", "pt"] as Idioma[]).map((lng) => (
        <button
          key={lng}
          onClick={() => setIdioma(lng)}
          className="inline-flex items-center rounded-full h-[44px] px-3.5 text-[15px] font-extrabold"
          style={idioma === lng ? { background: "#22301f", color: "#fff" } : { color: "#4d5545" }}
          aria-pressed={idioma === lng}
        >
          <BanderaIdioma lng={lng} className="w-[22px] h-auto rounded-[3px] shrink-0 mr-2" />
          {lng === "es" ? "ES" : lng === "en" ? "EN" : "PT"}
        </button>
      ))}
    </div>
  );

  return (
    // Alto fijo de pantalla y sin scroll propio: si la página entera pudiera
    // deslizarse, el "Volver" y los logos de las marcas se irían para arriba al
    // bajar por los productos. Cada pantalla se encarga de deslizar su propio
    // contenido y deja el marco quieto.
    <div
      className="h-screen w-full max-w-[100vw] overflow-hidden text-[#2d2d2d] flex flex-col"
      // El acento viaja como variable CSS para que cada pieza de adentro lo
      // tome sola, sin tener que pasárselo de mano en mano.
      style={{
        background: tema.fondo,
        ["--acento" as string]: tema.acento,
        ["--barra" as string]: tema.barra,
        ["--barra-acento" as string]: tema.barraAcento,
      }}
    >
      {/* Que nada se pase del ancho del monitor: si la página es más ancha, el
          navegador la deja correr de costado y se cortan los bordes (pasaba en
          el Joog). En modo liviano, sin sombras ni transiciones. El producto
          flotando en la ficha sí queda: es una sola foto que se mueve y
          Gonzalo lo extrañó (2026-11-11). */}
      <style>{`
        html, body { overflow-x: hidden; max-width: 100%; }
        .asesor-liviano *, .asesor-liviano *::before, .asesor-liviano *::after {
          box-shadow: none !important; text-shadow: none !important;
          backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
          transition: none !important;
        }
      `}</style>

      {/* Volver e Inicio quedan a la izquierda (ver Navbar), así este lado
          queda libre. En el Conóceme no va: tapa los controles de las filminas.
          En el inicio va adentro de lo que se desliza (ver más abajo). */}
      {pantalla !== "conoceme" && pantalla !== "home" && !productoAbierto && selectorIdioma("fixed top-5 right-5")}

      {/* Regla en los bordes: el último número que se ve entero es lo que el
          monitor no corta; el que no se ve, lo que hay que dejar libre. */}
      {calibrar && (
        <div className="fixed inset-0 z-[998] pointer-events-none">
          {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140].map((n) => (
            <div key={`d${n}`} className="absolute top-0 bottom-0" style={{ right: n, width: 2, background: n % 20 === 0 ? "#d00" : "#06c" }}>
              <span className="absolute font-bold text-[15px]" style={{ top: 60 + (n % 20 === 0 ? 0 : 24), right: 4, color: n % 20 === 0 ? "#d00" : "#06c" }}>
                {n}
              </span>
            </div>
          ))}
          {[0, 10, 20, 30, 40, 50, 60, 80, 100].map((n) => (
            <div key={`a${n}`} className="absolute left-0 right-0" style={{ bottom: n, height: 2, background: n % 20 === 0 ? "#d00" : "#06c" }}>
              <span className="absolute font-bold text-[15px]" style={{ bottom: 4, left: 300 + (n % 20 === 0 ? 0 : 40), color: n % 20 === 0 ? "#d00" : "#06c" }}>
                {n}
              </span>
            </div>
          ))}
        </div>
      )}
      {calibrar && (
        <div className="fixed left-1/2 top-1/2 z-[999] w-[440px] -ml-[220px] -mt-[150px] rounded-2xl bg-white border-2 border-[#22301f] p-5 text-[#1f261c]">
          <p className="font-extrabold text-[20px] mb-1">Ajustar los bordes</p>
          <p className="text-[14px] text-[#4d5545] mb-4">
            Tocá + hasta que la línea roja del 0 se vea entera en el borde. Queda guardado en esta pantalla.
          </p>
          {(["derecha", "abajo"] as const).map((lado) => (
            <div key={lado} className="flex items-center justify-between mb-3">
              <span className="text-[16px] font-bold">{lado === "derecha" ? "Borde derecho" : "Borde de abajo"}</span>
              <span className="flex items-center">
                <button onClick={() => moverBorde(lado, -5)} className="w-12 h-12 rounded-full border-2 border-[#e8dfcd] text-[22px] font-bold">
                  −
                </button>
                <b className="w-16 text-center text-[18px] tabular-nums">{margen[lado] ?? 0}</b>
                <button onClick={() => moverBorde(lado, 5)} className="w-12 h-12 rounded-full border-2 border-[#e8dfcd] text-[22px] font-bold">
                  +
                </button>
              </span>
            </div>
          ))}
          <button
            onClick={() => {
              setCalibrar(false);
              setDiagnostico(null);
            }}
            className="mt-2 w-full h-12 rounded-full text-white font-bold"
            style={{ background: "#22301f" }}
          >
            Listo
          </button>
        </div>
      )}

      {diagnostico && (
        <div className="fixed left-3 bottom-3 z-[999] max-w-[560px] rounded-xl bg-black/85 text-white text-[13px] leading-snug p-3 font-mono break-words">
          <b>Diagnóstico de la pantalla</b>
          <div>Pantalla: {diagnostico.pantalla} · física {diagnostico.pantallaFisica}</div>
          <div>Ancho de la página: {diagnostico.anchoPagina}px</div>
          <div>Placa de video: {diagnostico.placaVideo}</div>
          <div>Modo liviano: {diagnostico.liviano ? "sí" : "no"}</div>
          <div>Se pasa del borde: {diagnostico.seSalen}</div>
          <div>Navegador: {diagnostico.navegador}</div>
        </div>
      )}

      {/* La principal, rediseñada el 2026-11-02 (vista previa aprobada:
          https://claude.ai/artifact/KHCcZNFtaSzt6rsgriKqR1). En vez de cuatro
          puertas que llevan a otra pregunta, la pregunta ya está acá: los
          objetivos se tocan directo. Al costado, las marcas, las ofertas y la
          profesional destacada, para el que viene a otra cosa.
          Sin buscador a propósito (ver el comentario arriba de AsesorApp).
          Los separadores son de grilla y no `gap` de flex: la placa de la
          all-in-one puede tener un navegador que no lo entiende. */}
      {pantalla === "home" && (
        <div
          className="relative flex-1 min-h-0 overflow-y-auto"
          // Degradés quietos: no se mueven, así que para la placa son como un
          // color plano. El grano de encima evita que se vean en franjas.
          style={{
            background:
              "radial-gradient(900px 500px at 88% -10%, #f9dcc6 0%, rgba(249,220,198,0) 60%), radial-gradient(800px 600px at -10% 110%, #dde7cc 0%, rgba(221,231,204,0) 60%), #f5efe3",
          }}
        >
          {/* El grano encima de todo se redibuja al deslizar: en la Raspberry, no. */}
          {!liviano && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ backgroundImage: "url(/grano.png)", backgroundRepeat: "repeat" }}
              aria-hidden
            />
          )}
          {selectorIdioma("absolute top-5 right-6 xl:right-10")}
          {/* En pantallas bajas (la Joog: 1280 × 720) todo se compacta un poco
              con `[@media(max-height:820px)]` para que el inicio entre entero
              sin deslizar (Gonzalo, 2026-11-11). */}
          <div className="relative min-h-full grid content-center px-6 md:px-10 xl:px-14 pt-6 pb-8 [@media(max-height:820px)]:pb-5">
            <div className="w-full max-w-[1600px] mx-auto grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-7 xl:gap-10 items-start">
              {/* ---- izquierda: la pregunta y los objetivos ---- */}
              <div className="grid gap-5 md:gap-6 [@media(max-height:820px)]:gap-4">
                {/* 5 toques seguidos en el logo: ajustar los bordes de la pantalla. */}
                <div className="w-[180px] md:w-[230px] xl:w-[270px] [@media(max-height:820px)]:w-[210px]" onClick={tocarLogo}>
                  <Image
                    src="/wiigo-logo-negro.png"
                    alt="WiiGo — Estaciones de bienestar"
                    width={2172}
                    height={448}
                    sizes="270px"
                    className="w-full h-auto"
                    priority
                  />
                </div>
                <div>
                  <h1
                    className={`${titular.className} font-extrabold text-[clamp(40px,min(5.2vw,8vh),84px)] leading-[.95] tracking-[-.035em] text-[#1f261c]`}
                  >
                    {t("inicioTitulo1")}
                    <br />
                    <span style={{ color: "#e8743b" }}>{t("inicioTituloAcento")}</span> {t("inicioTitulo2")}
                  </h1>
                  <p className="mt-3 text-[17px] md:text-[20px] xl:text-[22px] [@media(max-height:820px)]:mt-2 [@media(max-height:820px)]:text-[18px] text-[#4d5545] max-w-[40ch] leading-snug">
                    {gondola.length > 0 ? t("inicioBajada") : t("inicioBajadaSinGondola")}
                  </p>
                </div>

                {/* Seis objetivos grandes y nada más (Gonzalo, 2026-11-02: «me
                    gusta que sea más minimalista»). Los demás, detrás del link. */}
                <div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                    {objetivosEnInicio.map((o, i) => {
                      const tono = TONOS_INICIO[i % TONOS_INICIO.length];
                      const cuantos = conteoPorObjetivo[o.id_objetivo] ?? 0;
                      return (
                        <button
                          key={o.id_objetivo}
                          onClick={() => elegirObjetivo(o.id_objetivo)}
                          className="relative overflow-hidden rounded-[26px] p-4 md:p-5 [@media(max-height:820px)]:p-4 text-left grid content-between gap-4 [@media(max-height:820px)]:gap-2 min-h-[140px] md:min-h-[165px] xl:min-h-[190px] [@media(max-height:820px)]:min-h-0 transition-transform active:scale-[.97]"
                          style={{ background: tono.fondo, color: tono.texto, boxShadow: "0 14px 30px -20px rgba(40,40,20,.55)" }}
                        >
                          <span
                            className="absolute rounded-full pointer-events-none"
                            style={{ width: 130, height: 130, right: -34, bottom: -40, background: "rgba(255,255,255,.16)" }}
                          />
                          <span
                            className="relative w-12 h-12 xl:w-14 xl:h-14 [@media(max-height:820px)]:w-11 [@media(max-height:820px)]:h-11 rounded-2xl overflow-hidden grid place-items-center"
                            style={{ background: "rgba(255,255,255,.22)" }}
                          >
                            {o.imagen ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={o.imagen} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <IconoObjetivo nombre={o.nombre} className="w-7 h-7" />
                            )}
                          </span>
                          <span className="relative">
                            <span className={`${titular.className} block font-extrabold text-[20px] md:text-[23px] xl:text-[27px] leading-[1.05] tracking-[-.02em]`}>
                              {tr(o.nombre, o.nombre_en, o.nombre_pt)}
                            </span>
                            <span className="block mt-1 text-[13px] xl:text-[14.5px] font-semibold opacity-80">{contarProductos(cuantos, idioma)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {hayMasObjetivos && (
                    <button onClick={irAObjetivo} className="mt-3 py-1.5 text-[15px] xl:text-[16px] font-extrabold" style={{ color: "#4f6a3b" }}>
                      {idioma === "en"
                        ? `See all ${objetivosConProductos.length} goals →`
                        : idioma === "pt"
                          ? `Ver os ${objetivosConProductos.length} objetivos →`
                          : `Ver los ${objetivosConProductos.length} objetivos →`}
                    </button>
                  )}
                </div>
              </div>

              {/* ---- derecha: marcas, ofertas, la profesional y el efectivo ---- */}
              {/* `minmax(0,1fr)`: sin esto la columna crecía con lo de adentro y
                  en la Raspberry (1280 de ancho) se salía de la pantalla. */}
              <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-4 lg:pt-[72px] xl:pt-[84px]">
                {marcasOrdenadas.length > 0 && (
                  <div className="rounded-[24px] border border-[#e8dfcd] px-5 py-4" style={{ background: "#fffaf2" }}>
                    <div className="flex items-baseline justify-between mb-3">
                      <h2 className={`${titular.className} font-extrabold text-[20px] xl:text-[23px] tracking-[-.01em] text-[#1f261c]`}>{t("nuestrasMarcas")}</h2>
                      <span className="text-[13px] font-semibold text-[#857f6f] ml-3">{contarProductos(productos.length, idioma)}</span>
                    </div>
                    {/* Los logos se reparten el ancho que hay y, si no entran,
                        bajan a otro renglón: en una fila fija de 96 px cada uno
                        empujaban la pantalla de costado (Joog, 2026-11-11). */}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-y-3 pb-1">
                      {marcasOrdenadas.map((m) => (
                        <button key={m.id_marca} onClick={() => irAMarca(m.id_marca)} className="grid justify-items-center min-w-0 px-0.5">
                          <span
                            className="w-[66px] h-[66px] xl:w-[76px] xl:h-[76px] rounded-full overflow-hidden grid place-items-center bg-white"
                            style={{ boxShadow: "0 0 0 3px #fffaf2, 0 0 0 4.5px #e8dfcd" }}
                          >
                            {m.logo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.logo} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className={`${titular.className} font-extrabold text-[22px] text-[#6d8058]`}>{m.nombre.charAt(0).toUpperCase()}</span>
                            )}
                          </span>
                          <span className="mt-1.5 text-[12.5px] xl:text-[13.5px] font-bold text-[#4d5545] leading-tight text-center">{m.nombre}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Todas las profesionales juntas en una sola tarjeta: las caras
                    encimadas dicen «son varias» sin llenar la pantalla de
                    nombres. Con una sola, abre su ficha directo. */}
                {profesionales.length > 0 && (
                  <div className="rounded-[24px] border border-[#e8dfcd] px-5 py-4" style={{ background: "#fffaf2" }}>
                    <h2 className={`${titular.className} font-extrabold text-[20px] xl:text-[23px] tracking-[-.01em] text-[#1f261c] mb-3`}>
                      {t("profesionalesWiigo")}
                    </h2>
                    <button
                      onClick={() =>
                        profesionales.length === 1 ? irAFichaProfesional(profesionales[0].id_profesional) : setPantalla("profesionales")
                      }
                      className="w-full flex items-center text-left"
                    >
                      <span className="flex shrink-0 pl-3 mr-4">
                        {profesionales.slice(0, 5).map((p, i) => (
                          <span
                            key={p.id_profesional}
                            className="w-[60px] h-[60px] xl:w-[68px] xl:h-[68px] -ml-3.5 rounded-full overflow-hidden grid place-items-center text-white"
                            style={{ background: CARAS_PROFESIONALES[i % CARAS_PROFESIONALES.length], boxShadow: "0 0 0 3px #fffaf2" }}
                          >
                            {p.foto ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.foto} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className={`${titular.className} font-extrabold text-[18px]`}>
                                {p.nombre.charAt(0).toUpperCase()}
                                {(p.apellido ?? "").charAt(0).toUpperCase()}
                              </span>
                            )}
                          </span>
                        ))}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[17px] xl:text-[19px] font-bold text-[#1f261c] leading-tight">
                          {idioma === "en"
                            ? `${profesionales.length} professional${profesionales.length === 1 ? "" : "s"} to advise you`
                            : idioma === "pt"
                              ? `${profesionales.length} profissiona${profesionales.length === 1 ? "l" : "is"} para te orientar`
                              : `${profesionales.length} profesional${profesionales.length === 1 ? "" : "es"} te ${profesionales.length === 1 ? "asesora" : "asesoran"}`}
                        </span>
                        {categoriasProf.length > 0 && (
                          <span className="block text-[14px] text-[#857f6f] mt-0.5">
                            {listaConY(
                              categoriasProf.map((c) => (idioma === "es" ? enPlural(c) : c)),
                              idioma
                            )}
                          </span>
                        )}
                        <span className="inline-block mt-2 rounded-full px-3 py-1 text-[12.5px] xl:text-[13.5px] font-extrabold" style={{ background: "#fde7d9", color: "#a34713" }}>
                          {profesionales.length === 1 ? t("conocerla") : t("conocelos")} →
                        </span>
                      </span>
                    </button>
                  </div>
                )}

                {/* Ver todos, a la derecha y no abajo de los objetivos: así el
                    inicio entra entero en la pantalla de 1280 × 720 sin deslizar
                    (Gonzalo, 2026-11-11). */}
                <button
                  onClick={irAMarcas}
                  className="w-full rounded-[22px] px-5 py-4 text-left flex items-center transition-transform active:scale-[.98]"
                  style={{ background: "#22301f", color: "#f5efe3", boxShadow: "0 16px 30px -20px rgba(0,0,0,.6)" }}
                >
                  <span className="w-12 h-12 rounded-[15px] grid place-items-center shrink-0 mr-4" style={{ background: "rgba(255,255,255,.12)" }}>
                    <IconoBolsa className="w-7 h-7" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`${titular.className} block font-extrabold text-[20px] xl:text-[24px] leading-tight`}>{t("verTodosProductos")}</span>
                    <span className="block text-[14px] font-semibold opacity-75">
                      {contarProductos(productos.length, idioma)} · {t("verTodoDesc")}
                    </span>
                  </span>
                  <span
                    className="w-12 h-12 rounded-full grid place-items-center shrink-0 ml-4 text-[22px] font-extrabold text-white"
                    style={{ background: "#e8743b" }}
                    aria-hidden
                  >
                    →
                  </span>
                </button>

                {/* Solo cuando hay alguna oferta cargada. */}
                {productosEnOferta.length > 0 && (
                  <button
                    onClick={irAOfertas}
                    className="rounded-[24px] px-5 py-4 text-left flex items-center transition-transform active:scale-[.98]"
                    style={{ background: "#e8743b", color: "#fff", boxShadow: "0 16px 30px -18px rgba(232,116,59,.9)" }}
                  >
                    <span className="w-12 h-12 rounded-2xl grid place-items-center shrink-0 mr-4" style={{ background: "rgba(255,255,255,.2)" }}>
                      <IconoEtiqueta className="w-7 h-7" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={`${titular.className} block font-extrabold text-[20px] xl:text-[23px] leading-tight`}>{t("ofertasHoy")}</span>
                      <span className="block text-[14px] font-semibold opacity-90">{contarProductos(productosEnOferta.length, idioma, "descuento")}</span>
                    </span>
                    <span className="text-[26px] font-bold ml-3" aria-hidden>
                      →
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Solo la pregunta. Las preferencias viven en la pantalla de productos,
          que es donde el cliente ya tiene cosas delante para filtrar. */}
      {pantalla === "objetivo" && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={volverAInicio} onInicio={volverAInicio} idioma={idioma} />
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-6 pt-4 pb-10 gap-6 md:gap-8">
            <div className="text-center">
              <h2 className={`${titular.className} font-extrabold tracking-[-.02em] text-[clamp(26px,3.4vw,44px)] leading-tight`}>
                {t("objetivoTitulo")}
              </h2>
              <p className="text-[13px] md:text-[15px] text-[#8a8a8a] mt-1.5">{t("objetivoSubtitulo")}</p>
            </div>
            {objetivosConProductos.length === 0 ? (
              <p className="text-[#686868] text-sm text-center py-8">{t("objetivoVacio")}</p>
            ) : (
              // Los mismos cuadros que en la portada: mismos colores, íconos y letra.
              <div className="w-full max-w-6xl grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                {objetivosConProductos.map((o, i) => {
                  const tono = TONOS_INICIO[i % TONOS_INICIO.length];
                  return (
                    <button
                      key={o.id_objetivo}
                      onClick={() => elegirObjetivo(o.id_objetivo)}
                      className="relative overflow-hidden rounded-[26px] p-4 md:p-5 text-left grid content-between gap-4 min-h-[140px] md:min-h-[170px] transition-transform active:scale-[.97]"
                      style={{ background: tono.fondo, color: tono.texto, boxShadow: "0 14px 30px -20px rgba(40,40,20,.55)" }}
                    >
                      <span
                        className="absolute rounded-full pointer-events-none"
                        style={{ width: 130, height: 130, right: -34, bottom: -40, background: "rgba(255,255,255,.16)" }}
                      />
                      <span className="relative w-12 h-12 rounded-2xl overflow-hidden grid place-items-center" style={{ background: "rgba(255,255,255,.22)" }}>
                        {o.imagen ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={o.imagen} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <IconoObjetivo nombre={o.nombre} className="w-7 h-7" />
                        )}
                      </span>
                      <span className="relative">
                        <span className={`${titular.className} block font-extrabold text-[20px] md:text-[23px] leading-[1.05] tracking-[-.02em]`}>
                          {tr(o.nombre, o.nombre_en, o.nombre_pt)}
                        </span>
                        <span className="block mt-1 text-[13px] font-semibold opacity-80">{contarProductos(conteoPorObjetivo[o.id_objetivo] ?? 0, idioma)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Una sola pantalla: los logos arriba, los rubros y las preferencias al
          costado, los productos a la derecha. Se cambia de marca sin salir. */}
      {pantalla === "marcas" && (
        <div className="flex-1 flex flex-col min-h-0">
          <Navbar onVolver={volverAInicio} onInicio={volverAInicio} idioma={idioma} />

          {marcasOrdenadas.length === 0 ? (
            <p className="text-[#686868] text-sm text-center py-16">{t("marcasVacio")}</p>
          ) : (
            <>
              <div className="shrink-0 bg-[#fffaf2] border-b border-[#e8dfcd] px-4 md:px-7 pt-3 pb-3 [@media(max-height:820px)]:pt-2 [@media(max-height:820px)]:pb-2 flex gap-2 md:gap-4 overflow-x-auto">
                {marcasOrdenadas.map((m) => (
                  <DiscoMarca
                    key={m.id_marca}
                    nombre={m.nombre}
                    logo={m.logo}
                    cantidad={conteoProductosPorMarca[m.id_marca] ?? 0}
                    activo={marcaId === m.id_marca}
                    onClick={() => {
                      setMarcaId(m.id_marca);
                      setSubcategoriaId(primerRubroDe(m.id_marca));
                    }}
                  />
                ))}
              </div>

              {/* El menú a la izquierda cuesta ancho, que sobra, y nada de alto,
                  que es lo que falta en un monitor acostado. Solo la grilla se
                  desliza; las marcas de arriba y la barra quedan quietas. */}
              <div className="flex-1 min-h-0 flex flex-col md:flex-row">
                <div
                  className="shrink-0 md:w-[248px] px-3 py-4 md:py-5 flex flex-row md:flex-col gap-5 md:gap-6 overflow-x-auto md:overflow-y-auto"
                  style={{ background: "var(--barra, #1e2a18)" }}
                >
                  {(subcategoriasDeMarca.length > 0 || sinRubroDeMarca > 0) && (
                    <GrupoRail titulo={t("railRubro")}>
                      {subcategoriasDeMarca.map((s) => (
                        <OpcionRail
                          key={s.id_subcategoria}
                          nombre={s.nombre}
                          cantidad={conteoPorSubcategoria[s.id_subcategoria] ?? 0}
                          activo={subcategoriaId === s.id_subcategoria}
                          onClick={() => setSubcategoriaId(s.id_subcategoria)}
                        />
                      ))}
                      {sinRubroDeMarca > 0 && (
                        <OpcionRail
                          nombre={t("otros")}
                          cantidad={sinRubroDeMarca}
                          activo={subcategoriaId === SIN_RUBRO}
                          onClick={() => setSubcategoriaId(SIN_RUBRO)}
                        />
                      )}
                    </GrupoRail>
                  )}

                  {filtros.length > 0 && (
                    <GrupoRail titulo={t("railSin")}>
                      {filtros.map((f) => (
                        <OpcionRail
                          key={f.id_filtro}
                          nombre={tr(f.nombre, f.nombre_en, f.nombre_pt)}
                          activo={filtrosSeleccionados.has(f.id_filtro)}
                          casilla
                          onClick={() => toggleFiltro(f.id_filtro)}
                        />
                      ))}
                    </GrupoRail>
                  )}
                </div>

                <div className="flex-1 min-h-0 min-w-0 overflow-y-auto px-5 md:px-7 py-5 md:py-6 [@media(max-height:820px)]:py-3">
                  <div className="flex items-end justify-between gap-4 mb-4 [@media(max-height:820px)]:mb-2.5">
                    <div>
                      <p
                        className="text-[10px] md:text-[11px] font-extrabold uppercase tracking-[.22em]"
                        style={{ color: "var(--acento, #4d7635)" }}
                      >
                        {marcaId ? (marcaPorId[marcaId]?.nombre ?? t("marcasTitulo")) : t("marcasTitulo")}
                      </p>
                      <h2
                        className={`${titular.className} font-extrabold tracking-[-.02em] text-[clamp(21px,2.6vw,34px)] leading-tight mt-0.5`}
                      >
                        {subcategoriaId === SIN_RUBRO
                          ? t("otros")
                          : (subcategoriasDeMarca.find((s) => s.id_subcategoria === subcategoriaId)?.nombre ??
                            t("marcasTitulo"))}
                      </h2>
                    </div>
                    <div className="shrink-0 grid justify-items-end gap-1.5">
                      {muebleDelRubro && (
                        <span
                          className="rounded-[12px] border border-dashed border-[#d9cdb6] bg-white px-3 py-1.5 text-[13px] md:text-[14px] font-bold text-[#4d5545]"
                        >
                          <span style={{ color: "#e8743b" }}>●</span> {muebleDelRubro.texto}
                        </span>
                      )}
                      <span className="text-[12px] md:text-[13px] text-[#8a9180] font-semibold">
                        {contarProductos(productosDeMarca.length, idioma)}
                      </span>
                    </div>
                  </div>

                  {productosDeMarca.length === 0 ? (
                    <p className="text-[#686868] text-sm text-center py-12">{t("marcasSinProductos")}</p>
                  ) : (
                    // Sin panel al costado entran seis por fila en vez de cinco.
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                      {productosDeMarca.map((p) => (
                        <TarjetaResultado
                          key={p.id_producto}
                          producto={p}
                          marca={undefined}
                          etiqueta=""
                          nombre={tr(p.nombre, p.nombre_en, p.nombre_pt)}
                          onClick={() => setProductoAbierto(p.id_producto)}
                          bolsita={esMarcaWiigo(marcaPorId[p.id_marca])}
                          logoMarca={marcaPorId[p.id_marca]?.logo ?? null}
                          sinStock={agotados.has(p.id_producto) ? textoSinStock : null}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Agrupadas por marca, no todo mezclado: así se entiende de quién es
          cada promo. */}
      {pantalla === "ofertas" && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={volverAInicio} onInicio={volverAInicio} idioma={idioma} />
          <div className="flex-1 min-h-0 overflow-y-auto px-5 md:px-8 pt-5 pb-10 max-w-7xl mx-auto w-full">
            <div className="flex items-end justify-between gap-4 mb-5">
              <h2 className={`${titular.className} font-extrabold tracking-[-.02em] text-[clamp(23px,2.8vw,38px)] leading-tight`}>
                {t("ofertasTitulo")}
              </h2>
              <span className="text-[12px] md:text-[13px] text-[#8a9180] font-semibold shrink-0">
                {contarProductos(productosEnOferta.length, idioma, "descuento")}
              </span>
            </div>

            {productosEnOferta.length === 0 ? (
              <p className="text-[#686868] text-sm text-center py-16">{t("ofertasVacio")}</p>
            ) : (
              <div className="flex flex-col gap-7">
                {marcasOrdenadas
                  .filter((m) => marcasConOferta.includes(m.id_marca))
                  .map((m) => (
                    <div key={m.id_marca} className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 md:w-10 md:h-10 rounded-full overflow-hidden grid place-items-center shrink-0"
                              style={{ background: "#f1f4ec" }}>
                          {m.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.logo} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="font-extrabold text-[14px]" style={{ color: SAGE_DARK }}>
                              {m.nombre.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </span>
                        <span className="text-[12px] md:text-[13.5px] font-extrabold uppercase tracking-[.14em]"
                              style={{ color: "#4d7635" }}>
                          {m.nombre}
                        </span>
                        <span className="flex-1 h-px" style={{ background: "#e2e6da" }} />
                        <span className="text-[11.5px] text-[#a3aa95] font-semibold tabular-nums shrink-0">
                          {conteoOfertasPorMarca[m.id_marca] ?? 0}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4">
                        {productosEnOferta
                          .filter((p) => p.id_marca === m.id_marca)
                          .map((p) => (
                            <div
                              key={p.id_producto}
                              onClick={() => setProductoAbierto(p.id_producto)}
                              className="relative rounded-2xl bg-white overflow-hidden shadow-sm flex flex-col cursor-pointer"
                            >
                              <span
                                className="absolute top-2 left-2 z-10 text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white"
                                style={{ background: C3 }}
                              >
                                -{p.descuento_porcentaje}%
                              </span>
                              <div
                                className={`h-[88px] lg:h-[124px] xl:h-[150px] flex items-center justify-center ${
                                  p.imagen ? "bg-white" : "bg-gradient-to-br from-[#f0f2ec] to-[#d8d8d8]"
                                }`}
                              >
                                {p.imagen ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={p.imagen} alt="" className="w-full h-full object-contain p-1" />
                                ) : (
                                  <span style={{ color: SAGE_DARK }}>
                                    <IconoEtiqueta className="w-6 h-6" />
                                  </span>
                                )}
                              </div>
                              <div className="p-2.5 flex flex-col gap-1">
                                <p className="text-[12px] font-extrabold leading-tight line-clamp-2">
                                  {tr(p.nombre, p.nombre_en, p.nombre_pt)}
                                </p>
                                <div className="flex items-baseline gap-1.5 mt-1">
                                  <span className={`text-[13.5px] font-semibold ${titular.className}`} style={{ color: C3 }}>
                                    {formatoPrecio(precioConDescuento(p))}
                                  </span>
                                  <span className="text-[10px] text-[#a8a8a8] line-through">
                                    {formatoPrecio(p.precio_venta)}
                                  </span>
                                </div>
                                {ambosPrecios(p, null).ahorro !== null && (
                                  <span
                                    className="self-start inline-flex items-baseline gap-1 rounded px-1.5 py-0.5 mt-0.5"
                                    style={{ background: "#eaf3dc" }}
                                  >
                                    <span
                                      className="text-[7.5px] font-extrabold uppercase tracking-[.1em]"
                                      style={{ color: "#6e8f52" }}
                                    >
                                      Efectivo
                                    </span>
                                    <span
                                      className={`${titular.className} text-[11px] font-semibold`}
                                      style={{ color: "#3d6b28" }}
                                    >
                                      {formatoPrecio(ambosPrecios(p, null).efectivo)}
                                    </span>
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {pantalla === "resultado" && (
        <div className="flex-1 flex flex-col min-h-0">
          <Navbar onVolver={volverDesdeResultado} onInicio={volverAInicio} idioma={idioma} />
          {/* Igual que el catálogo de marcas (Gonzalo, 2026-11-02: el menú
              quedaba flotando en el medio): las marcas en la franja blanca de
              arriba, el menú pegado al borde izquierdo de punta a punta y los
              productos ocupando todo el resto. */}
          <div className="flex-1 min-h-0 flex flex-col mt-3">
                {marcasConResultados.length > 1 && (
                  <div className="shrink-0 bg-[#fffaf2] border-b border-[#e8dfcd] px-4 md:px-7 pt-3 pb-3 [@media(max-height:820px)]:pt-2 [@media(max-height:820px)]:pb-2 flex gap-2 md:gap-4 overflow-x-auto">
                    <DiscoMarca
                      nombre={t("todas")}
                      logo={null}
                      cantidad={productosSinFiltroMarca.length}
                      activo={marcaResultado === null}
                      onClick={() => setMarcaResultado(null)}
                    />
                    {marcasConResultados.map((m) => (
                      <DiscoMarca
                        key={m.id_marca}
                        nombre={m.nombre}
                        logo={m.logo}
                        cantidad={conteoPorMarca[m.id_marca] ?? 0}
                        activo={marcaResultado === m.id_marca}
                        onClick={() => setMarcaResultado(marcaResultado === m.id_marca ? null : m.id_marca)}
                      />
                    ))}
                  </div>
                )}

                <div className="flex-1 min-h-0 flex flex-col md:flex-row">
                  <div
                    className="shrink-0 md:w-[248px] px-3 py-4 md:py-5 flex flex-row md:flex-col gap-5 md:gap-6 overflow-x-auto md:overflow-y-auto"
                    style={{ background: "var(--barra, #1e2a18)" }}
                  >
                    {objetivosConProductos.length > 0 && (
                      <GrupoRail titulo={t("railObjetivo")}>
                        {objetivosConProductos.map((o) => (
                          <OpcionRail
                            key={o.id_objetivo}
                            nombre={tr(o.nombre, o.nombre_en, o.nombre_pt)}
                            cantidad={conteoPorObjetivo[o.id_objetivo] ?? 0}
                            activo={objetivoId === o.id_objetivo}
                            onClick={() => setObjetivoId(objetivoId === o.id_objetivo ? null : o.id_objetivo)}
                          />
                        ))}
                      </GrupoRail>
                    )}
                    {filtros.length > 0 && (
                      <GrupoRail titulo={t("railSin")}>
                        {filtros.map((f) => (
                          <OpcionRail
                            key={f.id_filtro}
                            nombre={tr(f.nombre, f.nombre_en, f.nombre_pt)}
                            activo={filtrosSeleccionados.has(f.id_filtro)}
                            casilla
                            onClick={() => toggleFiltro(f.id_filtro)}
                          />
                        ))}
                      </GrupoRail>
                    )}
                  </div>

                  <div className="flex-1 min-h-0 min-w-0 overflow-y-auto px-5 md:px-7 py-5 md:py-6">
                    <div className="flex items-end justify-between gap-4 mb-4">
                      <div>
                        <p
                          className="text-[10px] md:text-[11px] font-extrabold uppercase tracking-[.22em]"
                          style={{ color: "var(--acento, #4d7635)" }}
                        >
                          {t("railObjetivo")}
                        </p>
                        <h3 className={`${titular.className} font-extrabold tracking-[-.02em] text-[clamp(21px,2.6vw,34px)] leading-tight mt-0.5`}>
                          {objetivoId
                            ? (() => {
                                const o = objetivos.find((x) => x.id_objetivo === objetivoId);
                                return o ? tr(o.nombre, o.nombre_en, o.nombre_pt) : t("resultadoTitulo");
                              })()
                            : t("resultadoTitulo")}
                        </h3>
                      </div>
                      <span className="text-[12px] md:text-[13px] text-[#8a9180] font-semibold shrink-0">
                        {contarProductos(productosFiltrados.length, idioma, "disponibles")}
                      </span>
                    </div>

                    {productosFiltrados.length === 0 ? (
                      <p className="text-[#686868] text-sm text-center py-12">{t("sinResultados")}</p>
                    ) : (
                      // Como en el catálogo de marcas: con el menú pegado al borde
                      // entran seis por fila en la pantalla grande.
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                        {productosFiltrados.map((p) => (
                          <TarjetaResultado
                            key={p.id_producto}
                            producto={p}
                            marca={marcaResultado ? undefined : marcaPorId[p.id_marca]}
                            bolsita={esMarcaWiigo(marcaPorId[p.id_marca])}
                            logoMarca={marcaPorId[p.id_marca]?.logo ?? null}
                            etiqueta={porQue(p).texto}
                            nombre={tr(p.nombre, p.nombre_en, p.nombre_pt)}
                            onClick={() => setProductoAbierto(p.id_producto)}
                            sinStock={agotados.has(p.id_producto) ? textoSinStock : null}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
          </div>
        </div>
      )}

      {/* La grilla se acomoda sola: con una profesional sale centrada y grande,
          con ocho sale en dos filas. */}
      {pantalla === "profesionales" && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={volverAInicio} onInicio={volverAInicio} idioma={idioma} />
          <div className="flex-1 min-h-0 overflow-y-auto px-5 md:px-8 pt-5 pb-10 max-w-6xl mx-auto w-full flex flex-col items-center gap-5 md:gap-7">
            <div className="text-center">
              <h2 className={`${titular.className} font-extrabold tracking-[-.02em] text-[clamp(24px,3vw,40px)] leading-tight`}>
                {t("profesionalesTitulo")}
              </h2>
              <p className="text-[13px] md:text-[15px] text-[#8a8a8a] mt-1.5">{t("profesionalesSub")}</p>
            </div>

            {categoriasProf.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center">
                {categoriasProf.map((cat) => {
                  const on = categoriaProf === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleCategoriaProf(cat)}
                      className="rounded-full border-[1.5px] px-4 py-2 text-[12.5px] font-bold transition-colors"
                      style={
                        on
                          ? { background: SAGE_DARK, borderColor: SAGE_DARK, color: "#fff" }
                          : { background: "#fff", borderColor: "#d8d8d8", color: "#686868" }
                      }
                    >
                      {enPlural(cat)}
                    </button>
                  );
                })}
              </div>
            )}

            {profesionalesFiltrados.length === 0 ? (
              <p className="text-[#686868] text-sm text-center py-12">{t("profesionalesVacio")}</p>
            ) : (
              <div
                className={`w-full grid gap-4 md:gap-5 ${
                  profesionalesFiltrados.length === 1
                    ? "grid-cols-1 max-w-[320px]"
                    : profesionalesFiltrados.length === 2
                      ? "grid-cols-2 max-w-[660px]"
                      : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                }`}
              >
                {profesionalesFiltrados.map((prof) => (
                  <button
                    key={prof.id_profesional}
                    onClick={() => irAFichaProfesional(prof.id_profesional)}
                    className="rounded-3xl bg-white overflow-hidden text-left flex flex-col transition-transform active:scale-[.98]"
                    style={{ boxShadow: "0 16px 32px -24px rgba(20,28,14,.55)" }}
                  >
                    {/* Retrato y no apaisado: las fotos de las profesionales
                        son de medio cuerpo, y en una caja apaisada la caja les
                        corta la cabeza. Anclada arriba, la cara entra siempre. */}
                    <span
                      className="relative aspect-[3/4] w-full flex items-center justify-center font-extrabold text-[34px] text-white overflow-hidden"
                      style={{ background: "var(--acento, #4d7635)" }}
                    >
                      {prof.foto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={prof.foto} alt="" className="w-full h-full object-cover object-top" />
                      ) : (
                        `${prof.nombre.charAt(0)}${prof.apellido ? prof.apellido.charAt(0) : ""}`.toUpperCase()
                      )}

                      {/* La matrícula como sello. En un rubro donde cualquiera
                          se dice "coach nutricional", el número matriculado es
                          la diferencia — y hasta ahora no se veía en ningún
                          lado. */}
                      {prof.matricula && (
                        <span
                          className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full pl-1.5 pr-2.5 py-1 text-[9.5px] font-extrabold tracking-wide"
                          style={{ background: "rgba(255,255,255,.94)", color: SAGE_DARK }}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-full grid place-items-center text-[8px] text-white"
                            style={{ background: SAGE_DARK }}
                          >
                            ✓
                          </span>
                          {prof.matricula}
                        </span>
                      )}

                      <span
                        className="absolute inset-0 pointer-events-none"
                        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(20,24,16,.78) 100%)" }}
                      />
                      <span className="absolute left-0 right-0 bottom-0 p-3 text-left">
                        <span className={`${titular.className} block font-extrabold tracking-[-.02em] text-[19px] md:text-[21px] text-white leading-tight`}>
                          {prof.nombre} {prof.apellido ?? ""}
                        </span>
                        {(prof.titulo || prof.especialidad) && (
                          <span className="block text-[9px] md:text-[9.5px] font-extrabold uppercase tracking-[.14em] text-white/90 mt-1 leading-snug">
                            {[prof.titulo, prof.especialidad].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                    </span>
                    <div className="p-3.5 md:p-4 flex flex-col gap-2 flex-1">
                      {/* Sin fortalezas cargadas la tarjeta quedaba con un
                          hueco blanco al lado de otra que sí las tiene, y se
                          leía como un error de la pantalla. La especialidad
                          ocupa ese lugar hasta que se carguen. */}
                      {(fortalezasPorProfesional[prof.id_profesional] ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {(fortalezasPorProfesional[prof.id_profesional] ?? []).slice(0, 3).map((f) => (
                            <span
                              key={f.nombre}
                              className="text-[9.5px] font-bold px-2.5 py-1 rounded-full"
                              style={
                                f.principal
                                  ? { background: "#f7ece1", color: CLAY }
                                  : { background: SAGE_TINT, color: SAGE_DARK }
                              }
                            >
                              {f.nombre}
                            </span>
                          ))}
                        </div>
                      ) : (
                        prof.especialidad && (
                          <div className="flex flex-wrap gap-1.5">
                            <span
                              className="text-[9.5px] font-bold px-2.5 py-1 rounded-full"
                              style={{ background: SAGE_TINT, color: SAGE_DARK }}
                            >
                              {prof.especialidad}
                            </span>
                          </div>
                        )
                      )}
                      <span
                        className="text-[11px] font-extrabold mt-auto pt-2.5"
                        style={{ color: "var(--acento, #4d7635)" }}
                      >
                        {t("verFicha")} ›
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {pantalla === "fichaProfesional" && profesionalActual && (
        <div className="flex-1 flex flex-col min-h-0">
          <Navbar onVolver={() => setPantalla("profesionales")} onInicio={volverAInicio} idioma={idioma} />
          {/* Se abre como un libro, igual que la ficha de producto: a la
              izquierda quién es y el botón de turno —que no se mueve nunca—, a
              la derecha su historia, que se desliza. Antes era una sola columna
              de 448px en una pantalla de 27": el botón de reservar quedaba al
              final y había que volver a subir para tocarlo.

              Sin historia cargada no hay hoja derecha: media ficha en blanco se
              lee como que falta algo, y es el caso de las dos hasta que carguen
              formación y trayectoria. */}
          <div
            className={`flex-1 min-h-0 w-full mx-auto grid ${
              tieneHistoria ? "max-w-5xl md:grid-cols-2" : "max-w-md"
            }`}
          >
          <div className="min-h-0 overflow-y-auto px-6 pt-4 pb-10 w-full flex flex-col">
            {/* Vertical y grande: la foto es de medio cuerpo y en una caja baja
                queda una tira con la cara apretada arriba. El tope en vh es
                para que en una pantalla corta no empuje el botón de turno
                fuera de vista. */}
            {/* Las fotos pasan como historias: la de perfil y hasta 3 de su
                galería, con zoom lento y rayitas arriba (Gonzalo, 2026-11-05). */}
            <CarruselProfesional
              fotos={[...new Set([profesionalActual.foto, ...fotosDelProfesionalActual].filter((f): f is string => Boolean(f)))].slice(0, 4)}
              inicial={profesionalActual.nombre.charAt(0).toUpperCase()}
              style={{
                aspectRatio: tieneHistoria ? "4 / 5" : "16 / 10",
                maxHeight: tieneHistoria ? "48vh" : "26vh",
                marginBottom: 16,
                flexShrink: 0,
              }}
            >
              {profesionalActual.matricula && (
                <span
                  className="absolute top-6 left-3.5 z-[3] flex items-center gap-1.5 rounded-full pl-1.5 pr-3 py-1 text-[10.5px] font-extrabold tracking-wide"
                  style={{ background: "rgba(255,255,255,.95)", color: SAGE_DARK }}
                >
                  <span className="w-4 h-4 rounded-full grid place-items-center text-[9px] text-white" style={{ background: SAGE_DARK }}>
                    ✓
                  </span>
                  {t("matricula")} {profesionalActual.matricula}
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 p-4 z-[3] pointer-events-none">
                <p className={`${titular.className} font-extrabold tracking-[-.02em] text-[26px] md:text-[30px] text-white leading-tight`}>
                  {profesionalActual.nombre} {profesionalActual.apellido ?? ""}
                </p>
                {(profesionalActual.titulo || profesionalActual.especialidad) && (
                  <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-white/90 mt-1 leading-snug">
                    {[profesionalActual.titulo, profesionalActual.especialidad].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            </CarruselProfesional>

            {/* Sin `justify-center`: cuando la columna es más alta que el
                contenido, centrar abría un hueco arriba y otro abajo y la ficha
                quedaba desarmada. Ahora todo baja desde la foto y el único
                espacio libre queda antes del botón, que va pegado al pie.

                Los datos entran uno detrás de otro al abrirla, en medio
                segundo. Se ve una sola vez. */}
            <div className="flex flex-col gap-3" style={{ animation: "asesorEntrar .5s cubic-bezier(.2,.8,.2,1) .10s both" }}>
              {/* La matrícula va como sello sobre la foto. */}
              {profesionalActual.bio && (
                <p
                  className="text-[13px] italic leading-relaxed pl-3 border-l-2"
                  style={{ borderColor: CLAY, color: "#2d2d2d", animation: "asesorEntrar .5s cubic-bezier(.2,.8,.2,1) .26s both" }}
                >
                  {profesionalActual.bio}
                </p>
              )}

              {fortalezasDelProfesionalActual.length > 0 && (
                <div className="flex flex-wrap gap-1.5" style={{ animation: "asesorEntrar .5s cubic-bezier(.2,.8,.2,1) .34s both" }}>
                  {fortalezasDelProfesionalActual.map((f) => (
                    <span
                      key={f.nombre}
                      className="flex items-center gap-1.5 text-[10.5px] font-bold pl-1.5 pr-2.5 py-1 rounded-full"
                      style={f.principal ? { background: "#f7ece1", color: CLAY } : { background: SAGE_TINT, color: SAGE_DARK }}
                    >
                      <span
                        className="flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px] text-white shrink-0"
                        style={{ background: f.principal ? CLAY : SAGE_DARK }}
                      >
                        {f.principal ? "★" : "✓"}
                      </span>
                      {f.nombre}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div
              className="flex flex-col gap-2 mt-auto pt-5"
              style={{ animation: "asesorEntrar .5s cubic-bezier(.2,.8,.2,1) .42s both" }}
            >
              {/* Cómo atiende y cuánto sale, al lado del botón, que es donde se
                  decide (2026-11-05). Sale cada forma que atiende: por lo que
                  cargó en «Cómo atiende», por el link de turnos o por el precio. */}
              <ModosAtencion
                presencial={
                  /presencial/i.test(profesionalActual.tipo_atencion ?? "") || tieneReservaPresencial || profesionalActual.precio_presencial != null
                }
                online={
                  /virtual|online/i.test(profesionalActual.tipo_atencion ?? "") || tieneReservaOnline || profesionalActual.precio_online != null
                }
                precioPresencial={profesionalActual.precio_presencial ? formatoPrecio(profesionalActual.precio_presencial) : null}
                precioOnline={profesionalActual.precio_online ? formatoPrecio(profesionalActual.precio_online) : null}
                ciudad={profesionalActual.ciudad}
                idioma={idioma}
                claseTitular={titular.className}
              />

              {tieneReservaPresencial || tieneReservaOnline ? (
                <button
                  onClick={irAReservarTurno}
                  className="pp-reservar text-center text-[14px] font-extrabold text-white py-3.5 rounded-full"
                  style={{ background: SAGE_DARK }}
                >
                  📅 Reservar turno
                </button>
              ) : (
                <p className="text-center text-[11px] text-[#a8a8a8]">Todavía no tiene link de reserva cargado.</p>
              )}

              {/* Atiende con otras y comparten la agenda: el turno de arriba ya
                  abre la del consultorio. Esto es para que el cliente sepa con
                  quién atiende y pueda pasar a su ficha. */}
              {consultorioActual && consultorioActual.companeras.length > 0 && (
                <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: SAGE_TINT, color: SAGE_DARK }}>
                  <p className="text-[11px] leading-snug">
                    {t("atiendeEn")} <b>{consultorioActual.nombre}</b> {t("juntoA")}{" "}
                    {consultorioActual.companeras.map((c) => c.nombre).join(", ")}. {t("mismaAgenda")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {consultorioActual.companeras.map((c) => (
                      <button
                        key={c.id_profesional}
                        onClick={() => irAFichaProfesional(c.id_profesional)}
                        className="flex items-center gap-2 bg-white rounded-full pl-1 pr-3 py-1 text-[11px] font-bold"
                        style={{ color: SAGE_DARK }}
                      >
                        <span
                          className="w-6 h-6 rounded-full overflow-hidden grid place-items-center text-[10px] text-white shrink-0"
                          style={{ background: SAGE_DARK }}
                        >
                          {c.foto ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.foto} alt="" className="w-full h-full object-cover object-top" />
                          ) : (
                            c.nombre.charAt(0).toUpperCase()
                          )}
                        </span>
                        {c.nombre} →
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {slidesDelProfesionalActual.length > 0 && (
                <button
                  onClick={irAConoceme}
                  className="text-center text-[12px] font-extrabold text-white py-2.5 rounded-full"
                  style={{ background: SAGE }}
                >
                  ▶️ Conóceme
                </button>
              )}

              {objetivosDelProfesionalActual.length > 0 && (
                <>
                  <button
                    onClick={() => setMostrarComoAyuda((v) => !v)}
                    className="text-center text-[12px] font-bold py-2.5 rounded-full border"
                    style={{ borderColor: "#d8d8d8", color: "#686868" }}
                  >
                    🎯 ¿Cómo puede ayudarte? {mostrarComoAyuda ? "▴" : "▾"}
                  </button>
                  {mostrarComoAyuda && (
                    <div className="rounded-xl border border-[#d8d8d8] bg-white p-3">
                      <p className="text-[11px] font-bold mb-2">
                        {profesionalActual.nombre.split(" ")[0]} puede ayudarte si buscás:
                      </p>
                      <ul className="flex flex-col gap-1">
                        {objetivosDelProfesionalActual.map((nombre) => (
                          <li key={nombre} className="text-[11px] text-[#686868]">
                            • {nombre}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ---------- hoja derecha: su historia ---------- */}
          {tieneHistoria && (
            <div
              ref={hojaHistoria}
              className="min-h-0 overflow-y-auto px-6 pt-5 pb-10 border-t md:border-t-0 md:border-l border-[#e8eade]"
              style={{ background: "#f7f9f2" }}
            >
              <NumerosProfesional
                formaciones={formacionOrdenada.length}
                lugares={trayectoriaOrdenada.length}
                desde={trayectoriaOrdenada.reduce<number | null>((min, x) => (x.anio_desde && (min == null || x.anio_desde < min) ? x.anio_desde : min), null)}
                idioma={idioma}
              />

              {profesionalActual.biografia_completa && (
                <BloqueHistoria titulo={t("historiaTitulo")} contenedor={hojaHistoria}>
                  <p className="text-[13.5px] leading-relaxed text-[#4a4f43] whitespace-pre-line">
                    {profesionalActual.biografia_completa}
                  </p>
                </BloqueHistoria>
              )}

              {fotosDelProfesionalActual.length > 0 && (
                <BloqueHistoria titulo={t("fotosTitulo")} contenedor={hojaHistoria}>
                  <div className="grid grid-cols-3 gap-2">
                    {fotosDelProfesionalActual.map((url) => (
                      <button
                        key={url}
                        onClick={() => setFotoAmpliada(url)}
                        className="aspect-square rounded-xl overflow-hidden bg-[#e8eade]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </BloqueHistoria>
              )}

              {formacionOrdenada.length > 0 && (
                <BloqueHistoria titulo={t("formacionTitulo")} contenedor={hojaHistoria}>
                  <PildorasRecorrido
                    tipo="formacion"
                    items={formacionOrdenada.map((f) => ({
                      id: f.id_formacion,
                      cuando: f.anio ? String(f.anio) : "",
                      que: f.titulo,
                      donde: f.institucion,
                    }))}
                  />
                </BloqueHistoria>
              )}

              {trayectoriaOrdenada.length > 0 && (
                <BloqueHistoria titulo={t("trayectoriaTitulo")} contenedor={hojaHistoria}>
                  <PildorasRecorrido
                    tipo="trayectoria"
                    items={trayectoriaOrdenada.map((x) => ({
                      id: x.id_trayectoria,
                      // "2018 — hoy" dice más que "2018": el cliente quiere
                      // saber si sigue ahí, no cuándo empezó.
                      cuando: x.anio_desde
                        ? `${x.anio_desde}${x.anio_hasta ? ` — ${x.anio_hasta}` : ` — ${t("hoy")}`}`
                        : "",
                      que: x.titulo,
                      donde: x.lugar,
                    }))}
                  />
                </BloqueHistoria>
              )}

              {/* Lo que dicen sus pacientes: las cargó ella y las aprobó Gonzalo (2026-11-05). */}
              {opinionesDelProfesionalActual.length > 0 && (
                <BloqueHistoria
                  titulo={idioma === "en" ? "What her patients say" : idioma === "pt" ? "O que dizem seus pacientes" : "Lo que dicen sus pacientes"}
                  contenedor={hojaHistoria}
                >
                  <OpinionesPacientes opiniones={opinionesDelProfesionalActual} idioma={idioma} />
                </BloqueHistoria>
              )}

              {/* Sus redes: desde la pantalla no se abren (el cliente se iría
                  de WiiGo), así que va el usuario y un QR para el celular. */}
              {redActual && (
                <BloqueHistoria titulo={t("redesTitulo")} contenedor={hojaHistoria}>
                  <div className="flex items-center gap-4 rounded-2xl bg-white border border-[#e8eade] p-3.5">
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {redesDelProfesionalActual.map((r) => (
                          // La elegida toma el color de su red, con un brillo alrededor (2026-11-05).
                          <button
                            key={r.clave}
                            onClick={() => setRedElegida(r.clave)}
                            className="pp-red inline-flex items-center gap-1.5 text-[12px] font-bold pl-1 pr-3 py-1 rounded-full"
                            style={
                              r.clave === redActual.clave
                                ? { background: colorDeRed(r.clave as ClaveRed), color: "#fff", boxShadow: `0 0 0 4px ${colorDeRed(r.clave as ClaveRed)}2e, 0 10px 20px -10px ${colorDeRed(r.clave as ClaveRed)}` }
                                : { background: SAGE_TINT, color: SAGE_DARK }
                            }
                          >
                            <span className="grid place-items-center w-5 h-5 rounded-full text-white" style={{ background: colorDeRed(r.clave as ClaveRed) }}>
                              <IconoRed clave={r.clave as ClaveRed} className="w-3 h-3" />
                            </span>
                            {r.nombre}
                          </button>
                        ))}
                      </div>
                      <p className="text-[14px] font-bold break-all" style={{ color: "#2d2d2d" }}>
                        {redActual.texto}
                      </p>
                      <p className="text-[11px] leading-snug text-[#7d8472]">{t("escaneaQr")}</p>
                    </div>
                    {/* El QR flota despacio y lo cruza un destello. */}
                    <span className="pp-qr block w-[112px] h-[112px] shrink-0">
                      <span
                        className="block w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                        dangerouslySetInnerHTML={{ __html: redActual.qr }}
                      />
                    </span>
                  </div>
                </BloqueHistoria>
              )}
            </div>
          )}
          </div>
        </div>
      )}

      {/* La foto de la galería en grande: se cierra tocando en cualquier lado. */}
      {pantalla === "fichaProfesional" && fotoAmpliada && (
        <button
          onClick={() => setFotoAmpliada(null)}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          aria-label="Cerrar foto"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fotoAmpliada} alt="" className="max-w-full max-h-full object-contain rounded-2xl" />
        </button>
      )}

      {pantalla === "reservarTurno" && profesionalActual && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={() => setPantalla("fichaProfesional")} onInicio={volverAInicio} idioma={idioma} />
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-6 max-w-md mx-auto w-full flex flex-col">
            {eligiendoModalidadTurno && (
              <>
                <h2 className={`${titular.className} font-extrabold tracking-[-.02em] text-[22px] mb-1`}>Reservar turno</h2>
                <p className="text-[12px] text-[#686868] mb-4">¿Cómo preferís tu consulta?</p>
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => setModalidadTurno("presencial")}
                    className="flex items-center gap-3 rounded-2xl border-2 bg-white p-3.5 text-left"
                    style={{ borderColor: SAGE_DARK }}
                  >
                    <span
                      className="flex items-center justify-center w-9 h-9 rounded-full text-white text-[15px] shrink-0"
                      style={{ background: SAGE_DARK }}
                    >
                      🏠
                    </span>
                    <div>
                      <p className="text-[13px] font-extrabold">Presencial</p>
                      {profesionalActual.ciudad ? (
                        <p className="text-[10.5px] font-bold" style={{ color: CLAY }}>
                          📍 En {profesionalActual.ciudad}
                        </p>
                      ) : (
                        <p className="text-[10.5px] text-[#a8a8a8]">En el consultorio</p>
                      )}
                    </div>
                    {profesionalActual.precio_presencial != null && (
                      <span className="ml-auto text-[12px] font-extrabold whitespace-nowrap">
                        {formatoPrecio(profesionalActual.precio_presencial)}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setModalidadTurno("online")}
                    className="flex items-center gap-3 rounded-2xl border bg-white p-3.5 text-left"
                    style={{ borderColor: "#d8d8d8" }}
                  >
                    <span
                      className="flex items-center justify-center w-9 h-9 rounded-full text-[15px] shrink-0"
                      style={{ background: SAGE_TINT, color: SAGE_DARK }}
                    >
                      💻
                    </span>
                    <div>
                      <p className="text-[13px] font-extrabold">Online</p>
                      <p className="text-[10.5px] text-[#a8a8a8]">Por videollamada</p>
                    </div>
                    {profesionalActual.precio_online != null && (
                      <span className="ml-auto text-[12px] font-extrabold whitespace-nowrap">
                        {formatoPrecio(profesionalActual.precio_online)}
                      </span>
                    )}
                  </button>
                </div>

                {profesionalActual.ciudad && (
                  <div className="flex gap-2 items-start rounded-xl mt-3 p-3" style={{ background: "#f7ece1" }}>
                    <span>⚠️</span>
                    <p className="text-[10.5px] leading-relaxed" style={{ color: "#8a5a35" }}>
                      <b className="block" style={{ color: "#7a4d2c" }}>
                        {profesionalActual.nombre} atiende presencial en {profesionalActual.ciudad}
                      </b>
                      Si preferís algo local, elegí &quot;Online&quot; o mirá otras profesionales.
                    </p>
                  </div>
                )}
              </>
            )}

            {!eligiendoModalidadTurno && linkReservaFinal && esLinkNoEmbebible(linkReservaFinal) && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
                <p className="text-[13px] text-[#686868] max-w-[240px]">
                  Este link se abre afuera del kiosco — tocá el botón para continuar.
                </p>
                <a
                  href={linkReservaFinal}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-center text-[13px] font-extrabold text-white py-3 px-8 rounded-full"
                  style={{ background: SAGE_DARK }}
                >
                  📅 Continuar
                </a>
              </div>
            )}

            {!eligiendoModalidadTurno && linkReservaFinal && !esLinkNoEmbebible(linkReservaFinal) && (
              <>
                <p className="text-[11px] font-bold mb-2" style={{ color: SAGE_DARK }}>
                  {modalidadTurno === "online" ? "💻 Turno online" : "🏠 Turno presencial"} · {profesionalActual.nombre}
                </p>
                <iframe
                  src={linkReservaFinal}
                  title="Reservar turno"
                  className="flex-1 w-full rounded-2xl border-0"
                  style={{ minHeight: 440, background: "#fff" }}
                />
              </>
            )}

            {!eligiendoModalidadTurno && !linkReservaFinal && (
              <p className="text-center text-[12px] text-[#a8a8a8] py-10">Todavía no tiene link de reserva cargado.</p>
            )}
          </div>
        </div>
      )}

      {pantalla === "conoceme" && profesionalActual && (
        <div className="flex-1 flex flex-col bg-[#fbfbfb]">
          <style>{`
            @keyframes wgItemIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes wgGrowLine { from { transform: scaleY(0); } to { transform: scaleY(1); } }
            @media (prefers-reduced-motion: reduce) {
              .wg-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
            }
          `}</style>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-5 pb-4 flex flex-col max-w-md mx-auto w-full">
            <button
              onClick={() => setPantalla("fichaProfesional")}
              className="self-start text-[10.5px] font-bold text-[#a8a8a8] mb-3"
            >
              ‹ Volver
            </button>

            <div className="flex items-center gap-2 mb-5 shrink-0">
              <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ background: "#e2ddd0" }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${((slideIndex + 1) / Math.max(slidesDelProfesionalActual.length, 1)) * 100}%`,
                    background: SAGE_DARK,
                  }}
                />
              </div>
              <span className="text-[10px] font-bold text-[#a8a8a8] tabular-nums">
                {slideIndex + 1}/{slidesDelProfesionalActual.length}
              </span>
            </div>

            {slideActual && (
              <div className="flex-1 flex flex-col">
                {(slideActual.tipo === "foto" || slideActual.tipo === "texto_foto") && (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: CLAY }}>
                      Conóceme
                    </p>
                    {slideActual.titulo && <p className="text-[18px] font-extrabold leading-tight mb-3">{slideActual.titulo}</p>}
                    <div className="w-full rounded-2xl overflow-hidden mb-3 shadow-sm" style={{ height: 190, background: SAGE_TINT }}>
                      {slideActual.fotoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={slideActual.fotoUrl} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    {slideActual.texto && <p className="text-[12.5px] text-[#686868] leading-relaxed">{slideActual.texto}</p>}
                  </>
                )}

                {slideActual.tipo === "video" && (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: CLAY }}>
                      Conóceme
                    </p>
                    <p className="text-[18px] font-extrabold leading-tight mb-3">{slideActual.titulo || "Un video mío"}</p>
                    <a
                      href={slideActual.videoUrl ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative w-full rounded-2xl overflow-hidden mb-3 shadow-sm flex items-center justify-center"
                      style={{ height: 190, background: `linear-gradient(150deg, #3d4a3a, ${SAGE_DARK})` }}
                    >
                      <span
                        className="absolute top-3 right-3 text-[9px] font-extrabold uppercase tracking-wide text-white px-2.5 py-1 rounded-full"
                        style={{ background: "rgba(0,0,0,.35)" }}
                      >
                        {plataformaVideo(slideActual.videoUrl ?? "")}
                      </span>
                      <span
                        className="flex items-center justify-center w-12 h-12 rounded-full bg-white/95 text-[18px] pl-0.5"
                        style={{ color: SAGE_DARK }}
                      >
                        ▶
                      </span>
                    </a>
                    <p className="text-[12.5px] text-[#686868] leading-relaxed">
                      {slideActual.videoTitulo || "Tocá para verlo — se abre en una pestaña nueva."}
                    </p>
                  </>
                )}

                {(slideActual.tipo === "logro" || slideActual.tipo === "como_trabajo") && (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: CLAY }}>
                      Conóceme
                    </p>
                    {slideActual.titulo && <p className="text-[18px] font-extrabold leading-tight mb-2">{slideActual.titulo}</p>}
                    {slideActual.texto && <p className="text-[13px] text-[#686868] leading-relaxed">{slideActual.texto}</p>}
                  </>
                )}

                {slideActual.tipo === "historia" && (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: CLAY }}>
                      Conóceme
                    </p>
                    <p className="text-[18px] font-extrabold leading-tight mb-3">Mi historia</p>
                    <div
                      className="relative w-full rounded-2xl overflow-hidden mb-4"
                      style={{ height: 100, background: "linear-gradient(140deg,#dccfa8,#c9b788)" }}
                    >
                      <span
                        className="absolute right-2 -bottom-6 text-[90px] leading-none italic"
                        style={{ color: "rgba(255,255,255,.55)", fontFamily: "Georgia, serif" }}
                      >
                        &rdquo;
                      </span>
                    </div>
                    <p className="text-[13px] leading-relaxed text-[#2d2d2d] first-letter:text-[34px] first-letter:font-extrabold first-letter:leading-[0.8] first-letter:float-left first-letter:pr-1.5 first-letter:pt-0.5 first-letter:text-[#646759]">
                      {profesionalActual.biografia_completa || "Todavía no cargó su historia."}
                    </p>
                  </>
                )}

                {slideActual.tipo === "fortalezas" && (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: CLAY }}>
                      Conóceme
                    </p>
                    <p className="text-[18px] font-extrabold leading-tight mb-0.5">Fortalezas</p>
                    <p className="text-[11.5px] font-semibold text-[#a8a8a8] mb-4">En qué se destaca</p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {fortalezasDelProfesionalActual.map((f) => (
                        <div
                          key={f.nombre}
                          className="flex flex-col items-center gap-2 text-center rounded-2xl border bg-white p-3.5"
                          style={{ borderColor: f.principal ? CLAY : "#e2ddd0" }}
                        >
                          <span
                            className="flex items-center justify-center w-9 h-9 rounded-full text-[15px]"
                            style={f.principal ? { background: "#f7ece1", color: CLAY } : { background: SAGE_TINT, color: SAGE_DARK }}
                          >
                            {f.principal ? "★" : "✓"}
                          </span>
                          <b className="text-[11.5px] leading-tight">{f.nombre}</b>
                          {f.principal && (
                            <span className="text-[8.5px] font-extrabold uppercase tracking-wide" style={{ color: CLAY }}>
                              Principal
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {slideActual.tipo === "formacion" && (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: CLAY }}>
                      Conóceme
                    </p>
                    <p className="text-[18px] font-extrabold leading-tight mb-4">Formación</p>
                    <div className="relative pl-5">
                      <div
                        className="wg-anim absolute left-[5px] top-1 bottom-1 w-[1.5px] origin-top"
                        style={{ background: SAGE_DARK, animation: "wgGrowLine 1.2s ease-out .1s forwards", transform: "scaleY(0)" }}
                      />
                      {formacionOrdenada.map((f, i) => (
                        <div
                          key={f.id_formacion}
                          className="wg-anim relative pb-4 last:pb-0"
                          style={{ opacity: 0, animation: `wgItemIn .5s ease-out ${0.15 + i * 0.35}s forwards` }}
                        >
                          <span
                            className="absolute -left-5 top-0.5 w-2.5 h-2.5 rounded-full bg-white"
                            style={{ border: `2px solid ${CLAY}` }}
                          />
                          <p className="text-[10px] font-extrabold tabular-nums mb-0.5" style={{ color: CLAY }}>
                            {f.anio ?? ""}
                          </p>
                          <p className="text-[12.5px] font-bold leading-tight">{f.titulo}</p>
                          <p className="text-[11px] text-[#a8a8a8]">{f.institucion}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {slideActual.tipo === "trayectoria" && (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: CLAY }}>
                      Conóceme
                    </p>
                    <p className="text-[18px] font-extrabold leading-tight mb-4">Trayectoria</p>
                    <div className="relative pl-5">
                      <div
                        className="wg-anim absolute left-[5px] top-1 bottom-1 w-[1.5px] origin-top"
                        style={{ background: SAGE_DARK, animation: "wgGrowLine 1.2s ease-out .1s forwards", transform: "scaleY(0)" }}
                      />
                      {trayectoriaOrdenada.map((t, i) => (
                        <div
                          key={t.id_trayectoria}
                          className="wg-anim relative pb-4 last:pb-0"
                          style={{ opacity: 0, animation: `wgItemIn .5s ease-out ${0.15 + i * 0.35}s forwards` }}
                        >
                          <span
                            className="absolute -left-5 top-0.5 w-2.5 h-2.5 rounded-full bg-white"
                            style={{ border: `2px solid ${SAGE_DARK}` }}
                          />
                          <p className="text-[10px] font-extrabold tabular-nums mb-0.5" style={{ color: SAGE_DARK }}>
                            {[t.anio_desde, "—", t.anio_hasta ?? "Actualidad"].filter(Boolean).join(" ")}
                          </p>
                          <p className="text-[12.5px] font-bold leading-tight">{t.titulo}</p>
                          <p className="text-[11px] text-[#a8a8a8]">{t.lugar}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex justify-between mt-4">
              <button
                onClick={atrasSlide}
                disabled={slideIndex === 0}
                className="text-[13px] font-bold disabled:opacity-30 px-3 py-2"
                style={{ color: SAGE_DARK }}
              >
                ‹ atrás
              </button>
              <button
                onClick={siguienteSlide}
                disabled={slideIndex === slidesDelProfesionalActual.length - 1}
                className="text-[13px] font-bold disabled:opacity-30 px-3 py-2"
                style={{ color: SAGE_DARK }}
              >
                Siguiente ›
              </button>
            </div>
          </div>
        </div>
      )}

      {idleWarning && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 px-8"
          style={{ background: "rgba(45,45,45,.88)" }}
        >
          <div
            className="flex items-center justify-center w-[74px] h-[74px] rounded-full border-4 text-white text-[20px] font-extrabold"
            style={{ borderColor: "rgba(255,255,255,.25)", borderTopColor: "#fff" }}
          >
            {idleCountdown}
          </div>
          <h4 className="text-white text-[16px] font-extrabold text-center">¿Seguís ahí?</h4>
          <p className="text-white/75 text-[12px] text-center leading-relaxed max-w-[220px]">
            Si no tocás la pantalla, en unos segundos volvemos al inicio para el próximo cliente.
          </p>
          <button
            onClick={reiniciarInactividad}
            className="mt-1 text-[#2d2d2d] text-[12.5px] font-extrabold px-6 py-2.5 rounded-full bg-white"
          >
            Seguir acá
          </button>
        </div>
      )}

      {productoAbierto &&
        (() => {
          const p = productos.find((x) => x.id_producto === productoAbierto);
          if (!p) return null;
          return (
            <ProductoDetalleModal
              key={p.id_producto}
              producto={p}
              marca={marcaPorId[p.id_marca]}
              ficha={fichaPorProducto[p.id_producto] ?? null}
              variantes={variantesPorProducto[p.id_producto] ?? []}
              idioma={idioma}
              onClose={() => setProductoAbierto(null)}
              gondola={gondola}
              ubicacion={ubicacionDe(gondola, p.id_producto)}
              sinStock={agotados.has(p.id_producto) ? textoSinStock : null}
            />
          );
        })()}

      <p className="sr-only">Local: {local.nombre}</p>
    </div>
  );
}

function ProductoDetalleModal({
  producto,
  marca,
  ficha,
  variantes,
  idioma,
  onClose,
  gondola,
  ubicacion,
  sinStock = null,
}: {
  producto: ProductoPublico;
  marca: MarcaPublica | undefined;
  ficha: FichaProducto | null;
  variantes: VarianteProductoPublica[];
  idioma: Idioma;
  onClose: () => void;
  gondola: ModuloGondola[];
  ubicacion: UbicacionGondola | null;
  /** En 0 en el local: en vez de «¿Dónde lo encuentro?» dice que no hay. */
  sinStock?: string | null;
}) {
  const [verDonde, setVerDonde] = useState(false);
  const fotos = [producto.imagen, ficha?.foto_extra_1, ficha?.foto_extra_2, ficha?.foto_extra_3].filter(
    (f): f is string => Boolean(f)
  );
  const [fotoActiva, setFotoActiva] = useState<string | null>(fotos[0] ?? null);
  const [abierto, setAbierto] = useState(false);
  const [ingredientesAbierto, setIngredientesAbierto] = useState(false);
  const [micronutrientesAbierto, setMicronutrientesAbierto] = useState(false);
  const [saborActivo, setSaborActivo] = useState<string | null>(null);
  const [descAbierta, setDescAbierta] = useState(false);
  const nombreVisible = traducir(idioma, producto.nombre, producto.nombre_en, producto.nombre_pt);
  const descripcionVisible = ficha?.descripcion_publica
    ? traducir(idioma, ficha.descripcion_publica, ficha.descripcion_publica_en, ficha.descripcion_publica_pt)
    : null;

  // Todo producto tiene al menos una variante; cuando no viene en sabores esa
  // única se llama "Único" y mostrarla como opción sería ruido.
  const sabores =
    variantes.length === 1 && /^\s*(único|unico)\s*$/i.test(variantes[0].nombre) ? [] : variantes;

  // El anillo se dibuja solo al abrir — arranca en 0% y un instante después
  // pasa al valor final, la transición CSS de --p hace el resto.
  useEffect(() => {
    const id = requestAnimationFrame(() => setAbierto(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const macros = [
    { label: "Proteínas", valor: ficha?.proteinas ?? null },
    { label: "Carbohidratos", valor: ficha?.carbohidratos ?? null },
    { label: "Grasas", valor: ficha?.grasas ?? null },
    { label: "Fibra", valor: ficha?.fibra ?? null },
    { label: "Sodio", valor: ficha?.sodio ?? null },
  ].filter((m): m is { label: string; valor: number } => m.valor !== null);

  const precios = ambosPrecios(producto, null);

  const hayKcal = ficha?.kcal_100g !== null && ficha?.kcal_100g !== undefined;
  // Si el producto no tiene nada de información nutricional cargada, la hoja
  // derecha quedaría en blanco: en ese caso se abre de una sola hoja.
  const hayNutricional =
    hayKcal ||
    macros.length > 0 ||
    Boolean(ficha?.ingredientes) ||
    Boolean(ficha?.micronutrientes) ||
    Boolean(ficha?.porcion) ||
    Boolean(ficha?.video);

  const tituloNutricional =
    idioma === "en"
      ? "Nutrition facts · per 100 g"
      : idioma === "pt"
        ? "Informação nutricional · a cada 100 g"
        : "Información nutricional · cada 100 g";

  /**
   * Qué es y cuánto sale: marca, nombre, los dos precios, sabores y la
   * explicación.
   *
   * Va en una hoja o en la otra según el producto. Cuando hay información
   * nutricional, acompaña a la foto en la hoja izquierda y la derecha queda
   * entera para los números — así el libro se lee como un libro: a la
   * izquierda qué es, a la derecha qué tiene. Cuando no hay nutricional, la
   * hoja derecha quedaría vacía, así que este bloque la ocupa él.
   */
  const bloqueIdentidad = (
    <div
      className="px-6 pt-5 pb-6 flex flex-col gap-4"
      style={{
        opacity: abierto ? 1 : 0,
        transform: abierto ? "translateY(0)" : "translateY(10px)",
        transition: "all .5s ease .15s",
      }}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          {marca && (
            <p className="text-[10.5px] font-extrabold uppercase tracking-[.2em]" style={{ color: "#4d7635" }}>
              {marca.nombre}
            </p>
          )}
          {ficha?.clasificacion && (
            <span
              className="shrink-0 text-[9px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full"
              style={{ background: SAGE_TINT, color: SAGE_DARK }}
            >
              {ficha.clasificacion === "NATURAL" ? "🌿 " : ""}
              {ficha.clasificacion}
            </span>
          )}
        </div>
        {/* Con nombres largos («CREATINA 300gr FRUTOS ROJOS MONOHIDRATADA…») la letra
            se achica, así entra todo sin empujar la descripción fuera de la ficha (2026-11-05). */}
        <h3
          className={`${titular.className} font-extrabold tracking-[-.02em] leading-tight mt-1 ${
            nombreVisible.length > 60 ? "text-[19px] md:text-[22px]" : nombreVisible.length > 36 ? "text-[22px] md:text-[26px]" : "text-[26px] md:text-[32px]"
          }`}
        >
          {nombreVisible}
        </h3>
        <div className="mt-2.5 flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2.5">
            <span
              className={`${titular.className} text-[24px] md:text-[28px] font-semibold`}
              style={{ color: (producto.descuento_porcentaje ?? 0) > 0 ? C3 : "#2d2d2d" }}
            >
              {formatoPrecio(precios.lista)}
            </span>
            {(producto.descuento_porcentaje ?? 0) > 0 && (
              <span className="text-[15px] text-[#a8a8a8] line-through">
                {formatoPrecio(producto.precio_venta)}
              </span>
            )}
          </div>

          {/* El precio de efectivo es un argumento de venta, no un detalle: va
              con el ahorro en pesos al lado, que es lo que termina de
              convencer. */}
          {precios.ahorro !== null && (
            <div className="flex flex-col rounded-xl px-3 py-2" style={{ background: "#eaf3dc" }}>
              <span
                className="text-[9px] font-extrabold uppercase tracking-[.16em]"
                style={{ color: "#6e8f52" }}
              >
                {idioma === "en" ? "Paying cash" : idioma === "pt" ? "Pagando em dinheiro" : "Pagando en efectivo"}
              </span>
              <div className="flex items-baseline gap-2">
                <span
                  className={`${titular.className} text-[20px] md:text-[23px] font-semibold leading-tight`}
                  style={{ color: "#3d6b28" }}
                >
                  {formatoPrecio(precios.efectivo)}
                </span>
                <span className="text-[11.5px] font-bold" style={{ color: "#6e8f52" }}>
                  −{formatoPrecio(precios.ahorro)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Agotado: no tiene sentido mandarlo a buscarlo a la góndola. */}
      {sinStock && (
        <div className="self-stretch rounded-[18px] px-4 py-3.5 text-center text-[17px] md:text-[19px] font-extrabold text-white" style={{ background: "#22301f" }}>
          {sinStock} {idioma === "en" ? "for now" : idioma === "pt" ? "por enquanto" : "por ahora"}
        </div>
      )}

      {/* Dónde está en el local: abre la góndola en 3D con el lugar marcado. */}
      {ubicacion && !sinStock && (
        <button
          type="button"
          onClick={() => setVerDonde(true)}
          // En dos renglones y siempre adentro del botón: con «Estantería Animalfit» en el
          // mismo renglón se salía del recuadro (Gonzalo, 2026-11-05).
          className="self-stretch flex flex-col items-center justify-center min-w-0 overflow-hidden rounded-[18px] px-4 py-3.5 text-center text-[17px] md:text-[19px] font-extrabold leading-tight text-white transition-transform active:scale-[.98]"
          style={{ background: "#e8743b", boxShadow: "0 16px 30px -16px rgba(232,116,59,.9)" }}
        >
          <span className="max-w-full">
            <span aria-hidden="true">📍 </span>
            {idioma === "en" ? "Where do I find it?" : idioma === "pt" ? "Onde encontro?" : "¿Dónde lo encuentro?"}
          </span>
          <span className="mt-1.5 max-w-full truncate rounded-full bg-white/25 px-3 py-0.5 text-[12.5px] font-bold">
            {ubicacion.modulo.tipo === "ISLA"
              ? `${idioma === "en" ? "Island" : idioma === "pt" ? "Ilha" : "Isla"} ${ubicacion.modulo.numero ?? ""}`
              : ubicacion.modulo.tipo === "ESTANTERIA"
                ? ubicacion.modulo.titulo
                : ubicacion.modulo.tipo === "FREEZER"
                  ? `Freezer ${ubicacion.modulo.numero ?? ""}`.trim()
                  : `${idioma === "en" ? "Shelf" : idioma === "pt" ? "Móvel" : "Mueble"} ${gondola.filter((m) => m.tipo === "MODULO").indexOf(ubicacion.modulo) + 1}`}
          </span>
        </button>
      )}

      {sabores.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[#98a08b]">
            {idioma === "en" ? "Flavours" : "Sabores"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sabores.map((v) => {
              const activo = v.id_variante === saborActivo;
              return (
                <button
                  key={v.id_variante}
                  onClick={() => setSaborActivo(activo ? null : v.id_variante)}
                  className="text-[12.5px] px-3.5 py-2 rounded-full border transition-colors"
                  style={{
                    background: activo ? SAGE_DARK : "#fff",
                    borderColor: activo ? SAGE_DARK : "#dcdfd4",
                    color: activo ? "#fff" : "#4a4f43",
                    fontWeight: activo ? 700 : 500,
                  }}
                >
                  {v.nombre}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Larga, se muestra en 3 renglones con «Ver más»: entera se cortaba abajo de la ficha. */}
      {descripcionVisible && (
        <div>
          <p
            className="text-[14px] leading-relaxed text-[#686868]"
            style={
              descripcionVisible.length > 170 && !descAbierta
                ? { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }
                : undefined
            }
          >
            {descripcionVisible}
          </p>
          {descripcionVisible.length > 170 && (
            <button type="button" onClick={() => setDescAbierta((v) => !v)} className="mt-1 text-[12.5px] font-extrabold" style={{ color: SAGE_DARK }}>
              {descAbierta ? (idioma === "en" ? "Show less" : idioma === "pt" ? "Ver menos" : "Ver menos") : idioma === "en" ? "Read more" : idioma === "pt" ? "Ver mais" : "Ver más"}
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: "rgba(20,17,13,.55)" }}
      onClick={onClose}
    >
      {/* Se abre como un libro: la foto a la izquierda y todo lo que se lee a la
          derecha. Siempre en dos hojas, aunque el producto no tenga información
          nutricional: apilado en una sola columna el precio y los sabores
          quedaban abajo de todo y se cortaban. En celular sí se apilan. */}
      <div
        className={`relative w-full rounded-t-3xl sm:rounded-3xl overflow-hidden max-h-[94vh] sm:max-h-[88vh] grid md:grid-cols-2 ${
          hayNutricional ? "sm:max-w-5xl" : "sm:max-w-3xl"
        }`}
        style={{
          background: "#fff",
          transform: abierto ? "translateY(0)" : "translateY(24px)",
          transition: "transform .4s cubic-bezier(.2,.8,.2,1)",
          boxShadow: "0 40px 80px -40px rgba(20,28,14,.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3.5 right-3.5 z-20 w-9 h-9 rounded-full text-white font-bold flex items-center justify-center"
          // Sin `backdrop-filter`: copiar y desenfocar lo que hay detrás en cada
          // cuadro es de lo más caro que hay en Android. Un fondo sólido se ve
          // igual y no cuesta nada.
          style={{ background: "rgba(20,17,13,.72)" }}
        >
          ✕
        </button>

        {verDonde && ubicacion && (
          <ViajeGondola
            gondola={gondola}
            ubicacion={ubicacion}
            nombre={traducir(idioma, producto.nombre, producto.nombre_en, producto.nombre_pt)}
            imagen={producto.imagen}
            idioma={idioma}
            onVolver={() => setVerDonde(false)}
          />
        )}

        {/* ---------- hoja izquierda: la foto ---------- */}
        <div className="bg-white overflow-y-auto flex flex-col min-h-0">
          {/* pb-5: sin aire abajo, el recuadro crema de la foto quedaba pegado
              al borde de la ficha y parecía salirse del marco (Joog, 2026-11-11). */}
          <div className="relative bg-white px-5 pt-5 pb-5">
            {/* Techo al alto de la foto: si crece libre empuja el precio fuera
                de la ficha y hay que buscarlo deslizando. */}
            {/* El producto flota (vista previa aprobada el 2026-11-02): se
                mece en el aire con una sombra que respira abajo. El centro
                del fondo es blanco para que las fotos, que vienen sobre
                blanco, no se vean como un cuadrado pegado. La sombra es un
                degradé y no un desenfoque: en la placa de la all-in-one el
                desenfoque cuesta carísimo. */}
            <div
              // Con la información nutricional a la derecha, abajo de la foto van nombre,
              // precios, sabores y descripción: la foto más baja deja que entre todo sin cortarse (2026-11-05).
              className={`relative w-full aspect-square max-h-[30vh] flex items-center justify-center rounded-[26px] overflow-hidden ${
                hayNutricional ? (sabores.length > 0 ? "md:max-h-[30vh]" : "md:max-h-[36vh]") : "md:max-h-[46vh]"
              }`}
              // Quieto: el fondo aparece de una en su tamaño final (Gonzalo,
              // 2026-11-03: no quiere que arranque chico y crezca). Lo único
              // que se mueve es el producto flotando.
              style={{
                background: "radial-gradient(circle at 50% 44%, #ffffff 0%, #ffffff 38%, #fbeee0 70%, #f3d9bd 100%)",
                perspective: 900,
              }}
            >
              <span
                className="absolute left-1/2 bottom-[7%] w-[46%] h-[7%] -ml-[23%] rounded-[50%] pointer-events-none"
                style={{
                  background: "radial-gradient(ellipse at center, rgba(90,50,15,.32) 0%, rgba(90,50,15,0) 70%)",
                  animation: "asesorSombraFlotar 5s ease-in-out infinite",
                }}
                aria-hidden
              />
              <div
                className="relative w-[78%] h-[78%] flex items-center justify-center"
                style={{ animation: "asesorProductoFlotar 5s ease-in-out infinite", willChange: "transform" }}
              >
                {fotoActiva ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fotoActiva} alt="" className="w-full h-full object-contain" />
                ) : (
                  <SinFoto producto={producto} logoMarca={marca?.logo ?? null} bolsita={esMarcaWiigo(marca)} />
                )}
              </div>
            </div>
            {ficha?.origen && (
              <span
                className="absolute top-4 left-5 text-white text-[10.5px] font-medium px-3 py-1.5 rounded-full"
                style={{ background: "rgba(20,17,13,.72)" }}
              >
                📍 {traducir(idioma, ficha.origen, ficha.origen_en, ficha.origen_pt)}
              </span>
            )}
          </div>

          {fotos.length > 1 && (
            <div className="flex gap-2 px-5 py-3 justify-center">
              {fotos.map((f) => (
                <button
                  key={f}
                  onClick={() => setFotoActiva(f)}
                  className="w-12 h-12 rounded-lg overflow-hidden border-2 shrink-0 bg-white"
                  style={{ borderColor: f === fotoActiva ? SAGE_DARK : "#e5e5e5" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f} alt="" className="w-full h-full object-contain" />
                </button>
              ))}
            </div>
          )}

          {hayNutricional && bloqueIdentidad}
        </div>

        {/* ---------- hoja derecha: todo lo que se lee ---------- */}
        <div
          className="overflow-y-auto min-h-0 flex flex-col border-t md:border-t-0 md:border-l border-[#e8eade]"
          style={{ background: hayNutricional ? "#f7f9f2" : "#fff" }}
        >
          {!hayNutricional && bloqueIdentidad}

          {hayNutricional && (
            <div
              className="px-6 pt-5 pb-6 flex flex-col gap-4"
              style={{ opacity: abierto ? 1 : 0, transition: "opacity .5s ease .25s" }}
            >
            {/* Kcal que suben y tarjetas que giran (opción C, Gonzalo 2026-11-05). */}
            {ficha && (hayKcal || macros.length > 0) ? (
              <NutricionAsesor ficha={ficha} idioma={idioma} claseTitular={titular.className} />
            ) : (
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[#8a9180]">
                {tituloNutricional}
              </p>
            )}

            {ficha?.porcion && (
              <span
                className="self-start text-[11px] font-bold px-3 py-1.5 rounded-full"
                style={{ background: "#fff", color: SAGE_DARK }}
              >
                {idioma === "en" ? "Suggested serving" : idioma === "pt" ? "Porção sugerida" : "Porción sugerida"}:{" "}
                {traducir(idioma, ficha.porcion, ficha.porcion_en, ficha.porcion_pt)}
              </span>
            )}

            {ficha?.ingredientes && (
              <div className="border-t border-[#dfe3d6]">
                <button
                  onClick={() => setIngredientesAbierto((v) => !v)}
                  className="w-full flex items-center justify-between py-3.5"
                >
                  <span className="text-[13.5px] font-bold">
                    {idioma === "en" ? "Ingredients" : "Ingredientes"}
                  </span>
                  <span
                    className="text-[#8a9180]"
                    style={{
                      transition: "transform .3s ease",
                      transform: ingredientesAbierto ? "rotate(180deg)" : "none",
                    }}
                  >
                    ⌄
                  </span>
                </button>
                <div
                  className="overflow-hidden"
                  style={{ maxHeight: ingredientesAbierto ? 200 : 0, transition: "max-height .35s ease" }}
                >
                  <p className="text-[13px] leading-relaxed text-[#3d3d3d] pb-3.5">
                    {traducir(idioma, ficha.ingredientes, ficha.ingredientes_en, ficha.ingredientes_pt)}
                  </p>
                </div>
              </div>
            )}

            {ficha?.micronutrientes && (
              <div className="border-t border-[#dfe3d6]">
                <button
                  onClick={() => setMicronutrientesAbierto((v) => !v)}
                  className="w-full flex items-center justify-between py-3.5"
                >
                  <span className="text-[13.5px] font-bold">
                    {idioma === "en" ? "Micronutrients" : "Micronutrientes"}
                  </span>
                  <span
                    className="text-[#8a9180]"
                    style={{
                      transition: "transform .3s ease",
                      transform: micronutrientesAbierto ? "rotate(180deg)" : "none",
                    }}
                  >
                    ⌄
                  </span>
                </button>
                <div
                  className="overflow-hidden"
                  style={{ maxHeight: micronutrientesAbierto ? 200 : 0, transition: "max-height .35s ease" }}
                >
                  <p className="text-[13px] leading-relaxed text-[#3d3d3d] pb-3.5">
                    {traducir(idioma, ficha.micronutrientes, ficha.micronutrientes_en, ficha.micronutrientes_pt)}
                  </p>
                </div>
              </div>
            )}

              {ficha?.video && (
                <a
                  href={ficha.video}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12.5px] font-bold underline self-start"
                  style={{ color: SAGE_DARK }}
                >
                  Ver video ↗
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
