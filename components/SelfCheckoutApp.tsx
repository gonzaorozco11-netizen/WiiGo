"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Local, Marca, Producto, VarianteProducto, Stock } from "@/lib/supabase";
import type { Clima } from "@/lib/clima";
import {
  confirmarPedido,
  estadoPedido,
  cancelarPedidoCliente,
  buscarProfesionalPorDniAction,
  buscarClientePorDniAction,
  buscarCodigoProfesionalAction,
  previsualizarDescuentoReferidoAction,
  infoCanjePuntosAction,
  obtenerStockLocal,
} from "@/app/self-checkout/[idLocal]/actions";

const STOCK_POLL_MS = 8000;

type Item = {
  variante: VarianteProducto;
  producto: Producto;
  marca: Marca | undefined;
  precio: number;
  cantidadDisponible: number;
};

type ItemCarrito = Item & { cantidad: number };

type Paso = "reposo" | "escaneo" | "identificar" | "pagar" | "efectivo-esperando" | "mp-esperando" | "pagado" | "cancelado";
type MedioPago = "EFECTIVO" | "MERCADO_PAGO";

const POLL_MS = 3000;
const TOAST_MS = 2500;

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearPedido(numero: number) {
  return `VTA-${String(numero).padStart(4, "0")}`;
}

function precioFinal(producto: Producto, variante: VarianteProducto) {
  const base = variante.precio_venta ?? producto.precio_venta ?? 0;
  const descuento = producto.descuento_porcentaje ?? 0;
  return descuento > 0 ? Math.round(base * (1 - descuento / 100)) : base;
}

// Tormenta reusa la misma foto de lluvia, oscurecida por CSS (ver
// .sc-tormenta-foto) — no hace falta una cuarta foto para eso.
const FOTOS_CLIMA: Record<Clima, string> = {
  soleado: "/clima/soleado.jpg",
  nublado: "/clima/nublado.jpg",
  lluvia: "/clima/lluvia.jpg",
  tormenta: "/clima/lluvia.jpg",
};

export default function SelfCheckoutApp({
  local,
  productos,
  variantes,
  marcas,
  stock,
  clima,
}: {
  local: Local;
  productos: Producto[];
  variantes: VarianteProducto[];
  marcas: Marca[];
  stock: Stock[];
  clima: Clima;
}) {
  const [paso, setPaso] = useState<Paso>("reposo");

  // El totem queda prendido todo el día sin que nadie lo recargue — el
  // stock que trajo el servidor al abrirse la pestaña se iría
  // desactualizando con cada entrega, ajuste o venta que pase mientras
  // tanto en cualquier otro lado (POS, otro totem, Stock). Se vuelve a
  // consultar solo, todo el tiempo, para que el disponible que ve el
  // cliente sea siempre el real.
  const [stockEnVivo, setStockEnVivo] = useState<Map<string, number>>(
    () => new Map(stock.map((s) => [s.id_variante, s.cantidad]))
  );
  useEffect(() => {
    let cancelado = false;
    async function actualizar() {
      try {
        const filas = await obtenerStockLocal(local.id_local);
        if (cancelado || filas.length === 0) return;
        // Se actualiza solo lo que efectivamente llegó en esta consulta —
        // nunca se reemplaza el mapa entero. Así, si una consulta viene
        // incompleta (falta algún producto puntual, algo que puede pasar
        // ante un problema pasajero del lado de la base de datos), ese
        // producto conserva su último stock bueno conocido en vez de
        // quedar en 0 por error.
        setStockEnVivo((prev) => {
          const map = new Map(prev);
          filas.forEach((f) => map.set(f.idVariante, f.cantidad));
          return map;
        });
      } catch {
        // Falla de red pasajera — se mantiene el último stock conocido.
      }
    }
    const id = setInterval(actualizar, STOCK_POLL_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [local.id_local]);

  // El catálogo (productos/variantes/precios nuevos) sí necesita una
  // recarga completa — pero solo mientras está en reposo, nunca en medio
  // de una compra.
  useEffect(() => {
    if (paso !== "reposo") return;
    const id = setInterval(() => window.location.reload(), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [paso]);

  // Gotas de la pantalla de reposo con lluvia/tormenta — se calculan una
  // sola vez por clima (no en cada render) para que no "salten" de lugar.
  const gotas = useMemo(() => {
    if (clima !== "lluvia" && clima !== "tormenta") return [];
    const cantidad = clima === "tormenta" ? 75 : 45;
    const velocidad = clima === "tormenta" ? 1.6 : 0.9;
    const minLen = clima === "tormenta" ? 18 : 14;
    const maxLen = clima === "tormenta" ? 28 : 20;
    return Array.from({ length: cantidad }, () => ({
      left: Math.random() * 110 - 5,
      height: minLen + Math.random() * (maxLen - minLen),
      opacity: 0.4 + Math.random() * 0.5,
      duration: (0.45 + Math.random() * 0.35) / velocidad,
      delay: -Math.random() * 2,
    }));
  }, [clima]);

  // Relámpago al azar en tormenta — cambiar la key remonta el div y
  // reinicia la animación CSS cada vez, sin necesidad de refs.
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (clima !== "tormenta") return;
    const id = setInterval(() => setFlashKey((k) => k + 1), 3200 + Math.random() * 2600);
    return () => clearInterval(id);
  }, [clima]);

  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [dni, setDni] = useState("");
  const [codigoProfesional, setCodigoProfesional] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [medioPagoElegido, setMedioPagoElegido] = useState<MedioPago>("EFECTIVO");

  const [pedido, setPedido] = useState<{
    idVenta: string;
    numero: number;
    total: number;
    descuento: number;
    qrImagen?: string;
  } | null>(
    null
  );
  const [profesional, setProfesional] = useState<{
    idProfesional: string;
    nombre: string;
    tienePin: boolean;
    saldosPorMarca: { idMarca: string; nombreMarca: string; saldo: number; tipoRecompensa: string }[];
  } | null>(null);
  const [marcasCanje, setMarcasCanje] = useState<Set<string>>(new Set());
  const [pinCanje, setPinCanje] = useState("");
  const [codigoInfo, setCodigoInfo] = useState<{ nombre: string | null; error: string | null } | null>(null);
  const [buscandoCodigo, setBuscandoCodigo] = useState(false);
  const [clienteInfo, setClienteInfo] = useState<{ existe: boolean; puntos: number; nombre: string | null } | null>(null);
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [infoPuntos, setInfoPuntos] = useState<{
    puntosDisponibles: number;
    valorPorPunto: number;
    topePorcentaje: number;
    maxDescuento: number;
    puntosNecesarios: number;
  } | null>(null);
  const [usarPuntosWiigo, setUsarPuntosWiigo] = useState(false);

  // El mismo DNI que identifica al cliente también identifica si es un
  // profesional que puede pagar con el saldo que acumuló vendiendo marcas.
  useEffect(() => {
    const dniLimpio = dni.trim();
    if (dniLimpio.length < 6) {
      setProfesional(null);
      setMarcasCanje(new Set());
      return;
    }
    const timeout = setTimeout(() => {
      buscarProfesionalPorDniAction(dniLimpio).then(setProfesional);
    }, 400);
    return () => clearTimeout(timeout);
  }, [dni]);

  // Aviso en vivo de que el DNI se está reconociendo — sin esto el campo
  // queda mudo mientras se escribe (el cliente se identifica/crea recién al
  // confirmar el pedido, ver confirmarPedido en actions.ts).
  useEffect(() => {
    const dniLimpio = dni.trim();
    if (dniLimpio.length < 6) {
      setClienteInfo(null);
      return;
    }
    setBuscandoCliente(true);
    const timeout = setTimeout(() => {
      buscarClientePorDniAction(dniLimpio)
        .then(setClienteInfo)
        .finally(() => setBuscandoCliente(false));
    }, 400);
    return () => clearTimeout(timeout);
  }, [dni]);

  // Confirmar en vivo si el código de profesional existe, misma idea que el DNI.
  useEffect(() => {
    const codigoLimpio = codigoProfesional.trim();
    if (!codigoLimpio) {
      setCodigoInfo(null);
      return;
    }
    setBuscandoCodigo(true);
    const timeout = setTimeout(() => {
      buscarCodigoProfesionalAction(codigoLimpio)
        .then(setCodigoInfo)
        .finally(() => setBuscandoCodigo(false));
    }, 400);
    return () => clearTimeout(timeout);
  }, [codigoProfesional]);

  const [toast, setToast] = useState<{ nombre: string; precio: number } | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [busquedaTexto, setBusquedaTexto] = useState("");

  const searchInputRef = useRef<HTMLInputElement>(null);

  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id_producto, p])), [productos]);
  const marcaPorId = useMemo(() => new Map(marcas.map((m) => [m.id_marca, m])), [marcas]);
  const stockPorVariante = stockEnVivo;

  const items = useMemo<Item[]>(() => {
    return variantes
      .map((variante) => {
        const producto = productoPorId.get(variante.id_producto);
        if (!producto) return null;
        const cantidadDisponible = stockPorVariante.get(variante.id_variante) ?? 0;
        if (cantidadDisponible <= 0) return null;
        return {
          variante,
          producto,
          marca: marcaPorId.get(producto.id_marca),
          precio: precioFinal(producto, variante),
          cantidadDisponible,
        };
      })
      .filter((i): i is Item => i !== null)
      .sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre));
  }, [variantes, productoPorId, marcaPorId, stockPorVariante]);

  const itemPorVariante = useMemo(() => new Map(items.map((i) => [i.variante.id_variante, i])), [items]);

  const resultadosBusqueda = useMemo(() => {
    const q = busquedaTexto.trim().toLowerCase();
    if (!q) return [];
    return items.filter((i) => i.producto.nombre.toLowerCase().includes(q)).slice(0, 20);
  }, [items, busquedaTexto]);

  const itemsCarrito = useMemo<ItemCarrito[]>(() => {
    return Object.entries(carrito)
      .map(([idVariante, cantidad]) => {
        const item = itemPorVariante.get(idVariante);
        return item ? { ...item, cantidad } : null;
      })
      .filter((i): i is ItemCarrito => i !== null);
  }, [carrito, itemPorVariante]);

  const totalItemsCarrito = itemsCarrito.reduce((acc, i) => acc + i.cantidad, 0);
  const subtotalCarrito = itemsCarrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0);

  // Marcas presentes en el carrito con el saldo del profesional para cada
  // una — si el saldo no cubre todo el importe de esa marca, se aplica como
  // descuento parcial (lo que haya disponible) y el resto se paga normal.
  const marcasEnCarrito = useMemo(() => {
    const subtotalPorMarca = new Map<string, number>();
    for (const i of itemsCarrito) {
      if (!i.producto.id_marca) continue;
      subtotalPorMarca.set(i.producto.id_marca, (subtotalPorMarca.get(i.producto.id_marca) ?? 0) + i.precio * i.cantidad);
    }
    if (!profesional) return [];
    return profesional.saldosPorMarca
      .filter((s) => subtotalPorMarca.has(s.idMarca))
      .map((s) => ({ ...s, subtotalCarrito: subtotalPorMarca.get(s.idMarca) ?? 0 }));
  }, [itemsCarrito, profesional]);

  const descuentoCanje = marcasEnCarrito
    .filter((m) => marcasCanje.has(m.idMarca))
    .reduce((acc, m) => acc + Math.min(m.subtotalCarrito, m.saldo), 0);

  // Vista previa en vivo del descuento que el código de profesional le da al
  // cliente (si la marca eligió "Descuento en el momento") — antes no se
  // consultaba nunca acá, así que el total en pantalla no bajaba aunque
  // confirmarPedido ya lo calculara bien.
  const [descuentoReferidoPreview, setDescuentoReferidoPreview] = useState(0);
  useEffect(() => {
    const codigoLimpio = codigoProfesional.trim();
    if (!codigoLimpio || itemsCarrito.length === 0) {
      setDescuentoReferidoPreview(0);
      return;
    }
    const timeout = setTimeout(() => {
      previsualizarDescuentoReferidoAction(
        codigoLimpio,
        itemsCarrito.map((i) => ({ idMarca: i.producto.id_marca, cantidad: i.cantidad, precioUnitario: i.precio }))
      ).then(setDescuentoReferidoPreview);
    }, 400);
    return () => clearTimeout(timeout);
  }, [codigoProfesional, itemsCarrito]);

  // Mismo orden que confirmarPedido: primero el descuento de referido,
  // después el canje con saldo propio del profesional, y recién sobre lo
  // que queda se calculan los puntos WiiGo del cliente.
  const totalConCanje = Math.max(subtotalCarrito - descuentoReferidoPreview - descuentoCanje, 0);
  const descuentoPuntosPreview = usarPuntosWiigo && infoPuntos ? infoPuntos.maxDescuento : 0;
  const totalFinal = Math.max(totalConCanje - descuentoPuntosPreview, 0);

  // Cuánto puede cubrir con sus puntos WiiGo sobre lo que le queda por pagar
  // — solo vista previa, el server recalcula todo al confirmar el pedido.
  useEffect(() => {
    const dniLimpio = dni.trim();
    if (dniLimpio.length < 6 || totalConCanje <= 0) {
      setInfoPuntos(null);
      return;
    }
    const timeout = setTimeout(() => {
      infoCanjePuntosAction(dniLimpio, totalConCanje).then(setInfoPuntos);
    }, 400);
    return () => clearTimeout(timeout);
  }, [dni, totalConCanje]);

  function toggleMarcaCanje(idMarca: string) {
    setMarcasCanje((prev) => {
      const next = new Set(prev);
      if (next.has(idMarca)) next.delete(idMarca);
      else next.add(idMarca);
      return next;
    });
  }

  const mostrarToast = useCallback((nombre: string, precio: number) => {
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    setToast({ nombre, precio });
    toastTimeout.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    };
  }, []);

  function agregarAlCarrito(idVariante: string) {
    const item = itemPorVariante.get(idVariante);
    if (!item) return;
    let agregado = false;
    setCarrito((prev) => {
      const actual = prev[idVariante] ?? 0;
      if (actual >= item.cantidadDisponible) return prev;
      agregado = true;
      return { ...prev, [idVariante]: actual + 1 };
    });
    if (agregado) mostrarToast(item.producto.nombre, item.precio);
  }

  // El lector de código de barras conecta como teclado: "escribe" el
  // código leído y remata con Enter, todo en milisegundos, en el mismo
  // buscador de arriba. Si lo que se tipeó matchea un código de barras
  // exacto, se agrega solo (comportamiento de escaneo); si no matchea,
  // se deja el texto tal cual para que el cliente elija de la lista que
  // se despliega abajo (búsqueda manual por nombre).
  function handleBuscadorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const valor = e.currentTarget.value.trim();
    if (!valor) return;
    const coincidencia = items.find((i) => i.variante.codigo_barras === valor);
    if (coincidencia) {
      agregarAlCarrito(coincidencia.variante.id_variante);
      setBusquedaTexto("");
    }
  }

  useEffect(() => {
    if (paso !== "escaneo") return;
    searchInputRef.current?.focus();
  }, [paso]);

  function cambiarCantidad(idVariante: string, delta: number) {
    setCarrito((prev) => {
      const item = itemPorVariante.get(idVariante);
      const actual = prev[idVariante] ?? 0;
      const nueva = actual + delta;
      if (nueva <= 0) {
        const { [idVariante]: _omit, ...resto } = prev;
        return resto;
      }
      if (item && nueva > item.cantidadDisponible) return prev;
      return { ...prev, [idVariante]: nueva };
    });
  }

  function volverAEmpezar() {
    setCarrito({});
    setDni("");
    setCodigoProfesional("");
    setPedido(null);
    setError(null);
    setBusquedaTexto("");
    setProfesional(null);
    setMarcasCanje(new Set());
    setPinCanje("");
    setInfoPuntos(null);
    setUsarPuntosWiigo(false);
    setPaso("reposo");
  }

  function handleConfirmar(medioPago: MedioPago) {
    setError(null);
    setEnviando(true);
    confirmarPedido(
      local.id_local,
      itemsCarrito.map((i) => ({
        idVariante: i.variante.id_variante,
        idMarca: i.producto.id_marca,
        cantidad: i.cantidad,
        precioUnitario: i.precio,
      })),
      dni,
      codigoProfesional,
      medioPago,
      profesional && marcasCanje.size > 0
        ? { idProfesional: profesional.idProfesional, pin: pinCanje, marcas: [...marcasCanje] }
        : undefined,
      usarPuntosWiigo
    )
      .then((r) => {
        if (r.error || !r.pedido) {
          setError(r.error ?? "Algo salió mal, probá de nuevo.");
          return;
        }
        setPedido(r.pedido);
        setPaso(medioPago === "EFECTIVO" ? "efectivo-esperando" : "mp-esperando");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Algo salió mal, probá de nuevo."))
      .finally(() => setEnviando(false));
  }

  // Mientras espera que confirmen el pago, el totem se fija solo cada
  // pocos segundos si ya cambió de estado — así pasa a la pantalla final
  // sin que el cliente tenga que tocar nada.
  useEffect(() => {
    if ((paso !== "efectivo-esperando" && paso !== "mp-esperando") || !pedido) return;
    const intervalo = setInterval(() => {
      estadoPedido(pedido.idVenta)
        .then((r) => {
          if (r.estado === "PAGADA") setPaso("pagado");
          else if (r.estado === "CANCELADA") setPaso("cancelado");
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(intervalo);
  }, [paso, pedido]);

  function handleCancelarPedido() {
    if (!pedido) {
      volverAEmpezar();
      return;
    }
    cancelarPedidoCliente(pedido.idVenta).finally(volverAEmpezar);
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col relative">
      <style>{`
        @keyframes sc-float3d {
          0%, 100% { transform: rotateX(9deg) rotateY(-11deg) translateY(0px); }
          50% { transform: rotateX(4deg) rotateY(11deg) translateY(-9px); }
        }
        @keyframes sc-shine {
          0% { transform: translateX(-40%) rotate(8deg); }
          45%, 100% { transform: translateX(220%) rotate(8deg); }
        }
        @keyframes sc-glow-pulse {
          0%, 100% { opacity: .55; transform: scale(0.96); }
          50% { opacity: .9; transform: scale(1.04); }
        }
        @keyframes sc-pulse-ring {
          0% { transform: scale(0.85); opacity: .9; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @keyframes sc-kenburns {
          0% { transform: scale(1) translate(0, 0); }
          100% { transform: scale(1.14) translate(-1.5%, -2%); }
        }
        .sc-clima-foto {
          position: absolute;
          inset: -4%;
          width: 108%;
          height: 108%;
          object-fit: cover;
          animation: sc-kenburns 22s ease-in-out infinite alternate;
        }
        .sc-tormenta-foto { filter: brightness(0.5) contrast(1.15) saturate(0.85); }
        @keyframes sc-gota-caer {
          from { transform: translate(0, 0); }
          to { transform: translate(-30px, 900px); }
        }
        .sc-gota {
          position: absolute;
          top: -8%;
          width: 1.5px;
          background: linear-gradient(rgba(220,235,255,0), rgba(220,235,255,.85));
          animation: sc-gota-caer linear infinite;
        }
        .sc-niebla {
          position: absolute; left: 0; right: 0; bottom: 0; height: 30%;
          background: linear-gradient(180deg, rgba(180,195,210,0), rgba(180,195,210,.32));
          pointer-events: none;
        }
        .sc-relampago {
          position: absolute; inset: 0;
          background: #d9e6ff;
          opacity: 0;
          pointer-events: none;
        }
        .sc-relampago.sc-flash { animation: sc-flash-anim .5s ease-out; }
        @keyframes sc-flash-anim {
          0% { opacity: 0; }
          8% { opacity: .8; }
          18% { opacity: .08; }
          26% { opacity: .55; }
          40% { opacity: 0; }
          100% { opacity: 0; }
        }
        .sc-logo-glow {
          position: absolute;
          inset: -30px;
          background: radial-gradient(circle, rgba(212,221,180,.5), rgba(212,221,180,0) 68%);
          filter: blur(6px);
          z-index: -1;
          animation: sc-glow-pulse 6s ease-in-out infinite;
        }
        .sc-logo-card {
          transform-style: preserve-3d;
          animation: sc-float3d 6.5s ease-in-out infinite;
        }
        .sc-logo-card::after {
          content: "";
          position: absolute;
          top: -60%; left: -20%;
          width: 60%; height: 220%;
          background: linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,.55) 48%, rgba(255,255,255,0) 66%);
          animation: sc-shine 5.5s ease-in-out infinite;
        }
        .sc-tap-hint::before {
          content: "";
          position: absolute; inset: -10px;
          border-radius: 9999px;
          border: 1.5px solid rgba(212,221,180,.55);
          animation: sc-pulse-ring 2.2s ease-out infinite;
        }
      `}</style>
      {paso !== "reposo" && (
        <header className="border-b border-neutral-200 bg-white shrink-0 px-5 py-3.5 flex items-center justify-between">
          <span className="font-extrabold tracking-tight text-neutral-900">WiiGo</span>
          {paso === "escaneo" || paso === "identificar" || paso === "pagar" || paso === "mp-esperando" ? (
            <button
              onClick={handleCancelarPedido}
              className="text-xs text-neutral-400 border border-neutral-200 rounded-full px-3 py-1"
            >
              Cancelar
            </button>
          ) : (
            <span className="text-xs text-neutral-400 text-right leading-tight">
              {local.nombre}
              <br />
              Terminal
            </span>
          )}
        </header>
      )}

      {paso === "reposo" && (
        <div
          onClick={() => setPaso("escaneo")}
          className="flex-1 relative overflow-hidden flex flex-col items-center justify-center gap-6 text-center px-10 cursor-pointer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={FOTOS_CLIMA[clima]}
            alt=""
            className={`sc-clima-foto${clima === "tormenta" ? " sc-tormenta-foto" : ""}`}
          />

          {(clima === "lluvia" || clima === "tormenta") && (
            <>
              {gotas.map((g, i) => (
                <span
                  key={i}
                  className="sc-gota"
                  style={{
                    left: `${g.left}%`,
                    height: g.height,
                    opacity: g.opacity,
                    animationDuration: `${g.duration}s`,
                    animationDelay: `${g.delay}s`,
                  }}
                />
              ))}
              <div className="sc-niebla" />
            </>
          )}
          {clima === "tormenta" && <div key={flashKey} className="sc-relampago sc-flash" />}

          <div className="relative" style={{ perspective: "1100px", zIndex: 2 }}>
            <div className="sc-logo-glow" />
            <div
              className="sc-logo-card relative overflow-hidden rounded-[28px] px-9 py-8"
              style={{
                width: 250,
                background: "linear-gradient(160deg, #ffffff 0%, #f4f5ef 100%)",
                boxShadow:
                  "0 40px 70px -24px rgba(0,0,0,.6), 0 14px 26px -12px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.8), inset 0 -6px 14px -6px rgba(0,0,0,.06)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/wiigo-logo.png"
                alt="WiiGo"
                className="w-full"
                style={{ filter: "drop-shadow(0 10px 14px rgba(30,35,20,.28))" }}
              />
            </div>
          </div>

          <h1 className="text-2xl font-extrabold text-white text-balance relative z-10">Tu compra, a tu ritmo</h1>

          <div className="sc-tap-hint relative w-12 h-12 rounded-full bg-white/10 border border-white/25 flex items-center justify-center text-lg z-10">
            👆
          </div>
          <p className="text-xs font-bold uppercase tracking-widest text-white/50 -mt-2 relative z-10">
            Tocá la pantalla para empezar
          </p>
        </div>
      )}

      {paso === "escaneo" && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="bg-white border-b border-neutral-200 px-5 py-3 shrink-0">
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400">🔍</span>
              <input
                ref={searchInputRef}
                value={busquedaTexto}
                onChange={(e) => setBusquedaTexto(e.target.value)}
                onKeyDown={handleBuscadorKeyDown}
                placeholder="Buscá un producto por nombre..."
                className="w-full rounded-xl border-[1.5px] border-accent bg-accent-tint pl-9 pr-3.5 py-3 text-sm font-medium text-neutral-900"
              />
            </div>
            <p className="text-[11px] text-neutral-400 mt-1.5">📷 También podés escanear el código de barras en cualquier momento</p>

            {resultadosBusqueda.length > 0 && (
              <div className="mt-2 border border-neutral-200 rounded-xl bg-white shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                {resultadosBusqueda.map((i) => (
                  <button
                    key={i.variante.id_variante}
                    onClick={() => {
                      agregarAlCarrito(i.variante.id_variante);
                      setBusquedaTexto("");
                      searchInputRef.current?.focus();
                    }}
                    className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 border-b border-neutral-100 last:border-0 text-left active:bg-accent-tint"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-neutral-900 truncate">{i.producto.nombre}</span>
                      {i.variante.nombre !== "Único" && <span className="block text-xs text-neutral-400">{i.variante.nombre}</span>}
                    </span>
                    <span className="shrink-0 font-bold text-sm text-accent-dark">${formatearMonto(i.precio)}</span>
                  </button>
                ))}
              </div>
            )}
            {busquedaTexto.trim() && resultadosBusqueda.length === 0 && (
              <p className="text-center text-xs text-neutral-400 py-3">No encontramos productos con ese nombre.</p>
            )}
          </div>

          {toast && (
            <div className="shrink-0 mx-5 mt-3 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
              <span className="text-emerald-600">✓</span>
              <div>
                <p className="text-sm font-bold text-emerald-800">{toast.nombre}</p>
                <p className="text-xs text-emerald-600">Agregado · ${formatearMonto(toast.precio)}</p>
              </div>
            </div>
          )}

          {error && !toast && (
            <div className="shrink-0 mx-5 mt-3 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
              <p className="text-sm font-semibold text-red-700">{error}</p>
            </div>
          )}

          <div className="flex-1 flex flex-col min-h-0 mt-3">
            <div className="px-5 pb-2 flex items-baseline justify-between shrink-0">
              <h2 className="font-extrabold text-neutral-900">Tu carrito</h2>
              <span className="text-xs text-neutral-400">
                {totalItemsCarrito} producto{totalItemsCarrito === 1 ? "" : "s"}
              </span>
            </div>

            {itemsCarrito.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-2 text-neutral-400">
                <span className="text-3xl opacity-50">🛒</span>
                <p className="text-sm max-w-[220px]">Todavía no escaneaste ningún producto</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-5 pb-3 flex flex-col gap-2">
                {itemsCarrito.map((i) => (
                  <div
                    key={i.variante.id_variante}
                    className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-3 py-2"
                  >
                    <div className="w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center text-sm shrink-0">
                      📦
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-neutral-900 truncate">{i.producto.nombre}</p>
                      <p className="text-xs text-neutral-400">
                        {i.variante.nombre !== "Único" && `${i.variante.nombre} · `}${formatearMonto(i.precio)} c/u
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => cambiarCantidad(i.variante.id_variante, -1)}
                        className="w-6 h-6 rounded-md border border-neutral-300 text-neutral-500 font-bold text-sm"
                      >
                        −
                      </button>
                      <span className="w-4 text-center font-bold text-sm">{i.cantidad}</span>
                      <button
                        onClick={() => cambiarCantidad(i.variante.id_variante, 1)}
                        disabled={i.cantidad >= i.cantidadDisponible}
                        className="w-6 h-6 rounded-md border border-neutral-300 text-neutral-500 font-bold text-sm disabled:opacity-30"
                      >
                        +
                      </button>
                    </div>
                    <p className="w-14 text-right text-sm font-bold text-neutral-900 shrink-0">
                      ${formatearMonto(i.precio * i.cantidad)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="shrink-0 border-t border-neutral-200 bg-white px-5 py-3.5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-neutral-400">Total</p>
                <p className="text-lg font-extrabold text-neutral-900">${formatearMonto(subtotalCarrito)}</p>
              </div>
              <button
                onClick={() => setPaso("identificar")}
                disabled={itemsCarrito.length === 0}
                className="bg-accent hover:bg-accent-dark disabled:opacity-40 text-white font-bold px-6 py-3 rounded-xl"
              >
                Ir a pagar →
              </button>
            </div>
          </div>
        </div>
      )}

      {paso === "identificar" && (
        <div className="flex-1 flex flex-col min-h-0 relative">
          <div className="flex-1 overflow-y-auto px-5 py-4 opacity-30 pointer-events-none">
            {itemsCarrito.map((i) => (
              <div
                key={i.variante.id_variante}
                className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-3 py-2 mb-2"
              >
                <div className="w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center text-sm shrink-0">📦</div>
                <p className="flex-1 min-w-0 text-sm font-semibold text-neutral-900 truncate">{i.producto.nombre}</p>
                <p className="text-sm font-bold text-neutral-900 shrink-0">${formatearMonto(i.precio * i.cantidad)}</p>
              </div>
            ))}
          </div>

          <div className="absolute inset-0 bg-black/40 flex items-end">
            <div className="bg-white rounded-t-3xl w-full max-h-[92%] flex flex-col shadow-2xl px-5 pt-5 pb-5 overflow-y-auto">
              <p className="text-[11px] font-bold text-accent uppercase tracking-wide mb-1">Paso 1 de 2</p>
              <h2 className="font-extrabold text-lg text-neutral-900 mb-0.5">¿Sos cliente WiiGo Club?</h2>
              <p className="text-xs text-neutral-500 mb-4">¡Acumulá puntos con cada compra! Es opcional.</p>

              <div className="bg-accent-tint border border-accent/30 rounded-2xl p-3.5 mb-2.5">
                <p className="text-sm font-bold text-neutral-900">
                  Tu DNI <span className="font-normal text-neutral-400">Opcional</span>
                </p>
                <input
                  value={dni}
                  onChange={(e) => setDni(e.target.value)}
                  placeholder="Ingresá tu DNI"
                  inputMode="numeric"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm mt-1.5"
                />
                {buscandoCliente && <p className="text-xs text-neutral-400 mt-1.5">Buscando...</p>}
                {!buscandoCliente && clienteInfo?.existe && (
                  <p className="text-xs text-emerald-600 font-semibold mt-1.5">
                    ¡Hola{clienteInfo.nombre ? ` ${clienteInfo.nombre}` : ""}! Tenés {clienteInfo.puntos} puntos WiiGo.
                  </p>
                )}
                {!buscandoCliente && clienteInfo && !clienteInfo.existe && (
                  <p className="text-xs text-neutral-500 font-semibold mt-1.5">
                    Todavía no estás registrado — esta compra no suma puntos. Pedile a alguien del local que te registre para la próxima.
                  </p>
                )}
              </div>

              <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-3 mb-3">
                <p className="text-xs font-bold text-neutral-900">
                  ¿Te recomendó una profesional? <span className="font-normal text-neutral-400">Opcional</span>
                </p>
                <input
                  value={codigoProfesional}
                  onChange={(e) => setCodigoProfesional(e.target.value)}
                  placeholder="Código de la profesional"
                  className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs mt-1.5"
                />
                {buscandoCodigo && <p className="text-xs text-neutral-400 mt-1.5">Buscando...</p>}
                {!buscandoCodigo && codigoInfo?.nombre && (
                  <p className="text-xs text-emerald-600 font-semibold mt-1.5">✓ {codigoInfo.nombre}</p>
                )}
                {!buscandoCodigo && codigoInfo?.error && (
                  <p className="text-xs text-red-600 font-semibold mt-1.5">✗ {codigoInfo.error}</p>
                )}
              </div>

              {profesional && marcasEnCarrito.length > 0 && (
                <div className="bg-purple-50 border border-purple-200 rounded-2xl p-3.5 mb-3">
                  <p className="text-sm font-bold text-purple-800 mb-2">🤝 {profesional.nombre}, podés pagar con tu saldo</p>
                  <div className="space-y-1.5 mb-2">
                    {marcasEnCarrito.map((m) => {
                      const alcanza = m.saldo >= m.subtotalCarrito;
                      const montoAplicado = Math.min(m.saldo, m.subtotalCarrito);
                      return (
                        <label
                          key={m.idMarca}
                          className="flex items-center justify-between gap-2 text-sm bg-white border border-purple-200 rounded-lg px-3 py-2 cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <input type="checkbox" checked={marcasCanje.has(m.idMarca)} onChange={() => toggleMarcaCanje(m.idMarca)} />
                            {m.nombreMarca} — <span className="tabular-nums">${formatearMonto(m.subtotalCarrito)}</span>
                          </span>
                          <span className="text-xs text-purple-600 tabular-nums">
                            Saldo: ${formatearMonto(m.saldo)}
                            {!alcanza && ` (descuenta $${formatearMonto(montoAplicado)}, resto se paga normal)`}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {marcasCanje.size > 0 && (
                    <input
                      value={pinCanje}
                      onChange={(e) => setPinCanje(e.target.value)}
                      placeholder="Tu PIN"
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      className="w-full rounded-lg border border-purple-300 px-3 py-2 text-sm"
                    />
                  )}
                </div>
              )}

              {infoPuntos && infoPuntos.maxDescuento > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-3">
                  <label className="flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-sm font-bold text-amber-900">
                      ⭐ Usar mis puntos WiiGo — cubre hasta ${formatearMonto(infoPuntos.maxDescuento)}
                    </span>
                    <input type="checkbox" checked={usarPuntosWiigo} onChange={(e) => setUsarPuntosWiigo(e.target.checked)} className="w-5 h-5" />
                  </label>
                  <p className="text-[11px] text-amber-700 mt-1">
                    Usa {infoPuntos.puntosNecesarios} de tus {infoPuntos.puntosDisponibles} puntos.
                  </p>
                </div>
              )}

              <button
                onClick={() => setPaso("pagar")}
                disabled={marcasCanje.size > 0 && pinCanje.length < 4}
                className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-bold py-3.5 rounded-2xl text-sm mt-1"
              >
                Continuar
              </button>
              <button onClick={() => setPaso("pagar")} className="text-center text-xs text-neutral-400 font-semibold py-2.5">
                Omitir este paso
              </button>
              <button onClick={() => setPaso("escaneo")} className="text-center text-xs text-neutral-400 font-semibold -mt-1">
                ‹ Volver al carrito
              </button>
            </div>
          </div>
        </div>
      )}

      {paso === "pagar" && (
        <div className="flex-1 flex flex-col min-h-0 relative">
          <div className="flex-1 overflow-y-auto px-5 py-4 opacity-30 pointer-events-none">
            {itemsCarrito.map((i) => (
              <div
                key={i.variante.id_variante}
                className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-3 py-2 mb-2"
              >
                <div className="w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center text-sm shrink-0">📦</div>
                <p className="flex-1 min-w-0 text-sm font-semibold text-neutral-900 truncate">{i.producto.nombre}</p>
                <p className="text-sm font-bold text-neutral-900 shrink-0">${formatearMonto(i.precio * i.cantidad)}</p>
              </div>
            ))}
          </div>

          <div className="absolute inset-0 bg-black/40 flex items-end">
            <div className="bg-white rounded-t-3xl w-full max-h-[92%] flex flex-col shadow-2xl px-5 pt-5 pb-5 overflow-y-auto">
              <p className="text-[11px] font-bold text-accent uppercase tracking-wide mb-1">Paso 2 de 2</p>
              <h2 className="font-extrabold text-lg text-neutral-900 mb-3.5">¿Cómo querés pagar?</h2>

              <div className="flex justify-between items-center text-sm">
                <span>Subtotal</span>
                <span>${formatearMonto(subtotalCarrito)}</span>
              </div>
              {descuentoReferidoPreview > 0 && (
                <div className="flex justify-between items-center text-sm text-emerald-600">
                  <span>Descuento por código de profesional</span>
                  <span>-${formatearMonto(descuentoReferidoPreview)}</span>
                </div>
              )}
              {descuentoCanje > 0 && (
                <div className="flex justify-between items-center text-sm text-purple-600">
                  <span>Pagado con saldo de profesional</span>
                  <span>-${formatearMonto(descuentoCanje)}</span>
                </div>
              )}
              {descuentoPuntosPreview > 0 && (
                <div className="flex justify-between items-center text-sm text-amber-700">
                  <span>Pagado con puntos WiiGo</span>
                  <span>-${formatearMonto(descuentoPuntosPreview)}</span>
                </div>
              )}

              <div className="bg-accent-tint border border-accent/30 rounded-2xl p-4 text-center my-3.5">
                <p className="text-[11px] font-bold text-accent-dark uppercase tracking-wide">Total a pagar</p>
                <p className="text-3xl font-extrabold text-neutral-900 tracking-tight">${formatearMonto(totalFinal)}</p>
              </div>

              <button
                onClick={() => setMedioPagoElegido("EFECTIVO")}
                className={`flex items-center gap-3 text-left border-2 rounded-2xl px-3.5 py-3 mb-2.5 ${
                  medioPagoElegido === "EFECTIVO" ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white"
                }`}
              >
                <span className="w-10 h-10 rounded-xl bg-white border border-neutral-200 flex items-center justify-center text-lg shrink-0">
                  💵
                </span>
                <span>
                  <span className="block font-bold text-sm text-neutral-900">Efectivo</span>
                  <span className="block text-xs text-neutral-500">Pagás en caja con el personal</span>
                </span>
              </button>
              <button
                onClick={() => setMedioPagoElegido("MERCADO_PAGO")}
                className={`flex items-center gap-3 text-left border-2 rounded-2xl px-3.5 py-3 mb-2.5 ${
                  medioPagoElegido === "MERCADO_PAGO" ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white"
                }`}
              >
                <span className="w-10 h-10 rounded-xl bg-white border border-neutral-200 flex items-center justify-center text-lg shrink-0">
                  📱
                </span>
                <span>
                  <span className="block font-bold text-sm text-neutral-900">Mercado Pago</span>
                  <span className="block text-xs text-neutral-500">Escaneás un QR y pagás desde tu celular</span>
                </span>
              </button>
              <div className="flex items-center gap-3 text-left border-2 border-dashed border-neutral-200 rounded-2xl px-3.5 py-3 mb-1 opacity-45">
                <span className="w-10 h-10 rounded-xl bg-white border border-neutral-200 flex items-center justify-center text-lg shrink-0">
                  💳
                </span>
                <span>
                  <span className="block font-bold text-sm text-neutral-900">Débito / Crédito</span>
                  <span className="block text-xs text-neutral-500">Próximamente</span>
                </span>
              </div>

              {error && (
                <p className="text-sm text-red-600 mt-2.5" role="alert">
                  {error}
                </p>
              )}

              <button
                onClick={() => handleConfirmar(medioPagoElegido)}
                disabled={enviando}
                className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-bold py-3.5 rounded-2xl text-sm mt-3.5"
              >
                {enviando ? "Confirmando..." : "Confirmar y pagar"}
              </button>
              <button onClick={() => setPaso("identificar")} className="text-center text-xs text-neutral-400 font-semibold py-2.5">
                ‹ Volver
              </button>
            </div>
          </div>
        </div>
      )}

      {paso === "efectivo-esperando" && pedido && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div className="text-3xl mb-2">🧾</div>
          <h2 className="text-xl font-extrabold text-neutral-900 mb-1.5 text-balance">Entregá el efectivo al personal</h2>
          <p className="text-sm text-neutral-500 max-w-xs mb-4">
            Un miembro del equipo va a revisar los productos que seleccionaste y recibir el dinero antes de que te
            retires.
          </p>
          <p className="text-2xl font-extrabold text-neutral-900">${formatearMonto(pedido.total)}</p>
          <p className="text-xs text-neutral-400 mb-4">Pedido #{formatearPedido(pedido.numero)}</p>
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" />
            Esperando confirmación del personal...
          </div>
        </div>
      )}

      {paso === "mp-esperando" && pedido && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div className="flex items-center gap-1.5 bg-[#eef9f1] text-[#00a650] font-bold text-xs px-3.5 py-1.5 rounded-full mb-3.5">
            📱 Mercado Pago
          </div>
          <p className="text-sm text-neutral-500 mb-3.5">Escaneá este código con la app de Mercado Pago de tu celular</p>
          <div className="w-40 h-40 bg-white rounded-2xl border border-neutral-200 shadow-sm flex items-center justify-center mb-3.5 overflow-hidden">
            {pedido.qrImagen ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pedido.qrImagen} alt="Código QR de Mercado Pago" className="w-full h-full object-contain" />
            ) : (
              <span className="text-neutral-300 text-xs px-2 text-center">No se pudo generar el QR</span>
            )}
          </div>
          <p className="text-2xl font-extrabold text-neutral-900">${formatearMonto(pedido.total)}</p>
          <div className="flex items-center gap-2 text-xs text-neutral-400 mt-3">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" />
            Esperando el pago...
          </div>
        </div>
      )}

      {paso === "pagado" && pedido && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div className="text-4xl mb-2">✅</div>
          <h2 className="text-2xl font-extrabold text-neutral-900 mb-1.5">¡Perfecto!</h2>
          <p className="text-sm text-neutral-500 max-w-xs mb-2">Mostrale tu ticket al personal para controlar antes de salir.</p>
          <p className="text-xs text-neutral-400 mb-6">Pedido #{formatearPedido(pedido.numero)} · ${formatearMonto(pedido.total)}</p>
          <button
            onClick={volverAEmpezar}
            className="border border-neutral-300 text-neutral-700 font-semibold px-7 py-3 rounded-xl text-sm"
          >
            Nueva compra
          </button>
        </div>
      )}

      {paso === "cancelado" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div className="text-3xl mb-2">✕</div>
          <h2 className="text-xl font-extrabold text-neutral-900 mb-1.5">Pedido cancelado</h2>
          <p className="text-sm text-neutral-500 max-w-xs mb-6">Podés empezar una compra nueva cuando quieras.</p>
          <button
            onClick={volverAEmpezar}
            className="bg-accent hover:bg-accent-dark text-white font-bold px-7 py-3 rounded-xl text-sm"
          >
            Empezar de nuevo
          </button>
        </div>
      )}
    </div>
  );
}
