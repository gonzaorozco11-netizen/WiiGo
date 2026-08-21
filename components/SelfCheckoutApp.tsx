"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Local, Marca, Producto, VarianteProducto, Stock } from "@/lib/supabase";
import { confirmarPedido, estadoPedido, cancelarPedidoCliente } from "@/app/self-checkout/[idLocal]/actions";

type Item = {
  variante: VarianteProducto;
  producto: Producto;
  marca: Marca | undefined;
  precio: number;
  cantidadDisponible: number;
};

type ItemCarrito = Item & { cantidad: number };

type Paso = "bienvenida" | "escaneo" | "pago" | "efectivo-esperando" | "mp-esperando" | "pagado" | "cancelado";
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

export default function SelfCheckoutApp({
  local,
  productos,
  variantes,
  marcas,
  stock,
}: {
  local: Local;
  productos: Producto[];
  variantes: VarianteProducto[];
  marcas: Marca[];
  stock: Stock[];
}) {
  const [paso, setPaso] = useState<Paso>("bienvenida");
  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [dni, setDni] = useState("");
  const [codigoProfesional, setCodigoProfesional] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [medioPagoElegido, setMedioPagoElegido] = useState<MedioPago>("EFECTIVO");

  const [pedido, setPedido] = useState<{ idVenta: string; numero: number; total: number; descuento: number } | null>(
    null
  );

  const [toast, setToast] = useState<{ nombre: string; precio: number } | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [buscarAbierto, setBuscarAbierto] = useState(false);
  const [busquedaTexto, setBusquedaTexto] = useState("");

  const scanInputRef = useRef<HTMLInputElement>(null);

  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id_producto, p])), [productos]);
  const marcaPorId = useMemo(() => new Map(marcas.map((m) => [m.id_marca, m])), [marcas]);
  const stockPorVariante = useMemo(() => {
    const map = new Map<string, number>();
    stock.forEach((s) => map.set(s.id_variante, s.cantidad));
    return map;
  }, [stock]);

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
    if (agregado) {
      mostrarToast(item.producto.nombre, item.precio);
    } else {
      setError(`No queda más stock disponible de ${item.producto.nombre}`);
      setTimeout(() => setError(null), TOAST_MS);
    }
  }

  // El lector de código de barras conecta como teclado: "escribe" el
  // código leído y remata con Enter, todo en milisegundos. Escuchamos ese
  // Enter para tomar el valor acumulado y compararlo contra los códigos
  // de barra cargados — un input controlado no sirve acá porque React lo
  // limpiaría entre cada tecla antes de que el lector termine de tipear.
  function handleEscaneoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const valor = e.currentTarget.value.trim();
    e.currentTarget.value = "";
    if (!valor) return;
    const coincidencia = items.find((i) => i.variante.codigo_barras === valor);
    if (coincidencia) agregarAlCarrito(coincidencia.variante.id_variante);
  }

  useEffect(() => {
    if (paso !== "escaneo" || buscarAbierto) return;
    scanInputRef.current?.focus();
  }, [paso, buscarAbierto, itemsCarrito.length]);

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
    setBuscarAbierto(false);
    setPaso("bienvenida");
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
      medioPago
    )
      .then((r) => {
        setPedido(r);
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
      <header className="border-b border-neutral-200 bg-white shrink-0 px-5 py-3.5 flex items-center justify-between">
        <span className="font-extrabold tracking-tight text-neutral-900">WiiGo</span>
        {paso === "escaneo" || paso === "mp-esperando" ? (
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

      {paso === "bienvenida" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-10">
          <h1 className="text-3xl font-extrabold text-neutral-900 mb-3 text-balance">Tu compra, a tu ritmo</h1>
          <p className="text-neutral-500 max-w-xs mb-9">
            Escaneá los productos de tu canasta y pagá con Mercado Pago o en efectivo, sin hacer fila.
          </p>
          <button
            onClick={() => setPaso("escaneo")}
            className="bg-accent hover:bg-accent-dark text-white font-bold px-9 py-4 rounded-2xl shadow-sm"
          >
            Iniciar compra
          </button>
        </div>
      )}

      {paso === "escaneo" && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="bg-white border-b border-neutral-200 px-5 py-3.5 flex items-center gap-3 shrink-0">
            <div className="w-11 h-11 rounded-xl bg-accent-tint flex items-center justify-center text-lg shrink-0">
              📷
            </div>
            <div className="min-w-0">
              <h2 className="font-extrabold text-sm text-neutral-900">Escaneá el código de barras</h2>
              <p className="text-xs text-neutral-500">Se suma solo a la lista de abajo</p>
            </div>
            <input
              ref={scanInputRef}
              defaultValue=""
              onKeyDown={handleEscaneoKeyDown}
              onBlur={() => {
                if (!buscarAbierto) setTimeout(() => scanInputRef.current?.focus(), 50);
              }}
              className="opacity-0 absolute w-px h-px"
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>

          <button
            onClick={() => setBuscarAbierto(true)}
            className="shrink-0 mx-5 mt-3.5 mb-1 flex items-center justify-center gap-2 bg-accent-tint border-[1.5px] border-accent text-accent-dark font-bold text-sm py-3.5 rounded-2xl"
          >
            🔍 Buscar producto por nombre
          </button>

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
                onClick={() => setPaso("pago")}
                disabled={itemsCarrito.length === 0}
                className="bg-accent hover:bg-accent-dark disabled:opacity-40 text-white font-bold px-6 py-3 rounded-xl"
              >
                Continuar →
              </button>
            </div>
          </div>

          {buscarAbierto && (
            <div className="absolute inset-0 bg-black/40 flex items-end justify-center">
              <div className="bg-white rounded-t-2xl w-full max-h-[82%] flex flex-col shadow-2xl overflow-hidden">
                <div className="px-5 pt-4 pb-2.5 border-b border-neutral-200">
                  <div className="w-9 h-1 bg-neutral-200 rounded-full mx-auto mb-3" />
                  <h3 className="font-extrabold text-sm text-neutral-900">Buscar producto</h3>
                  <p className="text-xs text-neutral-500">Para cuando el código no se puede leer o el producto no tiene.</p>
                </div>
                <input
                  autoFocus
                  type="search"
                  value={busquedaTexto}
                  onChange={(e) => setBusquedaTexto(e.target.value)}
                  placeholder="Escribí el nombre del producto..."
                  className="mx-5 mt-3 rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm"
                />
                {error && (
                  <p className="mx-5 mt-2 text-sm font-semibold text-red-600">{error}</p>
                )}
                <div className="px-5 pt-3 pb-4 overflow-y-auto flex flex-col gap-2">
                  {resultadosBusqueda.map((i) => (
                    <button
                      key={i.variante.id_variante}
                      onClick={() => {
                        agregarAlCarrito(i.variante.id_variante);
                        setBusquedaTexto("");
                      }}
                      className="flex items-center gap-2.5 border border-neutral-200 rounded-xl px-3 py-2.5 bg-neutral-50 text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center text-sm shrink-0">
                        📦
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-900 truncate">{i.producto.nombre}</p>
                        {i.variante.nombre !== "Único" && (
                          <p className="text-xs text-neutral-400">{i.variante.nombre}</p>
                        )}
                      </div>
                      <span className="ml-auto font-bold text-sm text-neutral-900">${formatearMonto(i.precio)}</span>
                    </button>
                  ))}
                  {busquedaTexto.trim() && resultadosBusqueda.length === 0 && (
                    <p className="text-center text-sm text-neutral-400 py-6">No encontramos productos con ese nombre.</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setBuscarAbierto(false);
                    setBusquedaTexto("");
                  }}
                  className="text-sm text-neutral-400 py-3.5"
                >
                  Cerrar búsqueda
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {paso === "pago" && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="bg-white border-b border-neutral-200 px-5 py-3 flex items-center justify-between shrink-0">
            <div>
              <p className="text-xs text-neutral-400">
                {totalItemsCarrito} producto{totalItemsCarrito === 1 ? "" : "s"}
              </p>
              <p className="font-extrabold text-neutral-900">${formatearMonto(subtotalCarrito)}</p>
            </div>
            <button onClick={() => setPaso("escaneo")} className="text-xs text-accent font-semibold">
              Ver carrito ▾
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col">
            <h2 className="font-extrabold text-lg text-neutral-900 mb-0.5">Identificate y pagá</h2>
            <p className="text-xs text-neutral-500 mb-3.5">Ambos pasos son opcionales salvo el medio de pago.</p>

            <div className="bg-white border border-neutral-200 rounded-2xl p-3.5 mb-2.5">
              <p className="text-sm font-bold text-neutral-900">
                ¿Sos cliente WiiGo? <span className="font-normal text-neutral-400">Opcional</span>
              </p>
              <p className="text-xs text-neutral-500 mb-2">Acumulá puntos con cada compra.</p>
              <input
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                placeholder="Ingresá tu DNI"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="bg-white border border-neutral-200 rounded-2xl p-3.5 mb-3">
              <p className="text-sm font-bold text-neutral-900">
                ¿Venís recomendado? <span className="font-normal text-neutral-400">Opcional</span>
              </p>
              <p className="text-xs text-neutral-500 mb-2">Ingresá el código del profesional.</p>
              <input
                value={codigoProfesional}
                onChange={(e) => setCodigoProfesional(e.target.value)}
                placeholder="Ingresá tu código"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 mb-1">
              <button
                onClick={() => setMedioPagoElegido("EFECTIVO")}
                className={`flex flex-col items-center gap-1.5 py-4 rounded-2xl border-2 ${
                  medioPagoElegido === "EFECTIVO" ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white"
                }`}
              >
                <span className="text-xl">💵</span>
                <span className="font-bold text-sm text-neutral-900">Efectivo</span>
              </button>
              <button
                onClick={() => setMedioPagoElegido("MERCADO_PAGO")}
                className={`flex flex-col items-center gap-1.5 py-4 rounded-2xl border-2 ${
                  medioPagoElegido === "MERCADO_PAGO" ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white"
                }`}
              >
                <span className="text-xl">📱</span>
                <span className="font-bold text-sm text-neutral-900">Mercado Pago</span>
              </button>
              <div className="col-span-2 flex flex-col items-center gap-1.5 py-4 rounded-2xl border-2 border-dashed border-neutral-200 bg-neutral-50 text-neutral-400">
                <span className="text-xl opacity-40">💳</span>
                <span className="font-bold text-sm">Débito / Crédito</span>
                <span className="text-[10px]">Próximamente</span>
              </div>
            </div>
            <p className="text-[11px] text-neutral-400 -mt-1 mb-2.5">
              {medioPagoElegido === "EFECTIVO"
                ? "💵 Efectivo: avisás al personal para abonar"
                : "📱 Mercado Pago: pagá con tu celular y avisale al personal para que lo confirme"}
            </p>

            <div className="flex justify-between items-center font-extrabold text-lg text-neutral-900 my-2">
              <span>Total</span>
              <span>${formatearMonto(subtotalCarrito)}</span>
            </div>

            {error && (
              <p className="text-sm text-red-600 mb-2" role="alert">
                {error}
              </p>
            )}

            <div className="flex gap-2.5 mt-auto pt-2">
              <button
                onClick={() => setPaso("escaneo")}
                className="flex-1 border border-neutral-300 text-neutral-700 font-semibold py-3.5 rounded-2xl text-sm"
              >
                ← Seguir
              </button>
              <button
                onClick={() => handleConfirmar(medioPagoElegido)}
                disabled={enviando}
                className="flex-1 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-bold py-3.5 rounded-2xl text-sm"
              >
                {enviando ? "Confirmando..." : "Confirmar y pagar"}
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
          <div className="w-40 h-40 bg-white rounded-2xl border border-neutral-200 shadow-sm flex items-center justify-center mb-3.5 text-neutral-300 text-xs">
            (QR pendiente de integración)
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
