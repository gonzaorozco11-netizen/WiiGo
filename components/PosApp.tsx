"use client";

import { useEffect, useMemo, useState } from "react";
import type { Local, Marca, Producto, VarianteProducto, Stock } from "@/lib/supabase";
import { venderPos, buscarClientePorDni, buscarProfesionalPorDniAction, buscarCodigoProfesionalAction, infoCanjePuntosAction } from "@/app/(app)/pos/actions";

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
  return `VTA-${String(numero).padStart(4, "0")}`;
}

function precioFinal(producto: Producto, variante: VarianteProducto) {
  const base = variante.precio_venta ?? producto.precio_venta ?? 0;
  const descuento = producto.descuento_porcentaje ?? 0;
  return descuento > 0 ? Math.round(base * (1 - descuento / 100)) : base;
}

type MedioPago = "EFECTIVO" | "MERCADO_PAGO";

const FORMAS_PAGO_MP: { valor: string; etiqueta: string }[] = [
  { valor: "DINERO_CUENTA", etiqueta: "Dinero en cuenta MP" },
  { valor: "DEBITO", etiqueta: "Tarjeta de débito" },
  { valor: "CUOTAS_SIN_INTERES", etiqueta: "Cuotas sin interés" },
  { valor: "PREPAGA", etiqueta: "Tarjeta prepaga" },
  { valor: "CREDITO", etiqueta: "Tarjeta de crédito" },
];

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
  const [medioPago, setMedioPago] = useState<MedioPago>("EFECTIVO");
  const [formaPagoMp, setFormaPagoMp] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ numero: number; total: number; vuelto: number; puntosGenerados: number } | null>(
    null
  );
  const [clienteEncontrado, setClienteEncontrado] = useState<{ nombre: string; apellido: string | null; puntos: number } | null>(null);
  const [buscandoCliente, setBuscandoCliente] = useState(false);
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
  const [infoPuntos, setInfoPuntos] = useState<{
    puntosDisponibles: number;
    valorPorPunto: number;
    topePorcentaje: number;
    maxDescuento: number;
    puntosNecesarios: number;
  } | null>(null);
  const [usarPuntosWiigo, setUsarPuntosWiigo] = useState(false);

  // Autocompletar nombre al escribir el DNI, con una pequeña pausa para
  // no consultar en cada tecla. El mismo DNI también identifica si es un
  // profesional que puede pagar con el saldo que acumuló.
  useEffect(() => {
    const dniLimpio = dni.trim();
    if (dniLimpio.length < 6) {
      setClienteEncontrado(null);
      setProfesional(null);
      setMarcasCanje(new Set());
      return;
    }
    setBuscandoCliente(true);
    const timeout = setTimeout(() => {
      Promise.all([buscarClientePorDni(dniLimpio), buscarProfesionalPorDniAction(dniLimpio)])
        .then(([c, p]) => {
          setClienteEncontrado(c);
          setProfesional(p);
        })
        .finally(() => setBuscandoCliente(false));
    }, 400);
    return () => clearTimeout(timeout);
  }, [dni]);

  // Misma idea que el DNI: confirmar en vivo si el código de profesional
  // existe, para no depender de apretar Cobrar para enterarse.
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

  const totalConCanje = Math.max(subtotal - descuentoCanje, 0);
  const descuentoPuntosPreview = usarPuntosWiigo && infoPuntos ? infoPuntos.maxDescuento : 0;
  const totalFinal = Math.max(totalConCanje - descuentoPuntosPreview, 0);
  const montoNum = Number(montoRecibido.replace(/[^\d.-]/g, "")) || 0;
  const vueltoPrevio = montoNum - totalFinal;

  // Cuánto puede cubrir el cliente con sus puntos WiiGo sobre lo que queda
  // por pagar después del descuento de referido/canje de profesional — solo
  // vista previa, el server vuelve a calcular todo antes de cobrar.
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
    setMedioPago("EFECTIVO");
    setFormaPagoMp("");
    setResultado(null);
    setError(null);
    setClienteEncontrado(null);
    setProfesional(null);
    setMarcasCanje(new Set());
    setPinCanje("");
    setInfoPuntos(null);
    setUsarPuntosWiigo(false);
  }

  const esMercadoPago = medioPago === "MERCADO_PAGO";

  function toggleMarcaCanje(idMarca: string) {
    setMarcasCanje((prev) => {
      const next = new Set(prev);
      if (next.has(idMarca)) next.delete(idMarca);
      else next.add(idMarca);
      return next;
    });
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
      montoNum,
      medioPago,
      esMercadoPago ? formaPagoMp : undefined,
      profesional && marcasCanje.size > 0
        ? { idProfesional: profesional.idProfesional, pin: pinCanje, marcas: [...marcasCanje] }
        : undefined,
      usarPuntosWiigo
    )
      .then((r) => {
        if (r.error) setError(r.error);
        else if (r.venta) setResultado(r.venta);
      })
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
        <div className="mb-6">
          {resultado.vuelto > 0 && (
            <p className="text-sm text-emerald-600 font-semibold">Vuelto: ${formatearMonto(resultado.vuelto)}</p>
          )}
          {resultado.puntosGenerados > 0 && (
            <p className="text-sm text-accent font-semibold">⭐ +{resultado.puntosGenerados} WiiGo Points</p>
          )}
        </div>
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
        {buscandoCliente && <p className="text-xs text-neutral-400 mt-1.5">Buscando...</p>}
        {!buscandoCliente && clienteEncontrado && (
          <p className="text-xs text-emerald-600 font-semibold mt-1.5">
            ✓ {clienteEncontrado.nombre} {clienteEncontrado.apellido ?? ""} · {clienteEncontrado.puntos} puntos
          </p>
        )}
        {!buscandoCliente && !clienteEncontrado && dni.trim().length >= 6 && (
          <p className="text-xs text-neutral-400 mt-1.5">Cliente nuevo — se va a crear con este DNI.</p>
        )}
      </div>

      {profesional && marcasEnCarrito.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-3">
          <p className="text-sm font-bold text-purple-800 mb-2">🤝 {profesional.nombre} puede pagar con su saldo</p>
          <div className="space-y-1.5 mb-2">
            {marcasEnCarrito.map((m) => {
              const alcanza = m.saldo >= m.subtotalCarrito;
              return (
                <label key={m.idMarca} className={`flex items-center justify-between gap-2 text-sm bg-white border border-purple-200 rounded-lg px-3 py-2 ${!alcanza ? "opacity-50" : "cursor-pointer"}`}>
                  <span className="flex items-center gap-2">
                    <input type="checkbox" disabled={!alcanza} checked={marcasCanje.has(m.idMarca)} onChange={() => toggleMarcaCanje(m.idMarca)} />
                    {m.nombreMarca} — <span className="tabular-nums">${formatearMonto(m.subtotalCarrito)}</span>
                  </span>
                  <span className="text-xs text-purple-600 tabular-nums">Saldo: ${formatearMonto(m.saldo)}</span>
                </label>
              );
            })}
          </div>
          {marcasCanje.size > 0 && (
            <input
              value={pinCanje}
              onChange={(e) => setPinCanje(e.target.value)}
              placeholder="PIN del profesional"
              type="password"
              inputMode="numeric"
              maxLength={6}
              className="w-full rounded-lg border border-purple-300 px-3 py-2 text-sm"
            />
          )}
        </div>
      )}

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
        {buscandoCodigo && <p className="text-xs text-neutral-400 mt-1.5">Buscando...</p>}
        {!buscandoCodigo && codigoInfo?.nombre && (
          <p className="text-xs text-emerald-600 font-semibold mt-1.5">✓ {codigoInfo.nombre}</p>
        )}
        {!buscandoCodigo && codigoInfo?.error && (
          <p className="text-xs text-red-600 font-semibold mt-1.5">✗ {codigoInfo.error}</p>
        )}
      </div>

      {infoPuntos && infoPuntos.maxDescuento > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-sm font-bold text-amber-900">
              ⭐ Usar puntos WiiGo — cubre hasta ${formatearMonto(infoPuntos.maxDescuento)} ({infoPuntos.puntosNecesarios} de {infoPuntos.puntosDisponibles} puntos)
            </span>
            <input type="checkbox" checked={usarPuntosWiigo} onChange={(e) => setUsarPuntosWiigo(e.target.checked)} className="w-5 h-5" />
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setMedioPago("EFECTIVO")}
          className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 ${
            medioPago === "EFECTIVO" ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white"
          }`}
        >
          <span>💵</span>
          <span className="font-bold text-sm">Efectivo</span>
        </button>
        <button
          onClick={() => setMedioPago("MERCADO_PAGO")}
          className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 ${
            medioPago === "MERCADO_PAGO" ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white"
          }`}
        >
          <span>📱</span>
          <span className="font-bold text-sm">Mercado Pago</span>
        </button>
      </div>

      <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 mb-4">
        {descuentoCanje > 0 && (
          <div className="flex justify-between items-center text-sm text-purple-600 mb-1">
            <span>Pagado con saldo de profesional</span>
            <span>-${formatearMonto(descuentoCanje)}</span>
          </div>
        )}
        {descuentoPuntosPreview > 0 && (
          <div className="flex justify-between items-center text-sm text-amber-700 mb-1">
            <span>Pagado con puntos WiiGo</span>
            <span>-${formatearMonto(descuentoPuntosPreview)}</span>
          </div>
        )}
        <div className="flex justify-between items-center font-extrabold text-lg pb-2 border-b border-neutral-200 mb-2">
          <span>Total</span>
          <span>${formatearMonto(totalFinal)}</span>
        </div>
        {esMercadoPago ? (
          <div>
            <label className="block text-sm text-neutral-500 mb-1">¿Cómo pagó el cliente?</label>
            <select
              value={formaPagoMp}
              onChange={(e) => setFormaPagoMp(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm bg-white"
            >
              <option value="">Elegí una opción...</option>
              {FORMAS_PAGO_MP.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.etiqueta}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-3" role="alert">
          {error}
        </p>
      )}

      <button
        onClick={handleCobrar}
        disabled={
          enviando ||
          itemsCarrito.length === 0 ||
          (marcasCanje.size > 0 && pinCanje.length < 4) ||
          (esMercadoPago ? !formaPagoMp : montoNum < totalFinal)
        }
        className="w-full bg-accent hover:bg-accent-dark disabled:opacity-40 text-white font-bold py-4 rounded-xl mb-8"
      >
        {enviando ? "Registrando..." : `Cobrar · $${formatearMonto(totalFinal)}`}
      </button>
    </div>
  );
}
