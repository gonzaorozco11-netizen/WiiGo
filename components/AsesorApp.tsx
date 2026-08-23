"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import type { Local, Marca, Producto, Objetivo, FiltroProducto, FichaProducto, Subcategoria } from "@/lib/supabase";

type Pantalla = "home" | "objetivo" | "resultado" | "marcas" | "ofertas" | "proximamente";

const SAGE = "#b6bca2";
const SAGE_DARK = "#646759";
const SAGE_TINT = "#f0f2ec";
const C1 = "#8fa377"; // encontrar productos
const C2 = "#d99a5b"; // marcas y productos
const C3 = "#d97561"; // ofertas
const C4 = "#5f92a8"; // profesionales

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
  const [seccionProximamente, setSeccionProximamente] = useState("");
  const [marcaId, setMarcaId] = useState<string | null>(null);
  const [subcategoriaId, setSubcategoriaId] = useState<string | null>(null);

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

  function irAObjetivo() {
    setBusqueda("");
    setObjetivoId(null);
    setFiltrosSeleccionados(new Set());
    setPantalla("objetivo");
  }

  function irAProximamente(nombre: string) {
    setSeccionProximamente(nombre);
    setPantalla("proximamente");
  }

  function irAMarcas() {
    setMarcaId(null);
    setSubcategoriaId(null);
    setPantalla("marcas");
  }

  function toggleMarca(id: string) {
    setSubcategoriaId(null);
    setMarcaId((actual) => (actual === id ? null : id));
  }

  function toggleSubcategoria(id: string) {
    setSubcategoriaId((actual) => (actual === id ? null : id));
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
  }

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
            <button onClick={() => setPantalla("ofertas")} className="flex flex-col items-center gap-3 rounded-2xl border border-[#d8d8d8] bg-white p-6 shadow-sm aspect-square justify-center">
              <span className="flex items-center justify-center w-14 h-14 rounded-full text-white" style={{ background: C3 }}>
                <IconoEtiqueta className="w-7 h-7" />
              </span>
              <span className="text-[15px] font-extrabold leading-tight">Ofertas</span>
            </button>
            <button onClick={() => irAProximamente("Profesionales")} className="flex flex-col items-center gap-3 rounded-2xl border border-[#d8d8d8] bg-white p-6 shadow-sm aspect-square justify-center">
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
                      className="flex items-center justify-center w-7 h-7 rounded-full font-extrabold text-[12px] shrink-0"
                      style={on ? { background: "rgba(255,255,255,.5)" } : { background: SAGE_TINT, color: SAGE_DARK }}
                    >
                      {m.nombre.charAt(0).toUpperCase()}
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
            <h2 className="text-2xl font-extrabold mb-1">Ofertas</h2>
            <p className="text-[13px] text-[#686868] mb-5">
              {productosEnOferta.length} producto{productosEnOferta.length === 1 ? "" : "s"} con descuento
            </p>

            {productosEnOferta.length === 0 ? (
              <p className="text-[#686868] text-sm text-center py-12">
                Por ahora no hay productos con descuento cargado.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {productosEnOferta.map((p) => {
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

      {pantalla === "proximamente" && (
        <div className="flex-1 flex flex-col">
          <Navbar onVolver={volverAInicio} onInicio={volverAInicio} />
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
            <span className="flex items-center justify-center w-16 h-16 rounded-full text-white mb-2" style={{ background: SAGE }}>
              <IconoEtiqueta className="w-8 h-8" />
            </span>
            <h2 className="text-xl font-extrabold">{seccionProximamente}</h2>
            <p className="text-[#686868] text-sm max-w-xs">Muy pronto vas a poder ver esta sección acá. Estamos trabajando en eso.</p>
          </div>
        </div>
      )}

      <p className="sr-only">Local: {local.nombre}</p>
    </div>
  );
}
