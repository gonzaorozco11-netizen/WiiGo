"use client";

import { useEffect, useMemo, useState } from "react";
import type { Local, Gasto } from "@/lib/supabase";
import {
  crearGasto,
  actualizarGasto,
  listarGastos,
  resumenGastos,
  obtenerUrlComprobanteGasto,
  guardarPresupuesto,
  listarPresupuestos,
  listarCategorias,
  listarSubcategorias,
  anularGasto,
} from "@/app/(app)/gastos/actions";
import ModalAnularMovimiento from "@/components/ModalAnularMovimiento";

type CategoriaGasto = { id_categoria: string; nombre: string; tipo_default: string; estado: string; fecha_alta: string };
type SubcategoriaGasto = { id_subcategoria: string; id_categoria: string; nombre: string; estado: string };
type UsuarioMin = { id_usuario: string; nombre: string; sueldo_base: number | null };
type TurnoAbiertoMin = { id_turno: string; id_local: string };
type Resumen = {
  total: number;
  totalFijos: number;
  totalVariables: number;
  pendientesFactura: number;
  porCategoria: {
    idCategoria: string;
    nombre: string;
    gastado: number;
    pct: number;
    presupuesto: number | null;
    pctPresupuesto: number | null;
  }[];
};
const MEDIO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO_TURNO: "💵 Efectivo del turno",
  EFECTIVO_ADMIN: "🔒 Caja Administración",
  TRANSFERENCIA: "🏦 Transferencia",
  MERCADO_PAGO: "💳 Mercado Pago / Tarjeta",
};

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFechaHora(fechaISO: string) {
  return new Date(fechaISO).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function inicioDeMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function GastosApp({
  locales,
  usuarios,
  turnosAbiertos,
  categoriasIniciales,
  subcategoriasIniciales,
  puedeAutorizarSinLimite,
  topeAutorizacion,
  ivaGeneralPorcentaje,
}: {
  locales: Local[];
  usuarios: UsuarioMin[];
  turnosAbiertos: TurnoAbiertoMin[];
  categoriasIniciales: CategoriaGasto[];
  subcategoriasIniciales: SubcategoriaGasto[];
  puedeAutorizarSinLimite: boolean;
  topeAutorizacion: number;
  ivaGeneralPorcentaje: number;
}) {
  const [categorias, setCategorias] = useState(categoriasIniciales);
  const [subcategorias, setSubcategorias] = useState(subcategoriasIniciales);

  function recargarCategorias() {
    Promise.all([listarCategorias(), listarSubcategorias()]).then(([cats, subs]) => {
      setCategorias(cats);
      setSubcategorias(subs);
    });
  }

  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id_categoria, c])), [categorias]);
  const subcategoriaPorId = useMemo(() => new Map(subcategorias.map((s) => [s.id_subcategoria, s])), [subcategorias]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Resumen de Gastos</h1>
      <p className="text-sm text-neutral-500 mb-5 max-w-2xl">
        Todo egreso queda categorizado, vinculado al turno que lo pagó (si salió de la caja física) y con su
        comprobante — así se sabe en qué se va la plata y el arqueo de cada turno sigue cuadrando.
      </p>
      <p className="text-xs text-neutral-400 -mt-3 mb-5">
        Las categorías (Gastos, Cargo a marca e Ingreso) y los gastos recurrentes ahora se manejan desde{" "}
        <a href="/gastos-ingresos" className="text-accent hover:underline">Gastos e Ingresos</a>.
      </p>

      <TabGastos
        locales={locales}
        usuarios={usuarios}
        turnosAbiertos={turnosAbiertos}
        categorias={categorias}
        subcategorias={subcategorias}
        categoriaPorId={categoriaPorId}
        subcategoriaPorId={subcategoriaPorId}
        puedeAutorizarSinLimite={puedeAutorizarSinLimite}
        topeAutorizacion={topeAutorizacion}
        ivaGeneralPorcentaje={ivaGeneralPorcentaje}
      />
    </div>
  );
}

const COLORES_STAT = {
  accent: { borde: "border-t-accent", icono: "bg-accent-tint text-accent" },
  purple: { borde: "border-t-purple-600", icono: "bg-purple-100 text-purple-600" },
  success: { borde: "border-t-emerald-600", icono: "bg-emerald-100 text-emerald-600" },
  danger: { borde: "border-t-red-600", icono: "bg-red-100 text-red-600" },
  neutro: { borde: "border-t-neutral-400", icono: "bg-neutral-100 text-neutral-500" },
} as const;

function StatCard({
  color,
  icono,
  etiqueta,
  valor,
  nota,
}: {
  color: keyof typeof COLORES_STAT;
  icono: string;
  etiqueta: string;
  valor: string;
  nota?: string;
}) {
  const c = COLORES_STAT[color];
  return (
    <div className={`bg-white border border-neutral-200 border-t-4 ${c.borde} rounded-xl p-4`}>
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${c.icono}`}>{icono}</span>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{etiqueta}</p>
      </div>
      <p className="text-xl font-extrabold text-neutral-900 tabular-nums tracking-tight">{valor}</p>
      {nota && <p className="text-[11px] text-neutral-400 mt-0.5">{nota}</p>}
    </div>
  );
}

// ===================== TAB GASTOS =====================

function TabGastos({
  locales,
  usuarios,
  turnosAbiertos,
  categorias,
  subcategorias,
  categoriaPorId,
  subcategoriaPorId,
  puedeAutorizarSinLimite,
  topeAutorizacion,
  ivaGeneralPorcentaje,
}: {
  locales: Local[];
  usuarios: UsuarioMin[];
  turnosAbiertos: TurnoAbiertoMin[];
  categorias: CategoriaGasto[];
  subcategorias: SubcategoriaGasto[];
  categoriaPorId: Map<string, CategoriaGasto>;
  subcategoriaPorId: Map<string, SubcategoriaGasto>;
  puedeAutorizarSinLimite: boolean;
  topeAutorizacion: number;
  ivaGeneralPorcentaje: number;
}) {
  const [filtroLocal, setFiltroLocal] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [periodo, setPeriodo] = useState<"hoy" | "semana" | "mes">("mes");
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [presupuestos, setPresupuestos] = useState<Map<string, number>>(new Map());
  const [cargando, setCargando] = useState(false);
  const [modalGasto, setModalGasto] = useState<Gasto | null>(null);
  const [anulando, setAnulando] = useState<Gasto | null>(null);

  const { desde, hasta } = useMemo(() => {
    if (periodo === "hoy") return { desde: hoyISO(), hasta: hoyISO() };
    if (periodo === "semana") {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return { desde: d.toISOString().slice(0, 10), hasta: hoyISO() };
    }
    return { desde: inicioDeMes(), hasta: hoyISO() };
  }, [periodo]);

  function recargar() {
    setCargando(true);
    Promise.all([
      listarGastos({ idLocal: filtroLocal || undefined, idCategoria: filtroCategoria || undefined, desde, hasta }),
      resumenGastos({ idLocal: filtroLocal || undefined, desde, hasta }),
      listarPresupuestos(),
    ])
      .then(([g, r, p]) => {
        setGastos(g);
        setResumen(r);
        setPresupuestos(new Map(p.map((x) => [x.id_categoria, x.monto_mensual])));
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [filtroLocal, filtroCategoria, desde, hasta]);

  function handleVerComprobante(path: string) {
    obtenerUrlComprobanteGasto(path).then((url) => window.open(url, "_blank"));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm">
          <option value="">Todos los locales</option>
          {locales.map((l) => (
            <option key={l.id_local} value={l.id_local}>{l.nombre}</option>
          ))}
        </select>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm">
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>
          ))}
        </select>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as typeof periodo)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm">
          <option value="mes">Este mes</option>
          <option value="semana">Últimos 7 días</option>
          <option value="hoy">Hoy</option>
        </select>
      </div>

      {resumen && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-4">
          <StatCard color="accent" icono="💰" etiqueta="Total del período" valor={`$${formatearMonto(resumen.total)}`} />
          <StatCard color="purple" icono="📌" etiqueta="Fijos" valor={`$${formatearMonto(resumen.totalFijos)}`} nota={resumen.total ? `${Math.round((resumen.totalFijos / resumen.total) * 100)}% del total` : undefined} />
          <StatCard color="success" icono="📈" etiqueta="Variables" valor={`$${formatearMonto(resumen.totalVariables)}`} nota={resumen.total ? `${Math.round((resumen.totalVariables / resumen.total) * 100)}% del total` : undefined} />
          <StatCard color="danger" icono="🧾" etiqueta="Pendientes de factura" valor={String(resumen.pendientesFactura)} nota="Reclamar comprobante" />
        </div>
      )}

      {resumen && resumen.porCategoria.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-1">
          {resumen.porCategoria.map((c) => {
            const sobrepresupuesto = c.pctPresupuesto != null && c.pctPresupuesto >= 100;
            const cercaPresupuesto = c.pctPresupuesto != null && c.pctPresupuesto >= 80 && c.pctPresupuesto < 100;
            return (
              <div
                key={c.idCategoria}
                className={`border rounded-lg p-3 ${
                  sobrepresupuesto ? "bg-red-50 border-red-200" : cercaPresupuesto ? "bg-amber-50 border-amber-200" : "bg-white border-neutral-200"
                }`}
              >
                <p className="text-[11px] font-semibold text-neutral-500 mb-1 truncate">{c.nombre}</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-sm font-extrabold tabular-nums">${formatearMonto(c.gastado)}</span>
                  <span className="text-xs font-bold text-accent">{c.pct.toFixed(1)}%</span>
                </div>
                <div className="h-1 rounded-full bg-neutral-100 mt-2 overflow-hidden">
                  <span
                    className={`block h-full ${sobrepresupuesto ? "bg-red-500" : cercaPresupuesto ? "bg-amber-500" : "bg-accent"}`}
                    style={{ width: `${Math.min(c.pctPresupuesto ?? c.pct, 100)}%` }}
                  />
                </div>
                {c.pctPresupuesto != null && (
                  <p className={`text-[10px] mt-1 font-semibold ${sobrepresupuesto ? "text-red-600" : cercaPresupuesto ? "text-amber-700" : "text-neutral-400"}`}>
                    {sobrepresupuesto ? "🔴" : cercaPresupuesto ? "⚠" : ""} {Math.round(c.pctPresupuesto)}% del presupuesto (${formatearMonto(c.presupuesto ?? 0)})
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-neutral-400 mb-5">% sobre el total de gastos del período filtrado.</p>

      <PresupuestosPorCategoria categorias={categorias} presupuestos={presupuestos} onGuardado={recargar} />

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-6 mt-5">
        <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Historial de gastos</h2>
          <span className="text-xs text-neutral-400">Del más reciente al más viejo</span>
        </div>
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : gastos.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">No hay gastos en este período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Categoría</th>
                  <th className="p-3">Descripción</th>
                  <th className="p-3">Medio</th>
                  <th className="p-3 text-right">Monto</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Usuario</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {gastos.map((g) => {
                  const cat = categoriaPorId.get(g.id_categoria);
                  const sub = g.id_subcategoria ? subcategoriaPorId.get(g.id_subcategoria) : null;
                  return (
                    <tr key={g.id_gasto} className="border-b border-neutral-100 last:border-0">
                      <td className="p-3 whitespace-nowrap text-neutral-500">{formatearFechaHora(g.fecha)}</td>
                      <td className="p-3">
                        {cat?.nombre ?? "—"}
                        {sub && <div className="text-xs text-neutral-400">{sub.nombre}</div>}
                      </td>
                      <td className="p-3">{g.descripcion ?? "—"}</td>
                      <td className="p-3 text-neutral-500 whitespace-nowrap">{MEDIO_PAGO_LABEL[g.medio_pago] ?? g.medio_pago}</td>
                      <td className="p-3 text-right tabular-nums font-medium">${formatearMonto(g.monto)}</td>
                      <td className="p-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${g.tipo === "FIJO" ? "bg-purple-100 text-purple-700" : "bg-accent-tint text-accent-dark"}`}>
                          {g.tipo === "FIJO" ? "Fijo" : "Variable"}
                        </span>
                      </td>
                      <td className="p-3 text-neutral-500">{g.usuario ?? "—"}</td>
                      <td className="p-3">
                        {g.requirio_autorizacion ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Autorizado</span>
                        ) : g.pendiente_factura ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Sin factura</span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">OK</span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {g.comprobante_path && (
                          <button onClick={() => handleVerComprobante(g.comprobante_path!)} className="text-accent text-xs font-medium mr-2.5">
                            Ver comprobante
                          </button>
                        )}
                        <button onClick={() => setModalGasto(g)} className="text-accent text-xs font-medium mr-2.5">
                          Editar
                        </button>
                        <button onClick={() => setAnulando(g)} className="text-red-600 text-xs font-medium">
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalGasto && (
        <FormNuevoGasto
          gasto={modalGasto}
          locales={locales}
          usuarios={usuarios}
          turnosAbiertos={turnosAbiertos}
          categorias={categorias}
          subcategorias={subcategorias}
          puedeAutorizarSinLimite={puedeAutorizarSinLimite}
          topeAutorizacion={topeAutorizacion}
          ivaGeneralPorcentaje={ivaGeneralPorcentaje}
          onClose={() => setModalGasto(null)}
        />
      )}

      {anulando && (
        <ModalAnularMovimiento
          titulo="Eliminar gasto"
          descripcion={`${anulando.descripcion ?? "Gasto"} — $${formatearMonto(anulando.monto)}`}
          onConfirmar={async (motivo) => {
            const res = await anularGasto(anulando.id_gasto, motivo);
            if (!res.error) window.location.reload();
            return res;
          }}
          onClose={() => setAnulando(null)}
        />
      )}
    </div>
  );
}

function PresupuestosPorCategoria({
  categorias,
  presupuestos,
  onGuardado,
}: {
  categorias: CategoriaGasto[];
  presupuestos: Map<string, number>;
  onGuardado: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  function valor(idCategoria: string) {
    if (valores[idCategoria] !== undefined) return valores[idCategoria];
    const p = presupuestos.get(idCategoria);
    return p ? String(p) : "";
  }

  function handleGuardar(idCategoria: string) {
    const monto = Number(valor(idCategoria)) || 0;
    setGuardandoId(idCategoria);
    guardarPresupuesto(idCategoria, monto)
      .then(onGuardado)
      .finally(() => setGuardandoId(null));
  }

  return (
    <div className="mb-2">
      <button onClick={() => setAbierto((v) => !v)} className="text-xs font-semibold text-accent">
        {abierto ? "▾" : "▸"} Presupuestos mensuales por categoría
      </button>
      {abierto && (
        <div className="bg-white border border-neutral-200 rounded-xl p-4 mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {categorias.map((c) => (
            <div key={c.id_categoria} className="flex items-center gap-2">
              <span className="text-sm text-neutral-600 flex-1 truncate">{c.nombre}</span>
              <input
                value={valor(c.id_categoria)}
                onChange={(e) => setValores((v) => ({ ...v, [c.id_categoria]: e.target.value }))}
                placeholder="$0"
                className="w-28 border border-neutral-300 rounded-lg px-2 py-1 text-sm text-right"
              />
              <button
                onClick={() => handleGuardar(c.id_categoria)}
                disabled={guardandoId === c.id_categoria}
                className="text-xs font-semibold text-accent disabled:opacity-40"
              >
                Guardar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormNuevoGasto({
  gasto = null,
  locales,
  usuarios,
  turnosAbiertos,
  categorias,
  subcategorias,
  puedeAutorizarSinLimite,
  topeAutorizacion,
  ivaGeneralPorcentaje,
  onClose,
}: {
  gasto?: Gasto | null;
  locales: Local[];
  usuarios: UsuarioMin[];
  turnosAbiertos: TurnoAbiertoMin[];
  categorias: CategoriaGasto[];
  subcategorias: SubcategoriaGasto[];
  puedeAutorizarSinLimite: boolean;
  topeAutorizacion: number;
  ivaGeneralPorcentaje: number;
  onClose: () => void;
}) {
  const isEditing = !!gasto;
  const [idCategoria, setIdCategoria] = useState(gasto?.id_categoria ?? categorias[0]?.id_categoria ?? "__nueva__");
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [nuevaCategoriaTipo, setNuevaCategoriaTipo] = useState<"FIJO" | "VARIABLE">("VARIABLE");
  const [idSubcategoria, setIdSubcategoria] = useState(gasto?.id_subcategoria ?? "");
  const [nuevaSubcategoria, setNuevaSubcategoria] = useState("");
  const [monto, setMonto] = useState(gasto ? String(gasto.neto ?? gasto.monto) : "");
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [medioPago, setMedioPago] = useState<"EFECTIVO_TURNO" | "EFECTIVO_ADMIN" | "TRANSFERENCIA" | "MERCADO_PAGO">("TRANSFERENCIA");
  const [descripcion, setDescripcion] = useState(gasto?.descripcion ?? "");
  const [pendienteFactura, setPendienteFactura] = useState(gasto?.pendiente_factura ?? false);
  const [idUsuarioAdelanto, setIdUsuarioAdelanto] = useState("");
  const [llevaIva, setLlevaIva] = useState((gasto?.iva ?? 0) > 0);
  const [claveAdmin, setClaveAdmin] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subDisponibles = subcategorias.filter((s) => s.id_categoria === idCategoria);
  const nombreSubSeleccionada = idSubcategoria === "__nueva__" ? nuevaSubcategoria : subDisponibles.find((s) => s.id_subcategoria === idSubcategoria)?.nombre ?? "";
  const mostrarAdelanto = nombreSubSeleccionada.toLowerCase().includes("adelanto");
  // Solo informativo: el tipo real lo define el servidor a partir de la
  // categoría elegida — acá se muestra lo que va a quedar.
  const categoriaSeleccionada = categorias.find((c) => c.id_categoria === idCategoria);
  const tipoResultante = categoriaSeleccionada?.tipo_default ?? "VARIABLE";
  const turnoAbiertoDelLocal = turnosAbiertos.find((t) => t.id_local === idLocal);
  const montoNum = Number(monto.replace(/[^\d.-]/g, "")) || 0;
  const montoConIva = Math.round(montoNum * (1 + ivaGeneralPorcentaje / 100) * 100) / 100;
  const mostrarAuth = !puedeAutorizarSinLimite && (llevaIva ? montoConIva : montoNum) > topeAutorizacion;

  function handleCategoriaChange(id: string) {
    setIdCategoria(id);
    setIdSubcategoria("");
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    const promesa = isEditing ? actualizarGasto(gasto!.id_gasto, formData) : crearGasto(formData);
    promesa
      .then((res) => {
        if (res.error) setError(res.error);
        else window.location.reload();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar el gasto"))
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <form onSubmit={handleSubmit} className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">{isEditing ? "Editar gasto" : "+ Nuevo gasto"}</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Categoría</label>
          <select
            name="id_categoria"
            value={idCategoria}
            onChange={(e) => handleCategoriaChange(e.target.value)}
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          >
            {categorias.map((c) => (
              <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>
            ))}
            <option value="__nueva__">+ Crear categoría nueva…</option>
          </select>
          {idCategoria === "__nueva__" && (
            <>
              <input
                name="nueva_categoria"
                required
                value={nuevaCategoria}
                onChange={(e) => setNuevaCategoria(e.target.value)}
                placeholder="Nombre de la categoría nueva"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
              />
              <select
                name="tipo"
                value={nuevaCategoriaTipo}
                onChange={(e) => setNuevaCategoriaTipo(e.target.value as "FIJO" | "VARIABLE")}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
              >
                <option value="VARIABLE">Variable — depende del mes</option>
                <option value="FIJO">Fijo — todos los meses igual</option>
              </select>
            </>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Subcategoría</label>
          <select
            name="id_subcategoria"
            value={idSubcategoria}
            onChange={(e) => setIdSubcategoria(e.target.value)}
            required
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="" disabled>Elegí una subcategoría...</option>
            {subDisponibles.map((s) => (
              <option key={s.id_subcategoria} value={s.id_subcategoria}>{s.nombre}</option>
            ))}
            <option value="__nueva__">+ Crear subcategoría nueva…</option>
          </select>
          {idSubcategoria === "__nueva__" && (
            <input
              name="nueva_subcategoria_gasto"
              required
              value={nuevaSubcategoria}
              onChange={(e) => setNuevaSubcategoria(e.target.value)}
              placeholder="Nombre de la subcategoría nueva"
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
            />
          )}
        </div>
      </div>
      <p className="text-xs text-neutral-400 mb-4">
        Las categorías y subcategorías que crees quedan guardadas para elegirlas de nuevo la próxima vez — no se
        duplican aunque las escribas distinto (mayúsculas, tildes, etc.).
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Monto</label>
          <input
            name="monto"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="$0"
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer mt-1.5">
            <input type="checkbox" name="lleva_iva" checked={llevaIva} onChange={(e) => setLlevaIva(e.target.checked)} />
            Tiene factura con IVA ({ivaGeneralPorcentaje}%)
          </label>
          {llevaIva && montoNum > 0 && (
            <p className="text-[11px] text-neutral-500 bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-1.5 mt-1">
              ${formatearMonto(montoNum)} + IVA = <span className="font-bold text-neutral-800">${formatearMonto(montoConIva)}</span>
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Tipo de gasto</label>
          <div className={`py-2 px-3 rounded-lg text-sm font-bold border ${tipoResultante === "FIJO" ? "bg-purple-50 border-purple-200 text-purple-700" : "bg-accent-tint border-accent text-accent-dark"}`}>
            {tipoResultante === "FIJO" ? "Fijo" : "Variable"}
          </div>
          <p className="text-[11px] text-neutral-400 mt-1">Lo define la categoría/subcategoría elegida — cambialo desde Categorías si no es correcto.</p>
        </div>
        {!isEditing && (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Local</label>
            <select name="id_local" value={idLocal} onChange={(e) => setIdLocal(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Sin local (gasto general)</option>
              {locales.map((l) => (
                <option key={l.id_local} value={l.id_local}>{l.nombre}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!isEditing && mostrarAdelanto && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3">
          <label className="block text-sm font-medium text-purple-700 mb-1">👤 Empleado al que se le descuenta</label>
          <select name="id_usuario_adelanto" value={idUsuarioAdelanto} onChange={(e) => setIdUsuarioAdelanto(e.target.value)} className="w-full border border-purple-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Elegir empleado…</option>
            {usuarios.map((u) => (
              <option key={u.id_usuario} value={u.id_usuario}>{u.nombre}</option>
            ))}
          </select>
          <p className="text-xs text-purple-600 mt-1.5">Este monto se descuenta solo del sueldo en la pestaña Nómina.</p>
        </div>
      )}

      {isEditing ? (
        <p className="text-xs text-neutral-400 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2 mb-3">
          Local y medio de pago no se pueden editar acá (ya impactaron en el turno o la caja) — {MEDIO_PAGO_LABEL[gasto!.medio_pago] ?? gasto!.medio_pago}.
          {gasto!.comprobante_path && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => obtenerUrlComprobanteGasto(gasto!.comprobante_path!).then((url) => window.open(url, "_blank"))}
                className="text-accent font-semibold"
              >
                Ver comprobante
              </button>
            </>
          )}
        </p>
      ) : (
        <div className="mb-3">
          <label className="block text-sm font-medium text-neutral-700 mb-1">¿De dónde sale la plata?</label>
          <div className="flex flex-col gap-1.5">
            {(["EFECTIVO_TURNO", "EFECTIVO_ADMIN", "TRANSFERENCIA", "MERCADO_PAGO"] as const).map((opcion) => (
              <label
                key={opcion}
                className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer ${
                  medioPago === opcion ? "border-accent bg-accent-tint" : "border-neutral-300"
                } ${opcion === "EFECTIVO_TURNO" && !turnoAbiertoDelLocal ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <input
                  type="radio"
                  name="medio_pago"
                  value={opcion}
                  checked={medioPago === opcion}
                  disabled={opcion === "EFECTIVO_TURNO" && !turnoAbiertoDelLocal}
                  onChange={() => setMedioPago(opcion)}
                />
                {MEDIO_PAGO_LABEL[opcion]}
                {opcion === "EFECTIVO_TURNO" && !turnoAbiertoDelLocal && " — no hay turno abierto en ese local"}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción</label>
          <input name="descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        {!isEditing && (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Comprobante (opcional)</label>
            <input type="file" name="comprobante" className="w-full text-sm" />
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-700 mb-3">
        <input type="checkbox" name="pendiente_factura" checked={pendienteFactura} onChange={(e) => setPendienteFactura(e.target.checked)} />
        Pendiente de factura — recordar reclamar el comprobante fiscal
      </label>

      {mostrarAuth && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
          <p className="text-sm font-semibold text-red-700 mb-1">⚠️ Requiere autorización</p>
          <p className="text-xs text-red-700 mb-2">
            Este monto supera el tope de ${formatearMonto(topeAutorizacion)} configurado para gastos sin aprobar. Hace falta la contraseña de un admin o de alguien autorizado para confirmarlo.
          </p>
          <input
            type="password"
            name="clave_admin"
            value={claveAdmin}
            onChange={(e) => setClaveAdmin(e.target.value)}
            placeholder="Contraseña de quien autoriza"
            className="w-full sm:w-64 border border-red-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm">
          {guardando ? "Guardando..." : isEditing ? "Guardar cambios" : "Guardar gasto"}
        </button>
      </div>
      </form>
    </div>
  );
}
