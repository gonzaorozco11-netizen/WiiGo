"use client";

import { useEffect, useState } from "react";
import {
  calcularTablero,
  cerrarMes,
  actualizarValoresReales,
  agregarReservaConfigurada,
  actualizarReservaConfigurada,
  eliminarReservaConfigurada,
  type TableroResultados,
  type ItemMonto,
  type ItemCategoriaGasto,
} from "@/app/(app)/resultado-mes/actions";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function mesActualISO() {
  return new Date().toISOString().slice(0, 7);
}

function formatearPeriodo(periodo: string) {
  const [anio, mes] = periodo.split("-");
  return `${MESES[Number(mes) - 1] ?? mes} ${anio}`;
}

function sumarMes(periodo: string, delta: number) {
  const [anio, mes] = periodo.split("-").map(Number);
  const d = new Date(anio, mes - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatearMonto(valor: number) {
  const signo = valor < 0 ? "-" : "";
  return signo + "$" + Math.abs(valor).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(monto: number, base: number) {
  if (!base) return "—";
  return (Math.abs(monto) / base * 100).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "% s/ventas netas";
}

function pctDeBloque(monto: number, totalBloque: number) {
  if (!totalBloque) return "—";
  return (Math.abs(monto) / Math.abs(totalBloque) * 100).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
}

export default function ResultadoMesApp() {
  const [periodo, setPeriodo] = useState(mesActualISO());
  const [datos, setDatos] = useState<TableroResultados | null>(null);
  const [cargando, setCargando] = useState(true);
  const [reabriendo, setReabriendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview en vivo del % de Ganancias mientras el mes está abierto — no se
  // guarda nada hasta que se toca "Cerrar este mes".
  const [pctGananciasPreview, setPctGananciasPreview] = useState(35);

  // Valores reales que se cargan al cerrar (o al reabrir para corregir).
  const [iibbRealInput, setIibbRealInput] = useState("");
  const [gananciasRealInput, setGananciasRealInput] = useState("");
  const [reservasRealInput, setReservasRealInput] = useState<Record<string, string>>({});

  function recargar() {
    setCargando(true);
    calcularTablero(periodo)
      .then((d) => {
        setDatos(d);
        setPctGananciasPreview(d.pctGanancias);
        setIibbRealInput(String(d.iibbReal ?? Math.round(d.iibbSupuesto)));
        setGananciasRealInput(String(d.provisionGananciasReal ?? Math.round(d.provisionGananciasSupuesto)));
        setReservasRealInput(
          Object.fromEntries(d.reservas.map((r) => [r.nombre, String(Math.round(r.montoReal ?? r.montoSupuesto))]))
        );
        setReabriendo(false);
      })
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  if (cargando || !datos) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-lg font-semibold text-neutral-900 mb-5">Estado de Resultados</h1>
        <p className="text-sm text-neutral-400 text-center py-12">Calculando...</p>
      </div>
    );
  }

  const enCurso = datos.estado === "ABIERTO";
  const mostrarEdicion = !enCurso && reabriendo;

  // Preview del lado "supuesto" cuando el mes está abierto y se toca el %.
  const baseGanancias = datos.resultadoOperativo - datos.iibbSupuesto;
  const provisionGananciasPreview = enCurso ? Math.round(baseGanancias * (pctGananciasPreview / 100)) : datos.provisionGananciasSupuesto;
  const gananciaNetaPreview = enCurso ? Math.round(baseGanancias - provisionGananciasPreview) : datos.gananciaNetaSupuesto;
  const reservasPreview = enCurso
    ? datos.reservas.map((r) => ({ ...r, montoSupuesto: Math.round(gananciaNetaPreview * (r.porcentaje / 100)) }))
    : datos.reservas;
  const totalReservasPreview = reservasPreview.reduce((acc, r) => acc + r.montoSupuesto, 0);
  const distribuiblePreview = gananciaNetaPreview - totalReservasPreview;

  const iibbMostrado = enCurso ? datos.iibbSupuesto : datos.iibbReal ?? datos.iibbSupuesto;
  const gananciasMostrado = enCurso ? provisionGananciasPreview : datos.provisionGananciasReal ?? datos.provisionGananciasSupuesto;
  const gananciaNetaMostrada = enCurso ? gananciaNetaPreview : datos.gananciaNetaReal ?? datos.gananciaNetaSupuesto;
  const totalReservasMostrado = enCurso ? totalReservasPreview : datos.totalReservasReal ?? datos.totalReservasSupuesto;
  const distribuibleMostrado = enCurso ? distribuiblePreview : datos.utilidadDistribuibleReal ?? datos.utilidadDistribuibleSupuesto;

  async function confirmarCierre() {
    setError(null);
    setGuardando(true);
    const reservasReal = datos!.reservas.map((r) => ({ nombre: r.nombre, monto: Number(reservasRealInput[r.nombre] ?? 0) }));
    const res = await cerrarMes(periodo, pctGananciasPreview, Number(iibbRealInput), Number(gananciasRealInput), reservasReal);
    setGuardando(false);
    if (res.error) setError(res.error);
    else recargar();
  }

  async function confirmarActualizacion() {
    setError(null);
    setGuardando(true);
    const reservasReal = datos!.reservas.map((r) => ({ nombre: r.nombre, monto: Number(reservasRealInput[r.nombre] ?? 0) }));
    const res = await actualizarValoresReales(periodo, Number(iibbRealInput), Number(gananciasRealInput), reservasReal);
    setGuardando(false);
    if (res.error) setError(res.error);
    else recargar();
  }

  async function agregarReserva() {
    await agregarReservaConfigurada("Nueva reserva", 5);
    recargar();
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <h1 className="text-lg font-semibold text-neutral-900">Estado de Resultados</h1>
        <div className="flex items-center gap-1 bg-white border border-neutral-200 rounded-lg px-1 py-1 shadow-sm">
          <button onClick={() => setPeriodo((p) => sumarMes(p, -1))} className="px-2 py-1 text-neutral-400 hover:text-neutral-700 font-medium">
            ‹
          </button>
          <span className="text-sm font-medium px-2">{formatearPeriodo(periodo)}</span>
          <button onClick={() => setPeriodo((p) => sumarMes(p, 1))} className="px-2 py-1 text-neutral-400 hover:text-neutral-700 font-medium">
            ›
          </button>
        </div>
      </div>
      <p className="text-sm text-neutral-500 mb-3 max-w-lg">
        Mientras el mes está en curso, IIBB, Provisión de Ganancias y Reservas son estimados. Al cerrar el mes cargás
        los números reales — el cálculo original solo aparece si volvés a abrir el mes para corregir.
      </p>

      <div className="flex items-center gap-3 flex-wrap mb-4">
        {enCurso ? (
          <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-blue-50 text-blue-600">
            En curso — estimado
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-600">
            Cerrado{datos.fechaCierre ? ` el ${new Date(datos.fechaCierre).toLocaleDateString("es-AR")}` : ""}
          </span>
        )}
        {!enCurso && !reabriendo && (
          <button onClick={() => setReabriendo(true)} className="text-xs font-medium text-accent hover:underline">
            Reabrir para corregir →
          </button>
        )}
        {mostrarEdicion && (
          <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-amber-50 text-amber-600">
            Editando el cierre
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm text-sm">
        <BloqueVentasBrutas items={datos.ventasBrutas} total={datos.totalVentasBrutas} />

        <FilaSimple nombre="IVA Débito Fiscal" monto={-datos.ivaDebitoFiscal} pctSub={pct(-datos.ivaDebitoFiscal, datos.ventasNetas)} />

        <FilaHito color="blue" nombre="= Ventas Netas" monto={datos.ventasNetas} pctSub={pct(datos.ventasNetas, datos.ventasNetas)} />

        <FilaSimple nombre="Costo de Mercadería Vendida" monto={-datos.cmv} pctSub={pct(-datos.cmv, datos.ventasNetas)} />

        <FilaHito color="purple" nombre="= Contribución Marginal" monto={datos.contribucionMarginal} pctSub={pct(datos.contribucionMarginal, datos.ventasNetas)} />

        <BloqueGastosCategoria titulo="Gastos fijos operativos" total={-datos.totalGastosFijos} items={datos.gastosFijos} pctVentas={pct(-datos.totalGastosFijos, datos.ventasNetas)} />
        <BloqueGastosCategoria titulo="Gastos variables" total={-datos.totalGastosVariables} items={datos.gastosVariables} pctVentas={pct(-datos.totalGastosVariables, datos.ventasNetas)} />

        <BloqueItems
          titulo="Retenciones"
          total={-datos.totalRetenciones}
          pctVentas={pct(-datos.totalRetenciones, datos.ventasNetas)}
          items={[
            { nombre: "Impuesto a los Créditos", fuente: "Solo ventas propias — lo de consignación se lo trasladás a la marca", monto: -datos.impuestoCreditos },
            { nombre: "Impuesto a los Débitos", fuente: "Propias + consignación — lo absorbés vos siempre", monto: -datos.impuestoDebitos },
          ]}
        />

        <BloqueItems
          titulo="Gastos bancarios"
          total={-datos.totalGastosBancarios}
          pctVentas={pct(-datos.totalGastosBancarios, datos.ventasNetas)}
          items={[{ nombre: "Comisión Mercado Pago", fuente: "Ventas propias", monto: -datos.comisionMp }]}
        />

        <FilaHito color="teal" nombre="= Resultado Operativo" monto={datos.resultadoOperativo} pctSub={pct(datos.resultadoOperativo, datos.ventasNetas)} />

        <FilaSimple nombre="Gastos contables" monto={-iibbMostrado} pctSub={pct(-iibbMostrado, datos.ventasNetas)} />
        <FilaIibb
          mostrarEdicion={mostrarEdicion}
          montoSupuesto={datos.iibbSupuesto}
          montoReal={iibbRealInput}
          onMontoReal={setIibbRealInput}
          montoMostrado={-iibbMostrado}
        />
        <FilaDetalle nombre="Ingresos Brutos" monto={-datos.ingresosBrutosIibb} nivel={2} />
        <FilaDetalle nombre="SIRCREB del mes (recuperable)" monto={datos.sircrebRecuperable} positivo nivel={2} />

        <FilaProvisionGanancias
          enCurso={enCurso}
          mostrarEdicion={mostrarEdicion}
          pct={pctGananciasPreview}
          onPct={setPctGananciasPreview}
          montoSupuesto={enCurso ? provisionGananciasPreview : datos.provisionGananciasSupuesto}
          montoReal={gananciasRealInput}
          onMontoReal={setGananciasRealInput}
          pctVenta={pct(-gananciasMostrado, datos.ventasNetas)}
        />

        <FilaHito color="green" nombre="Ganancia Neta Real" monto={gananciaNetaMostrada} pctSub={pct(gananciaNetaMostrada, datos.ventasNetas)} />

        <FilaSimple nombre="Reservas estratégicas (informativo)" monto={-totalReservasMostrado} pctSub={pct(-totalReservasMostrado, datos.ventasNetas)} />
        {reservasPreview.map((r) => (
          <FilaReserva
            key={r.nombre}
            nombre={r.nombre}
            porcentaje={r.porcentaje}
            enCurso={enCurso}
            mostrarEdicion={mostrarEdicion}
            montoSupuesto={r.montoSupuesto}
            montoReal={reservasRealInput[r.nombre] ?? ""}
            onMontoReal={(v) => setReservasRealInput((prev) => ({ ...prev, [r.nombre]: v }))}
            onCambiarPorcentaje={(v) => actualizarReservaConfigurada(r.idReserva!, r.nombre, v).then(recargar)}
            onCambiarNombre={(v) => actualizarReservaConfigurada(r.idReserva!, v, r.porcentaje).then(recargar)}
            onEliminar={() => eliminarReservaConfigurada(r.idReserva!).then(recargar)}
          />
        ))}
        {enCurso && (
          <button onClick={agregarReserva} className="w-full py-2 text-xs font-medium text-accent border-t border-dashed border-neutral-200 hover:bg-neutral-50">
            + Agregar reserva
          </button>
        )}

        <div className={`flex items-center justify-between px-4 py-4 text-white ${distribuibleMostrado < 0 ? "bg-red-600" : "bg-emerald-600"}`}>
          <span className="font-semibold">Utilidad Distribuible</span>
          <span className="text-right">
            <span className="block text-2xl font-semibold tabular-nums">{formatearMonto(distribuibleMostrado)}</span>
            <span className="block text-xs opacity-85">{pct(distribuibleMostrado, datos.ventasNetas)}</span>
          </span>
        </div>

        {enCurso && (
          <button
            onClick={confirmarCierre}
            disabled={guardando}
            className="w-full py-3 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60"
          >
            {guardando ? "Cerrando..." : "Cerrar este mes"}
          </button>
        )}
        {mostrarEdicion && (
          <button
            onClick={confirmarActualizacion}
            disabled={guardando}
            className="w-full py-3 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60"
          >
            {guardando ? "Guardando..." : "Guardar y volver a cerrar"}
          </button>
        )}
      </div>

      <p className="text-xs text-neutral-400 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2.5 mt-4">
        "Cerrado" muestra solo el número real, sin nada más al lado. "Reabierto" es la única vista donde aparece el
        "Supuesto" de referencia junto al campo para corregir.
      </p>
    </div>
  );
}

function BloqueVentasBrutas({ items, total }: { items: ItemMonto[]; total: number }) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-2.5 font-medium">
        <span>Ventas totales brutas</span>
        <span className="tabular-nums">{formatearMonto(total)}</span>
      </div>
      {items.map((i) => (
        <div key={i.nombre} className="flex items-center justify-between px-4 py-1.5 pl-7 border-t border-neutral-50 text-neutral-500 text-[13px]">
          <span>
            <span className="text-blue-600 font-medium text-xs mr-2 tabular-nums">{pctDeBloque(i.monto, total)}</span>
            {i.nombre}
          </span>
          <span className="tabular-nums">{formatearMonto(i.monto)}</span>
        </div>
      ))}
    </>
  );
}

function BloqueItems({ titulo, total, items, pctVentas }: { titulo: string; total: number; items: ItemMonto[]; pctVentas: string }) {
  const totalAbs = Math.abs(total);
  return (
    <>
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-100 font-medium">
        <span>{titulo}</span>
        <span className="text-right">
          <span className="block tabular-nums">{formatearMonto(total)}</span>
          <span className="block text-[11px] font-normal text-blue-600">{pctVentas}</span>
        </span>
      </div>
      {items.map((i) => (
        <div key={i.nombre} className="flex items-center justify-between px-4 py-1.5 pl-7 text-neutral-500 text-[13px]">
          <span>
            <span className="text-blue-600 font-medium text-xs mr-2 tabular-nums">{pctDeBloque(i.monto, totalAbs)}</span>
            {i.nombre}
            {i.fuente && <span className="block text-[10px] text-neutral-400">{i.fuente}</span>}
          </span>
          <span className="tabular-nums">{formatearMonto(i.monto)}</span>
        </div>
      ))}
    </>
  );
}

// Gastos fijos/variables agrupados por categoría — si una categoría tiene
// más de una subcategoría se muestra plegable (tocás para desplegar), si
// tiene una sola se muestra directo, sin flechita de más.
function BloqueGastosCategoria({
  titulo,
  total,
  items,
  pctVentas,
}: {
  titulo: string;
  total: number;
  items: ItemCategoriaGasto[];
  pctVentas: string;
}) {
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const totalAbs = Math.abs(total);

  function toggle(nombre: string) {
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-100 font-medium">
        <span>{titulo}</span>
        <span className="text-right">
          <span className="block tabular-nums">{formatearMonto(total)}</span>
          <span className="block text-[11px] font-normal text-blue-600">{pctVentas}</span>
        </span>
      </div>
      {items.map((cat) => {
        const subitems = cat.subitems ?? [];
        const montoCat = cat.monto === 0 ? 0 : -Math.abs(cat.monto);
        if (subitems.length <= 1) {
          return (
            <div key={cat.nombre} className="flex items-center justify-between px-4 py-1.5 pl-7 text-neutral-500 text-[13px]">
              <span>
                <span className="text-blue-600 font-medium text-xs mr-2 tabular-nums">{pctDeBloque(cat.monto, totalAbs)}</span>
                {cat.nombre}
                {subitems[0] && subitems[0].nombre !== "Sin subcategoría" && (
                  <span className="text-neutral-400"> — {subitems[0].nombre}</span>
                )}
              </span>
              <span className="tabular-nums">{formatearMonto(montoCat)}</span>
            </div>
          );
        }
        const abierta = abiertas.has(cat.nombre);
        return (
          <div key={cat.nombre}>
            <button
              type="button"
              onClick={() => toggle(cat.nombre)}
              className="w-full flex items-center justify-between px-4 py-1.5 pl-7 text-neutral-500 text-[13px] hover:bg-neutral-50"
            >
              <span className="flex items-center gap-1.5">
                <span className={`inline-block text-[9px] text-neutral-400 transition-transform ${abierta ? "rotate-90" : ""}`}>▶</span>
                <span className="text-blue-600 font-medium text-xs tabular-nums">{pctDeBloque(cat.monto, totalAbs)}</span>
                {cat.nombre}
              </span>
              <span className="tabular-nums">{formatearMonto(montoCat)}</span>
            </button>
            {abierta &&
              subitems.map((s) => (
                <div key={s.nombre} className="flex items-center justify-between px-4 py-1 pl-11 text-neutral-400 text-[12px] border-t border-dashed border-neutral-100">
                  <span>
                    <span className="text-blue-500 font-medium text-[10.5px] mr-1.5 tabular-nums">{pctDeBloque(s.monto, Math.abs(cat.monto))}</span>
                    {s.nombre}
                  </span>
                  <span className="tabular-nums">{formatearMonto(s.monto === 0 ? 0 : -Math.abs(s.monto))}</span>
                </div>
              ))}
          </div>
        );
      })}
    </>
  );
}

function FilaSimple({ nombre, monto, pctSub }: { nombre: string; monto: number; pctSub: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-100 font-medium">
      <span>{nombre}</span>
      <span className="text-right">
        <span className="block tabular-nums">{formatearMonto(monto)}</span>
        <span className="block text-[11px] font-normal text-blue-600">{pctSub}</span>
      </span>
    </div>
  );
}

function FilaDetalle({ nombre, monto, positivo, nivel = 1 }: { nombre: string; monto: number; positivo?: boolean; nivel?: 1 | 2 }) {
  return (
    <div
      className={
        nivel === 2
          ? "flex items-center justify-between px-4 py-1 pl-11 text-neutral-400 text-[12px] border-t border-dashed border-neutral-100"
          : "flex items-center justify-between px-4 py-1.5 pl-7 text-neutral-500 text-[13px]"
      }
    >
      <span>{nombre}</span>
      <span className={`tabular-nums ${positivo ? "text-emerald-600 font-medium" : ""}`}>{formatearMonto(monto)}</span>
    </div>
  );
}

// La única "línea" bajo Gastos contables — muestra el mismo total que el
// rubro (es el único ítem de ese bloque, igual que Comisión Mercado Pago es
// el único ítem de Gastos bancarios), pero acá además se puede corregir con
// el número real una vez que se reabre el mes para editar.
function FilaIibb({
  mostrarEdicion,
  montoSupuesto,
  montoReal,
  onMontoReal,
  montoMostrado,
}: {
  mostrarEdicion: boolean;
  montoSupuesto: number;
  montoReal: string;
  onMontoReal: (v: string) => void;
  montoMostrado: number;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-1.5 pl-7 text-neutral-500 text-[13px]">
      <span>
        <span className="text-blue-600 font-medium text-xs mr-2 tabular-nums">100,0%</span>
        IIBB
      </span>
      {mostrarEdicion ? (
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-neutral-400 whitespace-nowrap">Supuesto {formatearMonto(-montoSupuesto)}</span>
          <input
            type="number"
            value={montoReal}
            onChange={(e) => onMontoReal(e.target.value)}
            className="w-24 border border-amber-400 rounded px-1.5 py-0.5 text-xs text-right tabular-nums"
          />
        </span>
      ) : (
        <span className="tabular-nums">{formatearMonto(montoMostrado)}</span>
      )}
    </div>
  );
}

const COLOR_HITO: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700 border-l-4 border-blue-500",
  purple: "bg-purple-50 text-purple-700 border-l-4 border-purple-500",
  teal: "bg-teal-50 text-teal-700 border-l-4 border-teal-500",
  green: "bg-emerald-50 text-emerald-700 border-l-4 border-emerald-500",
};

function FilaHito({ color, nombre, monto, pctSub }: { color: string; nombre: string; monto: number; pctSub: string }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 border-t border-b border-neutral-200 font-semibold ${COLOR_HITO[color]}`}>
      <span>{nombre}</span>
      <span className="text-right">
        <span className="block tabular-nums">{formatearMonto(monto)}</span>
        <span className="block text-[11px] font-normal opacity-80">{pctSub}</span>
      </span>
    </div>
  );
}

function FilaProvisionGanancias({
  enCurso,
  mostrarEdicion,
  pct: pctValor,
  onPct,
  montoSupuesto,
  montoReal,
  onMontoReal,
  pctVenta,
}: {
  enCurso: boolean;
  mostrarEdicion: boolean;
  pct: number;
  onPct: (v: number) => void;
  montoSupuesto: number;
  montoReal: string;
  onMontoReal: (v: string) => void;
  pctVenta: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 gap-3">
      <span className="text-neutral-700">
        {enCurso ? (
          <>
            Provisión Impuesto a las Ganancias —{" "}
            <input
              type="number"
              value={pctValor}
              onChange={(e) => onPct(Number(e.target.value) || 0)}
              className="w-14 border border-amber-400 rounded px-1.5 py-0.5 text-sm text-right tabular-nums"
            />
            %
          </>
        ) : (
          "Provisión Impuesto a las Ganancias"
        )}
      </span>
      <span className="text-right">
        {mostrarEdicion ? (
          <span className="flex items-center gap-2 justify-end">
            <span className="text-[10px] text-neutral-400 whitespace-nowrap">Supuesto {formatearMonto(-montoSupuesto)}</span>
            <input
              type="number"
              value={montoReal}
              onChange={(e) => onMontoReal(e.target.value)}
              className="w-24 border border-amber-400 rounded px-1.5 py-0.5 text-sm text-right tabular-nums"
            />
          </span>
        ) : (
          <>
            <span className="block tabular-nums font-medium">{formatearMonto(-(enCurso ? montoSupuesto : Number(montoReal)))}</span>
            <span className="block text-[11px] font-normal text-blue-600">{pctVenta}</span>
          </>
        )}
      </span>
    </div>
  );
}

function FilaReserva({
  nombre,
  porcentaje,
  enCurso,
  mostrarEdicion,
  montoSupuesto,
  montoReal,
  onMontoReal,
  onCambiarPorcentaje,
  onCambiarNombre,
  onEliminar,
}: {
  nombre: string;
  porcentaje: number;
  enCurso: boolean;
  mostrarEdicion: boolean;
  montoSupuesto: number;
  montoReal: string;
  onMontoReal: (v: string) => void;
  onCambiarPorcentaje: (v: number) => void;
  onCambiarNombre: (v: string) => void;
  onEliminar: () => void;
}) {
  const [nombreLocal, setNombreLocal] = useState(nombre);
  const [pctLocal, setPctLocal] = useState(porcentaje);

  return (
    <div className="flex items-center justify-between px-4 py-1.5 pl-7 text-neutral-500 text-[13px] gap-3">
      {enCurso ? (
        <input
          value={nombreLocal}
          onChange={(e) => setNombreLocal(e.target.value)}
          onBlur={() => nombreLocal !== nombre && onCambiarNombre(nombreLocal)}
          className="border-none bg-transparent text-neutral-600 text-[13px] flex-1 min-w-0"
        />
      ) : (
        <span>{nombre}</span>
      )}
      <span className="flex items-center gap-2 shrink-0">
        {enCurso && (
          <>
            <input
              type="number"
              value={pctLocal}
              onChange={(e) => setPctLocal(Number(e.target.value) || 0)}
              onBlur={() => pctLocal !== porcentaje && onCambiarPorcentaje(pctLocal)}
              className="w-12 border border-neutral-200 rounded px-1 py-0.5 text-xs text-right tabular-nums"
            />
            <span className="text-xs">%</span>
          </>
        )}
        {mostrarEdicion ? (
          <>
            <span className="text-[10px] text-neutral-400 whitespace-nowrap">Sup. {formatearMonto(-montoSupuesto)}</span>
            <input
              type="number"
              value={montoReal}
              onChange={(e) => onMontoReal(e.target.value)}
              className="w-20 border border-amber-400 rounded px-1 py-0.5 text-xs text-right tabular-nums"
            />
          </>
        ) : (
          <span className="tabular-nums">{formatearMonto(-(enCurso ? montoSupuesto : Number(montoReal)))}</span>
        )}
        {enCurso && (
          <button onClick={onEliminar} className="text-neutral-300 hover:text-red-500 px-1">
            ✕
          </button>
        )}
      </span>
    </div>
  );
}
