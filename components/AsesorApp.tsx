"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
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
      {pantalla === "home" && (
        <div className="flex-1 flex flex-col items-center px-6 pt-14 pb-8 text-center bg-gradient-to-b from-[#fbfbfb] to-[#f0f2ec]">
          <div className="w-full max-w-xs mb-8">
            <Image src="/wiigo-logo.png" alt="WiiGo — Estaciones de bienestar" width={2172} height={448} className="w-full h-auto drop-shadow-sm" priority />
          </div>
          <p className="text-[15px] font-bold text-[#686868] mb-6">¿Qué estás buscando hoy?</p>

          <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
            <button onClick={irAObjetivo} className="flex flex-col items-center gap-3 rounded-2xl border border-[#d8d8d8] bg-white p-6 shadow-sm aspect-square justify-center">
              <span className="flex items-center justify-center w-14 h-14 rounded-full text-white" style={{ background: C1 }}>
                <IconoBuscar className="w-7 h-7" />
              </span>
              <span className="text-[15px] font-extrabold leading-tight">Encontrar<br />productos para mí</span>
            </button>
            <button onClick={irAMarcas} className="flex flex-col items-center gap-3 rounded-2xl border border-[#d8d8d8] bg-white p-6 shadow-sm aspect-square justify-center">
              <span className="flex items-center justify-center w-14 h-14 rounded-full text-white" style={{ background: C2 }}>
                <IconoBolsa className="w-7 h-7" />
              </span>
              <span className="text-[15px] font-extrabold leading-tight">Marcas y<br />productos</span>
            </button>
            <button onClick={irAOfertas} className="flex flex-col items-center gap-3 rounded-2xl border border-[#d8d8d8] bg-white p-6 shadow-sm aspect-square justify-center">
              <span className="flex items-center justify-center w-14 h-14 rounded-full text-white" style={{ background: C3 }}>
                <IconoEtiqueta className="w-7 h-7" />
              </span>
              <span className="text-[15px] font-extrabold leading-tight">Ofertas</span>
            </button>
            <button onClick={() => setPantalla("profesionales")} className="flex flex-col items-center gap-3 rounded-2xl border border-[#d8d8d8] bg-white p-6 shadow-sm aspect-square justify-center">
              <span className="flex items-center justify-center w-14 h-14 rounded-full text-white" style={{ background: C4 }}>
                <IconoPersona className="w-7 h-7" />
              </span>
              <span className="text-[15px] font-extrabold leading-tight">Profesionales</span>
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
              placeholder="Buscar producto o marca..."
              className="flex-1 bg-transparent outline-none text-[14px] font-medium text-[#2d2d2d] placeholder:text-[#a8a8a8]"
            />
          </div>
        </div>
      )}

      {pantalla === "objetivo" && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={volverAInicio} onInicio={volverAInicio} />
          <div className="flex-1 px-6 pt-6 pb-10">
            <h2 className="text-2xl font-extrabold mb-6">¿Cuál es tu objetivo hoy?</h2>
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
                  <span className="text-[15px] font-bold">{o.nombre}</span>
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
                        <div key={p.id_producto} className="rounded-xl border border-[#d8d8d8] bg-white overflow-hidden shadow-sm flex flex-col">
                          <div className="h-20 bg-gradient-to-br from-[#f0f2ec] to-[#d8d8d8] flex items-center justify-center">
                            {(ficha?.imagen_principal || p.imagen) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={ficha?.imagen_principal || p.imagen || ""} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span style={{ color: SAGE_DARK }}>
                                <IconoBolsa className="w-6 h-6" />
                              </span>
                            )}
                          </div>
                          <div className="p-2.5 flex flex-col gap-1">
                            <p className="text-[12px] font-extrabold leading-tight line-clamp-2">{p.nombre}</p>
                            {ficha?.descripcion_publica && (
                              <p className="text-[10px] text-[#686868] leading-snug line-clamp-2">{ficha.descripcion_publica}</p>
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
                  const ficha = fichaPorProducto[p.id_producto];
                  const marca = marcaPorId[p.id_marca];
                  return (
                    <div key={p.id_producto} className="relative rounded-xl border border-[#d8d8d8] bg-white overflow-hidden shadow-sm flex flex-col">
                      <span
                        className="absolute top-2 left-2 z-10 text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white"
                        style={{ background: C3 }}
                      >
                        -{p.descuento_porcentaje}%
                      </span>
                      <div className="h-20 bg-gradient-to-br from-[#f0f2ec] to-[#d8d8d8] flex items-center justify-center">
                        {(ficha?.imagen_principal || p.imagen) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={ficha?.imagen_principal || p.imagen || ""} alt="" className="w-full h-full object-cover" />
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
                        <p className="text-[12px] font-extrabold leading-tight line-clamp-2">{p.nombre}</p>
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
                    {f.nombre}
                  </button>
                );
              })}
            </div>

            <h3 className="text-lg font-extrabold mb-1">Te recomendamos</h3>
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
                  const ficha = fichaPorProducto[p.id_producto];
                  return (
                    <div key={p.id_producto} className="rounded-xl border border-[#d8d8d8] bg-white overflow-hidden shadow-sm flex flex-col">
                      <div className="h-20 bg-gradient-to-br from-[#f0f2ec] to-[#d8d8d8] flex items-center justify-center">
                        {(ficha?.imagen_principal || p.imagen) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={ficha?.imagen_principal || p.imagen || ""} alt="" className="w-full h-full object-cover" />
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
                        <p className="text-[12px] font-extrabold leading-tight line-clamp-2">{p.nombre}</p>
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

      <p className="sr-only">Local: {local.nombre}</p>
    </div>
  );
}
