"use client";

import { Fragment, useEffect, useState } from "react";
import type { Marca } from "@/lib/supabase";
import {
  listarProfesionales,
  crearProfesional,
  actualizarProfesional,
  cambiarEstadoProfesional,
  guardarPinProfesional,
  listarCodigos,
  crearCodigoProfesional,
  cambiarEstadoCodigo,
  resumenProfesionales,
  saldosDeProfesional,
  canjesDeProfesional,
  detalleCanje,
  registrarPagoCanje,
  listarConfigMarcas,
  guardarConfigMarca,
} from "@/app/(app)/profesionales/actions";

type Profesional = {
  id_profesional: string;
  nombre: string;
  apellido: string | null;
  categoria: string | null;
  especialidad: string | null;
  telefono: string | null;
  email: string | null;
  dni: string | null;
  estado: string;
  observaciones: string | null;
};

type Codigo = {
  id_codigo: string;
  id_profesional: string;
  codigo: string;
  estado: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  limite_usos: number | null;
  usos: number;
};

type FilaResumen = {
  idProfesional: string;
  nombre: string;
  especialidad: string | null;
  estado: string;
  codigoPrincipal: string | null;
  ventasReferidas: number;
  totalVenta: number;
  comisionPendiente: number;
  comisionPagada: number;
};

type SaldoMarca = { idMarca: string; nombreMarca: string; saldo: number; tipoRecompensa: string };

type CanjeFila = {
  idMovimiento: string;
  nombreMarca: string;
  tipo: string;
  monto: number;
  idVenta: string | null;
  numeroVenta: number | null;
  descripcion: string | null;
  usuario: string | null;
  fecha: string;
};

type ConfigMarca = {
  id_config: string;
  id_marca: string;
  participa: boolean;
  porcentaje_aporte_total: number;
  porcentaje_cliente: number;
  porcentaje_profesional: number;
  tipo_beneficio_cliente: string;
  tipo_recompensa_profesional: string;
  fecha_desde: string;
  fecha_hasta: string | null;
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

export default function ProfesionalesApp({ marcas }: { marcas: Marca[] }) {
  const [tab, setTab] = useState<"profesionales" | "config">("profesionales");

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Profesionales</h1>
      <p className="text-sm text-neutral-500 mb-5 max-w-2xl">
        Nutricionistas, entrenadores y otros profesionales que recomiendan WiiGo con su propio código — el cliente
        recibe un beneficio al comprar, y el profesional acumula una comisión por cada venta referida.
      </p>

      <div className="flex items-center gap-1 border-b border-neutral-200 mb-5">
        <TabButton activo={tab === "profesionales"} onClick={() => setTab("profesionales")} icono="🤝" label="Profesionales" />
        <TabButton activo={tab === "config"} onClick={() => setTab("config")} icono="🏷️" label="Configuración por marca" />
      </div>

      {tab === "profesionales" ? <TabProfesionales /> : <TabConfigMarcas marcas={marcas} />}
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

// ===================== TAB PROFESIONALES =====================

function TabProfesionales() {
  const [periodo, setPeriodo] = useState<"hoy" | "semana" | "mes">("mes");
  const [filas, setFilas] = useState<FilaResumen[]>([]);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [codigos, setCodigos] = useState<Codigo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  const { desde, hasta } = (() => {
    if (periodo === "hoy") return { desde: hoyISO(), hasta: hoyISO() };
    if (periodo === "semana") {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return { desde: d.toISOString().slice(0, 10), hasta: hoyISO() };
    }
    return { desde: inicioDeMes(), hasta: hoyISO() };
  })();

  function recargar() {
    setCargando(true);
    Promise.all([resumenProfesionales({ desde, hasta }), listarProfesionales(), listarCodigos()])
      .then(([r, p, c]) => {
        setFilas(r);
        setProfesionales(p as Profesional[]);
        setCodigos(c as Codigo[]);
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [desde, hasta]);

  const activos = filas.filter((f) => f.estado === "ACTIVO").length;
  const ventasTotales = filas.reduce((acc, f) => acc + f.ventasReferidas, 0);
  const montoTotal = filas.reduce((acc, f) => acc + f.totalVenta, 0);
  const comisionPendienteTotal = filas.reduce((acc, f) => acc + f.comisionPendiente, 0);
  const comisionPagadaTotal = filas.reduce((acc, f) => acc + f.comisionPagada, 0);

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center justify-between mb-4">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as typeof periodo)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm">
          <option value="mes">Este mes</option>
          <option value="semana">Últimos 7 días</option>
          <option value="hoy">Hoy</option>
        </select>
        <button onClick={() => setMostrarForm((v) => !v)} className="bg-accent hover:bg-accent-dark text-white font-medium px-4 py-2 rounded-lg text-sm">
          {mostrarForm ? "Cancelar" : "+ Nuevo profesional"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-5">
        <StatCard color="accent" icono="🤝" etiqueta="Profesionales activos" valor={String(activos)} />
        <StatCard color="purple" icono="🛒" etiqueta="Ventas referidas" valor={String(ventasTotales)} nota={`$${formatearMonto(montoTotal)} en ventas`} />
        <StatCard color="danger" icono="💸" etiqueta="Comisión pendiente" valor={`$${formatearMonto(comisionPendienteTotal)}`} />
        <StatCard color="success" icono="✅" etiqueta="Comisión pagada" valor={`$${formatearMonto(comisionPagadaTotal)}`} />
      </div>

      {mostrarForm && <FormNuevoProfesional onCreado={() => { setMostrarForm(false); recargar(); }} />}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Profesionales y sus códigos</h2>
          <span className="text-xs text-neutral-400">Tocá una fila para ver el detalle</span>
        </div>
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay profesionales cargados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Profesional</th>
                  <th className="p-3">Código</th>
                  <th className="p-3 text-right">Ventas</th>
                  <th className="p-3 text-right">Total vendido</th>
                  <th className="p-3 text-right">Comisión pendiente</th>
                  <th className="p-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const expandido2 = expandido === f.idProfesional;
                  const profesional = profesionales.find((p) => p.id_profesional === f.idProfesional);
                  const codigosDelProfesional = codigos.filter((c) => c.id_profesional === f.idProfesional);
                  return (
                    <Fragment key={f.idProfesional}>
                      <tr
                        onClick={() => setExpandido(expandido2 ? null : f.idProfesional)}
                        className={`border-b border-neutral-100 last:border-0 cursor-pointer hover:bg-neutral-50 ${expandido2 ? "bg-neutral-50" : ""}`}
                      >
                        <td className="p-3">
                          <span className="text-neutral-400 mr-1">{expandido2 ? "▾" : "▸"}</span>
                          <span className="font-medium text-neutral-900">{f.nombre}</span>
                          {f.especialidad && <div className="text-xs text-neutral-400 pl-3.5">{f.especialidad}</div>}
                        </td>
                        <td className="p-3">
                          {f.codigoPrincipal ? (
                            <span className="text-xs font-mono font-bold bg-accent-tint text-accent-dark px-2 py-0.5 rounded">{f.codigoPrincipal}</span>
                          ) : (
                            <span className="text-xs text-neutral-400">Sin código</span>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">{f.ventasReferidas}</td>
                        <td className="p-3 text-right tabular-nums">${formatearMonto(f.totalVenta)}</td>
                        <td className={`p-3 text-right tabular-nums font-semibold ${f.comisionPendiente > 0 ? "text-red-600" : "text-neutral-400"}`}>
                          ${formatearMonto(f.comisionPendiente)}
                        </td>
                        <td className="p-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${f.estado === "ACTIVO" ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
                            {f.estado}
                          </span>
                        </td>
                      </tr>
                      {expandido2 && profesional && (
                        <tr className="border-b border-neutral-100 last:border-0">
                          <td colSpan={6} className="bg-neutral-50 p-0">
                            <DetalleProfesional
                              profesional={profesional}
                              codigos={codigosDelProfesional}
                              onCambio={recargar}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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

function DetalleProfesional({
  profesional,
  codigos,
  onCambio,
}: {
  profesional: Profesional;
  codigos: Codigo[];
  onCambio: () => void;
}) {
  const [saldos, setSaldos] = useState<SaldoMarca[]>([]);
  const [canjes, setCanjes] = useState<CanjeFila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarCodigoForm, setMostrarCodigoForm] = useState(false);
  const [mostrarPinForm, setMostrarPinForm] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  function recargar() {
    setCargando(true);
    Promise.all([saldosDeProfesional(profesional.id_profesional), canjesDeProfesional(profesional.id_profesional)])
      .then(([s, c]) => {
        setSaldos(s);
        setCanjes(c as CanjeFila[]);
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [profesional.id_profesional]);

  function toggleEstadoProfesional() {
    const nuevo = profesional.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO";
    cambiarEstadoProfesional(profesional.id_profesional, nuevo).then(onCambio);
  }

  function toggleEstadoCodigo(codigo: Codigo) {
    const nuevo = codigo.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO";
    cambiarEstadoCodigo(codigo.id_codigo, nuevo).then(onCambio);
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-neutral-500">
          {profesional.telefono && <span className="mr-3">📞 {profesional.telefono}</span>}
          {profesional.email && <span className="mr-3">✉️ {profesional.email}</span>}
          {profesional.dni && <span>🪪 DNI {profesional.dni}</span>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setMostrarPinForm((v) => !v)} className="text-xs font-semibold text-accent">
            {mostrarPinForm ? "Cancelar" : "🔒 Cambiar PIN"}
          </button>
          <button onClick={toggleEstadoProfesional} className="text-xs font-semibold text-red-500 hover:text-red-700">
            {profesional.estado === "ACTIVO" ? "Desactivar profesional" : "Activar profesional"}
          </button>
        </div>
      </div>

      {mostrarPinForm && <FormPin idProfesional={profesional.id_profesional} onGuardado={() => setMostrarPinForm(false)} />}
      {!profesional.dni && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          ⚠ Sin DNI cargado — este profesional todavía no puede pagar en caja con su saldo. Editalo para agregarlo.
        </p>
      )}

      <div className="bg-white border border-neutral-200 rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-neutral-700">Códigos</p>
          <button onClick={() => setMostrarCodigoForm((v) => !v)} className="text-xs font-semibold text-accent">
            {mostrarCodigoForm ? "Cancelar" : "+ Agregar código"}
          </button>
        </div>
        {codigos.length === 0 ? (
          <p className="text-xs text-neutral-400">Sin códigos todavía.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {codigos.map((c) => (
              <span
                key={c.id_codigo}
                onClick={() => toggleEstadoCodigo(c)}
                className={`cursor-pointer text-xs font-mono font-bold px-2 py-1 rounded ${
                  c.estado === "ACTIVO" ? "bg-accent-tint text-accent-dark" : "bg-neutral-100 text-neutral-400 line-through"
                }`}
                title={c.estado === "ACTIVO" ? "Click para desactivar" : "Click para activar"}
              >
                {c.codigo} {c.limite_usos != null && `(${c.usos}/${c.limite_usos})`}
              </span>
            ))}
          </div>
        )}
        {mostrarCodigoForm && <FormNuevoCodigo idProfesional={profesional.id_profesional} onCreado={() => { setMostrarCodigoForm(false); onCambio(); }} />}
      </div>

      <div className="bg-white border border-neutral-200 rounded-lg p-3 mb-4">
        <p className="text-xs font-bold text-neutral-700 mb-2">Saldo por marca</p>
        <p className="text-[11px] text-neutral-400 mb-2">
          Cada marca es una bolsa aparte — no se puede gastar el saldo de una en otra.
        </p>
        {cargando ? (
          <p className="text-xs text-neutral-400 text-center py-2">Cargando...</p>
        ) : saldos.length === 0 ? (
          <p className="text-xs text-neutral-400">Todavía no generó saldo en ninguna marca.</p>
        ) : (
          <div className="space-y-1.5">
            {saldos.map((s) => (
              <FilaSaldoMarca key={s.idMarca} idProfesional={profesional.id_profesional} saldo={s} onCambio={recargar} />
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-100">
          <p className="text-xs font-bold text-neutral-700">Historial de pagos y canjes</p>
        </div>
        {cargando ? (
          <p className="text-xs text-neutral-400 text-center py-4">Cargando...</p>
        ) : canjes.length === 0 ? (
          <p className="text-xs text-neutral-400 text-center py-4">Todavía no pagó ni canjeó nada.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-400 border-b border-neutral-200">
                <th className="p-2.5">Fecha</th>
                <th className="p-2.5">Marca</th>
                <th className="p-2.5">Tipo</th>
                <th className="p-2.5 text-right">Monto</th>
                <th className="p-2.5">Venta</th>
              </tr>
            </thead>
            <tbody>
              {canjes.map((c) => {
                const abierto = expandido === c.idMovimiento;
                return (
                  <Fragment key={c.idMovimiento}>
                    <tr
                      onClick={() => c.idVenta && setExpandido(abierto ? null : c.idMovimiento)}
                      className={`border-b border-neutral-100 last:border-0 ${c.idVenta ? "cursor-pointer hover:bg-neutral-50" : ""}`}
                    >
                      <td className="p-2.5 whitespace-nowrap text-neutral-500">{formatearFechaHora(c.fecha)}</td>
                      <td className="p-2.5">{c.nombreMarca}</td>
                      <td className="p-2.5">
                        <span className={`font-semibold ${c.tipo === "CANJE" ? "text-purple-600" : "text-emerald-600"}`}>
                          {c.tipo === "CANJE" ? "Canje" : "Pago"}
                        </span>
                      </td>
                      <td className="p-2.5 text-right tabular-nums font-semibold">${formatearMonto(c.monto)}</td>
                      <td className="p-2.5">
                        {c.numeroVenta ? (
                          <span className="text-accent">
                            {abierto ? "▾" : "▸"} VTA-{String(c.numeroVenta).padStart(4, "0")}
                          </span>
                        ) : (
                          <span className="text-neutral-400">{c.descripcion ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                    {abierto && c.idVenta && <DetalleCanjeVenta idMovimiento={c.idMovimiento} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FilaSaldoMarca({
  idProfesional,
  saldo,
  onCambio,
}: {
  idProfesional: string;
  saldo: SaldoMarca;
  onCambio: () => void;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [monto, setMonto] = useState(String(saldo.saldo));
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esPuntos = saldo.tipoRecompensa === "PUNTOS";

  function handleRegistrar() {
    setError(null);
    setGuardando(true);
    registrarPagoCanje(idProfesional, saldo.idMarca, esPuntos ? "CANJE" : "PAGO", Number(monto) || 0, descripcion)
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          setMostrarForm(false);
          onCambio();
        }
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-800">{saldo.nombreMarca}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tabular-nums">${formatearMonto(saldo.saldo)}</span>
          {saldo.saldo > 0 && (
            <button onClick={() => setMostrarForm((v) => !v)} className="text-xs font-semibold text-accent border border-accent rounded-lg px-2 py-0.5">
              {esPuntos ? "Canjear" : "Pagar"}
            </button>
          )}
        </div>
      </div>
      {mostrarForm && (
        <div className="mt-2 pt-2 border-t border-neutral-200">
          {error && <p className="text-xs text-red-600 mb-1.5">{error}</p>}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-[11px] text-neutral-500 mb-1">Monto</label>
              <input value={monto} onChange={(e) => setMonto(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-2 py-1 text-xs" />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-neutral-500 mb-1">{esPuntos ? "Qué se llevó" : "Descripción"}</label>
              <input
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder={esPuntos ? "Ej: 2 Whey + 1 Bloom" : "Ej: transferencia"}
                className="w-full border border-neutral-300 rounded-lg px-2 py-1 text-xs"
              />
            </div>
            <button onClick={handleRegistrar} disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
              {guardando ? "..." : "Confirmar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetalleCanjeVenta({ idMovimiento }: { idMovimiento: string }) {
  const [productos, setProductos] = useState<{ nombre: string; cantidad: number; precioUnitario: number; subtotal: number }[] | null>(null);

  useEffect(() => {
    detalleCanje(idMovimiento).then(setProductos);
  }, [idMovimiento]);

  return (
    <tr className="border-b border-neutral-100 last:border-0">
      <td colSpan={5} className="bg-neutral-50 px-4 py-2">
        {!productos ? (
          <p className="text-[11px] text-neutral-400">Cargando...</p>
        ) : productos.length === 0 ? (
          <p className="text-[11px] text-neutral-400">Sin productos para mostrar.</p>
        ) : (
          <ul className="text-[11px] text-neutral-600 space-y-0.5">
            {productos.map((p, idx) => (
              <li key={idx} className="flex justify-between">
                <span>{p.nombre} x{p.cantidad}</span>
                <span className="tabular-nums">${formatearMonto(p.subtotal)}</span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function FormPin({ idProfesional, onGuardado }: { idProfesional: string; onGuardado: () => void }) {
  const [pin, setPin] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleGuardar() {
    setError(null);
    setGuardando(true);
    guardarPinProfesional(idProfesional, pin)
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3">
      {error && <p className="text-xs text-red-600 mb-1.5">{error}</p>}
      <div className="flex gap-2">
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN de 4 a 6 números"
          type="password"
          inputMode="numeric"
          maxLength={6}
          className="flex-1 border border-purple-300 rounded-lg px-2.5 py-1.5 text-sm"
        />
        <button onClick={handleGuardar} disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
          {guardando ? "..." : "Guardar PIN"}
        </button>
      </div>
    </div>
  );
}

function FormNuevoProfesional({ onCreado }: { onCreado: () => void }) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    crearProfesional(formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else onCreado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-neutral-200 rounded-xl p-5 mb-5">
      <h2 className="text-base font-semibold text-neutral-900 mb-4">+ Nuevo profesional</h2>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Nombre y apellido</label>
          <input name="nombre" required placeholder="Nombre" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-2" />
          <input name="apellido" placeholder="Apellido (opcional)" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Categoría / Especialidad</label>
          <input name="categoria" placeholder="Ej: Nutricionista" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-2" />
          <input name="especialidad" placeholder="Especialidad (opcional)" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Teléfono</label>
          <input name="telefono" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Email</label>
          <input name="email" type="email" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">DNI</label>
          <input name="dni" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          <p className="text-xs text-neutral-400 mt-1">Para que pueda pagar en caja con su propio saldo.</p>
        </div>
      </div>

      <div className="border-t border-dashed border-neutral-200 pt-3 mb-3">
        <p className="text-xs font-bold uppercase tracking-wide text-accent-dark mb-2">Código de descuento (opcional)</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Código</label>
            <input name="codigo" placeholder="Ej: MARINA10" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm font-mono uppercase" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Vigente desde</label>
            <input name="fecha_desde" type="date" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Vigente hasta</label>
            <input name="fecha_hasta" type="date" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-3 max-w-[220px]">
          <label className="block text-sm font-medium text-neutral-700 mb-1">Límite de usos</label>
          <input name="limite_usos" type="number" placeholder="Sin límite" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-neutral-700 mb-1">Observaciones</label>
        <input name="observaciones" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm">
          {guardando ? "Guardando..." : "Crear profesional"}
        </button>
      </div>
    </form>
  );
}

function FormNuevoCodigo({ idProfesional, onCreado }: { idProfesional: string; onCreado: () => void }) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    crearCodigoProfesional(formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else onCreado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-neutral-100">
      <input type="hidden" name="id_profesional" value={idProfesional} />
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <input name="codigo" required placeholder="Código" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs font-mono uppercase" />
        <input name="fecha_desde" type="date" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        <input name="fecha_hasta" type="date" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        <input name="limite_usos" type="number" placeholder="Sin límite" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
      </div>
      <div className="flex justify-end mt-2">
        <button type="submit" disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
          {guardando ? "..." : "Guardar código"}
        </button>
      </div>
    </form>
  );
}

// ===================== TAB CONFIGURACIÓN POR MARCA =====================

function TabConfigMarcas({ marcas }: { marcas: Marca[] }) {
  const [configs, setConfigs] = useState<ConfigMarca[]>([]);
  const [cargando, setCargando] = useState(true);

  function recargar() {
    setCargando(true);
    listarConfigMarcas()
      .then((c) => setConfigs(c as ConfigMarca[]))
      .finally(() => setCargando(false));
  }

  useEffect(recargar, []);

  const configPorMarca = new Map(configs.map((c) => [c.id_marca, c]));

  return (
    <div>
      <p className="text-xs text-neutral-400 mb-4">
        Cada marca define su propio % — un mismo código de profesional funciona igual en todas. El % del cliente más
        el del profesional nunca puede superar el aporte total que la marca destina al programa. Si cambiás un %, la
        config anterior queda guardada (las ventas viejas conservan el % que usaron en su momento).
      </p>
      {cargando ? (
        <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
      ) : (
        <div className="space-y-3">
          {marcas.map((m) => (
            <FilaConfigMarca key={m.id_marca} marca={m} config={configPorMarca.get(m.id_marca) ?? null} onGuardado={recargar} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilaConfigMarca({ marca, config, onGuardado }: { marca: Marca; config: ConfigMarca | null; onGuardado: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participa, setParticipa] = useState(config?.participa ?? false);
  const [aporte, setAporte] = useState(String(config?.porcentaje_aporte_total ?? ""));
  const [pctCliente, setPctCliente] = useState(String(config?.porcentaje_cliente ?? ""));
  const [pctProfesional, setPctProfesional] = useState(String(config?.porcentaje_profesional ?? ""));

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    guardarConfigMarca(formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          setAbierto(false);
          onGuardado();
        }
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      <button onClick={() => setAbierto((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div>
          <span className="font-semibold text-neutral-900 text-sm">{marca.nombre}</span>
          {config ? (
            <span className="ml-3 text-xs text-neutral-500">
              Aporte {config.porcentaje_aporte_total}% — Cliente {config.porcentaje_cliente}% · Profesional {config.porcentaje_profesional}%
            </span>
          ) : (
            <span className="ml-3 text-xs text-neutral-400">Sin configurar — no participa del programa</span>
          )}
        </div>
        <span className="text-neutral-400 text-xs">{abierto ? "▾" : "▸"}</span>
      </button>
      {abierto && (
        <form onSubmit={handleSubmit} className="px-4 pb-4 border-t border-neutral-100 pt-3">
          <input type="hidden" name="id_marca" value={marca.id_marca} />
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}

          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" name="participa" checked={participa} onChange={(e) => setParticipa(e.target.checked)} />
            Esta marca participa del programa de profesionales
          </label>

          <div className="grid grid-cols-3 gap-3 mb-2">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Aporte total (%)</label>
              <input name="porcentaje_aporte_total" value={aporte} onChange={(e) => setAporte(e.target.value)} type="number" step="0.1" className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">% Cliente</label>
              <input name="porcentaje_cliente" value={pctCliente} onChange={(e) => setPctCliente(e.target.value)} type="number" step="0.1" className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">% Profesional</label>
              <input name="porcentaje_profesional" value={pctProfesional} onChange={(e) => setPctProfesional(e.target.value)} type="number" step="0.1" className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
          </div>
          {Number(pctCliente || 0) + Number(pctProfesional || 0) > Number(aporte || 0) && (
            <p className="text-xs text-red-600 mb-2">⚠ Cliente + Profesional supera el aporte total.</p>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Beneficio al cliente</label>
              <select name="tipo_beneficio_cliente" defaultValue={config?.tipo_beneficio_cliente ?? "PUNTOS"} className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm">
                <option value="PUNTOS">Puntos extra</option>
                <option value="DESCUENTO">Descuento en el momento</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Recompensa al profesional</label>
              <select name="tipo_recompensa_profesional" defaultValue={config?.tipo_recompensa_profesional ?? "DINERO"} className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm">
                <option value="DINERO">Dinero</option>
                <option value="PUNTOS">Puntos</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-4 py-1.5 rounded-lg text-sm">
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
