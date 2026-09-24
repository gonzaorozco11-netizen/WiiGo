"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ambosPrecios } from "@/lib/precios";
import { Fredoka, Bodoni_Moda } from "next/font/google";
import type {
  Local,
  MarcaPublica,
  ProductoPublico,
  VarianteProductoPublica,
  Objetivo,
  FiltroProducto,
  FichaProducto,
  Subcategoria,
  Profesional,
  ConocemeSlide,
  FormacionProfesional,
  TrayectoriaProfesional,
} from "@/lib/supabase";

type Pantalla = "home" | "objetivo" | "resultado" | "marcas" | "ofertas" | "profesionales" | "fichaProfesional" | "conoceme" | "reservarTurno";

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

/** Vuelta completa del anillo de kcal (2πr con r = 59). */
const ANILLO_LARGO = 2 * Math.PI * 59;

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

const TEMAS: Record<string, Tema> = {
  objetivo: { fondo: "#eef3e6", acento: "#4d7635", barra: "#1e2a18", barraAcento: "#cfe8a6" },
  resultado: { fondo: "#eef3e6", acento: "#4d7635", barra: "#1e2a18", barraAcento: "#cfe8a6" },
  marcas: { fondo: "#f8f1e7", acento: "#8d5726", barra: "#2b2419", barraAcento: "#e0a259" },
  ofertas: { fondo: "#faeee8", acento: "#96492b", barra: "#2e1c14", barraAcento: "#e59a72" },
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

// Los objetivos los carga Gonzalo desde el sistema y pueden ser cualquier
// cantidad, así que el color sale de esta rueda por posición y no de un nombre
// fijo: si mañana agrega uno, se pinta solo.
const TONOS_OBJETIVO = [
  "linear-gradient(145deg, #4d7635, #375526)",
  "linear-gradient(145deg, #c08a3e, #9a6a29)",
  "linear-gradient(145deg, #3f7d80, #2c5c5f)",
  "linear-gradient(145deg, #3d4a7a, #2a3357)",
  "linear-gradient(145deg, #b0643f, #8a4a2c)",
  "linear-gradient(145deg, #6e7f3a, #535f28)",
  "linear-gradient(145deg, #5a4a78, #372c4d)",
  "linear-gradient(145deg, #2f6b52, #1f4a38)",
];

// Solo para la ficha ampliada de producto (ProductoDetalleModal) — el resto
// del Asesor sigue con Manrope (ver app/asesor/layout.tsx).
const fredoka = Fredoka({ subsets: ["latin"], weight: ["500", "600", "700"] });
const bodoniModa = Bodoni_Moda({ subsets: ["latin"], style: ["italic"], weight: ["500", "600"] });

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
    pregunta: "¿Qué estás buscando hoy?",
    ctaObjetivo: "Encontrar<br />productos para mí",
    ctaMarcas: "Marcas y<br />productos",
    ctaOfertas: "Ofertas en<br />la tienda",
    ctaProfesionales: "Profesionales",
    objetivoTitulo: "¿Cuál es tu objetivo hoy?",
    resultadoTitulo: "Te recomendamos",
    ctaEyebrow: "Recomendado",
    ctaDescripcion: "Contanos qué buscás y te mostramos lo que mejor te queda",
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
    descMarcas: "Mirá las marcas que están en la tienda y todo lo que traen",
    descOfertas: "Los combos y descuentos que hay hoy en el local",
    descProfesionales: "Conocelos y sacá tu turno desde acá",
    railRubro: "Rubro",
    railSin: "Preferencias",
    railObjetivo: "Objetivo",
    otros: "Otros",
    profesionalesTitulo: "Nuestros profesionales",
    profesionalesSub: "Conocelos y pedí tu turno presencial o por videollamada",
    profesionalesVacio: "Todavía no hay profesionales cargados acá.",
    verFicha: "Ver más",
  },
  en: {
    pregunta: "What are you looking for today?",
    ctaObjetivo: "Find<br />products for me",
    ctaMarcas: "Brands &<br />products",
    ctaOfertas: "Offers in<br />the store",
    ctaProfesionales: "Professionals",
    objetivoTitulo: "What's your goal today?",
    resultadoTitulo: "We recommend",
    ctaEyebrow: "Recommended",
    ctaDescripcion: "Tell us what you need and we'll show you what fits best",
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
    descMarcas: "See the brands in the store and everything they carry",
    descOfertas: "The combos and discounts available today in store",
    descProfesionales: "Meet them and book your appointment right here",
    railRubro: "Category",
    railSin: "Preferences",
    railObjetivo: "Goal",
    otros: "Other",
    profesionalesTitulo: "Our professionals",
    profesionalesSub: "Meet them and book in person or by video call",
    profesionalesVacio: "No professionals loaded here yet.",
    verFicha: "See more",
  },
  pt: {
    pregunta: "O que você está procurando hoje?",
    ctaObjetivo: "Encontrar<br />produtos pra mim",
    ctaMarcas: "Marcas e<br />produtos",
    ctaOfertas: "Ofertas<br />da loja",
    ctaProfesionales: "Profissionais",
    objetivoTitulo: "Qual é o seu objetivo hoje?",
    resultadoTitulo: "Recomendamos",
    ctaEyebrow: "Recomendado",
    ctaDescripcion: "Conte o que você precisa e mostramos o que combina com você",
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
    descMarcas: "Veja as marcas da loja e tudo o que elas trazem",
    descOfertas: "Os combos e descontos de hoje na loja",
    descProfesionales: "Conheça-os e marque seu horário aqui",
    railRubro: "Categoria",
    railSin: "Preferências",
    railObjetivo: "Objetivo",
    otros: "Outros",
    profesionalesTitulo: "Nossos profissionais",
    profesionalesSub: "Conheça-os e marque presencial ou por videochamada",
    profesionalesVacio: "Ainda não há profissionais cadastrados aqui.",
    verFicha: "Ver mais",
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
function IconoPersona({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="7.8" r="3.3" />
      <path d="M5.3 20c0-3.7 3-6.2 6.7-6.2s6.7 2.5 6.7 6.2" />
    </svg>
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

/**
 * Una de las cuatro puertas de la pantalla principal. Todas del mismo tamaño
 * a propósito: el que ya sabe qué quiere no tiene que pasar por la primera.
 */
function Puerta({
  onClick,
  fondo,
  icono,
  titulo,
  descripcion,
  destacada,
}: {
  onClick: () => void;
  fondo: string;
  icono: React.ReactNode;
  /** Puede traer <br /> desde los textos traducidos. */
  titulo: string;
  descripcion: string;
  destacada?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="relative overflow-hidden rounded-3xl p-5 md:p-6 text-left text-white flex flex-col gap-3 min-h-[148px] md:min-h-[190px] transition-transform active:scale-[.98]"
      style={{ background: fondo, boxShadow: "0 18px 34px -22px rgba(20,28,14,.6)" }}
    >
      <span
        className="absolute rounded-full pointer-events-none"
        style={{ width: 130, height: 130, right: -34, bottom: -48, background: "rgba(255,255,255,.09)" }}
      />
      {destacada && (
        <span
          className="absolute top-3.5 right-3.5 text-[8.5px] md:text-[9.5px] font-extrabold uppercase tracking-[.14em] px-2.5 py-1 rounded-full"
          style={{ background: "rgba(255,255,255,.22)" }}
        >
          {destacada}
        </span>
      )}
      <span
        className="relative grid place-items-center rounded-full w-11 h-11 md:w-14 md:h-14 shrink-0"
        style={{ background: "rgba(255,255,255,.18)" }}
      >
        {icono}
      </span>
      <span
        className="relative text-[16px] md:text-[20px] font-extrabold leading-tight"
        dangerouslySetInnerHTML={{ __html: titulo }}
      />
      <span className="relative text-[11px] md:text-[12.5px] leading-snug opacity-80 mt-auto">{descripcion}</span>
    </button>
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
  return (
    <div className="flex items-center justify-between px-5 pt-5 shrink-0">
      <button
        onClick={onVolver}
        className="rounded-full border border-[#d8d8d8] bg-white px-3 py-2 text-[13px] font-bold text-[#686868]"
      >
        ← {volverTxt}
      </button>
      <button
        onClick={onInicio}
        className="rounded-full border border-[#d8d8d8] bg-white px-3 py-2 text-[13px] font-bold text-[#686868]"
      >
        ⌂ {inicioTxt}
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
    <div className="mt-0.5 flex flex-col gap-0.5">
      <span className={`${fredoka.className} text-[13.5px] font-semibold leading-none`}>
        {formatoPrecio(lista)}
      </span>
      {ahorro !== null && (
        <span
          className="self-start inline-flex items-baseline gap-1 rounded px-1.5 py-0.5"
          style={{ background: "#eaf3dc" }}
        >
          <span className="text-[7.5px] font-extrabold uppercase tracking-[.1em]" style={{ color: "#6e8f52" }}>
            Efectivo
          </span>
          <span className={`${fredoka.className} text-[11px] font-semibold`} style={{ color: "#3d6b28" }}>
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
function TarjetaResultado({
  producto,
  marca,
  etiqueta,
  nombre,
  onClick,
  compacta = false,
}: {
  producto: ProductoPublico;
  marca: MarcaPublica | undefined;
  etiqueta: string;
  nombre: string;
  onClick: () => void;
  compacta?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl bg-white overflow-hidden shadow-sm flex flex-col cursor-pointer ${
        compacta ? "w-[146px] shrink-0" : ""
      }`}
    >
      <div
        // La foto es lo que vende: en una pantalla táctil de 27" 88px de alto
        // es una miniatura, no un producto. Crece con el ancho disponible.
        className={`relative flex items-center justify-center ${compacta ? "h-[104px] lg:h-[132px]" : "h-[88px] lg:h-[124px] xl:h-[150px]"} ${
          producto.imagen ? "bg-white" : "bg-gradient-to-br from-[#f0f2ec] to-[#d8d8d8]"
        }`}
      >
        {marca && (
          <span
            className="absolute top-1.5 left-1.5 text-[7.5px] font-extrabold uppercase tracking-wide bg-white/85 px-1.5 py-0.5 rounded-full"
            style={{ color: "var(--acento, #4d7635)" }}
          >
            {marca.nombre}
          </span>
        )}
        {producto.imagen ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={producto.imagen} alt="" className="w-full h-full object-contain p-1" />
        ) : (
          <span style={{ color: SAGE_DARK }}>
            <IconoBolsa className="w-6 h-6" />
          </span>
        )}
      </div>
      <div className="p-2.5 flex flex-col gap-1">
        <p className="text-[12px] font-bold leading-tight line-clamp-2">{nombre}</p>
        {etiqueta && !compacta && (
          <span
            className="self-start text-[8px] font-extrabold px-2 py-0.5 rounded-full"
            style={{ background: "#cfe8a6", color: "#3d5c2a" }}
          >
            {etiqueta}
          </span>
        )}
        <PrecioTarjeta producto={producto} />
      </div>
    </div>
  );
}

/**
 * Una de las formas difusas que se mueven de fondo en la principal.
 *
 * `willChange: transform` le pide al navegador que le dé su propia capa en la
 * placa de video: así se mueve sin que nada se repinte.
 */
function Mancha({ estilo }: { estilo: React.CSSProperties }) {
  return (
    <div
      className="absolute rounded-full pointer-events-none"
      style={{ willChange: "transform", ...estilo }}
      aria-hidden
    />
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
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 shrink-0 w-[86px] md:w-[116px]">
      <span
        // El aro gris tenue en las no elegidas evita que un logo con fondo
        // blanco se funda con la barra y parezca que falta.
        className="rounded-full overflow-hidden grid place-items-center w-16 h-16 md:w-[92px] md:h-[92px] border-[3px] transition-all"
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
      className="flex items-center gap-2.5 py-2 px-2.5 text-left w-full rounded-lg transition-colors"
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
        className="text-[12.5px] md:text-[13.5px] leading-tight flex-1"
        style={{ fontWeight: activo ? 800 : 600 }}
      >
        {nombre}
      </span>
      {cantidad !== undefined && (
        <span
          className="text-[11px] tabular-nums font-semibold shrink-0"
          style={{ opacity: activo ? 0.62 : 0.45 }}
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
  fortalezasPorProfesional,
  objetivosPorProfesional,
  conocemePorProfesional,
  formacionPorProfesional,
  trayectoriaPorProfesional,
  objetivos,
  filtros,
  fichaPorProducto,
  objetivosPorProducto,
  filtrosPorProducto,
}: {
  local: Local;
  marcas: MarcaPublica[];
  productos: ProductoPublico[];
  variantesPorProducto: Record<string, VarianteProductoPublica[]>;
  subcategorias: Subcategoria[];
  profesionales: Profesional[];
  fortalezasPorProfesional: Record<string, { nombre: string; principal: boolean }[]>;
  objetivosPorProfesional: Record<string, string[]>;
  conocemePorProfesional: Record<string, ConocemeSlide[]>;
  formacionPorProfesional: Record<string, FormacionProfesional[]>;
  trayectoriaPorProfesional: Record<string, TrayectoriaProfesional[]>;
  objetivos: Objetivo[];
  filtros: FiltroProducto[];
  fichaPorProducto: Record<string, FichaProducto>;
  objetivosPorProducto: Record<string, string[]>;
  filtrosPorProducto: Record<string, string[]>;
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
  const [selectorIdiomaAbierto, setSelectorIdiomaAbierto] = useState(false);
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

  const subcategoriasDeMarca = useMemo(() => {
    if (!marcaId) return [];
    return subcategorias
      .filter((s) => s.id_marca === marcaId)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [subcategorias, marcaId]);

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

  /** El rubro que queda elegido al entrar a una marca: el primero que tenga. */
  function primerRubroDe(idMarca: string): string | null {
    const suyas = subcategorias
      .filter((s) => s.id_marca === idMarca)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (suyas.length > 0) return suyas[0].id_subcategoria;
    return productos.some((p) => p.id_marca === idMarca && !p.id_subcategoria) ? SIN_RUBRO : null;
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

  const profesionalesFiltrados = useMemo(() => {
    if (!categoriaProf) return profesionales;
    return profesionales.filter((p) => p.categoria === categoriaProf);
  }, [profesionales, categoriaProf]);

  const profesionalActual = profesionalId ? profesionales.find((p) => p.id_profesional === profesionalId) ?? null : null;

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
  const trayectoriaOrdenada = useMemo(
    () => [...trayectoriaDelProfesionalActual].sort((a, b) => (a.anio_desde ?? 0) - (b.anio_desde ?? 0)),
    [trayectoriaDelProfesionalActual]
  );

  function siguienteSlide() {
    setSlideIndex((i) => Math.min(i + 1, slidesDelProfesionalActual.length - 1));
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
    setProfesionalId(id);
    setMostrarComoAyuda(false);
    setPantalla("fichaProfesional");
  }

  function irAConoceme() {
    setSlideIndex(0);
    setPantalla("conoceme");
  }

  function irAReservarTurno() {
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

  const productosFiltrados = useMemo(
    () =>
      marcaResultado
        ? productosSinFiltroMarca.filter((p) => p.id_marca === marcaResultado)
        : productosSinFiltroMarca,
    [productosSinFiltroMarca, marcaResultado]
  );

  const conteoPorMarca = useMemo(() => {
    const conteo: Record<string, number> = {};
    for (const p of productosSinFiltroMarca) conteo[p.id_marca] = (conteo[p.id_marca] ?? 0) + 1;
    return conteo;
  }, [productosSinFiltroMarca]);

  const marcasConResultados = useMemo(
    () => marcas.filter((m) => (conteoPorMarca[m.id_marca] ?? 0) > 0),
    [marcas, conteoPorMarca]
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

  return (
    // Alto fijo de pantalla y sin scroll propio: si la página entera pudiera
    // deslizarse, el "Volver" y los logos de las marcas se irían para arriba al
    // bajar por los productos. Cada pantalla se encarga de deslizar su propio
    // contenido y deja el marco quieto.
    <div
      className="h-screen overflow-hidden text-[#2d2d2d] flex flex-col"
      // El acento viaja como variable CSS para que cada pieza de adentro lo
      // tome sola, sin tener que pasárselo de mano en mano.
      style={{
        background: tema.fondo,
        ["--acento" as string]: tema.acento,
        ["--barra" as string]: tema.barra,
        ["--barra-acento" as string]: tema.barraAcento,
      }}
    >
      <div className={`fixed right-3.5 z-50 text-right ${pantalla === "home" ? "top-3.5" : "top-16"}`}>
        <button
          onClick={() => setSelectorIdiomaAbierto((v) => !v)}
          className="bg-white/70 backdrop-blur rounded-full text-[9.5px] font-extrabold text-[#686868] px-2.5 py-1.5"
        >
          🌐 Languages
        </button>
        {selectorIdiomaAbierto && (
          <div className="mt-1.5 bg-white/85 backdrop-blur rounded-xl p-1 flex flex-col gap-0.5">
            {(["es", "en", "pt"] as Idioma[]).map((lng) => (
              <button
                key={lng}
                onClick={() => {
                  setIdioma(lng);
                  setSelectorIdiomaAbierto(false);
                }}
                className="flex items-center justify-end gap-1.5 text-[9px] font-extrabold px-1.5 py-1 rounded-full"
                style={idioma === lng ? { background: SAGE_DARK, color: "#fff" } : { color: "#686868" }}
              >
                <BanderaIdioma lng={lng} className="w-3.5 h-auto rounded-[2px] shrink-0" />
                {lng === "es" ? "ES" : lng === "en" ? "EN" : "PT"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* La principal: las cuatro puertas, todas del mismo peso. Es la primera
          pantalla: no hay vidriera intermedia, el cliente entra y ya puede
          tocar lo que quiera. */}
      {pantalla === "home" && (
        <div
          // El fondo es un degradé quieto y el movimiento lo ponen las tres
          // formas de abajo, que se mueven con `transform` —lo resuelve la placa
          // de video, igual que la lluvia del tótem—. Antes se animaba la
          // posición del degradé, que obliga al procesador a repintar la
          // pantalla entera en cada cuadro: eso es lo que la frenaba.
          className="relative flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-10 text-center overflow-hidden"
          style={{ background: "linear-gradient(160deg, #fbfbfb, #e2e6da)" }}
        >
          {/* La pantalla muestra 8 bits por color y un degradé grande se le
              escalona en franjas —esa es la línea que cruza la pantalla—. Este
              mosaico de grano de 96x96 la rompe. Es una imagen que se repite, no
              un filtro: para la placa cuesta lo mismo que un color plano. */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ backgroundImage: "url(/grano.png)", backgroundRepeat: "repeat" }}
            aria-hidden
          />
          {/* Difusas por degradé radial, no por desenfoque: el desenfoque en
              Android lo hace el procesador y cuesta carísimo. */}
          <Mancha
            estilo={{
              width: 420, height: 420, top: "-12%", right: "-9%",
              background: "radial-gradient(circle, rgba(182,188,162,.85), transparent 68%)",
              animation: "asesorBlob1 7s ease-in-out infinite",
            }}
          />
          <Mancha
            estilo={{
              width: 300, height: 300, bottom: "-8%", left: "-6%",
              background: "radial-gradient(circle, rgba(111,160,80,.5), transparent 68%)",
              animation: "asesorBlob2 8.5s ease-in-out infinite",
              animationDelay: "-1.5s",
            }}
          />
          <Mancha
            estilo={{
              width: 560, height: 560, top: "22%", left: "28%",
              background: "radial-gradient(circle, rgba(207,232,166,.4), transparent 70%)",
              animation: "asesorBlob3 21s ease-in-out infinite",
              animationDelay: "-6s",
            }}
          />

          {/* Sin `overflow` acá: recortaba las sombras de las cuatro puertas
              justo en el borde y dejaba una línea dura debajo de los cuadros. */}
          <div className="relative w-full max-w-6xl flex flex-col items-center gap-7 md:gap-10">
            {/* Sigue flotando, pero sin filtro encima: un elemento con filtro
                Y movimiento, Android lo dibuja una vez en una capa y después la
                estira — por eso se veía lavado. El archivo ya viene negro, así
                que el filtro no aportaba nada. `sizes` evita que baje el archivo
                grande para mostrarlo chico. */}
            {/* En el monitor de 27" el logo tiene que leerse desde lejos: crece
                con la pantalla en vez de quedarse en un tamaño fijo de celular. */}
            <div
              className="w-full max-w-[240px] sm:max-w-[340px] md:max-w-[450px] lg:max-w-[580px] mx-auto"
              style={{ animation: "asesorLogoFlotar 4.5s ease-in-out infinite", willChange: "transform" }}
            >
              <Image
                src="/wiigo-logo-negro.png"
                alt="WiiGo — Estaciones de bienestar"
                width={2172}
                height={448}
                sizes="(min-width: 1024px) 580px, (min-width: 768px) 450px, 340px"
                className="w-full h-auto"
                priority
              />
            </div>

            <p className={`${bodoniModa.className} italic text-[clamp(22px,3.2vw,40px)] leading-tight text-[#2a3324]`}>
              {t("pregunta")}
            </p>

            {/* Las cuatro del mismo tamaño: el que ya sabe qué quiere no tiene
                por qué pasar por la primera. */}
            <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
              <Puerta
                onClick={irAObjetivo}
                fondo="linear-gradient(150deg, #4d7635, #335023)"
                icono={<IconoBrujula className="w-6 h-6 md:w-7 md:h-7" />}
                titulo={t("ctaObjetivo")}
                descripcion={t("ctaDescripcion")}
                destacada={t("ctaEyebrow")}
              />
              <Puerta
                onClick={irAMarcas}
                fondo="linear-gradient(150deg, #b5763c, #8d5726)"
                icono={<IconoBolsa className="w-6 h-6 md:w-7 md:h-7" />}
                titulo={t("ctaMarcas")}
                descripcion={t("descMarcas")}
              />
              <Puerta
                onClick={irAOfertas}
                fondo="linear-gradient(150deg, #c06a45, #96492b)"
                icono={<IconoEtiqueta className="w-6 h-6 md:w-7 md:h-7" />}
                titulo={t("ctaOfertas")}
                descripcion={t("descOfertas")}
              />
              <Puerta
                onClick={() => setPantalla("profesionales")}
                fondo="linear-gradient(150deg, #42797c, #2d585b)"
                icono={<IconoPersona className="w-6 h-6 md:w-7 md:h-7" />}
                titulo={t("ctaProfesionales")}
                descripcion={t("descProfesionales")}
              />
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
              <h2 className={`${bodoniModa.className} italic text-[clamp(26px,3.4vw,44px)] leading-tight`}>
                {t("objetivoTitulo")}
              </h2>
              <p className="text-[13px] md:text-[15px] text-[#8a8a8a] mt-1.5">{t("objetivoSubtitulo")}</p>
            </div>
            {objetivosConProductos.length === 0 ? (
              <p className="text-[#686868] text-sm text-center py-8">{t("objetivoVacio")}</p>
            ) : (
              <div className="w-full max-w-5xl grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
                {objetivosConProductos.map((o, i) => (
                  <button
                    key={o.id_objetivo}
                    onClick={() => elegirObjetivo(o.id_objetivo)}
                    className="relative overflow-hidden rounded-3xl p-4 md:p-5 text-left text-white flex flex-col justify-between gap-3 min-h-[124px] md:min-h-[168px] transition-transform active:scale-[.97]"
                    style={{
                      background: TONOS_OBJETIVO[i % TONOS_OBJETIVO.length],
                      boxShadow: "0 16px 30px -20px rgba(20,28,14,.6)",
                    }}
                  >
                    <span
                      className="absolute rounded-full pointer-events-none"
                      style={{ width: 96, height: 96, right: -26, bottom: -36, background: "rgba(255,255,255,.1)" }}
                    />
                    <span className="relative w-10 h-10 md:w-12 md:h-12 rounded-2xl overflow-hidden grid place-items-center shrink-0"
                          style={{ background: "rgba(255,255,255,.18)" }}>
                      {o.imagen ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.imagen} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="font-extrabold text-[17px] md:text-[20px]">
                          {o.nombre.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="relative text-[14px] md:text-[17px] font-extrabold leading-tight">
                      {tr(o.nombre, o.nombre_en, o.nombre_pt)}
                    </span>
                  </button>
                ))}
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
              <div className="shrink-0 bg-white border-b border-[#e2e6da] px-4 md:px-7 pt-3 pb-3 flex gap-2 md:gap-4 overflow-x-auto">
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

                <div className="flex-1 min-h-0 min-w-0 overflow-y-auto px-5 md:px-7 py-5 md:py-6">
                  <div className="flex items-end justify-between gap-4 mb-4">
                    <div>
                      <p
                        className="text-[10px] md:text-[11px] font-extrabold uppercase tracking-[.22em]"
                        style={{ color: "var(--acento, #4d7635)" }}
                      >
                        {marcaId ? (marcaPorId[marcaId]?.nombre ?? t("marcasTitulo")) : t("marcasTitulo")}
                      </p>
                      <h2
                        className={`${bodoniModa.className} italic text-[clamp(21px,2.6vw,34px)] leading-tight mt-0.5`}
                      >
                        {subcategoriaId === SIN_RUBRO
                          ? t("otros")
                          : (subcategoriasDeMarca.find((s) => s.id_subcategoria === subcategoriaId)?.nombre ??
                            t("marcasTitulo"))}
                      </h2>
                    </div>
                    <span className="text-[12px] md:text-[13px] text-[#8a9180] font-semibold shrink-0">
                      {contarProductos(productosDeMarca.length, idioma)}
                    </span>
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
              <h2 className={`${bodoniModa.className} italic text-[clamp(23px,2.8vw,38px)] leading-tight`}>
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
                                  <span className={`text-[13.5px] font-semibold ${fredoka.className}`} style={{ color: C3 }}>
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
                                      className={`${fredoka.className} text-[11px] font-semibold`}
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
          <div className="flex-1 min-h-0 w-full mx-auto flex flex-col px-5 md:px-7 pt-5 pb-6 max-w-7xl">
            <div className="flex-1 min-h-0 flex flex-col">
                {marcasConResultados.length > 1 && (
                  <div className="flex gap-2 md:gap-4 overflow-x-auto pb-3 mb-3 border-b border-[#e2e6da] shrink-0">
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

                <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-0 md:gap-7">
                  <div
                    className="md:w-[248px] shrink-0 rounded-2xl px-3 py-4 md:py-5 flex flex-row md:flex-col gap-5 md:gap-6 overflow-x-auto md:overflow-y-auto"
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

                  <div className="flex-1 min-w-0 overflow-y-auto pt-5 md:pt-0">
                    <div className="flex items-end justify-between gap-4 mb-4">
                      <h3 className={`${bodoniModa.className} italic text-[clamp(21px,2.6vw,34px)] leading-tight`}>
                        {objetivoId
                          ? (() => {
                              const o = objetivos.find((x) => x.id_objetivo === objetivoId);
                              return o ? tr(o.nombre, o.nombre_en, o.nombre_pt) : t("resultadoTitulo");
                            })()
                          : t("resultadoTitulo")}
                      </h3>
                      <span className="text-[12px] md:text-[13px] text-[#8a9180] font-semibold shrink-0">
                        {contarProductos(productosFiltrados.length, idioma, "disponibles")}
                      </span>
                    </div>

                    {productosFiltrados.length === 0 ? (
                      <p className="text-[#686868] text-sm text-center py-12">{t("sinResultados")}</p>
                    ) : (
                      // Cuatro y no cinco: descontando la barra lateral, con cinco
                      // columnas cada tarjeta queda del ancho de un dedo y la foto no
                      // se ve. Recién arriba de 1536px entra una quinta sin achicar.
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4">
                        {productosFiltrados.map((p) => (
                          <TarjetaResultado
                            key={p.id_producto}
                            producto={p}
                            marca={marcaResultado ? undefined : marcaPorId[p.id_marca]}
                            etiqueta={porQue(p).texto}
                            nombre={tr(p.nombre, p.nombre_en, p.nombre_pt)}
                            onClick={() => setProductoAbierto(p.id_producto)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
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
              <h2 className={`${bodoniModa.className} italic text-[clamp(24px,3vw,40px)] leading-tight`}>
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
                      {cat}
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
                    <span
                      className="aspect-[4/3] w-full flex items-center justify-center font-extrabold text-[34px] text-white overflow-hidden"
                      style={{ background: "var(--acento, #4d7635)" }}
                    >
                      {prof.foto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={prof.foto} alt="" className="w-full h-full object-cover" />
                      ) : (
                        `${prof.nombre.charAt(0)}${prof.apellido ? prof.apellido.charAt(0) : ""}`.toUpperCase()
                      )}
                    </span>
                    <div className="p-3.5 md:p-4 flex flex-col gap-1 flex-1">
                      <p className="text-[15px] md:text-[17px] font-extrabold leading-tight">
                        {prof.nombre} {prof.apellido ?? ""}
                      </p>
                      {(prof.titulo || prof.especialidad) && (
                        <p
                          className="text-[10px] md:text-[11px] font-extrabold uppercase tracking-[.13em] leading-snug"
                          style={{ color: "var(--acento, #4d7635)" }}
                        >
                          {[prof.titulo, prof.especialidad].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {(fortalezasPorProfesional[prof.id_profesional] ?? []).length > 0 && (
                        <p className="text-[11.5px] md:text-[12.5px] text-[#7d8571] leading-snug mt-1">
                          {(fortalezasPorProfesional[prof.id_profesional] ?? [])
                            .slice(0, 3)
                            .map((f) => f.nombre)
                            .join(" · ")}
                        </p>
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
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={() => setPantalla("profesionales")} onInicio={volverAInicio} idioma={idioma} />
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-10 max-w-md mx-auto w-full flex flex-col">
            <div
              className="relative w-full rounded-2xl overflow-hidden mb-4"
              style={{ minHeight: 190, background: `linear-gradient(155deg, #8fa584 0%, ${SAGE_DARK} 100%)` }}
            >
              {profesionalActual.foto && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profesionalActual.foto} alt="" className="absolute inset-0 w-full h-full object-cover opacity-95" />
              )}
              <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,.5) 100%)" }} />
              {!profesionalActual.foto && (
                <span className="absolute inset-0 flex items-center justify-center font-extrabold text-[42px] text-white/70">
                  {profesionalActual.nombre.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="relative flex flex-col justify-end h-full min-h-[190px] p-4">
                <p className={`${bodoniModa.className} italic text-[24px] text-white leading-tight`}>
                  {profesionalActual.nombre} {profesionalActual.apellido ?? ""}
                </p>
                {(profesionalActual.titulo || profesionalActual.especialidad) && (
                  <p className="text-[11px] font-bold text-white/90">
                    {[profesionalActual.titulo, profesionalActual.especialidad].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-center">
              {profesionalActual.bio && (
                <p className="text-[13px] italic leading-relaxed mb-3.5 pl-3 border-l-2" style={{ borderColor: CLAY, color: "#2d2d2d" }}>
                  {profesionalActual.bio}
                </p>
              )}

              {fortalezasDelProfesionalActual.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
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

            <div className="flex flex-col gap-2">
              {tieneReservaPresencial || tieneReservaOnline ? (
                <button
                  onClick={irAReservarTurno}
                  className="text-center text-[13px] font-extrabold text-white py-3 rounded-full"
                  style={{ background: SAGE_DARK }}
                >
                  📅 Reservar turno
                </button>
              ) : (
                <p className="text-center text-[11px] text-[#a8a8a8]">Todavía no tiene link de reserva cargado.</p>
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
        </div>
      )}

      {pantalla === "reservarTurno" && profesionalActual && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={() => setPantalla("fichaProfesional")} onInicio={volverAInicio} idioma={idioma} />
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-6 max-w-md mx-auto w-full flex flex-col">
            {eligiendoModalidadTurno && (
              <>
                <h2 className={`${bodoniModa.className} italic text-[22px] mb-1`}>Reservar turno</h2>
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
            />
          );
        })()}

      <p className="sr-only">Local: {local.nombre}</p>
    </div>
  );
}

// Colores por macro (tono fuerte para el punto/valor, tono claro para el
// fondo de la explicación cuando se toca la burbuja) — separados del verde
// de marca porque acá cumplen una función de dato, no de identidad.
const MACROS_INFO: Record<
  string,
  { fuerte: string; claro: string; label: Record<Idioma, string>; explicacion: (v: number, idioma: Idioma) => string }
> = {
  Proteínas: {
    fuerte: "#4f8c7c",
    claro: "#e3f0ec",
    label: { es: "Proteína", en: "Protein", pt: "Proteína" },
    explicacion: (v, idioma) =>
      idioma === "en"
        ? `Provides ${v}g of protein per 100g.`
        : idioma === "pt"
          ? `Fornece ${v}g de proteína a cada 100g.`
          : `Aporta ${v}g de proteínas cada 100g.`,
  },
  Carbohidratos: {
    fuerte: "#c9822f",
    claro: "#faf0de",
    label: { es: "Carbos", en: "Carbs", pt: "Carboidratos" },
    explicacion: (v, idioma) =>
      idioma === "en"
        ? `Contains ${v}g of carbohydrates per 100g.`
        : idioma === "pt"
          ? `Contém ${v}g de carboidratos a cada 100g.`
          : `Contiene ${v}g de carbohidratos cada 100g.`,
  },
  Grasas: {
    fuerte: "#b85a48",
    claro: "#f6e6e2",
    label: { es: "Grasas", en: "Fat", pt: "Gorduras" },
    explicacion: (v, idioma) =>
      idioma === "en"
        ? `Has ${v}g of healthy fats per 100g.`
        : idioma === "pt"
          ? `Tem ${v}g de gorduras a cada 100g.`
          : `Tiene ${v}g de grasas cada 100g.`,
  },
  Fibra: {
    fuerte: "#7a63ad",
    claro: "#eee9f7",
    label: { es: "Fibra", en: "Fiber", pt: "Fibra" },
    explicacion: (v, idioma) =>
      idioma === "en"
        ? `Adds ${v}g of fiber per 100g.`
        : idioma === "pt"
          ? `Soma ${v}g de fibra a cada 100g.`
          : `Suma ${v}g de fibra cada 100g.`,
  },
  Sodio: {
    fuerte: "#5f8bb0",
    claro: "#e6eef4",
    label: { es: "Sodio", en: "Sodium", pt: "Sódio" },
    explicacion: (v, idioma) =>
      idioma === "en"
        ? `Contains ${v}g of sodium per 100g.`
        : idioma === "pt"
          ? `Contém ${v}g de sódio a cada 100g.`
          : `Contiene ${v}g de sodio cada 100g.`,
  },
};

function ProductoDetalleModal({
  producto,
  marca,
  ficha,
  variantes,
  idioma,
  onClose,
}: {
  producto: ProductoPublico;
  marca: MarcaPublica | undefined;
  ficha: FichaProducto | null;
  variantes: VarianteProductoPublica[];
  idioma: Idioma;
  onClose: () => void;
}) {
  const fotos = [producto.imagen, ficha?.foto_extra_1, ficha?.foto_extra_2, ficha?.foto_extra_3].filter(
    (f): f is string => Boolean(f)
  );
  const [fotoActiva, setFotoActiva] = useState<string | null>(fotos[0] ?? null);
  const [abierto, setAbierto] = useState(false);
  const [macroActiva, setMacroActiva] = useState<string | null>(null);
  const [ingredientesAbierto, setIngredientesAbierto] = useState(false);
  const [micronutrientesAbierto, setMicronutrientesAbierto] = useState(false);
  const [saborActivo, setSaborActivo] = useState<string | null>(null);

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

  const macroSeleccionada = macros.find((m) => m.label === macroActiva);
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
              🌿 {ficha.clasificacion}
            </span>
          )}
        </div>
        <h3 className={`${bodoniModa.className} italic text-[26px] md:text-[32px] leading-tight mt-1`}>
          {traducir(idioma, producto.nombre, producto.nombre_en, producto.nombre_pt)}
        </h3>
        <div className="mt-2.5 flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2.5">
            <span
              className={`${fredoka.className} text-[24px] md:text-[28px] font-semibold`}
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
                  className={`${fredoka.className} text-[20px] md:text-[23px] font-semibold leading-tight`}
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

      {ficha?.descripcion_publica && (
        <p className="text-[14px] leading-relaxed text-[#686868]">
          {traducir(idioma, ficha.descripcion_publica, ficha.descripcion_publica_en, ficha.descripcion_publica_pt)}
        </p>
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

        {/* ---------- hoja izquierda: la foto ---------- */}
        <div className="bg-white overflow-y-auto flex flex-col min-h-0">
          <div className="relative bg-white px-5 pt-5">
            {/* Techo al alto de la foto: si crece libre empuja el precio fuera
                de la ficha y hay que buscarlo deslizando. */}
            <div
              className="relative w-full aspect-square max-h-[34vh] md:max-h-[46vh] flex items-center justify-center"
              style={{
                transform: abierto ? "scale(1)" : "scale(1.06)",
                transition: "transform .9s cubic-bezier(.2,.8,.2,1)",
              }}
            >
              {fotoActiva ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fotoActiva} alt="" className="w-full h-full object-contain" />
              ) : (
                <span style={{ color: SAGE_DARK }}>
                  <IconoBolsa className="w-12 h-12" />
                </span>
              )}
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
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[#8a9180]">
                {tituloNutricional}
              </p>

            {(hayKcal || macros.length > 0) && (
              <div className="flex flex-col items-center gap-4">
                {hayKcal && (
                  <div className="relative w-[132px] h-[132px] shrink-0 grid place-items-center">
                    {/* El anillo se llena animando el trazo de un círculo SVG.
                        Antes se animaba un degradé circular, que hay que
                        recalcular entero en cada cuadro; esto lo dibuja la placa
                        de video y va fluido hasta en la all-in-one. */}
                    <svg className="absolute inset-0 -rotate-90" viewBox="0 0 132 132" aria-hidden>
                      <circle cx="66" cy="66" r="59" fill="none" stroke="#e3e7dc" strokeWidth="14" />
                      <circle
                        cx="66"
                        cy="66"
                        r="59"
                        fill="none"
                        stroke="#6fa050"
                        strokeWidth="14"
                        strokeLinecap="round"
                        strokeDasharray={ANILLO_LARGO}
                        style={
                          {
                            "--largo": `${ANILLO_LARGO}`,
                            "--resto": `${ANILLO_LARGO * (1 - 0.72)}`,
                            strokeDashoffset: ANILLO_LARGO,
                            animation: "asesorAnillo 1.1s cubic-bezier(.2,.8,.2,1) .35s forwards",
                          } as React.CSSProperties
                        }
                      />
                    </svg>
                    <div className="relative w-[102px] h-[102px] rounded-full bg-white flex flex-col items-center justify-center">
                      <span className={`${fredoka.className} text-[26px] font-semibold`}>{ficha?.kcal_100g}</span>
                      <span className="text-[9px] tracking-[.2em] text-[#8a9180] mt-0.5">KCAL</span>
                    </div>
                  </div>
                )}

                {macros.length > 0 && (
                  <div className="flex gap-2 flex-wrap justify-center">
                    {macros.map((m) => {
                      const info = MACROS_INFO[m.label];
                      const activa = macroActiva === m.label;
                      return (
                        <button
                          key={m.label}
                          onClick={() => setMacroActiva(activa ? null : m.label)}
                          className="w-[70px] rounded-2xl bg-white border flex flex-col items-center gap-0.5 py-2.5"
                          style={{
                            transform: activa ? "scale(1.06)" : "scale(1)",
                            boxShadow: activa ? "0 8px 18px -8px rgba(0,0,0,.25)" : "none",
                            borderColor: activa ? "transparent" : "#e2e6da",
                            opacity: macroActiva && !activa ? 0.45 : 1,
                            transition: "all .2s ease",
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: info.fuerte }} />
                          <span className={`${fredoka.className} text-[14px] font-semibold`}>{m.valor}g</span>
                          <span className="text-[8.5px] text-[#8a9180] text-center leading-tight">
                            {info.label[idioma]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div
                  className="w-full rounded-2xl overflow-hidden"
                  style={{
                    maxHeight: macroSeleccionada ? 90 : 0,
                    padding: macroSeleccionada ? "11px 15px" : "0 15px",
                    background: macroSeleccionada ? MACROS_INFO[macroSeleccionada.label].claro : "transparent",
                    transition: "max-height .35s ease, padding .35s ease",
                  }}
                >
                  {macroSeleccionada && (
                    <p className="text-[12px] leading-relaxed text-[#2d2d2d] m-0">
                      {MACROS_INFO[macroSeleccionada.label].explicacion(macroSeleccionada.valor, idioma)}
                    </p>
                  )}
                </div>
              </div>
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
