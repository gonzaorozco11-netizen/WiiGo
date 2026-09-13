"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { FichaProducto } from "@/lib/fichaProducto";

// La ficha de un producto. Solo muestra: no hay un solo botón que escriba.
//
// Es la pantalla que se abre cuando los números no coinciden y hay que
// mirarle la cara al proveedor con la trazabilidad adelante.

function monto(v: number) {
  return v.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function fechaHora(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function fechaCorta(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Nombres que se entienden sin saber cómo se llama la tabla por dentro. */
const TIPO_LABEL: Record<string, string> = {
  VENTA: "Venta",
  COMPRA_PROVEEDOR: "Recepción de proveedor",
  RECEPCION: "Recepción de marca",
  DEVOLUCION: "Devolución de cliente",
  DEVOLUCION_NO_VENDIBLE: "Devolución fallada",
  DEVOLUCION_PROVEEDOR: "Devolución al proveedor",
  AJUSTE: "Ajuste manual",
  CARGA_INICIAL: "Carga inicial",
  TRANSFERENCIA_SALIDA: "Transferencia · salió",
  TRANSFERENCIA_ENTRADA: "Transferencia · entró",
};

type Filtro = "TODO" | "ENTRADAS" | "VENTAS" | "AJUSTES";

export default function FichaProductoApp({ ficha }: { ficha: FichaProducto }) {
  const [filtro, setFiltro] = useState<Filtro>("TODO");

  const movimientos = useMemo(() => {
    if (filtro === "TODO") return ficha.movimientos;
    if (filtro === "ENTRADAS") return ficha.movimientos.filter((m) => m.cantidad > 0);
    if (filtro === "VENTAS") return ficha.movimientos.filter((m) => m.tipo === "VENTA");
    return ficha.movimientos.filter((m) => m.tipo === "AJUSTE" || m.tipo === "CARGA_INICIAL");
  }, [ficha.movimientos, filtro]);

  const hayAjusteManual = ficha.movimientos.some((m) => m.tipo === "AJUSTE");

  const filtros: { clave: Filtro; texto: string }[] = [
    { clave: "TODO", texto: "Todo" },
    { clave: "ENTRADAS", texto: "Solo entradas" },
    { clave: "VENTAS", texto: "Solo ventas" },
    { clave: "AJUSTES", texto: "Ajustes" },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      {/* En la impresión no van los menús ni los botones — la hoja tiene que
          poder quedar sobre un mostrador. */}
      <style>{`@media print { .no-imprimir { display: none !important; } body { background: #fff; } }`}</style>

      <div className="flex items-start gap-3 flex-wrap mb-4">
        <div className="flex-1 min-w-[220px]">
          <Link href="/stock" className="text-xs font-semibold text-accent hover:underline no-imprimir">
            ← Volver a Stock
          </Link>
          <h1 className="text-xl font-semibold text-neutral-900 mt-1">{ficha.nombre}</h1>
          <p className="text-xs text-neutral-500">
            {[ficha.marca, ficha.proveedor, `IVA ${ficha.ivaPorcentaje}%`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="no-imprimir text-sm font-semibold text-neutral-700 border border-neutral-300 rounded-lg px-3 py-1.5 hover:bg-neutral-50"
        >
          🖨 Imprimir
        </button>
      </div>

      {/* ---------- Los cuatro números ---------- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-neutral-200 border border-neutral-200 rounded-xl overflow-hidden mb-5">
        <Cifra titulo="En góndola" valor={`${ficha.stockActual}`} sufijo="un." />
        <Cifra titulo="Costo actual" valor={ficha.costoActual != null ? `$${monto(ficha.costoActual)}` : "—"} />
        <Cifra
          titulo="Vale hoy"
          valor={`$${monto(ficha.valorEnGondola)}`}
          pie="al costo del lote de cada unidad"
        />
        <Cifra titulo="Vendidas" valor={`${ficha.vendidasEnElPeriodo}`} pie="en el período" />
      </div>

      {/* ---------- Lotes ---------- */}
      {ficha.lotes.length > 0 && (
        <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-neutral-100 flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-sm font-semibold text-neutral-900">De dónde salió cada unidad</p>
            <p className="text-xs text-neutral-500 tabular-nums">
              {ficha.lotes.length} {ficha.lotes.length === 1 ? "entrada" : "entradas"} ·{" "}
              {ficha.lotes.reduce((a, l) => a + l.cantidad, 0)} unidades
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-neutral-400 bg-neutral-50 border-b border-neutral-200">
                  <th className="px-4 py-2 font-bold">Entró el</th>
                  <th className="px-4 py-2 font-bold">Pedido</th>
                  <th className="px-4 py-2 font-bold text-right">Cantidad</th>
                  <th className="px-4 py-2 font-bold text-right">Costo c/u</th>
                  <th className="px-4 py-2 font-bold text-right">Quedan</th>
                  <th className="px-4 py-2 font-bold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {ficha.lotes.map((l) => (
                  <tr key={l.idDetalle} className="border-b border-neutral-50 last:border-0">
                    <td className="px-4 py-2.5 text-neutral-700 tabular-nums">{fechaCorta(l.fecha)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-neutral-400">
                      {l.idOrden ? `#${l.idOrden.slice(0, 6).toUpperCase()}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">{l.cantidad}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700">
                      {l.costoUnitario != null ? `$${monto(l.costoUnitario)}` : <span className="text-amber-700">sin costear</span>}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                        l.quedan === 0 ? "text-neutral-400" : "text-neutral-900"
                      }`}
                    >
                      {l.quedan}
                    </td>
                    <td className="px-4 py-2.5">
                      {l.quedan === 0 ? (
                        <Chip tono="gris">{l.liquidado ? "Agotado · liquidado" : "Agotado"}</Chip>
                      ) : l.quedan === l.cantidad ? (
                        <Chip tono="azul">Sin tocar</Chip>
                      ) : (
                        <Chip tono="verde">Vendiéndose</Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2.5 text-xs text-neutral-400 border-t border-neutral-100">
            Se gasta del más viejo al más nuevo. <b className="text-neutral-600">Lo que queda se calcula al momento</b>{" "}
            — el sistema descuenta los lotes recién al liquidar, así que leerlo de la base mostraría de más.
          </p>
        </div>
      )}

      {/* ---------- Resumen para el proveedor ---------- */}
      {ficha.resumenProveedor && (
        <div className="border border-accent bg-accent-tint rounded-xl px-4 py-3.5 mb-5">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-accent mb-2">
            Para hablar con {ficha.proveedor ?? "el proveedor"}
          </p>
          <div className="flex gap-6 flex-wrap tabular-nums">
            <Dato etiqueta="Te entregó" valor={`${ficha.resumenProveedor.entregadas} un.`} />
            <Dato etiqueta="Salieron" valor={`${ficha.resumenProveedor.vendidas} un.`} />
            <Dato etiqueta="Quedan" valor={`${ficha.resumenProveedor.quedan} un.`} />
            <Dato etiqueta="Le liquidaste" valor={`$${monto(ficha.resumenProveedor.liquidado)}`} />
            <Dato etiqueta="Falta liquidar" valor={`$${monto(ficha.resumenProveedor.faltaLiquidar)}`} />
          </div>
        </div>
      )}

      {/* ---------- Movimientos ---------- */}
      <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold text-neutral-900">Todo lo que pasó</p>
          <p className="text-xs text-neutral-500">el saldo es lo que quedó después de cada movimiento</p>
        </div>

        <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-100 flex gap-1.5 flex-wrap no-imprimir">
          {filtros.map((f) => (
            <button
              key={f.clave}
              onClick={() => setFiltro(f.clave)}
              className={`text-xs font-semibold rounded-lg px-2.5 py-1 border ${
                filtro === f.clave
                  ? "bg-neutral-800 text-white border-neutral-800"
                  : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {f.texto}
            </button>
          ))}
        </div>

        {movimientos.length === 0 ? (
          <p className="px-4 py-8 text-sm text-neutral-400 text-center">Este producto todavía no se movió.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-neutral-400 bg-neutral-50 border-b border-neutral-200">
                  <th className="px-4 py-2 font-bold">Cuándo</th>
                  <th className="px-4 py-2 font-bold">Qué pasó</th>
                  <th className="px-4 py-2 font-bold text-right">Entra</th>
                  <th className="px-4 py-2 font-bold text-right">Sale</th>
                  <th className="px-4 py-2 font-bold text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id} className="border-b border-neutral-50 last:border-0">
                    <td className="px-4 py-2.5 text-neutral-500 tabular-nums whitespace-nowrap">
                      {fechaHora(m.fecha)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block text-neutral-900">{TIPO_LABEL[m.tipo] ?? m.tipo}</span>
                      {(m.motivo || m.usuario) && (
                        <span className="block text-[11px] text-neutral-400">
                          {[m.motivo, m.usuario].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 font-semibold">
                      {m.cantidad > 0 ? `+${m.cantidad}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-red-600 font-semibold">
                      {m.cantidad < 0 ? m.cantidad : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-neutral-900">{m.saldo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hayAjusteManual && (
          <p className="px-4 py-2.5 text-xs text-amber-800 bg-amber-50 border-t border-amber-200">
            Hay <b>ajustes manuales</b> en esta lista. Son los renglones donde alguien corrigió el stock a mano, y son
            el motivo por el que la cuenta puede no dar exacta contra lo comprado y lo vendido. Están a la vista a
            propósito.
          </p>
        )}
      </div>

      <p className="text-xs text-neutral-400 mt-4">
        El saldo se reconstruye hacia atrás desde el stock de hoy, así que el renglón de arriba siempre coincide con lo
        que hay en la góndola. Se muestran los últimos 400 movimientos.
      </p>
    </div>
  );
}

function Cifra({ titulo, valor, sufijo, pie }: { titulo: string; valor: string; sufijo?: string; pie?: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-neutral-400">{titulo}</p>
      <p className="text-xl font-bold text-neutral-900 tabular-nums">
        {valor}
        {sufijo && <span className="text-xs font-normal text-neutral-400 ml-1">{sufijo}</span>}
      </p>
      {pie && <p className="text-[11px] text-neutral-400">{pie}</p>}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-[11px] text-accent-dark">{etiqueta}</p>
      <p className="text-lg font-bold text-accent-dark">{valor}</p>
    </div>
  );
}

function Chip({ tono, children }: { tono: "gris" | "verde" | "azul"; children: React.ReactNode }) {
  const estilo =
    tono === "verde"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tono === "azul"
        ? "bg-accent-tint text-accent border-blue-200"
        : "bg-neutral-50 text-neutral-500 border-neutral-200";
  return (
    <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${estilo}`}>
      {children}
    </span>
  );
}
