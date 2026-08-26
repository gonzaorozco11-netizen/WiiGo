"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Fredoka, Bodoni_Moda } from "next/font/google";
import type {
  Local,
  Marca,
  Producto,
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

const SAGE = "#b6bca2";
const SAGE_DARK = "#646759";
const SAGE_TINT = "#f0f2ec";
const CLAY = "#b97a52"; // acento cálido: destacados en el perfil de profesionales
const C1 = "#8fa377"; // encontrar productos
const C2 = "#d99a5b"; // marcas y productos
const C3 = "#d97561"; // ofertas
const C4 = "#5f92a8"; // profesionales

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
const HOME_I18N = {
  es: {
    eyebrow: "🌿 Asesores",
    pregunta: "¿Qué estás buscando hoy?",
    ctaObjetivo: "Encontrar<br />productos para mí",
    ctaMarcas: "Marcas y<br />productos",
    ctaOfertas: "Ofertas en<br />la tienda",
    ctaProfesionales: "Profesionales",
    buscarPlaceholder: "Buscar producto o marca...",
    objetivoTitulo: "¿Cuál es tu objetivo hoy?",
    resultadoTitulo: "Te recomendamos",
    reposoSub: "Tocá la pantalla para descubrir qué te conviene hoy",
    reposoHint: "Tocá para empezar",
    ctaEyebrow: "Recomendado",
    ctaDescripcion: "Contanos qué buscás y te mostramos lo que mejor te queda",
  },
  en: {
    eyebrow: "🌿 Advisors",
    pregunta: "What are you looking for today?",
    ctaObjetivo: "Find<br />products for me",
    ctaMarcas: "Brands &<br />products",
    ctaOfertas: "Offers in<br />the store",
    ctaProfesionales: "Professionals",
    buscarPlaceholder: "Search product or brand...",
    objetivoTitulo: "What's your goal today?",
    resultadoTitulo: "We recommend",
    reposoSub: "Tap the screen to find what's best for you today",
    reposoHint: "Tap to start",
    ctaEyebrow: "Recommended",
    ctaDescripcion: "Tell us what you need and we'll show you what fits best",
  },
  pt: {
    eyebrow: "🌿 Consultores",
    pregunta: "O que você está procurando hoje?",
    ctaObjetivo: "Encontrar<br />produtos pra mim",
    ctaMarcas: "Marcas e<br />produtos",
    ctaOfertas: "Ofertas<br />da loja",
    ctaProfesionales: "Profissionais",
    buscarPlaceholder: "Buscar produto ou marca...",
    objetivoTitulo: "Qual é o seu objetivo hoje?",
    resultadoTitulo: "Recomendamos",
    reposoSub: "Toque na tela para descobrir o que é melhor pra você hoje",
    reposoHint: "Toque para começar",
    ctaEyebrow: "Recomendado",
    ctaDescripcion: "Conte o que você precisa e mostramos o que combina com você",
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

function precioConDescuento(p: Producto) {
  const base = p.precio_venta ?? 0;
  const descuento = p.descuento_porcentaje ?? 0;
  return descuento > 0 ? Math.round(base * (1 - descuento / 100)) : base;
}

function IconoBuscar({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10.5" cy="10.5" r="6.8" />
      <circle cx="10.5" cy="10.5" r="2.6" />
      <line x1="15.3" y1="15.3" x2="20.5" y2="20.5" />
    </svg>
  );
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

function Navbar({ onVolver, onInicio }: { onVolver: () => void; onInicio: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 pt-5 shrink-0">
      <button
        onClick={onVolver}
        className="rounded-full border border-[#d8d8d8] bg-white px-3 py-2 text-[13px] font-bold text-[#686868]"
      >
        ← Volver
      </button>
      <button
        onClick={onInicio}
        className="rounded-full border border-[#d8d8d8] bg-white px-3 py-2 text-[13px] font-bold text-[#686868]"
      >
        ⌂ Inicio
      </button>
    </div>
  );
}

export default function AsesorApp({
  local,
  marcas,
  productos,
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
  marcas: Marca[];
  productos: Producto[];
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
  const [reposoActivo, setReposoActivo] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [objetivoId, setObjetivoId] = useState<string | null>(null);
  const [filtrosSeleccionados, setFiltrosSeleccionados] = useState<Set<string>>(new Set());
  const [marcaId, setMarcaId] = useState<string | null>(null);
  const [subcategoriaId, setSubcategoriaId] = useState<string | null>(null);
  const [marcaOfertaId, setMarcaOfertaId] = useState<string | null>(null);
  const [categoriaProf, setCategoriaProf] = useState<string | null>(null);
  const [profesionalId, setProfesionalId] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [mostrarComoAyuda, setMostrarComoAyuda] = useState(false);
  const [modalidadTurno, setModalidadTurno] = useState<"presencial" | "online" | null>(null);
  const [productoAbierto, setProductoAbierto] = useState<string | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [selectorIdiomaAbierto, setSelectorIdiomaAbierto] = useState(false);

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

  const marcaPorId = useMemo(() => {
    const mapa: Record<string, Marca> = {};
    marcas.forEach((m) => (mapa[m.id_marca] = m));
    return mapa;
  }, [marcas]);

  const filtroPorId = useMemo(() => {
    const mapa: Record<string, FiltroProducto> = {};
    filtros.forEach((f) => (mapa[f.id_filtro] = f));
    return mapa;
  }, [filtros]);

  const objetivoSeleccionado = objetivoId ? objetivos.find((o) => o.id_objetivo === objetivoId) ?? null : null;

  const conteoProductosPorMarca = useMemo(() => {
    const mapa: Record<string, number> = {};
    productos.forEach((p) => {
      mapa[p.id_marca] = (mapa[p.id_marca] ?? 0) + 1;
    });
    return mapa;
  }, [productos]);

  const marcasOrdenadas = useMemo(
    () => [...marcas].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [marcas]
  );

  const subcategoriasDeMarca = useMemo(() => {
    if (!marcaId) return [];
    return subcategorias
      .filter((s) => s.id_marca === marcaId)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [subcategorias, marcaId]);

  const productosDeMarca = useMemo(() => {
    if (!marcaId) return [];
    return productos.filter(
      (p) => p.id_marca === marcaId && (!subcategoriaId || p.id_subcategoria === subcategoriaId)
    );
  }, [productos, marcaId, subcategoriaId]);

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

  const productosEnOfertaFiltrados = useMemo(() => {
    if (!marcaOfertaId) return productosEnOferta;
    return productosEnOferta.filter((p) => p.id_marca === marcaOfertaId);
  }, [productosEnOferta, marcaOfertaId]);

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
    setBusqueda("");
    setObjetivoId(null);
    setFiltrosSeleccionados(new Set());
    setPantalla("objetivo");
  }

  function irAMarcas() {
    setMarcaId(null);
    setSubcategoriaId(null);
    setPantalla("marcas");
  }

  function irAOfertas() {
    setMarcaOfertaId(null);
    setPantalla("ofertas");
  }

  function toggleMarca(id: string) {
    setSubcategoriaId(null);
    setMarcaId((actual) => (actual === id ? null : id));
  }

  function toggleSubcategoria(id: string) {
    setSubcategoriaId((actual) => (actual === id ? null : id));
  }

  function toggleMarcaOferta(id: string) {
    setMarcaOfertaId((actual) => (actual === id ? null : id));
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
    setBusqueda("");
    setFiltrosSeleccionados(new Set());
    setPantalla("resultado");
  }

  function buscar() {
    if (!busqueda.trim()) return;
    setObjetivoId(null);
    setFiltrosSeleccionados(new Set());
    setPantalla("resultado");
  }

  function volverAInicio() {
    setPantalla("home");
    setBusqueda("");
    setObjetivoId(null);
    setFiltrosSeleccionados(new Set());
    setMarcaId(null);
    setSubcategoriaId(null);
    setMarcaOfertaId(null);
    setCategoriaProf(null);
    setProfesionalId(null);
    setMostrarComoAyuda(false);
    setSlideIndex(0);
    setModalidadTurno(null);
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

  // La pantalla de Inicio (buscador + tarjetas) vuelve sola a Reposo después
  // de un rato sin uso — así el totem siempre "descansa" en la pantalla de
  // bienvenida en vez de quedarse con el buscador abierto indefinidamente.
  useEffect(() => {
    if (pantalla !== "home" || reposoActivo) return;
    let timer = setTimeout(() => setReposoActivo(true), IDLE_WARNING_MS);
    const reiniciar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setReposoActivo(true), IDLE_WARNING_MS);
    };
    const eventos: (keyof WindowEventMap)[] = ["pointerdown", "keydown"];
    eventos.forEach((ev) => window.addEventListener(ev, reiniciar));
    return () => {
      clearTimeout(timer);
      eventos.forEach((ev) => window.removeEventListener(ev, reiniciar));
    };
  }, [pantalla, reposoActivo]);

  function volverDesdeResultado() {
    if (busqueda.trim()) {
      setBusqueda("");
      setPantalla("home");
    } else {
      setPantalla("objetivo");
    }
  }

  function toggleFiltro(id: string) {
    setFiltrosSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      if (q) {
        const nombreMarca = marcaPorId[p.id_marca]?.nombre ?? "";
        if (!p.nombre.toLowerCase().includes(q) && !nombreMarca.toLowerCase().includes(q)) return false;
      } else if (objetivoId) {
        if (!(objetivosPorProducto[p.id_producto] ?? []).includes(objetivoId)) return false;
      }
      if (filtrosSeleccionados.size > 0) {
        const propios = filtrosPorProducto[p.id_producto] ?? [];
        for (const f of filtrosSeleccionados) {
          if (!propios.includes(f)) return false;
        }
      }
      return true;
    });
  }, [productos, busqueda, objetivoId, filtrosSeleccionados, marcaPorId, objetivosPorProducto, filtrosPorProducto]);

  function porQue(p: Producto): { texto: string; tag: string } {
    const propios = filtrosPorProducto[p.id_producto] ?? [];
    const nombresFiltros = propios
      .filter((id) => filtrosSeleccionados.size === 0 || filtrosSeleccionados.has(id))
      .map((id) => filtroPorId[id]?.nombre)
      .filter(Boolean) as string[];

    if (nombresFiltros.length > 0) {
      return { texto: nombresFiltros.slice(0, 2).join(" · "), tag: nombresFiltros[0] };
    }
    if (objetivoSeleccionado) {
      return { texto: objetivoSeleccionado.nombre, tag: objetivoSeleccionado.nombre };
    }
    const marca = marcaPorId[p.id_marca]?.nombre;
    return { texto: marca ?? "", tag: marca ?? "" };
  }

  return (
    <div className="min-h-screen bg-[#ededed] text-[#2d2d2d] flex flex-col">
      <div className="fixed top-3.5 right-3.5 z-50 text-right">
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
                {lng === "es" ? "ES" : lng === "en" ? "EN" : "PT"}
              </button>
            ))}
          </div>
        )}
      </div>

      {pantalla === "home" && (
        <div
          className="relative flex-1 flex flex-col items-center px-6 pt-14 pb-8 text-center overflow-hidden"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 20%, rgba(182,188,162,.55), transparent 55%), radial-gradient(circle at 80% 75%, rgba(111,160,80,.35), transparent 55%), linear-gradient(160deg, #fbfbfb, #e2e6da)",
            backgroundSize: "220% 220%",
            animation: "asesorFondoDeriva 16s ease-in-out infinite",
          }}
          onClick={reposoActivo ? () => setReposoActivo(false) : undefined}
        >
          <span
            className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#646759] bg-white/55 backdrop-blur px-4 py-1.5 rounded-full mb-6"
            dangerouslySetInnerHTML={{ __html: t("eyebrow") }}
          />
          <div
            className={reposoActivo ? "w-full max-w-[280px] mb-8" : "w-full max-w-xs mb-8"}
            style={{ animation: "asesorLogoFlotar 4.5s ease-in-out infinite", transition: "max-width .4s ease" }}
          >
            <Image
              src="/wiigo-logo.png"
              alt="WiiGo — Estaciones de bienestar"
              width={2172}
              height={448}
              className="w-full h-auto"
              style={{ filter: "brightness(0) drop-shadow(0 14px 24px rgba(0,0,0,.18))" }}
              priority
            />
          </div>

          {reposoActivo ? (
            <>
              <p className="text-[15px] font-bold text-[#686868] mb-6 max-w-xs">{t("reposoSub")}</p>
              <span
                className="text-[11px] font-extrabold uppercase tracking-[.1em] px-5 py-2.5 rounded-full border-[1.5px] motion-safe:animate-pulse"
                style={{ color: SAGE_DARK, borderColor: SAGE_DARK }}
              >
                {t("reposoHint")}
              </span>
            </>
          ) : (
            <>
              <p className="text-[15px] font-bold text-[#686868] mb-6">{t("pregunta")}</p>

              <button
                onClick={irAObjetivo}
                className="relative w-full max-w-sm rounded-3xl p-6 text-left text-white overflow-hidden"
                style={{ background: `linear-gradient(135deg, ${SAGE_DARK}, #4d5245)` }}
              >
                <p className="text-[10px] font-extrabold uppercase tracking-[.1em] opacity-85">{t("ctaEyebrow")}</p>
                <h3
                  className="text-[19px] font-extrabold leading-tight mt-1 mb-1.5"
                  dangerouslySetInnerHTML={{ __html: t("ctaObjetivo") }}
                />
                <p className="text-[12px] opacity-90 max-w-[210px]">{t("ctaDescripcion")}</p>
                <span className="absolute right-5 bottom-5 text-[22px]">→</span>
              </button>

              <div className="flex gap-2 w-full max-w-sm mt-3">
                <button onClick={irAMarcas} className="flex-1 flex flex-col items-center gap-2 rounded-2xl border border-[#d8d8d8] bg-white p-3.5">
                  <span className="flex items-center justify-center w-9 h-9 rounded-full text-white shrink-0" style={{ background: C2 }}>
                    <IconoBolsa className="w-4.5 h-4.5" />
                  </span>
                  <span className="text-[11px] font-bold leading-tight text-center" dangerouslySetInnerHTML={{ __html: t("ctaMarcas") }} />
                </button>
                <button onClick={irAOfertas} className="flex-1 flex flex-col items-center gap-2 rounded-2xl border border-[#d8d8d8] bg-white p-3.5">
                  <span className="flex items-center justify-center w-9 h-9 rounded-full text-white shrink-0" style={{ background: C3 }}>
                    <IconoEtiqueta className="w-4.5 h-4.5" />
                  </span>
                  <span className="text-[11px] font-bold leading-tight text-center" dangerouslySetInnerHTML={{ __html: t("ctaOfertas") }} />
                </button>
                <button onClick={() => setPantalla("profesionales")} className="flex-1 flex flex-col items-center gap-2 rounded-2xl border border-[#d8d8d8] bg-white p-3.5">
                  <span className="flex items-center justify-center w-9 h-9 rounded-full text-white shrink-0" style={{ background: C4 }}>
                    <IconoPersona className="w-4.5 h-4.5" />
                  </span>
                  <span className="text-[11px] font-bold leading-tight text-center">{t("ctaProfesionales")}</span>
                </button>
              </div>

              <div className="w-full max-w-sm mt-6 flex items-center gap-3 rounded-full border border-[#d8d8d8] bg-white px-3 py-3 shadow-sm">
                <span className="flex items-center justify-center w-8 h-8 rounded-full shrink-0" style={{ background: SAGE_TINT, color: SAGE_DARK }}>
                  <IconoBuscar className="w-4 h-4" />
                </span>
                <input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && buscar()}
                  placeholder={t("buscarPlaceholder")}
                  className="flex-1 bg-transparent outline-none text-[14px] font-medium text-[#2d2d2d] placeholder:text-[#a8a8a8]"
                />
              </div>
            </>
          )}
        </div>
      )}

      {pantalla === "objetivo" && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={volverAInicio} onInicio={volverAInicio} />
          <div className="flex-1 px-6 pt-6 pb-10">
            <h2 className="text-2xl font-extrabold mb-6">{t("objetivoTitulo")}</h2>
            <div className="flex flex-col gap-2.5 max-w-md mx-auto">
              {objetivos.length === 0 && (
                <p className="text-[#686868] text-sm text-center py-8">
                  Todavía no cargaste objetivos en Catálogo asesor.
                </p>
              )}
              {objetivos.map((o) => (
                <button
                  key={o.id_objetivo}
                  onClick={() => elegirObjetivo(o.id_objetivo)}
                  className="flex items-center gap-3 rounded-2xl border border-[#d8d8d8] bg-white px-4 py-3 shadow-sm text-left"
                >
                  <span className="flex items-center justify-center w-9 h-9 rounded-full shrink-0 overflow-hidden font-extrabold text-[14px]" style={{ background: SAGE_TINT, color: SAGE_DARK }}>
                    {o.imagen ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.imagen} alt="" className="w-full h-full object-cover" />
                    ) : (
                      o.nombre.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className="text-[15px] font-bold">{tr(o.nombre, o.nombre_en, o.nombre_pt)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {pantalla === "marcas" && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={volverAInicio} onInicio={volverAInicio} />
          <div className="flex-1 px-6 pt-6 pb-10 max-w-3xl mx-auto w-full">
            <h2 className="text-2xl font-extrabold mb-4">Marcas y productos</h2>

            <div className="flex flex-wrap gap-2 mb-5">
              {marcasOrdenadas.length === 0 && (
                <p className="text-[#686868] text-sm">Todav&iacute;a no hay marcas visibles en el Asesor.</p>
              )}
              {marcasOrdenadas.map((m) => {
                const on = marcaId === m.id_marca;
                return (
                  <button
                    key={m.id_marca}
                    onClick={() => toggleMarca(m.id_marca)}
                    className="flex items-center gap-2 rounded-full border px-3 py-2 shadow-sm transition-colors"
                    style={
                      on
                        ? { background: SAGE_TINT, borderColor: SAGE, color: SAGE_DARK }
                        : { background: "#fff", borderColor: "#d8d8d8", color: "#2d2d2d" }
                    }
                  >
                    <span
                      className="flex items-center justify-center w-7 h-7 rounded-full font-extrabold text-[12px] shrink-0 overflow-hidden"
                      style={on ? { background: "rgba(255,255,255,.5)" } : { background: SAGE_TINT, color: SAGE_DARK }}
                    >
                      {m.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.logo} alt="" className="w-full h-full object-cover" />
                      ) : (
                        m.nombre.charAt(0).toUpperCase()
                      )}
                    </span>
                    <span className="text-[13px] font-extrabold">{m.nombre}</span>
                    <span className="text-[11px] font-medium opacity-70">
                      {conteoProductosPorMarca[m.id_marca] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            {!marcaId ? (
              <p className="text-[#686868] text-sm text-center py-12">
                Eleg&iacute; una marca para ver sus productos.
              </p>
            ) : (
              <>
                {subcategoriasDeMarca.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-6">
                    {subcategoriasDeMarca.map((s) => {
                      const on = subcategoriaId === s.id_subcategoria;
                      return (
                        <button
                          key={s.id_subcategoria}
                          onClick={() => toggleSubcategoria(s.id_subcategoria)}
                          className="rounded-full border px-3.5 py-1.5 text-[12px] font-bold"
                          style={
                            on
                              ? { background: SAGE_DARK, borderColor: SAGE_DARK, color: "#fff" }
                              : { background: "#fff", borderColor: "#d8d8d8", color: "#686868" }
                          }
                        >
                          {s.nombre}
                        </button>
                      );
                    })}
                  </div>
                )}

                <p className="text-[13px] text-[#686868] mb-4">
                  {productosDeMarca.length} producto{productosDeMarca.length === 1 ? "" : "s"}
                </p>

                {productosDeMarca.length === 0 ? (
                  <p className="text-[#686868] text-sm text-center py-12">
                    Todav&iacute;a no hay productos visibles ac&aacute;.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {productosDeMarca.map((p) => {
                      const ficha = fichaPorProducto[p.id_producto];
                      return (
                        <div
                          key={p.id_producto}
                          onClick={() => setProductoAbierto(p.id_producto)}
                          className="rounded-xl border border-[#d8d8d8] bg-white overflow-hidden shadow-sm flex flex-col cursor-pointer"
                        >
                          <div className="h-20 bg-gradient-to-br from-[#f0f2ec] to-[#d8d8d8] flex items-center justify-center">
                            {p.imagen ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.imagen} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span style={{ color: SAGE_DARK }}>
                                <IconoBolsa className="w-6 h-6" />
                              </span>
                            )}
                          </div>
                          <div className="p-2.5 flex flex-col gap-1">
                            <p className="text-[12px] font-extrabold leading-tight line-clamp-2">{tr(p.nombre, p.nombre_en, p.nombre_pt)}</p>
                            {ficha?.descripcion_publica && (
                              <p className="text-[10px] text-[#686868] leading-snug line-clamp-2">
                                {tr(ficha.descripcion_publica, ficha.descripcion_publica_en, ficha.descripcion_publica_pt)}
                              </p>
                            )}
                            <span className="text-[13px] font-extrabold mt-1">{formatoPrecio(p.precio_venta)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {pantalla === "ofertas" && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={volverAInicio} onInicio={volverAInicio} />
          <div className="flex-1 px-6 pt-6 pb-10 max-w-3xl mx-auto w-full">
            <h2 className="text-2xl font-extrabold mb-4">Ofertas</h2>

            {marcasConOferta.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-5">
                {marcasOrdenadas
                  .filter((m) => marcasConOferta.includes(m.id_marca))
                  .map((m) => {
                    const on = marcaOfertaId === m.id_marca;
                    return (
                      <button
                        key={m.id_marca}
                        onClick={() => toggleMarcaOferta(m.id_marca)}
                        className="flex items-center gap-2 rounded-full border px-3 py-2 shadow-sm transition-colors"
                        style={
                          on
                            ? { background: SAGE_TINT, borderColor: SAGE, color: SAGE_DARK }
                            : { background: "#fff", borderColor: "#d8d8d8", color: "#2d2d2d" }
                        }
                      >
                        <span
                          className="flex items-center justify-center w-7 h-7 rounded-full font-extrabold text-[12px] shrink-0 overflow-hidden"
                          style={on ? { background: "rgba(255,255,255,.5)" } : { background: SAGE_TINT, color: SAGE_DARK }}
                        >
                          {m.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.logo} alt="" className="w-full h-full object-cover" />
                          ) : (
                            m.nombre.charAt(0).toUpperCase()
                          )}
                        </span>
                        <span className="text-[13px] font-extrabold">{m.nombre}</span>
                        <span className="text-[11px] font-medium opacity-70">
                          {conteoOfertasPorMarca[m.id_marca] ?? 0}
                        </span>
                      </button>
                    );
                  })}
              </div>
            )}

            <p className="text-[13px] text-[#686868] mb-4">
              {productosEnOfertaFiltrados.length} producto{productosEnOfertaFiltrados.length === 1 ? "" : "s"} con descuento
            </p>

            {productosEnOfertaFiltrados.length === 0 ? (
              <p className="text-[#686868] text-sm text-center py-12">
                Por ahora no hay productos con descuento cargado.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {productosEnOfertaFiltrados.map((p) => {
                  const marca = marcaPorId[p.id_marca];
                  return (
                    <div
                      key={p.id_producto}
                      onClick={() => setProductoAbierto(p.id_producto)}
                      className="relative rounded-xl border border-[#d8d8d8] bg-white overflow-hidden shadow-sm flex flex-col cursor-pointer"
                    >
                      <span
                        className="absolute top-2 left-2 z-10 text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white"
                        style={{ background: C3 }}
                      >
                        -{p.descuento_porcentaje}%
                      </span>
                      <div className="h-20 bg-gradient-to-br from-[#f0f2ec] to-[#d8d8d8] flex items-center justify-center">
                        {p.imagen ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imagen} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span style={{ color: SAGE_DARK }}>
                            <IconoEtiqueta className="w-6 h-6" />
                          </span>
                        )}
                      </div>
                      <div className="p-2.5 flex flex-col gap-1">
                        {marca && (
                          <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: SAGE_DARK }}>
                            {marca.nombre}
                          </p>
                        )}
                        <p className="text-[12px] font-extrabold leading-tight line-clamp-2">{tr(p.nombre, p.nombre_en, p.nombre_pt)}</p>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <span className="text-[13px] font-extrabold" style={{ color: C3 }}>
                            {formatoPrecio(precioConDescuento(p))}
                          </span>
                          <span className="text-[10px] text-[#a8a8a8] line-through">{formatoPrecio(p.precio_venta)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {pantalla === "resultado" && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={volverDesdeResultado} onInicio={volverAInicio} />
          <div className="flex-1 px-6 pt-6 pb-10 max-w-3xl mx-auto w-full">
            <h3 className="text-lg font-extrabold mb-3">¿Tenés alguna preferencia?</h3>
            <div className="flex flex-wrap gap-2 mb-8">
              {filtros.length === 0 && (
                <p className="text-[#686868] text-sm">Todavía no cargaste preferencias en Catálogo asesor.</p>
              )}
              {filtros.map((f) => {
                const on = filtrosSeleccionados.has(f.id_filtro);
                return (
                  <button
                    key={f.id_filtro}
                    onClick={() => toggleFiltro(f.id_filtro)}
                    className="rounded-full border px-3.5 py-2 text-[13px] font-bold transition-colors"
                    style={
                      on
                        ? { background: SAGE_TINT, borderColor: SAGE, color: SAGE_DARK }
                        : { background: "#fff", borderColor: "#d8d8d8", color: "#686868" }
                    }
                  >
                    {tr(f.nombre, f.nombre_en, f.nombre_pt)}
                  </button>
                );
              })}
            </div>

            <h3 className="text-lg font-extrabold mb-1">{t("resultadoTitulo")}</h3>
            <p className="text-[13px] text-[#686868] mb-5">
              {productosFiltrados.length} producto{productosFiltrados.length === 1 ? "" : "s"} disponible
              {productosFiltrados.length === 1 ? "" : "s"} en WiiGo
            </p>

            {productosFiltrados.length === 0 ? (
              <p className="text-[#686868] text-sm text-center py-12">
                No encontramos productos con esa combinación — probá sacando alguna preferencia.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {productosFiltrados.map((p) => {
                  const { texto, tag } = porQue(p);
                  const marca = marcaPorId[p.id_marca];
                  return (
                    <div
                      key={p.id_producto}
                      onClick={() => setProductoAbierto(p.id_producto)}
                      className="rounded-xl border border-[#d8d8d8] bg-white overflow-hidden shadow-sm flex flex-col cursor-pointer"
                    >
                      <div className="h-20 bg-gradient-to-br from-[#f0f2ec] to-[#d8d8d8] flex items-center justify-center">
                        {p.imagen ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imagen} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span style={{ color: SAGE_DARK }}>
                            <IconoBolsa className="w-6 h-6" />
                          </span>
                        )}
                      </div>
                      <div className="p-2.5 flex flex-col gap-1">
                        {marca && (
                          <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: SAGE_DARK }}>
                            {marca.nombre}
                          </p>
                        )}
                        <p className="text-[12px] font-extrabold leading-tight line-clamp-2">{tr(p.nombre, p.nombre_en, p.nombre_pt)}</p>
                        {texto && <p className="text-[10px] text-[#686868] leading-snug">{texto}</p>}
                        <div className="flex flex-col gap-1 mt-1">
                          <span className="text-[13px] font-extrabold">{formatoPrecio(p.precio_venta)}</span>
                          {tag && (
                            <span
                              className="self-start text-[9px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: SAGE_TINT, color: SAGE_DARK }}
                            >
                              {tag}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {pantalla === "profesionales" && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={volverAInicio} onInicio={volverAInicio} />
          <div className="flex-1 px-6 pt-6 pb-10 max-w-md mx-auto w-full">
            <h2 className="text-2xl font-extrabold mb-4">Profesionales</h2>

            {categoriasProf.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-5">
                {categoriasProf.map((cat) => {
                  const on = categoriaProf === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleCategoriaProf(cat)}
                      className="rounded-full border px-3.5 py-2 text-[12px] font-bold"
                      style={
                        on
                          ? { background: SAGE_TINT, borderColor: SAGE, color: SAGE_DARK }
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
              <p className="text-[#686868] text-sm text-center py-12">
                Todav&iacute;a no hay profesionales cargados ac&aacute;.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {profesionalesFiltrados.map((prof) => (
                  <button
                    key={prof.id_profesional}
                    onClick={() => irAFichaProfesional(prof.id_profesional)}
                    className="rounded-2xl border border-[#d8d8d8] bg-white p-4 shadow-sm flex gap-4 text-left"
                  >
                    <span className="w-24 h-24 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center font-extrabold text-[30px]" style={{ background: SAGE_TINT, color: SAGE_DARK }}>
                      {prof.foto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={prof.foto} alt="" className="w-full h-full object-cover" />
                      ) : (
                        prof.nombre.charAt(0).toUpperCase()
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-extrabold leading-tight">
                        {prof.nombre} {prof.apellido ?? ""}
                      </p>
                      {(prof.titulo || prof.especialidad) && (
                        <p className="text-[11px] font-bold" style={{ color: SAGE_DARK }}>
                          {[prof.titulo, prof.especialidad].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      <span className="text-[10px] font-bold mt-1 inline-block" style={{ color: SAGE_DARK }}>
                        Tocá para ver más ›
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
          <Navbar onVolver={() => setPantalla("profesionales")} onInicio={volverAInicio} />
          <div className="flex-1 px-6 pt-4 pb-10 max-w-md mx-auto w-full flex flex-col">
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
                <p className="text-[21px] font-extrabold text-white leading-tight">
                  {profesionalActual.nombre} {profesionalActual.apellido ?? ""}
                </p>
                {(profesionalActual.titulo || profesionalActual.especialidad) && (
                  <p className="text-[11px] font-bold text-white/90">
                    {[profesionalActual.titulo, profesionalActual.especialidad].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            </div>

            {profesionalActual.bio && (
              <p className="text-[13px] italic leading-relaxed mb-3 pl-3 border-l-2" style={{ borderColor: CLAY, color: "#2d2d2d" }}>
                {profesionalActual.bio}
              </p>
            )}

            {fortalezasDelProfesionalActual.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
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

            <div className="mt-auto flex flex-col gap-2">
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
          <Navbar onVolver={() => setPantalla("fichaProfesional")} onInicio={volverAInicio} />
          <div className="flex-1 px-6 pt-4 pb-6 max-w-md mx-auto w-full flex flex-col">
            {eligiendoModalidadTurno && (
              <>
                <h2 className="text-xl font-extrabold mb-1">Reservar turno</h2>
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

          <div className="flex-1 px-6 pt-5 pb-4 flex flex-col max-w-md mx-auto w-full">
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
  idioma,
  onClose,
}: {
  producto: Producto;
  marca: Marca | undefined;
  ficha: FichaProducto | null;
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

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(20,17,13,.55)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[94vh] overflow-y-auto"
        style={{
          background: "#e9ede0",
          transform: abierto ? "translateY(0)" : "translateY(24px)",
          transition: "transform .4s cubic-bezier(.2,.8,.2,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-52 overflow-hidden">
          <div
            className="absolute inset-0 bg-gradient-to-br from-[#f0f2ec] to-[#d8d8d8] flex items-center justify-center"
            style={{
              transform: abierto ? "scale(1)" : "scale(1.12)",
              transition: "transform .9s cubic-bezier(.2,.8,.2,1)",
            }}
          >
            {fotoActiva ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fotoActiva} alt="" className="w-full h-full object-cover" />
            ) : (
              <span style={{ color: SAGE_DARK }}>
                <IconoBolsa className="w-10 h-10" />
              </span>
            )}
          </div>
          <div
            className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
            style={{ background: "linear-gradient(to top, rgba(20,17,13,.45), transparent)" }}
          />
          {ficha?.origen && (
            <span
              className="absolute top-3.5 left-3.5 text-white text-[10.5px] font-medium px-3 py-1.5 rounded-full"
              style={{ background: "rgba(255,255,255,.28)", backdropFilter: "blur(6px)" }}
            >
              📍 {traducir(idioma, ficha.origen, ficha.origen_en, ficha.origen_pt)}
            </span>
          )}
          <button
            onClick={onClose}
            className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full text-white font-bold flex items-center justify-center"
            style={{ background: "rgba(255,255,255,.28)", backdropFilter: "blur(6px)" }}
          >
            ✕
          </button>
          {ficha?.clasificacion && (
            <div
              className="absolute left-4 -bottom-7 w-16 h-16 rounded-full bg-white flex flex-col items-center justify-center text-center"
              style={{
                border: `2px solid ${SAGE_DARK}`,
                boxShadow: "0 8px 20px -8px rgba(0,0,0,.35)",
                opacity: abierto ? 1 : 0,
                transform: abierto ? "translateY(0) scale(1)" : "translateY(6px) scale(.85)",
                transition: "all .5s cubic-bezier(.2,.8,.2,1) .35s",
              }}
            >
              <span className="text-[15px] leading-none">🌿</span>
              <span className="text-[6.5px] font-extrabold tracking-wide mt-0.5" style={{ color: SAGE_DARK }}>
                {ficha.clasificacion}
              </span>
            </div>
          )}
        </div>

        {fotos.length > 1 && (
          <div className="flex gap-2 px-4 pt-3">
            {fotos.map((f) => (
              <button
                key={f}
                onClick={() => setFotoActiva(f)}
                className="w-11 h-11 rounded-lg overflow-hidden border-2 shrink-0"
                style={{ borderColor: f === fotoActiva ? SAGE_DARK : "#e5e5e5" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="pt-9 pb-5 px-4 flex flex-col gap-4">
          <div
            style={{
              opacity: abierto ? 1 : 0,
              transform: abierto ? "translateY(0)" : "translateY(10px)",
              transition: "all .5s ease .15s",
            }}
          >
            {marca && (
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: SAGE_DARK }}>
                {marca.nombre}
              </p>
            )}
            <h3 className={`${bodoniModa.className} italic text-2xl leading-tight mt-0.5`}>
              {traducir(idioma, producto.nombre, producto.nombre_en, producto.nombre_pt)}
            </h3>
            <div className="flex items-baseline gap-2 mt-1.5">
              <span
                className={`${fredoka.className} text-lg font-semibold`}
                style={{ color: (producto.descuento_porcentaje ?? 0) > 0 ? C3 : "#2d2d2d" }}
              >
                {formatoPrecio(precioConDescuento(producto))}
              </span>
              {(producto.descuento_porcentaje ?? 0) > 0 && (
                <span className="text-sm text-[#a8a8a8] line-through">{formatoPrecio(producto.precio_venta)}</span>
              )}
            </div>
          </div>

          {ficha?.descripcion_publica && (
            <p
              className="text-[13.5px] leading-relaxed text-[#686868]"
              style={{
                opacity: abierto ? 1 : 0,
                transform: abierto ? "translateY(0)" : "translateY(10px)",
                transition: "all .5s ease .25s",
              }}
            >
              {traducir(idioma, ficha.descripcion_publica, ficha.descripcion_publica_en, ficha.descripcion_publica_pt)}
            </p>
          )}

          <div
            className="h-px"
            style={{ background: `linear-gradient(to right, transparent, ${SAGE_DARK}80, transparent)` }}
          />

          {(ficha?.kcal_100g !== null && ficha?.kcal_100g !== undefined) || macros.length > 0 ? (
            <div
              className="flex flex-col items-center gap-3.5"
              style={{
                opacity: abierto ? 1 : 0,
                transform: abierto ? "translateY(0)" : "translateY(10px)",
                transition: "all .5s ease .3s",
              }}
            >
              <p className="text-[10.5px] font-bold uppercase tracking-widest text-[#8a8a8a] self-start">
                {idioma === "en"
                  ? "Nutrition facts · per 100 g"
                  : idioma === "pt"
                    ? "Informação nutricional · a cada 100 g"
                    : "Información nutricional · cada 100 g"}
              </p>

              {ficha?.kcal_100g !== null && ficha?.kcal_100g !== undefined && (
                <div
                  className="w-[124px] h-[124px] rounded-full flex items-center justify-center"
                  style={
                    {
                      "--p": abierto ? "72%" : "0%",
                      background: `conic-gradient(from -90deg, #6fa050 0%, #cfe8a6 var(--p), #ededed var(--p))`,
                      transition: "--p 1.1s cubic-bezier(.2,.8,.2,1) .45s",
                    } as React.CSSProperties
                  }
                >
                  <div className="w-[96px] h-[96px] rounded-full bg-white flex flex-col items-center justify-center">
                    <span className={`${fredoka.className} text-2xl font-semibold`}>{ficha.kcal_100g}</span>
                    <span className="text-[9px] tracking-widest text-[#8a8a8a] mt-0.5">KCAL</span>
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
                        className="w-16 rounded-2xl bg-white border border-[#e5e5e5] flex flex-col items-center gap-0.5 py-2"
                        style={{
                          transform: activa ? "scale(1.08)" : "scale(1)",
                          boxShadow: activa ? "0 8px 18px -8px rgba(0,0,0,.25)" : "none",
                          borderColor: activa ? "transparent" : "#e5e5e5",
                          opacity: macroActiva && !activa ? 0.45 : 1,
                          transition: "all .2s ease",
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: info.fuerte }} />
                        <span className={`${fredoka.className} text-xs font-semibold`}>{m.valor}g</span>
                        <span className="text-[8px] text-[#8a8a8a] text-center leading-tight">{info.label[idioma]}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div
                className="w-full rounded-2xl overflow-hidden"
                style={{
                  maxHeight: macroSeleccionada ? 80 : 0,
                  padding: macroSeleccionada ? "10px 14px" : "0 14px",
                  background: macroSeleccionada ? MACROS_INFO[macroSeleccionada.label].claro : "transparent",
                  transition: "max-height .35s ease, padding .35s ease",
                }}
              >
                {macroSeleccionada && (
                  <p className="text-[11.5px] leading-relaxed text-[#2d2d2d] m-0">
                    {MACROS_INFO[macroSeleccionada.label].explicacion(macroSeleccionada.valor, idioma)}
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {ficha?.ingredientes && (
            <div className="border-t border-[#ededed]">
              <button
                onClick={() => setIngredientesAbierto((v) => !v)}
                className="w-full flex items-center justify-between py-3.5"
              >
                <span className="text-[13px] font-bold">
                  {idioma === "en" ? "Ingredients" : idioma === "pt" ? "Ingredientes" : "Ingredientes"}
                </span>
                <span
                  className="text-[#8a8a8a]"
                  style={{ transition: "transform .3s ease", transform: ingredientesAbierto ? "rotate(180deg)" : "none" }}
                >
                  ⌄
                </span>
              </button>
              <div
                className="overflow-hidden"
                style={{ maxHeight: ingredientesAbierto ? 160 : 0, transition: "max-height .35s ease" }}
              >
                <p className="text-[12.5px] leading-relaxed text-[#3d3d3d] pb-3.5">
                  {traducir(idioma, ficha.ingredientes, ficha.ingredientes_en, ficha.ingredientes_pt)}
                </p>
              </div>
            </div>
          )}

          {ficha?.micronutrientes && (
            <div className="border-t border-[#ededed]">
              <button
                onClick={() => setMicronutrientesAbierto((v) => !v)}
                className="w-full flex items-center justify-between py-3.5"
              >
                <span className="text-[13px] font-bold">
                  {idioma === "en" ? "Micronutrients" : "Micronutrientes"}
                </span>
                <span
                  className="text-[#8a8a8a]"
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
                style={{ maxHeight: micronutrientesAbierto ? 160 : 0, transition: "max-height .35s ease" }}
              >
                <p className="text-[12.5px] leading-relaxed text-[#3d3d3d] pb-3.5">
                  {traducir(idioma, ficha.micronutrientes, ficha.micronutrientes_en, ficha.micronutrientes_pt)}
                </p>
              </div>
            </div>
          )}

          {ficha?.porcion && (
            <span
              className="self-start text-[10px] font-bold px-3 py-1.5 rounded-full"
              style={{ background: SAGE_TINT, color: SAGE_DARK }}
            >
              {idioma === "en" ? "Suggested serving" : idioma === "pt" ? "Porção sugerida" : "Porción sugerida"}:{" "}
              {traducir(idioma, ficha.porcion, ficha.porcion_en, ficha.porcion_pt)}
            </span>
          )}

          {ficha?.video && (
            <a
              href={ficha.video}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] font-bold underline"
              style={{ color: SAGE_DARK }}
            >
              Ver video ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
