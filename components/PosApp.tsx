"use client";

import { useMemo, useState } from "react";
import type { Local, Marca, Producto, VarianteProducto, Stock } from "@/lib/supabase";
import { venderPos } from "@/app/(app)/pos/actions";

type Item = {
  variante: VarianteProducto;
  producto: Producto;
  marca: Marca | undefined;
  precio: number;
  cantidadDisponible: number;
};

type ItemCarrito = Item & { cantidad: number };

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearPedido(numero: number) {
  return `COB-${String(numero).padStart(4, "0")}`;
}

function precioFinal(producto: Producto, variante: VarianteProducto) {
  const base = variante.precio_venta ?? producto.precio_venta ?? 0;
  const descuento = producto.descuento_porcentaje ?? 0;
  return descuento > 0 ? Math.round(base * (1 - descuento / 100)) : base;
}

export default function PosApp({
  locales,
  productos,
  variantes,
  marcas,
  stock,
}: {
  locales: Local[];
  productos: Producto[];
  variantes: VarianteProducto[];
  marcas: Marca[];
  stock: Stock[];
}) {
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [busqueda, setBusqueda] = useState("");
  const [dni, setDni] = useState("");
  const [codigoProfesional, setCodigoProfesional] = useState("");
  const [montoRecibido, setMontoRecibido] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ numero: number; total: number; vuelto: number } | null>(null);

  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id_producto, p])), [productos]);
  const marcaPorId = useMemo(() => new Map(marcas.map((m) => [m.id_marca, m])), [marcas]);
  const stockPorClave = useMemo(() => {
    const map = new Map<string, number>();
    stock.forEach((s) => map.set(`${s.id_variante}_${s.id_local}`, s.cantidad));
    return map;
  }, [stock]);

  const items = useMemo<Item[]>(() => {
    return variantes
      .map((variante) => {
        const producto = productoPorId.get(variante.id_producto);
        if (!producto) return null;
        const cantidadDisponible = stockPorClave.get(`${variante.id_variante}_${idLocal}`) ?? 0;
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
  }, [variantes, productoPorId, marcaPorId, stockPorClave, idLocal]);

  const itemPorVariante = useMemo(() => new Map(items.map((i) => [i.variante.id_variante, i])), [items]);

  const resultadosBusqueda = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    return items.filter((i) => i.producto.nombre.toLowerCase().includes(q)).slice(0, 15);
  }, [items, busqueda]);

  const itemsCarrito = useMemo<ItemCarrito[]>(() => {
    return Object.entries(carrito)
      .map(([idVariante, cantidad]) => {
        const item = itemPorVariante.get(idVariante);
        return item ? { ...item, cantidad } : null;
      })
      .filter((i): i is ItemCarrito => i !== null);
  }, [carrito, itemPorVariante]);

  const subtotal = itemsCarrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0);
  const montoNum = Number(montoRecibido.replace(/[^\d.-]/g, "")) || 0;
  const vueltoPrevio = montoNum - subtotal;

  function agregar(idVariante: string) {
    const item = itemPorVariante.get(idVariante);
    if (!item) return;
    setCarrito((prev) => {
      const actual = prev[idVariante] ?? 0;
      if (actual >= item.cantidadDisponible) return prev;
      return { ...prev, [idVariante]: actual + 1 };
    });
  }

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

  function nuevaVenta() {
    setCarrito({});
    setBusqueda("");
    setDni("");
    setCodigoProfesional("");
    setMontoRecibido("");
    setResultado(null);
    setError(null);
  }

  function handleCobrar() {
    setError(null);
    setEnviando(true);
    venderPos(
      idLocal,
      itemsCarrito.map((i) => ({
        idVariante: i.variante.id_variante,
        idMarca: i.producto.id_marca,
        cantidad: i.cantidad,
        precioUnitario: i.precio,
      })),
      dni,
      codigoProfesional,
      montoNum
    )
      .then((r) => setResultado(r))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo registrar la venta"))
      .finally(() => setEnviando(false));
  }

  if (resultado) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <div className="text-4xl mb-3">✅</div>
        <h1 className="text-xl font-bold text-neutral-900 mb-1">Venta registrada</h1>
        <p className="text-sm text-neutral-500 mb-1">Pedido #{formatearPedido(resultado.numero)}</p>
        <p className="text-2xl font-extrabold text-neutral-900 mb-1">${formatearMonto(resultado.total)}</p>
        {resultado.vuelto > 0 && (
          <p className="text-sm text-emerald-600 font-semibold mb-6">Vuelto: ${formatearMonto(resultado.vuelto)}</p>
        )}
        <button
          onClick={nuevaVenta}
          className="bg-accent hover:bg-accent-dark text-white font-bold px-6 py-3 rounded-xl"
        >
          Nueva venta
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-neutral-900">Vender</h1>
        <select
          value={idLocal}
          onChange={(e) => {
            setIdLocal(e.target.value);
            setCarrito({});
          }}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          {locales.map((l) => (
            <option key={l.id_local} value={l.id_local}>
              {l.nombre}
            </option>
          ))}
        </select>
      </div>

      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar producto por nombre..."
        className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-sm mb-2"
      />

      {resultadosBusqueda.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl mb-4 divide-y divide-neutral-100 overflow-hidden">
          {resultadosBusqueda.map((i) => (
            <button
              key={i.variante.id_variante}
              onClick={() => {
                agregar(i.variante.id_variante);
                setBusqueda("");
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-neutral-900 truncate">{i.producto.nombre}</p>
                {i.variante.nombre !== "Único" && <p className="text-xs text-neutral-400">{i.variante.nombre}</p>}
              </div>
              <span className="font-bold text-sm text-neutral-900 shrink-0">${formatearMonto(i.precio)}</span>
            </button>
          ))}
        </div>
      )}

      {itemsCarrito.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-10">Buscá productos arriba para armar la venta.</p>
      ) : (
        <div className="space-y-2 mb-5">
          {itemsCarrito.map((i) => (
            <div
              key={i.variante.id_variante}
              className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-neutral-900 truncate">{i.producto.nombre}</p>
                <p className="text-xs text-neutral-400">
                  {i.variante.nombre !== "Único" && `${i.variante.nombre} · `}${formatearMonto(i.precio)} c/u
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => cambiarCantidad(i.variante.id_variante, -1)}
                  className="w-7 h-7 rounded-md border border-neutral-300 text-neutral-500 font-bold"
                >
                  −
                </button>
                <span className="w-5 text-center font-bold text-sm">{i.cantidad}</span>
                <button
                  onClick={() => cambiarCantidad(i.variante.id_variante, 1)}
                  disabled={i.cantidad >= i.cantidadDisponible}
                  className="w-7 h-7 rounded-md border border-neutral-300 text-neutral-500 font-bold disabled:opacity-30"
                >
                  +
                </button>
              </div>
              <p className="w-16 text-right text-sm font-bold text-neutral-900 shrink-0">
                ${formatearMonto(i.precio * i.cantidad)}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-neutral-200 rounded-xl p-4 mb-3">
        <p className="text-sm font-bold text-neutral-900">
          ¿Cliente WiiGo? <span className="font-normal text-neutral-400">Opcional</span>
        </p>
        <input
          value={dni}
          onChange={(e) => setDni(e.target.value)}
          placeholder="DNI"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mt-2"
        />
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl p-4 mb-4">
        <p className="text-sm font-bold text-neutral-900">
          ¿Referido? <span className="font-normal text-neutral-400">Opcional</span>
        </p>
        <input
          value={codigoProfesional}
          onChange={(e) => setCodigoProfesional(e.target.value)}
          placeholder="Código del profesional"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mt-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="flex flex-col items-center gap-1 py-3 rounded-xl border-2 border-accent bg-accent-tint">
          <span>💵</span>
          <span className="font-bold text-sm">Efectivo</span>
        </div>
        <div className="flex flex-col items-center gap-1 py-3 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 text-neutral-400">
          <span className="opacity-40">📱</span>
          <span className="font-bold text-sm">Mercado Pago</span>
          <span className="text-[10px]">Próximamente</span>
        </div>
      </div>

      <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 mb-4">
        <div className="flex justify-between items-center font-extrabold text-lg pb-2 border-b border-neutral-200 mb-2">
          <span>Total</span>
          <span>${formatearMonto(subtotal)}</span>
        </div>
        <div className="flex justify-between items-center text-sm mb-2">
          <label className="text-neutral-500">Pagó con</label>
          <input
            value={montoRecibido}
            onChange={(e) => setMontoRecibido(e.target.value)}
            placeholder="$0"
            className="w-32 text-right border border-neutral-300 rounded-lg px-2.5 py-1.5"
          />
        </div>
        <div className="flex justify-between items-center text-sm">
          <label className="text-neutral-500">Vuelto</label>
          <span className={`font-bold ${vueltoPrevio < 0 ? "text-red-600" : "text-emerald-600"}`}>
            ${formatearMonto(Math.max(vueltoPrevio, 0))}
          </span>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-3" role="alert">
          {error}
        </p>
      )}

      <button
        onClick={handleCobrar}
        disabled={enviando || itemsCarrito.length === 0 || montoNum < subtotal}
        className="w-full bg-accent hover:bg-accent-dark disabled:opacity-40 text-white font-bold py-4 rounded-xl mb-8"
      >
        {enviando ? "Registrando..." : `Cobrar · $${formatearMonto(subtotal)}`}
      </button>
    </div>
  );
}
