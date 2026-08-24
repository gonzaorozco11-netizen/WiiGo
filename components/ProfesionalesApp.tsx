"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type {
  Marca,
  Profesional,
  Objetivo,
  FortalezaProfesional,
  FormacionProfesional,
  FotoGaleriaProfesional,
  VideoProfesional,
  TrayectoriaProfesional,
  FilminaProfesional,
  TipoFilmina,
} from "@/lib/supabase";
import {
  listarProfesionales,
  crearProfesional,
  actualizarProfesional,
  subirFotoProfesional,
  cambiarEstadoProfesional,
  cambiarPublicacionProfesional,
  guardarPinProfesional,
  listarCodigos,
  crearCodigoProfesional,
  cambiarEstadoCodigo,
  resumenProfesionales,
  saldosDeProfesional,
  canjesDeProfesional,
  ventasGeneradasDeProfesional,
  detalleCanje,
  registrarPagoCanje,
  listarConfigMarcas,
  guardarConfigMarca,
  listarFortalezas,
  listarProfesionalesConFortalezas,
  listarProfesionalesConObjetivos,
  listarFortalezasDeProfesional,
  guardarFortalezasProfesional,
  listarObjetivosDeProfesional,
  guardarObjetivosProfesional,
  listarFormacion,
  crearFormacion,
  actualizarFormacion,
  eliminarFormacion,
  listarGaleria,
  subirFotoGaleria,
  actualizarFotoGaleria,
  eliminarFotoGaleria,
  reordenarFotoGaleria,
  listarVideos,
  crearVideo,
  actualizarVideo,
  eliminarVideo,
  listarTrayectoria,
  crearTrayectoria,
  actualizarTrayectoria,
  eliminarTrayectoria,
  listarFilminas,
  crearFilmina,
  actualizarFilmina,
  eliminarFilmina,
  toggleVisibleFilmina,
  reordenarFilmina,
} from "@/app/(app)/profesionales/actions";

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

type VentaGeneradaFila = {
  idReferido: string;
  idVenta: string | null;
  numeroVenta: number | null;
  totalVenta: number;
  comisionGenerada: number;
  estado: string;
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

export default function ProfesionalesApp({ marcas, objetivosGlobales }: { marcas: Marca[]; objetivosGlobales: Objetivo[] }) {
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

      {tab === "profesionales" ? <TabProfesionales objetivosGlobales={objetivosGlobales} /> : <TabConfigMarcas marcas={marcas} />}
    </div>
  );
}

// Cuántos de los campos clave de la Fase A están cargados — para el
// indicador "Perfil completado" en el listado y en la ficha de edición.
function calcularCompletitud(p: Profesional, tieneFortalezas: boolean, tieneObjetivos: boolean) {
  const items: { label: string; ok: boolean }[] = [
    { label: "Foto", ok: Boolean(p.foto) },
    { label: "Título y especialidad", ok: Boolean(p.titulo && p.especialidad) },
    { label: "Presentación corta", ok: Boolean(p.bio) },
    { label: "Fortalezas", ok: tieneFortalezas },
    { label: "Cómo puede ayudarte", ok: tieneObjetivos },
    { label: "Atención y reserva", ok: Boolean(p.tipo_atencion && p.link_reserva) },
  ];
  const completados = items.filter((i) => i.ok).length;
  const porcentaje = Math.round((completados / items.length) * 100);
  return { items, porcentaje };
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

function TabProfesionales({ objetivosGlobales }: { objetivosGlobales: Objetivo[] }) {
  const [periodo, setPeriodo] = useState<"hoy" | "semana" | "mes">("mes");
  const [filas, setFilas] = useState<FilaResumen[]>([]);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [codigos, setCodigos] = useState<Codigo[]>([]);
  const [conFortalezas, setConFortalezas] = useState<string[]>([]);
  const [conObjetivos, setConObjetivos] = useState<string[]>([]);
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
    Promise.all([
      resumenProfesionales({ desde, hasta }),
      listarProfesionales(),
      listarCodigos(),
      listarProfesionalesConFortalezas(),
      listarProfesionalesConObjetivos(),
    ])
      .then(([r, p, c, cf, co]) => {
        setFilas(r);
        setProfesionales(p as Profesional[]);
        setCodigos(c as Codigo[]);
        setConFortalezas(cf);
        setConObjetivos(co);
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
                  <th className="p-3">Perfil</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const expandido2 = expandido === f.idProfesional;
                  const profesional = profesionales.find((p) => p.id_profesional === f.idProfesional);
                  const codigosDelProfesional = codigos.filter((c) => c.id_profesional === f.idProfesional);
                  const completitud = profesional
                    ? calcularCompletitud(
                        profesional,
                        conFortalezas.includes(profesional.id_profesional),
                        conObjetivos.includes(profesional.id_profesional)
                      )
                    : null;
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
                        <td className="p-3">
                          {profesional && completitud && (
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                                  profesional.publicado ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"
                                }`}
                              >
                                {profesional.publicado ? "🟢 Publicado" : "⚪ Borrador"}
                              </span>
                              <span className="text-xs text-neutral-400 tabular-nums">{completitud.porcentaje}%</span>
                            </div>
                          )}
                        </td>
                      </tr>
                      {expandido2 && profesional && (
                        <tr className="border-b border-neutral-100 last:border-0">
                          <td colSpan={7} className="bg-neutral-50 p-0">
                            <DetalleProfesional
                              profesional={profesional}
                              objetivosGlobales={objetivosGlobales}
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
  objetivosGlobales,
  codigos,
  onCambio,
}: {
  profesional: Profesional;
  objetivosGlobales: Objetivo[];
  codigos: Codigo[];
  onCambio: () => void;
}) {
  const [saldos, setSaldos] = useState<SaldoMarca[]>([]);
  const [canjes, setCanjes] = useState<CanjeFila[]>([]);
  const [ventasGeneradas, setVentasGeneradas] = useState<VentaGeneradaFila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarCodigoForm, setMostrarCodigoForm] = useState(false);
  const [mostrarPinForm, setMostrarPinForm] = useState(false);
  const [mostrarEditar, setMostrarEditar] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  function recargar() {
    setCargando(true);
    Promise.all([
      saldosDeProfesional(profesional.id_profesional),
      canjesDeProfesional(profesional.id_profesional),
      ventasGeneradasDeProfesional(profesional.id_profesional),
    ])
      .then(([s, c, v]) => {
        setSaldos(s);
        setCanjes(c as CanjeFila[]);
        setVentasGeneradas(v);
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [profesional.id_profesional]);

  function toggleEstadoProfesional() {
    const nuevo = profesional.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO";
    cambiarEstadoProfesional(profesional.id_profesional, nuevo).then(onCambio);
  }

  function togglePublicacion() {
    cambiarPublicacionProfesional(profesional.id_profesional, !profesional.publicado).then(onCambio);
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
          <button onClick={() => setMostrarEditar((v) => !v)} className="text-xs font-semibold text-accent">
            {mostrarEditar ? "Cancelar" : "✏️ Editar"}
          </button>
          <button onClick={() => setMostrarPinForm((v) => !v)} className="text-xs font-semibold text-accent">
            {mostrarPinForm ? "Cancelar" : "🔒 Cambiar PIN"}
          </button>
          <button onClick={togglePublicacion} className="text-xs font-semibold text-emerald-600 hover:text-emerald-800">
            {profesional.publicado ? "Pasar a Borrador" : "🟢 Publicar"}
          </button>
          <button onClick={toggleEstadoProfesional} className="text-xs font-semibold text-red-500 hover:text-red-700">
            {profesional.estado === "ACTIVO" ? "Desactivar profesional" : "Activar profesional"}
          </button>
        </div>
      </div>

      {mostrarEditar && (
        <FormEditarProfesional
          profesional={profesional}
          objetivosGlobales={objetivosGlobales}
          onGuardado={() => {
            setMostrarEditar(false);
            onCambio();
          }}
        />
      )}
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
              <FilaSaldoMarca
                key={s.idMarca}
                idProfesional={profesional.id_profesional}
                saldo={s}
                onCambio={() => {
                  recargar();
                  onCambio();
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden mb-4">
        <div className="px-3 py-2 border-b border-neutral-100">
          <p className="text-xs font-bold text-neutral-700">Ventas generadas (referidos)</p>
          <p className="text-[11px] text-neutral-400">Las ventas donde fue el código referido — esto es lo que le fue sumando saldo</p>
        </div>
        {cargando ? (
          <p className="text-xs text-neutral-400 text-center py-4">Cargando...</p>
        ) : ventasGeneradas.length === 0 ? (
          <p className="text-xs text-neutral-400 text-center py-4">
            Todavía no generó ninguna venta con su código — si esperabas ver una acá, fijate que la marca de esos
            productos tenga habilitado el programa de profesionales (pestaña "Configuración por marca", arriba).
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-400 border-b border-neutral-200">
                <th className="p-2.5">Fecha</th>
                <th className="p-2.5">Venta</th>
                <th className="p-2.5 text-right">Total venta</th>
                <th className="p-2.5 text-right">Comisión generada</th>
              </tr>
            </thead>
            <tbody>
              {ventasGeneradas.map((v) => (
                <tr key={v.idReferido} className="border-b border-neutral-100 last:border-0">
                  <td className="p-2.5 whitespace-nowrap text-neutral-500">
                    {new Date(v.fecha).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  </td>
                  <td className="p-2.5">{v.numeroVenta ? `#${v.numeroVenta}` : "—"}</td>
                  <td className="p-2.5 text-right tabular-nums">${Math.round(v.totalVenta).toLocaleString("es-AR")}</td>
                  <td className="p-2.5 text-right tabular-nums font-semibold text-emerald-600">
                    +${Math.round(v.comisionGenerada).toLocaleString("es-AR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <label className="block text-sm font-medium text-neutral-700 mb-1">Título</label>
          <input name="titulo" placeholder="Ej: Lic. en Nutrición" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
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
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Tipo de atención</label>
          <select name="tipo_atencion" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Sin especificar</option>
            <option value="Presencial">Presencial</option>
            <option value="Virtual">Virtual</option>
            <option value="Presencial y virtual">Presencial y virtual</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Link de reserva</label>
          <input name="link_reserva" placeholder="Ej: link de WhatsApp o Calendly" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-neutral-700 mb-1">Bio</label>
        <textarea name="bio" rows={2} placeholder="Presentación corta para mostrarle al cliente" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        <p className="text-xs text-neutral-400 mt-1">
          La foto, fortalezas, formación, "cómo puede ayudarte" y la publicación se completan después, editando el
          profesional ya creado.
        </p>
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

const OPCIONES_TIPO_FORMACION = ["Carrera universitaria", "Posgrado", "Especialización", "Diplomatura", "Curso", "Certificación"];

function SeccionFormLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-wide text-accent-dark mt-5 mb-2 first:mt-0">{children}</p>;
}

function FormEditarProfesional({
  profesional,
  objetivosGlobales,
  onGuardado,
}: {
  profesional: Profesional;
  objetivosGlobales: Objetivo[];
  onGuardado: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foto, setFoto] = useState(profesional.foto);
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  const [catalogoFortalezas, setCatalogoFortalezas] = useState<FortalezaProfesional[]>([]);
  const [fortalezasSeleccionadas, setFortalezasSeleccionadas] = useState<Set<string>>(new Set());
  const [fortalezaPrincipal, setFortalezaPrincipal] = useState<string | null>(null);
  const [nuevaFortaleza, setNuevaFortaleza] = useState("");
  const [objetivosSeleccionados, setObjetivosSeleccionados] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([listarFortalezas(), listarFortalezasDeProfesional(profesional.id_profesional), listarObjetivosDeProfesional(profesional.id_profesional)]).then(
      ([catalogo, propias, objetivos]) => {
        setCatalogoFortalezas(catalogo as FortalezaProfesional[]);
        const porId = new Map((catalogo as FortalezaProfesional[]).map((f) => [f.id_fortaleza, f.nombre]));
        const nombresPropios = new Set<string>();
        let principal: string | null = null;
        (propias as { id_fortaleza: string; principal: boolean }[]).forEach((p) => {
          const nombre = porId.get(p.id_fortaleza);
          if (!nombre) return;
          nombresPropios.add(nombre);
          if (p.principal) principal = nombre;
        });
        setFortalezasSeleccionadas(nombresPropios);
        setFortalezaPrincipal(principal);
        setObjetivosSeleccionados(new Set(objetivos));
      }
    );
  }, [profesional.id_profesional]);

  function toggleFortaleza(nombre: string) {
    setFortalezasSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(nombre)) {
        next.delete(nombre);
        if (fortalezaPrincipal === nombre) setFortalezaPrincipal(null);
      } else {
        next.add(nombre);
      }
      return next;
    });
  }

  function agregarFortalezaNueva() {
    const nombre = nuevaFortaleza.trim();
    if (!nombre) return;
    if (!catalogoFortalezas.some((f) => f.nombre.toLowerCase() === nombre.toLowerCase())) {
      setCatalogoFortalezas((prev) => [...prev, { id_fortaleza: `nueva-${nombre}`, nombre, orden: null, estado: "ACTIVA" }]);
    }
    setFortalezasSeleccionadas((prev) => new Set(prev).add(nombre));
    setNuevaFortaleza("");
  }

  function toggleObjetivo(id: string) {
    setObjetivosSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    Promise.all([
      actualizarProfesional(profesional.id_profesional, formData),
      guardarFortalezasProfesional(
        profesional.id_profesional,
        [...fortalezasSeleccionadas].map((nombre) => ({ nombre, principal: nombre === fortalezaPrincipal }))
      ),
      guardarObjetivosProfesional(profesional.id_profesional, [...objetivosSeleccionados]),
    ])
      .then(([res1, res2, res3]) => {
        const err = res1.error || res2.error || res3.error;
        if (err) setError(err);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    const formData = new FormData();
    formData.set("archivo", archivo);
    setSubiendoFoto(true);
    subirFotoProfesional(profesional.id_profesional, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else if (res.url) setFoto(res.url);
      })
      .finally(() => setSubiendoFoto(false));
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-neutral-200 rounded-lg p-4 mb-4">
      <h3 className="text-sm font-bold text-neutral-900 mb-3">Editar profesional</h3>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}

      <div className="flex items-center gap-3 mb-4">
        <span className="w-16 h-16 rounded-xl overflow-hidden bg-neutral-100 flex items-center justify-center text-neutral-400 text-xl font-bold shrink-0">
          {foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto} alt="" className="w-full h-full object-cover" />
          ) : (
            profesional.nombre.charAt(0).toUpperCase()
          )}
        </span>
        <label className="text-xs font-semibold text-accent cursor-pointer">
          {subiendoFoto ? "Subiendo..." : foto ? "Cambiar foto" : "Agregar foto"}
          <input type="file" accept="image/*" onChange={handleFoto} disabled={subiendoFoto} className="hidden" />
        </label>
      </div>

      {(() => {
        const completitud = calcularCompletitud({ ...profesional, foto }, fortalezasSeleccionadas.size > 0, objetivosSeleccionados.size > 0);
        return (
          <div className="bg-accent-tint border border-accent rounded-lg p-3 mb-4">
            <p className="text-sm font-bold text-neutral-900 mb-1.5">Perfil completado: {completitud.porcentaje}%</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {completitud.items.map((item) => (
                <p key={item.label} className={`text-xs ${item.ok ? "text-emerald-700" : "text-amber-700"}`}>
                  {item.ok ? "✓" : "⚠"} {item.label}
                </p>
              ))}
            </div>
          </div>
        );
      })()}

      <SeccionFormLabel>👤 Datos personales</SeccionFormLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre</label>
          <input name="nombre" required defaultValue={profesional.nombre} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Apellido</label>
          <input name="apellido" defaultValue={profesional.apellido ?? ""} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">DNI 🔒</label>
          <input name="dni" defaultValue={profesional.dni ?? ""} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Fecha de nacimiento 🔒</label>
          <input name="fecha_nacimiento" type="date" defaultValue={profesional.fecha_nacimiento ?? ""} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Email</label>
          <input name="email" type="email" defaultValue={profesional.email ?? ""} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Teléfono 🔒</label>
          <input name="telefono" defaultValue={profesional.telefono ?? ""} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Profesión</label>
          <input name="categoria" defaultValue={profesional.categoria ?? ""} placeholder="Ej: Nutricionista" className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Matrícula profesional</label>
          <input name="matricula" defaultValue={profesional.matricula ?? ""} placeholder="Ej: MP 4521" className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
      </div>
      <p className="text-[11px] text-neutral-400 mt-2">🔒 Estos campos son administrativos — nunca se muestran en el kiosco ni en la ficha del cliente.</p>

      <SeccionFormLabel>🎓 Formación</SeccionFormLabel>
      <SeccionFormacion idProfesional={profesional.id_profesional} />

      <SeccionFormLabel>⭐ Perfil profesional</SeccionFormLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Título principal</label>
          <input name="titulo" defaultValue={profesional.titulo ?? ""} placeholder="Ej: Lic. en Nutrición" className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Especialidad principal</label>
          <input name="especialidad" defaultValue={profesional.especialidad ?? ""} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-neutral-600 mb-1">Presentación corta — aparece al tocar su foto en el kiosco</label>
        <textarea name="bio" rows={2} defaultValue={profesional.bio ?? ""} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-neutral-600 mb-1">
          Biografía completa — se guarda ya, se va a mostrar cuando armemos "Conóceme"
        </label>
        <textarea name="biografia_completa" rows={3} defaultValue={profesional.biografia_completa ?? ""} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
      </div>

      <SeccionFormLabel>💪 ¿En qué se destaca?</SeccionFormLabel>
      <div className="flex flex-wrap gap-2 mb-1">
        {catalogoFortalezas.map((f) => {
          const on = fortalezasSeleccionadas.has(f.nombre);
          return (
            <button
              key={f.id_fortaleza}
              type="button"
              onClick={() => toggleFortaleza(f.nombre)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${
                on ? "bg-accent-tint border-accent text-accent-dark" : "border-neutral-300 text-neutral-600"
              }`}
            >
              {f.nombre}
              {on && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFortalezaPrincipal(fortalezaPrincipal === f.nombre ? null : f.nombre);
                  }}
                  title="Marcar como principal"
                  className={fortalezaPrincipal === f.nombre ? "text-amber-500" : "text-neutral-300"}
                >
                  ★
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 mb-2 max-w-xs">
        <input
          value={nuevaFortaleza}
          onChange={(e) => setNuevaFortaleza(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              agregarFortalezaNueva();
            }
          }}
          placeholder="Crear una nueva..."
          className="flex-1 border border-neutral-300 rounded-lg px-2.5 py-1 text-xs"
        />
        <button type="button" onClick={agregarFortalezaNueva} className="text-xs font-semibold text-accent">
          + Crear
        </button>
      </div>
      <p className="text-[11px] text-neutral-400 mb-3">Tocá la ★ de una fortaleza elegida para marcarla como principal.</p>

      <SeccionFormLabel>🎯 ¿Cómo puede ayudarte?</SeccionFormLabel>
      <div className="flex flex-wrap gap-2 mb-1">
        {objetivosGlobales.length === 0 && <p className="text-xs text-neutral-400">Todavía no cargaste objetivos en Catálogo asesor.</p>}
        {objetivosGlobales.map((o) => {
          const on = objetivosSeleccionados.has(o.id_objetivo);
          return (
            <button
              key={o.id_objetivo}
              type="button"
              onClick={() => toggleObjetivo(o.id_objetivo)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                on ? "bg-accent-tint border-accent text-accent-dark" : "border-neutral-300 text-neutral-600"
              }`}
            >
              {o.nombre}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-400 mb-3">
        Son los mismos objetivos de "Encontrar productos para mí" — así el Asesor puede recomendar a este profesional según lo que busca el cliente.
      </p>

      <SeccionFormLabel>🏆 Trayectoria</SeccionFormLabel>
      <SeccionTrayectoria idProfesional={profesional.id_profesional} />

      <SeccionFormLabel>📸 Fotos y videos</SeccionFormLabel>
      <SeccionGaleria idProfesional={profesional.id_profesional} />
      <SeccionVideos idProfesional={profesional.id_profesional} />

      <SeccionFormLabel>🎞️ Conóceme</SeccionFormLabel>
      <SeccionConoceme idProfesional={profesional.id_profesional} />

      <SeccionFormLabel>📅 Atención y reserva</SeccionFormLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Tipo de atención</label>
          <select name="tipo_atencion" defaultValue={profesional.tipo_atencion ?? ""} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="">Sin especificar</option>
            <option value="Presencial">Presencial</option>
            <option value="Virtual">Virtual</option>
            <option value="Presencial y virtual">Presencial y virtual</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Ciudad (solo si no atiende en el local)</label>
          <input name="ciudad" defaultValue={profesional.ciudad ?? ""} placeholder="Ej: Buenos Aires" className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
          <p className="text-[11px] text-neutral-400 mt-1">
            Si la carga, el cliente ve un aviso antes de reservar un turno presencial fuera del local.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Link de reserva — Presencial</label>
          <input name="link_reserva" defaultValue={profesional.link_reserva ?? ""} placeholder="Link de Cal.com, WhatsApp, etc." className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Link de reserva — Online</label>
          <input name="link_reserva_online" defaultValue={profesional.link_reserva_online ?? ""} placeholder="Link de Cal.com para videollamada" className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
          <p className="text-[11px] text-neutral-400 mt-1">
            Si cargás los dos links, el cliente va a poder elegir modalidad antes de reservar.
          </p>
        </div>
      </div>

      <SeccionFormLabel>👁️ Publicación</SeccionFormLabel>
      <label className="flex items-center gap-2 text-sm text-neutral-700 mb-3">
        <input type="checkbox" name="publicado" defaultChecked={profesional.publicado} className="rounded border-neutral-300 text-accent focus:ring-accent" />
        Publicado en el kiosco del Asesor (si no está tildado, queda en Borrador y no se muestra al cliente)
      </label>

      <div className="mb-3">
        <label className="block text-xs font-medium text-neutral-600 mb-1">Observaciones</label>
        <input name="observaciones" defaultValue={profesional.observaciones ?? ""} className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm" />
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-4 py-1.5 rounded-lg text-sm">
          {guardando ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}

function SeccionFormacion({ idProfesional }: { idProfesional: string }) {
  const [formacion, setFormacion] = useState<FormacionProfesional[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<FormacionProfesional | null>(null);

  function recargar() {
    setCargando(true);
    listarFormacion(idProfesional)
      .then((f) => setFormacion(f as FormacionProfesional[]))
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [idProfesional]);

  function handleEliminar(f: FormacionProfesional) {
    if (!confirm(`¿Borrar "${f.titulo}"?`)) return;
    eliminarFormacion(f.id_formacion).then(recargar);
  }

  return (
    <div className="mb-3">
      {cargando ? (
        <p className="text-xs text-neutral-400">Cargando...</p>
      ) : formacion.length === 0 ? (
        <p className="text-xs text-neutral-400 mb-2">Todavía no cargaste formación académica.</p>
      ) : (
        <div className="space-y-1.5 mb-2">
          {formacion.map((f) => (
            <div key={f.id_formacion} className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-800">{f.titulo}</p>
                <p className="text-xs text-neutral-400">
                  {[f.institucion, f.anio, f.tipo].filter(Boolean).join(" · ")}
                  {!f.publico && " · oculto"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => setEditando(f)} className="text-xs font-semibold text-accent">
                  Editar
                </button>
                <button type="button" onClick={() => handleEliminar(f)} className="text-xs font-semibold text-red-500">
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editando && (
        <FormFormacion
          idProfesional={idProfesional}
          formacion={editando}
          onListo={() => {
            setEditando(null);
            recargar();
          }}
          onCancelar={() => setEditando(null)}
        />
      )}

      {!editando &&
        (mostrarForm ? (
          <FormFormacion
            idProfesional={idProfesional}
            formacion={null}
            onListo={() => {
              setMostrarForm(false);
              recargar();
            }}
            onCancelar={() => setMostrarForm(false)}
          />
        ) : (
          <button type="button" onClick={() => setMostrarForm(true)} className="text-xs font-semibold text-accent">
            + Agregar formación
          </button>
        ))}
    </div>
  );
}

function FormFormacion({
  idProfesional,
  formacion,
  onListo,
  onCancelar,
}: {
  idProfesional: string;
  formacion: FormacionProfesional | null;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);

  // No es un <form> propio a propósito: esto vive adentro del <form> grande
  // de "Editar profesional", y HTML no permite anidar formularios. Se arma
  // el FormData a mano leyendo los campos del contenedor.
  function handleGuardar() {
    if (!contenedorRef.current) return;
    setError(null);
    const formData = new FormData();
    contenedorRef.current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name]").forEach((el) => {
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        if (el.checked) formData.set(el.name, "on");
      } else {
        formData.set(el.name, el.value);
      }
    });
    if (!String(formData.get("titulo") ?? "").trim()) {
      setError("El título es obligatorio");
      return;
    }
    setGuardando(true);
    const promesa = formacion ? actualizarFormacion(formacion.id_formacion, formData) : crearFormacion(idProfesional, formData);
    promesa
      .then((res) => {
        if (res.error) setError(res.error);
        else onListo();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div ref={contenedorRef} className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 mt-2">
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
        <input name="titulo" defaultValue={formacion?.titulo ?? ""} placeholder="Título" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs sm:col-span-1" />
        <input name="institucion" defaultValue={formacion?.institucion ?? ""} placeholder="Institución / Universidad" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        <input name="anio" type="number" defaultValue={formacion?.anio ?? ""} placeholder="Año" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <select name="tipo" defaultValue={formacion?.tipo ?? ""} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs">
          <option value="">Tipo...</option>
          {OPCIONES_TIPO_FORMACION.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" name="publico" defaultChecked={formacion?.publico ?? true} className="rounded border-neutral-300 text-accent focus:ring-accent" />
          Mostrar públicamente
        </label>
      </div>
      <textarea
        name="descripcion"
        rows={2}
        defaultValue={formacion?.descripcion ?? ""}
        placeholder="Descripción (opcional)"
        className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs mb-2"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="text-xs font-semibold text-neutral-500 px-3 py-1.5">
          Cancelar
        </button>
        <button type="button" onClick={handleGuardar} disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
          {guardando ? "..." : "Guardar"}
        </button>
      </div>
    </div>
  );
}

// ===================== TRAYECTORIA =====================

function SeccionTrayectoria({ idProfesional }: { idProfesional: string }) {
  const [items, setItems] = useState<TrayectoriaProfesional[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<TrayectoriaProfesional | null>(null);

  function recargar() {
    setCargando(true);
    listarTrayectoria(idProfesional)
      .then((f) => setItems(f as TrayectoriaProfesional[]))
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [idProfesional]);

  function handleEliminar(t: TrayectoriaProfesional) {
    if (!confirm(`¿Borrar "${t.titulo}"?`)) return;
    eliminarTrayectoria(t.id_trayectoria).then(recargar);
  }

  return (
    <div className="mb-3">
      {cargando ? (
        <p className="text-xs text-neutral-400">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-neutral-400 mb-2">Todavía no cargaste trayectoria.</p>
      ) : (
        <div className="space-y-1.5 mb-2">
          {items.map((t) => (
            <div key={t.id_trayectoria} className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-800">{t.titulo}</p>
                <p className="text-xs text-neutral-400">
                  {[t.lugar, t.anio_desde && `${t.anio_desde} – ${t.anio_hasta ?? "Actualidad"}`].filter(Boolean).join(" · ")}
                  {!t.publico && " · oculto"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => setEditando(t)} className="text-xs font-semibold text-accent">
                  Editar
                </button>
                <button type="button" onClick={() => handleEliminar(t)} className="text-xs font-semibold text-red-500">
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editando && (
        <FormTrayectoria
          idProfesional={idProfesional}
          item={editando}
          onListo={() => {
            setEditando(null);
            recargar();
          }}
          onCancelar={() => setEditando(null)}
        />
      )}

      {!editando &&
        (mostrarForm ? (
          <FormTrayectoria
            idProfesional={idProfesional}
            item={null}
            onListo={() => {
              setMostrarForm(false);
              recargar();
            }}
            onCancelar={() => setMostrarForm(false)}
          />
        ) : (
          <button type="button" onClick={() => setMostrarForm(true)} className="text-xs font-semibold text-accent">
            + Agregar experiencia / logro
          </button>
        ))}
    </div>
  );
}

function FormTrayectoria({
  idProfesional,
  item,
  onListo,
  onCancelar,
}: {
  idProfesional: string;
  item: TrayectoriaProfesional | null;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);

  function handleGuardar() {
    if (!contenedorRef.current) return;
    setError(null);
    const formData = new FormData();
    contenedorRef.current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[name]").forEach((el) => {
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        if (el.checked) formData.set(el.name, "on");
      } else {
        formData.set(el.name, el.value);
      }
    });
    if (!String(formData.get("titulo") ?? "").trim()) {
      setError("El título es obligatorio");
      return;
    }
    setGuardando(true);
    const promesa = item ? actualizarTrayectoria(item.id_trayectoria, formData) : crearTrayectoria(idProfesional, formData);
    promesa
      .then((res) => {
        if (res.error) setError(res.error);
        else onListo();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div ref={contenedorRef} className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 mt-2">
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input name="titulo" defaultValue={item?.titulo ?? ""} placeholder="Título (ej: Nutricionista deportiva)" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        <input name="lugar" defaultValue={item?.lugar ?? ""} placeholder="Lugar (ej: Club XXX)" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
        <input name="anio_desde" type="number" defaultValue={item?.anio_desde ?? ""} placeholder="Año desde" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        <input name="anio_hasta" type="number" defaultValue={item?.anio_hasta ?? ""} placeholder="Año hasta (vacío = Actualidad)" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" name="publico" defaultChecked={item?.publico ?? true} className="rounded border-neutral-300 text-accent focus:ring-accent" />
          Mostrar públicamente
        </label>
      </div>
      <textarea
        name="descripcion"
        rows={2}
        defaultValue={item?.descripcion ?? ""}
        placeholder="Descripción (opcional)"
        className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs mb-2"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="text-xs font-semibold text-neutral-500 px-3 py-1.5">
          Cancelar
        </button>
        <button type="button" onClick={handleGuardar} disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
          {guardando ? "..." : "Guardar"}
        </button>
      </div>
    </div>
  );
}

// ===================== GALERÍA DE FOTOS =====================

function SeccionGaleria({ idProfesional }: { idProfesional: string }) {
  const [fotos, setFotos] = useState<FotoGaleriaProfesional[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [editando, setEditando] = useState<FotoGaleriaProfesional | null>(null);

  function recargar() {
    setCargando(true);
    listarGaleria(idProfesional)
      .then((f) => setFotos(f as FotoGaleriaProfesional[]))
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [idProfesional]);

  function handleSubir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    const formData = new FormData();
    formData.set("archivo", archivo);
    setSubiendo(true);
    subirFotoGaleria(idProfesional, formData)
      .then(recargar)
      .finally(() => setSubiendo(false));
  }

  function handleEliminar(f: FotoGaleriaProfesional) {
    if (!confirm("¿Borrar esta foto de la galería?")) return;
    eliminarFotoGaleria(f.id_foto).then(recargar);
  }

  function handleMover(f: FotoGaleriaProfesional, direccion: "up" | "down") {
    reordenarFotoGaleria(idProfesional, f.id_foto, direccion).then(recargar);
  }

  return (
    <div className="mb-4">
      <p className="text-xs font-bold text-neutral-700 mb-2">Galería</p>
      {cargando ? (
        <p className="text-xs text-neutral-400">Cargando...</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          {fotos.map((f, idx) => (
            <div key={f.id_foto} className="border border-neutral-200 rounded-lg overflow-hidden bg-neutral-50">
              <div className="aspect-square bg-neutral-100 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="p-1.5">
                <p className="text-[10px] font-semibold text-neutral-700 truncate">{f.titulo || "Sin título"}</p>
                <p className="text-[9px] text-neutral-400">{f.publico ? "Público" : "Oculto"}</p>
                <div className="flex items-center justify-between mt-1">
                  <div className="flex gap-1">
                    <button type="button" disabled={idx === 0} onClick={() => handleMover(f, "up")} className="text-[10px] text-neutral-400 disabled:opacity-30">
                      ▲
                    </button>
                    <button type="button" disabled={idx === fotos.length - 1} onClick={() => handleMover(f, "down")} className="text-[10px] text-neutral-400 disabled:opacity-30">
                      ▼
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setEditando(f)} className="text-[10px] font-semibold text-accent">
                      Editar
                    </button>
                    <button type="button" onClick={() => handleEliminar(f)} className="text-[10px] font-semibold text-red-500">
                      Borrar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <label className="border border-dashed border-neutral-300 rounded-lg aspect-square flex flex-col items-center justify-center gap-1 text-accent text-[11px] font-semibold cursor-pointer">
            {subiendo ? "Subiendo..." : (
              <>
                <span className="text-lg">+</span>
                Agregar foto
              </>
            )}
            <input type="file" accept="image/*" onChange={handleSubir} disabled={subiendo} className="hidden" />
          </label>
        </div>
      )}
      {editando && (
        <FormFotoGaleria
          foto={editando}
          onListo={() => {
            setEditando(null);
            recargar();
          }}
          onCancelar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function FormFotoGaleria({
  foto,
  onListo,
  onCancelar,
}: {
  foto: FotoGaleriaProfesional;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);

  function handleGuardar() {
    if (!contenedorRef.current) return;
    setError(null);
    const formData = new FormData();
    contenedorRef.current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[name]").forEach((el) => {
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        if (el.checked) formData.set(el.name, "on");
      } else {
        formData.set(el.name, el.value);
      }
    });
    setGuardando(true);
    actualizarFotoGaleria(foto.id_foto, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else onListo();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div ref={contenedorRef} className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 mt-2">
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input name="titulo" defaultValue={foto.titulo ?? ""} placeholder="Título (ej: Consultorio)" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" name="publico" defaultChecked={foto.publico} className="rounded border-neutral-300 text-accent focus:ring-accent" />
          Mostrar públicamente
        </label>
      </div>
      <textarea
        name="descripcion"
        rows={2}
        defaultValue={foto.descripcion ?? ""}
        placeholder="Descripción (opcional)"
        className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs mb-2"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="text-xs font-semibold text-neutral-500 px-3 py-1.5">
          Cancelar
        </button>
        <button type="button" onClick={handleGuardar} disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
          {guardando ? "..." : "Guardar"}
        </button>
      </div>
    </div>
  );
}

// ===================== VIDEOS =====================

function SeccionVideos({ idProfesional }: { idProfesional: string }) {
  const [videos, setVideos] = useState<VideoProfesional[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<VideoProfesional | null>(null);

  function recargar() {
    setCargando(true);
    listarVideos(idProfesional)
      .then((v) => setVideos(v as VideoProfesional[]))
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [idProfesional]);

  function handleEliminar(v: VideoProfesional) {
    if (!confirm(`¿Borrar el video "${v.titulo}"?`)) return;
    eliminarVideo(v.id_video).then(recargar);
  }

  return (
    <div className="mb-3">
      <p className="text-xs font-bold text-neutral-700 mb-2">Videos</p>
      {cargando ? (
        <p className="text-xs text-neutral-400">Cargando...</p>
      ) : videos.length === 0 ? (
        <p className="text-xs text-neutral-400 mb-2">Todavía no cargaste videos.</p>
      ) : (
        <div className="space-y-1.5 mb-2">
          {videos.map((v) => (
            <div key={v.id_video} className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-800 truncate">▶️ {v.titulo}</p>
                <p className="text-xs text-neutral-400 truncate">{v.url}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => setEditando(v)} className="text-xs font-semibold text-accent">
                  Editar
                </button>
                <button type="button" onClick={() => handleEliminar(v)} className="text-xs font-semibold text-red-500">
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editando && (
        <FormVideo
          idProfesional={idProfesional}
          video={editando}
          onListo={() => {
            setEditando(null);
            recargar();
          }}
          onCancelar={() => setEditando(null)}
        />
      )}

      {!editando &&
        (mostrarForm ? (
          <FormVideo
            idProfesional={idProfesional}
            video={null}
            onListo={() => {
              setMostrarForm(false);
              recargar();
            }}
            onCancelar={() => setMostrarForm(false)}
          />
        ) : (
          <button type="button" onClick={() => setMostrarForm(true)} className="text-xs font-semibold text-accent">
            + Agregar video
          </button>
        ))}
      <p className="text-[11px] text-neutral-400 mt-1">Un link de YouTube, Instagram, etc. — no se sube ningún archivo de video.</p>
    </div>
  );
}

function FormVideo({
  idProfesional,
  video,
  onListo,
  onCancelar,
}: {
  idProfesional: string;
  video: VideoProfesional | null;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [titulo, setTitulo] = useState(video?.titulo ?? "");
  const [url, setUrl] = useState(video?.url ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleGuardar() {
    if (!titulo.trim() || !url.trim()) {
      setError("Título y link son obligatorios");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("titulo", titulo.trim());
    formData.set("url", url.trim());
    setGuardando(true);
    const promesa = video ? actualizarVideo(video.id_video, formData) : crearVideo(idProfesional, formData);
    promesa
      .then((res) => {
        if (res.error) setError(res.error);
        else onListo();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 mt-2">
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: Conóceme en 40 segundos" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link de YouTube, Instagram, etc." className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="text-xs font-semibold text-neutral-500 px-3 py-1.5">
          Cancelar
        </button>
        <button type="button" onClick={handleGuardar} disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
          {guardando ? "..." : "Guardar"}
        </button>
      </div>
    </div>
  );
}

// ===================== CONÓCEME (filminas) =====================

const TIPOS_FILMINA: { valor: TipoFilmina; label: string; icono: string; automatica?: boolean }[] = [
  { valor: "texto_foto", label: "Texto + foto", icono: "👤" },
  { valor: "foto", label: "Foto", icono: "🖼️" },
  { valor: "video", label: "Video", icono: "▶️" },
  { valor: "historia", label: "Mi historia (biografía completa)", icono: "📖", automatica: true },
  { valor: "formacion", label: "Formación", icono: "🎓", automatica: true },
  { valor: "trayectoria", label: "Trayectoria", icono: "🏆", automatica: true },
  { valor: "fortalezas", label: "Fortalezas", icono: "💪", automatica: true },
  { valor: "como_trabajo", label: "Cómo trabajo", icono: "🗣️" },
  { valor: "logro", label: "Logro destacado", icono: "⭐" },
];

function etiquetaTipoFilmina(tipo: TipoFilmina) {
  return TIPOS_FILMINA.find((t) => t.valor === tipo) ?? TIPOS_FILMINA[0];
}

function SeccionConoceme({ idProfesional }: { idProfesional: string }) {
  const [filminas, setFilminas] = useState<FilminaProfesional[]>([]);
  const [fotos, setFotos] = useState<FotoGaleriaProfesional[]>([]);
  const [videos, setVideos] = useState<VideoProfesional[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<FilminaProfesional | null>(null);

  function recargar() {
    setCargando(true);
    Promise.all([listarFilminas(idProfesional), listarGaleria(idProfesional), listarVideos(idProfesional)])
      .then(([f, fo, v]) => {
        setFilminas(f as FilminaProfesional[]);
        setFotos(fo as FotoGaleriaProfesional[]);
        setVideos(v as VideoProfesional[]);
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [idProfesional]);

  function handleEliminar(f: FilminaProfesional) {
    if (!confirm("¿Borrar esta filmina?")) return;
    eliminarFilmina(f.id_filmina).then(recargar);
  }

  function handleToggleVisible(f: FilminaProfesional) {
    toggleVisibleFilmina(f.id_filmina, !f.visible).then(recargar);
  }

  function handleMover(f: FilminaProfesional, direccion: "up" | "down") {
    reordenarFilmina(idProfesional, f.id_filmina, direccion).then(recargar);
  }

  return (
    <div className="mb-3">
      {cargando ? (
        <p className="text-xs text-neutral-400">Cargando...</p>
      ) : filminas.length === 0 ? (
        <p className="text-xs text-neutral-400 mb-2">Todavía no armaste ninguna filmina.</p>
      ) : (
        <div className="space-y-1.5 mb-2">
          {filminas.map((f, idx) => {
            const info = etiquetaTipoFilmina(f.tipo);
            return (
              <div key={f.id_filmina} className={`flex items-center gap-2 border border-neutral-200 rounded-lg px-3 py-2 ${f.visible ? "bg-white" : "bg-neutral-50 opacity-60"}`}>
                <span className="text-xs font-bold text-neutral-400 w-4 text-center">{idx + 1}</span>
                <span className="w-8 h-8 rounded-lg bg-accent-tint text-accent flex items-center justify-center text-sm shrink-0">{info.icono}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-800 truncate">{f.titulo || info.label}</p>
                  <p className="text-xs text-neutral-400">{info.automatica ? "Se arma sola con lo que ya cargaste" : info.label}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button type="button" disabled={idx === 0} onClick={() => handleMover(f, "up")} className="text-xs text-neutral-400 disabled:opacity-30">
                    ▲
                  </button>
                  <button type="button" disabled={idx === filminas.length - 1} onClick={() => handleMover(f, "down")} className="text-xs text-neutral-400 disabled:opacity-30">
                    ▼
                  </button>
                  <button type="button" onClick={() => handleToggleVisible(f)} title={f.visible ? "Ocultar" : "Mostrar"} className="text-sm">
                    {f.visible ? "👁" : "🚫"}
                  </button>
                  <button type="button" onClick={() => setEditando(f)} className="text-xs font-semibold text-accent">
                    Editar
                  </button>
                  <button type="button" onClick={() => handleEliminar(f)} className="text-xs font-semibold text-red-500">
                    Borrar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editando && (
        <FormFilmina
          idProfesional={idProfesional}
          filmina={editando}
          fotos={fotos}
          videos={videos}
          onListo={() => {
            setEditando(null);
            recargar();
          }}
          onCancelar={() => setEditando(null)}
        />
      )}

      {!editando &&
        (mostrarForm ? (
          <FormFilmina
            idProfesional={idProfesional}
            filmina={null}
            fotos={fotos}
            videos={videos}
            onListo={() => {
              setMostrarForm(false);
              recargar();
            }}
            onCancelar={() => setMostrarForm(false)}
          />
        ) : (
          <button type="button" onClick={() => setMostrarForm(true)} className="text-xs font-semibold text-accent">
            + Agregar filmina
          </button>
        ))}
    </div>
  );
}

function FormFilmina({
  idProfesional,
  filmina,
  fotos,
  videos,
  onListo,
  onCancelar,
}: {
  idProfesional: string;
  filmina: FilminaProfesional | null;
  fotos: FotoGaleriaProfesional[];
  videos: VideoProfesional[];
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [tipo, setTipo] = useState<TipoFilmina>(filmina?.tipo ?? "texto_foto");
  const [titulo, setTitulo] = useState(filmina?.titulo ?? "");
  const [texto, setTexto] = useState(filmina?.texto ?? "");
  const [idFoto, setIdFoto] = useState(filmina?.id_foto ?? "");
  const [idVideo, setIdVideo] = useState(filmina?.id_video ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = etiquetaTipoFilmina(tipo);
  const necesitaFoto = tipo === "foto" || tipo === "texto_foto";
  const necesitaVideo = tipo === "video";
  const necesitaTexto = tipo === "texto_foto" || tipo === "como_trabajo" || tipo === "logro";

  function handleGuardar() {
    setError(null);
    const formData = new FormData();
    formData.set("tipo", tipo);
    formData.set("titulo", titulo.trim());
    if (necesitaTexto) formData.set("texto", texto.trim());
    if (necesitaFoto && idFoto) formData.set("id_foto", idFoto);
    if (necesitaVideo && idVideo) formData.set("id_video", idVideo);
    setGuardando(true);
    const promesa = filmina ? actualizarFilmina(filmina.id_filmina, formData) : crearFilmina(idProfesional, formData);
    promesa
      .then((res) => {
        if (res.error) setError(res.error);
        else onListo();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 mt-2">
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="mb-2">
        <label className="block text-xs font-medium text-neutral-600 mb-1">Tipo de filmina</label>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoFilmina)}
          disabled={Boolean(filmina)}
          className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs disabled:bg-neutral-100"
        >
          {TIPOS_FILMINA.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.icono} {t.label}
            </option>
          ))}
        </select>
        {info.automatica && <p className="text-[11px] text-neutral-400 mt-1">Esta filmina se arma sola — no hace falta cargar nada más acá.</p>}
      </div>

      {!info.automatica && (
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Título de la filmina (opcional)"
          className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs mb-2"
        />
      )}

      {necesitaFoto && (
        <select value={idFoto} onChange={(e) => setIdFoto(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs mb-2">
          <option value="">Elegí una foto de la galería...</option>
          {fotos.map((f) => (
            <option key={f.id_foto} value={f.id_foto}>
              {f.titulo || "Sin título"}
            </option>
          ))}
        </select>
      )}

      {necesitaVideo && (
        <select value={idVideo} onChange={(e) => setIdVideo(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs mb-2">
          <option value="">Elegí un video...</option>
          {videos.map((v) => (
            <option key={v.id_video} value={v.id_video}>
              {v.titulo}
            </option>
          ))}
        </select>
      )}

      {necesitaTexto && (
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          placeholder="Texto de la filmina"
          className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs mb-2"
        />
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="text-xs font-semibold text-neutral-500 px-3 py-1.5">
          Cancelar
        </button>
        <button type="button" onClick={handleGuardar} disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
          {guardando ? "..." : "Guardar"}
        </button>
      </div>
    </div>
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
