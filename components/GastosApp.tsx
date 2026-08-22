"use client";

import { useEffect, useMemo, useState } from "react";
import type { Local, Gasto, MovimientoCajaAdmin, GastoRecurrente } from "@/lib/supabase";
import {
  crearGasto,
  listarGastos,
  resumenGastos,
  obtenerUrlComprobanteGasto,
  guardarPresupuesto,
  listarPresupuestos,
  listarRecurrentes,
  crearRecurrente,
  cargarRecurrente,
  resumenNomina,
  resumenCajaAdmin,
  movimientosCajaAdmin,
  registrarMovimientoCajaAdmin,
  totalCobradoPorBanco,
} from "@/app/(app)/gastos/actions";
import { actualizarSueldoBase } from "@/app/(app)/usuarios/actions";

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
type NominaFila = { idUsuario: string; nombre: string; sueldoBase: number; adelantado: number; aPagar: number };

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

function mesActualISO() {
  return new Date().toISOString().slice(0, 7);
}

export default function GastosApp({
  locales,
  usuarios,
  turnosAbiertos,
  categoriasIniciales,
  subcategoriasIniciales,
  puedeVerCajaAdmin,
  puedeGestionarNomina,
  puedeAutorizarSinLimite,
  topeAutorizacion,
}: {
  locales: Local[];
  usuarios: UsuarioMin[];
  turnosAbiertos: TurnoAbiertoMin[];
  categoriasIniciales: CategoriaGasto[];
  subcategoriasIniciales: SubcategoriaGasto[];
  puedeVerCajaAdmin: boolean;
  puedeGestionarNomina: boolean;
  puedeAutorizarSinLimite: boolean;
  topeAutorizacion: number;
}) {
  const [tab, setTab] = useState<"gastos" | "caja" | "nomina" | "recurrentes">("gastos");

  const categoriaPorId = useMemo(() => new Map(categoriasIniciales.map((c) => [c.id_categoria, c])), [categoriasIniciales]);
  const subcategoriaPorId = useMemo(() => new Map(subcategoriasIniciales.map((s) => [s.id_subcategoria, s])), [subcategoriasIniciales]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Gastos</h1>
      <p className="text-sm text-neutral-500 mb-5 max-w-2xl">
        Todo egreso queda categorizado, vinculado al turno que lo pagó (si salió de la caja física) y con su
        comprobante — así se sabe en qué se va la plata y el arqueo de cada turno sigue cuadrando.
      </p>

      <div className="flex items-center gap-1 border-b border-neutral-200 mb-5 flex-wrap">
        <TabButton activo={tab === "gastos"} onClick={() => setTab("gastos")} icono="💸" label="Gastos" />
        {puedeVerCajaAdmin && <TabButton activo={tab === "caja"} onClick={() => setTab("caja")} icono="🔒" label="Caja Administración" />}
        {puedeGestionarNomina && <TabButton activo={tab === "nomina"} onClick={() => setTab("nomina")} icono="👥" label="Nómina" />}
        <TabButton activo={tab === "recurrentes"} onClick={() => setTab("recurrentes")} icono="🔁" label="Recurrentes" />
      </div>

      {tab === "gastos" && (
        <TabGastos
          locales={locales}
          usuarios={usuarios}
          turnosAbiertos={turnosAbiertos}
          categorias={categoriasIniciales}
          subcategorias={subcategoriasIniciales}
          categoriaPorId={categoriaPorId}
          subcategoriaPorId={subcategoriaPorId}
          puedeAutorizarSinLimite={puedeAutorizarSinLimite}
          topeAutorizacion={topeAutorizacion}
        />
      )}
      {tab === "caja" && puedeVerCajaAdmin && <TabCajaAdmin />}
      {tab === "nomina" && puedeGestionarNomina && <TabNomina usuarios={usuarios} />}
      {tab === "recurrentes" && (
        <TabRecurrentes locales={locales} categorias={categoriasIniciales} subcategorias={subcategoriasIniciales} categoriaPorId={categoriaPorId} />
      )}
    </div>
  );
}

function TabButton({ activo, onClick, icono, label }: { activo: boolean; onClick: () => void; icono: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-t-lg text-sm font-semibold -mb-px border ${
        activo ? "bg-white border-neutral-200 border-b-white text-accent" : "border-transparent text-neutral-500 hover:text-neutral-800"
      }`}
    >
      {icono} {label}
    </button>
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
}) {
  const [filtroLocal, setFiltroLocal] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [periodo, setPeriodo] = useState<"hoy" | "semana" | "mes">("mes");
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [presupuestos, setPresupuestos] = useState<Map<string, number>>(new Map());
  const [cargando, setCargando] = useState(false);

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
                      <td className="p-3">
                        {g.comprobante_path && (
                          <button onClick={() => handleVerComprobante(g.comprobante_path!)} className="text-accent text-xs font-medium">
                            Ver comprobante
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FormNuevoGasto
        locales={locales}
        usuarios={usuarios}
        turnosAbiertos={turnosAbiertos}
        categorias={categorias}
        subcategorias={subcategorias}
        puedeAutorizarSinLimite={puedeAutorizarSinLimite}
        topeAutorizacion={topeAutorizacion}
      />
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
  locales,
  usuarios,
  turnosAbiertos,
  categorias,
  subcategorias,
  puedeAutorizarSinLimite,
  topeAutorizacion,
}: {
  locales: Local[];
  usuarios: UsuarioMin[];
  turnosAbiertos: TurnoAbiertoMin[];
  categorias: CategoriaGasto[];
  subcategorias: SubcategoriaGasto[];
  puedeAutorizarSinLimite: boolean;
  topeAutorizacion: number;
}) {
  const [idCategoria, setIdCategoria] = useState(categorias[0]?.id_categoria ?? "__nueva__");
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [idSubcategoria, setIdSubcategoria] = useState("");
  const [nuevaSubcategoria, setNuevaSubcategoria] = useState("");
  const [monto, setMonto] = useState("");
  const [tipo, setTipo] = useState<"FIJO" | "VARIABLE">(categorias[0]?.tipo_default === "FIJO" ? "FIJO" : "VARIABLE");
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [medioPago, setMedioPago] = useState<"EFECTIVO_TURNO" | "EFECTIVO_ADMIN" | "TRANSFERENCIA" | "MERCADO_PAGO">("TRANSFERENCIA");
  const [descripcion, setDescripcion] = useState("");
  const [pendienteFactura, setPendienteFactura] = useState(false);
  const [idUsuarioAdelanto, setIdUsuarioAdelanto] = useState("");
  const [claveAdmin, setClaveAdmin] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subDisponibles = subcategorias.filter((s) => s.id_categoria === idCategoria);
  const nombreSubSeleccionada = idSubcategoria === "__nueva__" ? nuevaSubcategoria : subDisponibles.find((s) => s.id_subcategoria === idSubcategoria)?.nombre ?? "";
  const mostrarAdelanto = nombreSubSeleccionada.toLowerCase().includes("adelanto");
  const turnoAbiertoDelLocal = turnosAbiertos.find((t) => t.id_local === idLocal);
  const montoNum = Number(monto.replace(/[^\d.-]/g, "")) || 0;
  const mostrarAuth = !puedeAutorizarSinLimite && montoNum > topeAutorizacion;

  function handleCategoriaChange(id: string) {
    setIdCategoria(id);
    setIdSubcategoria("");
    const cat = categorias.find((c) => c.id_categoria === id);
    if (cat) setTipo(cat.tipo_default === "FIJO" ? "FIJO" : "VARIABLE");
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    crearGasto(formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else window.location.reload();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar el gasto"))
      .finally(() => setGuardando(false));
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-neutral-200 rounded-xl p-5">
      <h2 className="text-base font-semibold text-neutral-900 mb-4">+ Nuevo gasto</h2>

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
            <input
              name="nueva_categoria"
              required
              value={nuevaCategoria}
              onChange={(e) => setNuevaCategoria(e.target.value)}
              placeholder="Nombre de la categoría nueva"
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
            />
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Subcategoría (opcional)</label>
          <select
            name="id_subcategoria"
            value={idSubcategoria}
            onChange={(e) => setIdSubcategoria(e.target.value)}
            disabled={idCategoria === "__nueva__"}
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="">Sin subcategoría</option>
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
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Tipo de gasto</label>
          <div className="flex gap-2">
            <input type="hidden" name="tipo" value={tipo} />
            <button type="button" onClick={() => setTipo("FIJO")} className={`flex-1 py-2 rounded-lg text-sm font-bold border ${tipo === "FIJO" ? "bg-purple-100 border-purple-600 text-purple-700" : "border-neutral-300 text-neutral-500"}`}>
              Fijo
            </button>
            <button type="button" onClick={() => setTipo("VARIABLE")} className={`flex-1 py-2 rounded-lg text-sm font-bold border ${tipo === "VARIABLE" ? "bg-accent-tint border-accent text-accent-dark" : "border-neutral-300 text-neutral-500"}`}>
              Variable
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Local</label>
          <select name="id_local" value={idLocal} onChange={(e) => setIdLocal(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Sin local (gasto general)</option>
            {locales.map((l) => (
              <option key={l.id_local} value={l.id_local}>{l.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {mostrarAdelanto && (
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción</label>
          <input name="descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Comprobante (opcional)</label>
          <input type="file" name="comprobante" className="w-full text-sm" />
        </div>
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
          {guardando ? "Guardando..." : "Guardar gasto"}
        </button>
      </div>
    </form>
  );
}

// ===================== TAB CAJA ADMINISTRACIÓN =====================

function TabCajaAdmin() {
  const [resumen, setResumen] = useState<{ saldo: number; ingresadoSemana: number; gastadoSemana: number } | null>(null);
  const [movimientos, setMovimientos] = useState<(MovimientoCajaAdmin & { saldoAcumulado: number })[]>([]);
  const [cobradoBanco, setCobradoBanco] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState<"retiro" | "deposito" | null>(null);
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    setCargando(true);
    Promise.all([resumenCajaAdmin(), movimientosCajaAdmin(), totalCobradoPorBanco(inicioDeMes(), hoyISO())])
      .then(([r, m, c]) => {
        setResumen(r);
        setMovimientos(m);
        setCobradoBanco(c);
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargar, []);

  function handleRegistrar() {
    const montoNum = Number(monto.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setGuardando(true);
    registrarMovimientoCajaAdmin(mostrarForm === "retiro" ? "RETIRO_MANUAL" : "DEPOSITO_MANUAL", montoNum, descripcion)
      .then((res) => {
        if (res.error) {
          setError(res.error);
          return;
        }
        setMostrarForm(null);
        setMonto("");
        setDescripcion("");
        recargar();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div>
      <p className="text-xs text-neutral-400 mb-3">🔒 Esta pantalla solo la ve quien tenga el permiso de Caja Administración.</p>

      <div className="bg-gradient-to-br from-accent to-accent-dark rounded-xl p-6 text-white mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-80">Efectivo en Caja Administración</p>
          <p className="text-3xl font-extrabold tabular-nums">${formatearMonto(resumen?.saldo ?? 0)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMostrarForm("deposito")} className="bg-white/15 border border-white/40 rounded-lg px-3.5 py-2 text-sm font-semibold">
            + Registrar depósito
          </button>
          <button onClick={() => setMostrarForm("retiro")} className="bg-white/15 border border-white/40 rounded-lg px-3.5 py-2 text-sm font-semibold">
            − Registrar retiro
          </button>
        </div>
      </div>
      <p className="text-xs text-neutral-400 mb-4">
        Este saldo es solo efectivo físico — lo que entra por Mercado Pago o transferencia va directo al banco, nunca
        pasa por acá.
      </p>

      {mostrarForm && (
        <div className="bg-white border border-neutral-200 rounded-xl p-4 mb-4 max-w-md">
          <h3 className="text-sm font-bold text-neutral-900 mb-2">{mostrarForm === "retiro" ? "Registrar retiro" : "Registrar depósito"}</h3>
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          <label className="block text-xs font-medium text-neutral-500 mb-1">Monto</label>
          <input value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$0" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-2" />
          <label className="block text-xs font-medium text-neutral-500 mb-1">Descripción</label>
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: depósito al banco" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-3" />
          <div className="flex gap-2">
            <button onClick={() => setMostrarForm(null)} className="flex-1 border border-neutral-300 text-neutral-700 font-semibold py-2 rounded-lg text-sm">
              Cancelar
            </button>
            <button onClick={handleRegistrar} disabled={guardando} className="flex-1 bg-accent hover:bg-accent-dark disabled:opacity-40 text-white font-bold py-2 rounded-lg text-sm">
              {guardando ? "Guardando..." : "Confirmar"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-6">
        <StatCard color="success" icono="⬇" etiqueta="Ingresado esta semana" valor={`$${formatearMonto(resumen?.ingresadoSemana ?? 0)}`} />
        <StatCard color="danger" icono="⬆" etiqueta="Gastado esta semana" valor={`$${formatearMonto(resumen?.gastadoSemana ?? 0)}`} />
        <StatCard color="neutro" icono="🏦" etiqueta="Cobrado por banco (mes)" valor={`$${formatearMonto(cobradoBanco)}`} nota="Mercado Pago/transferencia — informativo" />
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Movimientos</h2>
          <span className="text-xs text-neutral-400">Cada cierre de turno entra acá solo</span>
        </div>
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : movimientos.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay movimientos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Detalle</th>
                  <th className="p-3 text-right">Monto</th>
                  <th className="p-3 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id_movimiento} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3 whitespace-nowrap text-neutral-500">{formatearFechaHora(m.fecha)}</td>
                    <td className="p-3">{m.tipo}</td>
                    <td className="p-3">{m.descripcion ?? "—"}</td>
                    <td className={`p-3 text-right tabular-nums font-semibold ${m.monto >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {m.monto >= 0 ? "+" : "-"}${formatearMonto(Math.abs(m.monto))}
                    </td>
                    <td className="p-3 text-right tabular-nums">${formatearMonto(m.saldoAcumulado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ===================== TAB NÓMINA =====================

function TabNomina({ usuarios }: { usuarios: UsuarioMin[] }) {
  const [mes, setMes] = useState(mesActualISO());
  const [filas, setFilas] = useState<NominaFila[]>([]);
  const [cargando, setCargando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [valorEdit, setValorEdit] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    setCargando(true);
    resumenNomina(mes).then(setFilas).finally(() => setCargando(false));
  }

  useEffect(recargar, [mes]);

  function handleGuardarSueldo(idUsuario: string) {
    const monto = Number(valorEdit.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setGuardando(true);
    actualizarSueldoBase(idUsuario, monto)
      .then((res) => {
        if (res.error) {
          setError(res.error);
          return;
        }
        setEditando(null);
        recargar();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div>
      <p className="text-xs text-neutral-400 mb-3">
        👥 Sueldo simplificado por empleado — sueldo base − adelantos del mes = a pagar. No reemplaza un módulo de
        RR.HH. completo (legajos, vacaciones, licencias) — eso se arma aparte, más adelante.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="mb-4">
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Sueldos del mes</h2>
          <span className="text-xs text-neutral-400">Sueldo base − adelantos del mes = a pagar</span>
        </div>
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : usuarios.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">No hay usuarios activos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Empleado</th>
                  <th className="p-3 text-right">Sueldo base</th>
                  <th className="p-3 text-right">Adelantos del mes</th>
                  <th className="p-3 text-right">A pagar</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.idUsuario} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3">{f.nombre}</td>
                    <td className="p-3 text-right tabular-nums">
                      {editando === f.idUsuario ? (
                        <input
                          autoFocus
                          value={valorEdit}
                          onChange={(e) => setValorEdit(e.target.value)}
                          className="w-28 border border-neutral-300 rounded-lg px-2 py-1 text-sm text-right"
                        />
                      ) : (
                        `$${formatearMonto(f.sueldoBase)}`
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums text-red-600">{f.adelantado > 0 ? `-$${formatearMonto(f.adelantado)}` : "—"}</td>
                    <td className="p-3 text-right tabular-nums font-bold">${formatearMonto(f.aPagar)}</td>
                    <td className="p-3 text-right">
                      {editando === f.idUsuario ? (
                        <button onClick={() => handleGuardarSueldo(f.idUsuario)} disabled={guardando} className="text-xs font-semibold text-accent">
                          {guardando ? "..." : "Guardar"}
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setEditando(f.idUsuario);
                            setValorEdit(String(f.sueldoBase));
                          }}
                          className="text-xs font-semibold text-neutral-500 hover:text-accent"
                        >
                          Editar sueldo base
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ===================== TAB RECURRENTES =====================

function TabRecurrentes({
  locales,
  categorias,
  subcategorias,
  categoriaPorId,
}: {
  locales: Local[];
  categorias: CategoriaGasto[];
  subcategorias: SubcategoriaGasto[];
  categoriaPorId: Map<string, CategoriaGasto>;
}) {
  const [recurrentes, setRecurrentes] = useState<GastoRecurrente[]>([]);
  const [cargando, setCargando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [cargandoId, setCargandoId] = useState<string | null>(null);
  const [montoCargar, setMontoCargar] = useState<Record<string, string>>({});
  const [medioCargar, setMedioCargar] = useState<Record<string, string>>({});

  function recargar() {
    setCargando(true);
    listarRecurrentes().then(setRecurrentes).finally(() => setCargando(false));
  }

  useEffect(recargar, []);

  const mesActual = mesActualISO();
  const pendientes = recurrentes.filter((r) => r.ultimo_mes_cargado !== mesActual);

  function handleCargar(r: GastoRecurrente) {
    const monto = Number((montoCargar[r.id_recurrente] ?? String(r.monto_estimado)).replace(/[^\d.-]/g, "")) || 0;
    const medio = medioCargar[r.id_recurrente] ?? "TRANSFERENCIA";
    setCargandoId(r.id_recurrente);
    cargarRecurrente(r.id_recurrente, monto, medio)
      .then(recargar)
      .finally(() => setCargandoId(null));
  }

  return (
    <div>
      <p className="text-xs text-neutral-400 mb-3">
        🔁 Semi-automático: el sistema avisa cuándo toca cargar uno, vos confirmás el monto (puede variar) y con un
        clic se completa el gasto.
      </p>

      {pendientes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 mb-4 text-sm">
          ⏰ Tenés <b>{pendientes.length}</b> {pendientes.length === 1 ? "gasto recurrente pendiente" : "gastos recurrentes pendientes"} de cargar este mes:{" "}
          {pendientes.map((p) => p.descripcion).join(", ")}.
        </div>
      )}

      <div className="flex justify-end mb-4">
        <button onClick={() => setMostrarForm((v) => !v)} className="bg-accent hover:bg-accent-dark text-white font-medium px-4 py-2 rounded-lg text-sm">
          {mostrarForm ? "Cancelar" : "+ Nuevo gasto recurrente"}
        </button>
      </div>

      {mostrarForm && <FormNuevoRecurrente locales={locales} categorias={categorias} subcategorias={subcategorias} onCreado={() => { setMostrarForm(false); recargar(); }} />}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Configurados</h2>
          <span className="text-xs text-neutral-400">{recurrentes.length} activos</span>
        </div>
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : recurrentes.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay gastos recurrentes configurados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Descripción</th>
                  <th className="p-3">Categoría</th>
                  <th className="p-3">Día</th>
                  <th className="p-3 text-right">Monto estimado</th>
                  <th className="p-3">Este mes</th>
                </tr>
              </thead>
              <tbody>
                {recurrentes.map((r) => {
                  const pendiente = r.ultimo_mes_cargado !== mesActual;
                  return (
                    <tr key={r.id_recurrente} className="border-b border-neutral-100 last:border-0">
                      <td className="p-3">{r.descripcion}</td>
                      <td className="p-3 text-neutral-500">{categoriaPorId.get(r.id_categoria)?.nombre ?? "—"}</td>
                      <td className="p-3 text-neutral-500">Día {r.dia_mes}</td>
                      <td className="p-3 text-right tabular-nums">${formatearMonto(r.monto_estimado)}</td>
                      <td className="p-3">
                        {pendiente ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <input
                              value={montoCargar[r.id_recurrente] ?? String(r.monto_estimado)}
                              onChange={(e) => setMontoCargar((v) => ({ ...v, [r.id_recurrente]: e.target.value }))}
                              className="w-24 border border-neutral-300 rounded-lg px-2 py-1 text-xs text-right"
                            />
                            <select
                              value={medioCargar[r.id_recurrente] ?? "TRANSFERENCIA"}
                              onChange={(e) => setMedioCargar((v) => ({ ...v, [r.id_recurrente]: e.target.value }))}
                              className="border border-neutral-300 rounded-lg px-1.5 py-1 text-xs"
                            >
                              <option value="TRANSFERENCIA">Transferencia</option>
                              <option value="EFECTIVO_ADMIN">Caja Admin.</option>
                              <option value="MERCADO_PAGO">MP/Tarjeta</option>
                            </select>
                            <button
                              onClick={() => handleCargar(r)}
                              disabled={cargandoId === r.id_recurrente}
                              className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-2.5 py-1 rounded-lg"
                            >
                              {cargandoId === r.id_recurrente ? "..." : "Cargar"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-600">✓ Ya se cargó</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FormNuevoRecurrente({
  locales,
  categorias,
  subcategorias,
  onCreado,
}: {
  locales: Local[];
  categorias: CategoriaGasto[];
  subcategorias: SubcategoriaGasto[];
  onCreado: () => void;
}) {
  const [idCategoria, setIdCategoria] = useState(categorias[0]?.id_categoria ?? "__nueva__");
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [idSubcategoria, setIdSubcategoria] = useState("");
  const [nuevaSubcategoria, setNuevaSubcategoria] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subDisponibles = subcategorias.filter((s) => s.id_categoria === idCategoria);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    crearRecurrente(formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else onCreado();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo crear el gasto recurrente"))
      .finally(() => setGuardando(false));
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-neutral-200 rounded-xl p-4 mb-5">
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Categoría</label>
          <select
            name="id_categoria"
            value={idCategoria}
            onChange={(e) => {
              setIdCategoria(e.target.value);
              setIdSubcategoria("");
            }}
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          >
            {categorias.map((c) => (
              <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>
            ))}
            <option value="__nueva__">+ Crear categoría nueva…</option>
          </select>
          {idCategoria === "__nueva__" && (
            <input name="nueva_categoria" required value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)} placeholder="Nombre de la categoría nueva" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5" />
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Subcategoría (opcional)</label>
          <select name="id_subcategoria" value={idSubcategoria} onChange={(e) => setIdSubcategoria(e.target.value)} disabled={idCategoria === "__nueva__"} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
            <option value="">Sin subcategoría</option>
            {subDisponibles.map((s) => (
              <option key={s.id_subcategoria} value={s.id_subcategoria}>{s.nombre}</option>
            ))}
            <option value="__nueva__">+ Crear subcategoría nueva…</option>
          </select>
          {idSubcategoria === "__nueva__" && (
            <input name="nueva_subcategoria_gasto" required value={nuevaSubcategoria} onChange={(e) => setNuevaSubcategoria(e.target.value)} placeholder="Nombre de la subcategoría nueva" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5" />
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción</label>
          <input name="descripcion" required className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Monto estimado</label>
          <input name="monto_estimado" type="number" step="1" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Día del mes</label>
          <input name="dia_mes" type="number" min="1" max="28" defaultValue="1" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="mb-3">
        <label className="block text-sm font-medium text-neutral-700 mb-1">Local (opcional)</label>
        <select name="id_local" className="w-full sm:w-64 border border-neutral-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Sin local (gasto general)</option>
          {locales.map((l) => (
            <option key={l.id_local} value={l.id_local}>{l.nombre}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm">
          {guardando ? "Guardando..." : "Guardar recurrente"}
        </button>
      </div>
    </form>
  );
}
