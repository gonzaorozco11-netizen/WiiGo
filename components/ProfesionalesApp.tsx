"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
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
  Consultorio,
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
  listarConsultorios,
  guardarConsultorio,
  usuarioDeProfesional,
  profesionalesDelMes,
  guardarReglasProfesionales,
  crearUsuarioProfesional,
  cambiarClaveUsuarioProfesional,
  cambiarEstadoUsuarioProfesional,
  type UsuarioDeProfesional,
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
// Si comparte consultorio, el link de turnos puede venir de ahí y no de ella.
function calcularCompletitud(p: Profesional, tieneFortalezas: boolean, tieneObjetivos: boolean, linkConsultorio: string | null = null) {
  const items: { label: string; ok: boolean }[] = [
    { label: "Foto", ok: Boolean(p.foto) },
    { label: "Título y especialidad", ok: Boolean(p.titulo && p.especialidad) },
    { label: "Presentación corta", ok: Boolean(p.bio) },
    { label: "Fortalezas", ok: tieneFortalezas },
    { label: "Cómo puede ayudarte", ok: tieneObjetivos },
    { label: "Atención y reserva", ok: Boolean(p.tipo_atencion && (p.link_reserva || linkConsultorio)) },
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

type FiltroLista = "todos" | "publicados" | "completar" | "borradores" | "inactivos";

type DatosConsultorios = Awaited<ReturnType<typeof listarConsultorios>>;

function TabProfesionales({ objetivosGlobales }: { objetivosGlobales: Objetivo[] }) {
  const [periodo, setPeriodo] = useState<"hoy" | "semana" | "mes">("mes");
  const [filas, setFilas] = useState<FilaResumen[]>([]);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [codigos, setCodigos] = useState<Codigo[]>([]);
  const [conFortalezas, setConFortalezas] = useState<string[]>([]);
  const [conObjetivos, setConObjetivos] = useState<string[]>([]);
  const [consultorios, setConsultorios] = useState<DatosConsultorios>({ disponible: false, consultorios: [], miembros: [] });
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState<FiltroLista>("todos");
  const [abierto, setAbierto] = useState<{ id: string; pestana: Pestana } | null>(null);
  const cerrarFicha = useCallback(() => setAbierto(null), []);
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
      listarConsultorios(),
    ])
      .then(([r, p, c, cf, co, cons]) => {
        setFilas(r);
        setProfesionales(p as Profesional[]);
        setCodigos(c as Codigo[]);
        setConFortalezas(cf);
        setConObjetivos(co);
        setConsultorios(cons);
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [desde, hasta]);

  const activos = filas.filter((f) => f.estado === "ACTIVO").length;
  const ventasTotales = filas.reduce((acc, f) => acc + f.ventasReferidas, 0);
  const montoTotal = filas.reduce((acc, f) => acc + f.totalVenta, 0);
  const comisionPendienteTotal = filas.reduce((acc, f) => acc + f.comisionPendiente, 0);
  const comisionPagadaTotal = filas.reduce((acc, f) => acc + f.comisionPagada, 0);

  const nombreCompleto = (p: Profesional) => `${p.nombre}${p.apellido ? ` ${p.apellido}` : ""}`;
  const consultorioDe = (idProfesional: string) => {
    const m = consultorios.miembros.find((x) => x.id_profesional === idProfesional);
    return m ? consultorios.consultorios.find((c) => c.id_consultorio === m.id_consultorio) ?? null : null;
  };
  const nombresPorConsultorio: Record<string, string[]> = {};
  for (const m of consultorios.miembros) {
    const p = profesionales.find((x) => x.id_profesional === m.id_profesional);
    if (p) (nombresPorConsultorio[m.id_consultorio] ??= []).push(nombreCompleto(p));
  }
  const categorias = [...new Set(profesionales.map((p) => p.categoria).filter((c): c is string => Boolean(c)))];

  const tarjetas = filas.flatMap((f) => {
    const profesional = profesionales.find((p) => p.id_profesional === f.idProfesional);
    if (!profesional) return [];
    const consultorio = consultorioDe(profesional.id_profesional);
    const completitud = calcularCompletitud(
      profesional,
      conFortalezas.includes(profesional.id_profesional),
      conObjetivos.includes(profesional.id_profesional),
      consultorio?.link_reserva ?? consultorio?.link_reserva_online ?? null
    );
    const companeras = consultorio
      ? (nombresPorConsultorio[consultorio.id_consultorio] ?? []).filter((n) => n !== nombreCompleto(profesional))
      : [];
    return [{ fila: f, profesional, completitud, consultorio, companeras }];
  });

  const cumple = (t: (typeof tarjetas)[number], filtroLista: FiltroLista) => {
    const activo = t.profesional.estado === "ACTIVO";
    if (filtroLista === "publicados") return activo && t.profesional.publicado;
    if (filtroLista === "completar") return activo && t.completitud.porcentaje < 100;
    if (filtroLista === "borradores") return activo && !t.profesional.publicado;
    if (filtroLista === "inactivos") return !activo;
    return activo;
  };
  const visibles = tarjetas.filter((t) => cumple(t, filtro));
  const abiertoTarjeta = abierto ? tarjetas.find((t) => t.profesional.id_profesional === abierto.id) ?? null : null;

  const FILTROS: { clave: FiltroLista; label: string }[] = [
    { clave: "todos", label: "Activos" },
    { clave: "publicados", label: "Publicados" },
    { clave: "completar", label: "Les falta completar" },
    { clave: "borradores", label: "Borradores" },
    { clave: "inactivos", label: "Inactivos" },
  ];

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

      <PanelDelMes onAbrir={(id) => setAbierto({ id, pestana: "resumen" })} />

      {mostrarForm && (
        <FormNuevoProfesional
          categorias={categorias}
          consultorios={consultorios}
          nombresPorConsultorio={nombresPorConsultorio}
          onCreado={(id) => {
            setMostrarForm(false);
            recargar();
            setAbierto({ id, pestana: "perfil" });
          }}
        />
      )}

      <div className="flex flex-wrap gap-1.5 mb-4">
        {FILTROS.map((x) => {
          const cuenta = tarjetas.filter((t) => cumple(t, x.clave)).length;
          return (
            <button
              key={x.clave}
              onClick={() => setFiltro(x.clave)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                filtro === x.clave ? "bg-accent-tint border-accent text-accent-dark" : "bg-white border-neutral-200 text-neutral-600"
              }`}
            >
              {x.label} <span className="tabular-nums text-neutral-400">{cuenta}</span>
            </button>
          );
        })}
      </div>

      {cargando && tarjetas.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
      ) : tarjetas.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay profesionales cargados.</p>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">No hay profesionales en este filtro.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {visibles.map((t) => (
            <TarjetaProfesional
              key={t.profesional.id_profesional}
              profesional={t.profesional}
              fila={t.fila}
              completitud={t.completitud}
              consultorio={t.consultorio}
              companeras={t.companeras}
              onAbrir={() => setAbierto({ id: t.profesional.id_profesional, pestana: "resumen" })}
            />
          ))}
        </div>
      )}

      {abiertoTarjeta && abierto && (
        <FichaProfesional
          key={abiertoTarjeta.profesional.id_profesional}
          profesional={abiertoTarjeta.profesional}
          fila={abiertoTarjeta.fila}
          objetivosGlobales={objetivosGlobales}
          codigos={codigos.filter((c) => c.id_profesional === abiertoTarjeta.profesional.id_profesional)}
          consultorios={consultorios}
          nombresPorConsultorio={nombresPorConsultorio}
          categorias={categorias}
          pestanaInicial={abierto.pestana}
          onCambio={recargar}
          onCerrar={cerrarFicha}
        />
      )}
    </div>
  );
}

// La foto con un anillo alrededor que se llena según cuánto tiene cargado el
// perfil: verde completo, ámbar si le falta algo.
function AvatarConAnillo({ foto, nombre, porcentaje, tamano = 64 }: { foto: string | null; nombre: string; porcentaje: number; tamano?: number }) {
  const color = porcentaje >= 100 ? "#059669" : "#f59e0b";
  const iniciales = nombre
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      className="rounded-full p-[3px] shrink-0 grid"
      style={{ width: tamano, height: tamano, background: `conic-gradient(${color} ${porcentaje}%, #e5e5e5 0)` }}
    >
      <span className="w-full h-full rounded-full overflow-hidden bg-neutral-100 border-2 border-white grid place-items-center text-neutral-500 font-bold">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={foto} alt="" className="w-full h-full object-cover object-top" />
        ) : (
          iniciales
        )}
      </span>
    </span>
  );
}

function TarjetaProfesional({
  profesional,
  fila,
  completitud,
  consultorio,
  companeras,
  onAbrir,
}: {
  profesional: Profesional;
  fila: FilaResumen;
  completitud: ReturnType<typeof calcularCompletitud>;
  consultorio: Consultorio | null;
  companeras: string[];
  onAbrir: () => void;
}) {
  const faltan = completitud.items.filter((i) => !i.ok).map((i) => i.label.toLowerCase());
  const activo = profesional.estado === "ACTIVO";
  return (
    <button
      onClick={onAbrir}
      className={`text-left bg-white border rounded-2xl p-4 flex flex-col gap-3 transition hover:shadow-md hover:border-accent ${
        activo ? "border-neutral-200" : "border-neutral-200 opacity-60"
      }`}
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <AvatarConAnillo foto={profesional.foto} nombre={fila.nombre} porcentaje={completitud.porcentaje} />
        <div className="min-w-0">
          <p className="font-bold text-neutral-900 leading-tight truncate">{fila.nombre}</p>
          <p className="text-xs text-neutral-500 truncate">
            {[profesional.categoria, profesional.especialidad].filter(Boolean).join(" · ") || "Sin profesión cargada"}
          </p>
          <p className="text-[11px] font-semibold text-neutral-400 tabular-nums mt-0.5">Perfil {completitud.porcentaje}%</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {!activo ? (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500">Inactivo</span>
        ) : profesional.publicado ? (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Publicado</span>
        ) : (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500">Borrador</span>
        )}
        {consultorio && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
            {companeras.length > 0 ? `Agenda compartida con ${companeras.join(", ")}` : `Consultorio ${consultorio.nombre}`}
          </span>
        )}
        {!profesional.dni && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Sin DNI</span>}
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-neutral-100 pt-2.5">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold text-neutral-400">Código</p>
          <p className="text-sm font-bold font-mono truncate">{fila.codigoPrincipal ?? "—"}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold text-neutral-400">Ventas</p>
          <p className="text-sm font-bold tabular-nums truncate">
            {fila.ventasReferidas}
            {fila.totalVenta > 0 && <span className="font-medium text-neutral-500"> · ${formatearMonto(fila.totalVenta)}</span>}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold text-neutral-400">A pagar</p>
          <p className={`text-sm font-bold tabular-nums ${fila.comisionPendiente > 0 ? "text-red-600" : "text-neutral-400"}`}>
            ${formatearMonto(fila.comisionPendiente)}
          </p>
        </div>
      </div>

      {activo && faltan.length > 0 && (
        <p className="text-xs text-neutral-600 bg-amber-50 rounded-lg px-3 py-2">
          <span className="font-semibold text-amber-800">Le falta:</span>{" "}
          {faltan.length === 1 ? faltan[0] : `${faltan.slice(0, -1).join(", ")} y ${faltan[faltan.length - 1]}`}
        </p>
      )}
    </button>
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

// ===================== AGENDA: PROPIA O COMPARTIDA =====================

type EstadoAgenda = {
  modo: "propia" | "compartida";
  idConsultorio: string; // "" sin elegir, "__nuevo" para crear uno
  nombreNuevo: string;
  linkReserva: string;
  linkReservaOnline: string;
};

function agendaInicial(consultorios: DatosConsultorios, idProfesional: string | null): EstadoAgenda {
  const miembro = idProfesional ? consultorios.miembros.find((m) => m.id_profesional === idProfesional) : undefined;
  const c = miembro ? consultorios.consultorios.find((x) => x.id_consultorio === miembro.id_consultorio) : undefined;
  return c
    ? { modo: "compartida", idConsultorio: c.id_consultorio, nombreNuevo: "", linkReserva: c.link_reserva ?? "", linkReservaOnline: c.link_reserva_online ?? "" }
    : { modo: "propia", idConsultorio: "", nombreNuevo: "", linkReserva: "", linkReservaOnline: "" };
}

// Antes de guardar a la profesional: si eligieron "nuevo consultorio" se
// crea, y si cambiaron los links de uno que ya existe se actualizan (valen
// para todo el consultorio).
async function resolverAgenda(estado: EstadoAgenda, consultorios: DatosConsultorios): Promise<{ error: string | null; idConsultorio: string | null }> {
  if (estado.modo === "propia") return { error: null, idConsultorio: null };
  if (!estado.idConsultorio) return { error: "Elegí con qué consultorio comparte la agenda.", idConsultorio: null };
  if (estado.idConsultorio === "__nuevo") {
    const res = await guardarConsultorio({ nombre: estado.nombreNuevo, linkReserva: estado.linkReserva, linkReservaOnline: estado.linkReservaOnline });
    return { error: res.error, idConsultorio: res.id ?? null };
  }
  const actual = consultorios.consultorios.find((c) => c.id_consultorio === estado.idConsultorio);
  if (
    actual &&
    ((actual.link_reserva ?? "") !== estado.linkReserva || (actual.link_reserva_online ?? "") !== estado.linkReservaOnline)
  ) {
    const res = await guardarConsultorio({
      idConsultorio: actual.id_consultorio,
      nombre: actual.nombre,
      linkReserva: estado.linkReserva,
      linkReservaOnline: estado.linkReservaOnline,
    });
    if (res.error) return { error: res.error, idConsultorio: null };
  }
  return { error: null, idConsultorio: estado.idConsultorio };
}

function SelectorAgenda({
  estado,
  onChange,
  consultorios,
  nombresPorConsultorio,
  nombrePropio,
}: {
  estado: EstadoAgenda;
  onChange: (estado: EstadoAgenda) => void;
  consultorios: DatosConsultorios;
  nombresPorConsultorio: Record<string, string[]>;
  nombrePropio: string | null;
}) {
  const set = (cambios: Partial<EstadoAgenda>) => onChange({ ...estado, ...cambios });
  function elegirConsultorio(id: string) {
    const c = consultorios.consultorios.find((x) => x.id_consultorio === id);
    set({ idConsultorio: id, linkReserva: c?.link_reserva ?? "", linkReservaOnline: c?.link_reserva_online ?? "" });
  }
  const opciones: { modo: EstadoAgenda["modo"]; titulo: string; bajada: string }[] = [
    { modo: "propia", titulo: "Agenda propia", bajada: "Tiene su propio link de turnos." },
    { modo: "compartida", titulo: "Agenda compartida", bajada: "Atiende en un consultorio con otros y usan el mismo link." },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {opciones.map((o) => {
          const on = estado.modo === o.modo;
          return (
            <button
              type="button"
              key={o.modo}
              onClick={() => set({ modo: o.modo })}
              className={`text-left rounded-xl border px-3 py-2.5 ${on ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white"}`}
            >
              <span className={`block text-sm font-bold ${on ? "text-accent-dark" : "text-neutral-800"}`}>{o.titulo}</span>
              <span className="block text-xs text-neutral-500">{o.bajada}</span>
            </button>
          );
        })}
      </div>
      {estado.modo === "compartida" && (
        <div className="rounded-xl border border-neutral-200 bg-white p-3 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Consultorio</label>
            <select
              value={estado.idConsultorio}
              onChange={(e) => elegirConsultorio(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="">Elegí uno…</option>
              {consultorios.consultorios.map((c) => {
                const otros = (nombresPorConsultorio[c.id_consultorio] ?? []).filter((n) => n !== nombrePropio);
                return (
                  <option key={c.id_consultorio} value={c.id_consultorio}>
                    {c.nombre}
                    {otros.length > 0 ? ` — con ${otros.join(", ")}` : ""}
                  </option>
                );
              })}
              <option value="__nuevo">+ Nuevo consultorio</option>
            </select>
          </div>
          {estado.idConsultorio === "__nuevo" && (
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre del consultorio</label>
              <input
                value={estado.nombreNuevo}
                onChange={(e) => set({ nombreNuevo: e.target.value })}
                placeholder="Ej: Consultorio Raíz"
                className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
          )}
          {estado.idConsultorio && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Link de turnos — Presencial</label>
                <input
                  value={estado.linkReserva}
                  onChange={(e) => set({ linkReserva: e.target.value })}
                  placeholder="Cal.com, Google Calendar o WhatsApp"
                  className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Link de turnos — Online</label>
                <input
                  value={estado.linkReservaOnline}
                  onChange={(e) => set({ linkReservaOnline: e.target.value })}
                  placeholder="Para turnos por videollamada"
                  className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <p className="sm:col-span-2 text-[11px] text-neutral-400">
                Estos links son los del consultorio: si los cambiás acá, cambian para todo el consultorio.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PROFESIONES_BASE = ["Nutricionista", "Entrenador/a", "Kinesiólogo/a", "Psicólogo/a"];

// El alta pide solo lo justo para que exista: quién es, cómo ubicarla, qué
// hace y con qué agenda atiende. La foto, la presentación y todo lo que se
// ve en la pantalla del local se completan después, en su ficha.
function FormNuevoProfesional({
  categorias,
  consultorios,
  nombresPorConsultorio,
  onCreado,
}: {
  categorias: string[];
  consultorios: DatosConsultorios;
  nombresPorConsultorio: Record<string, string[]>;
  onCreado: (id: string) => void;
}) {
  const opciones = [...new Set([...PROFESIONES_BASE, ...categorias])];
  const [profesion, setProfesion] = useState(opciones[0]);
  const [otraProfesion, setOtraProfesion] = useState("");
  const [agenda, setAgenda] = useState<EstadoAgenda>(() => agendaInicial(consultorios, null));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("categoria", profesion === "__otra" ? otraProfesion.trim() : profesion);
    setGuardando(true);
    try {
      if (consultorios.disponible) {
        const resAgenda = await resolverAgenda(agenda, consultorios);
        if (resAgenda.error) {
          setError(resAgenda.error);
          return;
        }
        if (resAgenda.idConsultorio) formData.set("id_consultorio", resAgenda.idConsultorio);
      }
      const res = await crearProfesional(formData);
      if (res.error) setError(res.error);
      else if (res.id) onCreado(res.id);
    } finally {
      setGuardando(false);
    }
  }

  const campo = "w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm";
  return (
    <form onSubmit={handleSubmit} className="bg-white border border-neutral-200 rounded-2xl p-5 mb-5 flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-neutral-900">Nuevo profesional</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Lo básico para darlo de alta. La foto, la presentación y lo que se ve en la pantalla del local se completan después.
        </p>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre</label>
          <input name="nombre" required className={campo} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Apellido</label>
          <input name="apellido" className={campo} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">DNI</label>
          <input name="dni" inputMode="numeric" className={campo} />
          <p className="text-[11px] text-neutral-400 mt-1">Para que pueda pagar en caja con su saldo.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">WhatsApp</label>
          <input name="telefono" inputMode="tel" className={campo} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-neutral-600 mb-1">Mail</label>
          <input name="email" type="email" className={campo} />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-600 mb-1.5">Profesión</p>
        <div className="flex flex-wrap gap-2">
          {[...opciones, "__otra"].map((o) => {
            const on = profesion === o;
            return (
              <button
                type="button"
                key={o}
                onClick={() => setProfesion(o)}
                className={`text-sm px-3 py-1.5 rounded-lg border ${
                  on ? "border-accent bg-accent-tint text-accent-dark font-semibold" : "border-neutral-200 text-neutral-700"
                }`}
              >
                {o === "__otra" ? "Otra" : o}
              </button>
            );
          })}
        </div>
        {profesion === "__otra" && (
          <input
            value={otraProfesion}
            onChange={(e) => setOtraProfesion(e.target.value)}
            placeholder="¿Cuál?"
            required
            className={`${campo} mt-2 max-w-xs`}
          />
        )}
      </div>

      {consultorios.disponible && (
        <div>
          <p className="text-xs font-medium text-neutral-600 mb-1.5">Agenda de turnos</p>
          <SelectorAgenda
            estado={agenda}
            onChange={setAgenda}
            consultorios={consultorios}
            nombresPorConsultorio={nombresPorConsultorio}
            nombrePropio={null}
          />
        </div>
      )}

      <div className="max-w-xs">
        <label className="block text-xs font-medium text-neutral-600 mb-1">Código para sus pacientes (opcional)</label>
        <input name="codigo" placeholder="Ej: MARINA10" className={`${campo} font-mono uppercase`} />
        <p className="text-[11px] text-neutral-400 mt-1">Si hace falta, el vencimiento y el límite de usos se cargan después.</p>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm">
          {guardando ? "Guardando..." : "Crear y completar su perfil"}
        </button>
      </div>
    </form>
  );
}

const OPCIONES_TIPO_FORMACION = ["Carrera universitaria", "Posgrado", "Especialización", "Diplomatura", "Curso", "Certificación"];

// ===================== FICHA DEL PROFESIONAL =====================
// Una ventana en el medio de la pantalla, con una pestaña por parte de la
// ficha. Antes era un formulario de veinte campos seguidos debajo de una fila:
// no se veía qué faltaba ni cómo iba a quedar en la pantalla del local.

type Pestana = "resumen" | "datos" | "perfil" | "ayuda" | "turnos" | "fotos" | "historia" | "conoceme";

const PESTANAS: { clave: Pestana; icono: string; label: string }[] = [
  { clave: "resumen", icono: "📊", label: "Resumen" },
  { clave: "datos", icono: "👤", label: "Datos personales" },
  { clave: "perfil", icono: "⭐", label: "Perfil" },
  { clave: "ayuda", icono: "🎯", label: "En qué ayuda" },
  { clave: "turnos", icono: "📅", label: "Turnos" },
  { clave: "fotos", icono: "📸", label: "Fotos" },
  { clave: "historia", icono: "🎓", label: "Historia" },
  { clave: "conoceme", icono: "🎞️", label: "Conóceme" },
];

// A qué pestaña lleva cada cosa que falta para que el perfil esté completo.
const PESTANA_DE_ITEM: Record<string, Pestana> = {
  Foto: "perfil",
  "Título y especialidad": "perfil",
  "Presentación corta": "perfil",
  Fortalezas: "ayuda",
  "Cómo puede ayudarte": "ayuda",
  "Atención y reserva": "turnos",
};

const INPUT =
  "w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent";

// ---------- Profesionales del mes y las reglas de los objetivos ----------

function PanelDelMes({ onAbrir }: { onAbrir: (id: string) => void }) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof profesionalesDelMes>> | null>(null);
  const [abierto, setAbiertoPanel] = useState(false);
  const [objetivo, setObjetivo] = useState("");
  const [destacada, setDestacada] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cargar = useCallback(() => {
    profesionalesDelMes()
      .then((d) => {
        setDatos(d);
        setObjetivo(String(d.reglas.objetivoSemanal));
        setDestacada(String(d.reglas.pacientesDestacada));
      })
      .catch(() => setDatos(null));
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  function guardar() {
    setMensaje(null);
    setGuardando(true);
    guardarReglasProfesionales(Number(objetivo), Number(destacada))
      .then((r) => {
        setMensaje(r.error ?? "Guardado. Vale desde ahora para todas.");
        if (!r.error) cargar();
      })
      .finally(() => setGuardando(false));
  }

  if (!datos) return null;
  const conMovimiento = datos.filas.filter((f) => f.vistas > 0 || f.pacientes > 0);

  return (
    <section className="bg-white border border-neutral-200 rounded-2xl mb-5 overflow-hidden">
      <button type="button" onClick={() => setAbiertoPanel((v) => !v)} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left">
        <span>
          <span className="block text-[15px] font-extrabold text-neutral-900">Profesionales del mes</span>
          <span className="block text-xs text-neutral-500">
            Quién trae más pacientes y a quién miran más en la pantalla. Sin premios en plata: el premio es que su ficha salga destacada.
          </span>
        </span>
        <span className="text-sm text-neutral-400">{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && (
        <div className="px-5 pb-5 flex flex-col gap-4">
          {!datos.hayVisitas && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Para contar las visitas en la pantalla falta correr <b>sql/profesionales-visitas.sql</b> en Supabase.
            </p>
          )}
          {conMovimiento.length === 0 ? (
            <p className="text-sm text-neutral-400">Este mes todavía no hay movimiento.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-neutral-500 text-left">
                    <th className="pb-2 font-bold">Profesional</th>
                    <th className="pb-2 font-bold text-right">Vieron su ficha</th>
                    <th className="pb-2 font-bold text-right">Pacientes</th>
                    <th className="pb-2 font-bold text-right">Vendido</th>
                  </tr>
                </thead>
                <tbody>
                  {conMovimiento.map((f) => (
                    <tr key={f.idProfesional} className="border-t border-neutral-100">
                      <td className="py-2">
                        <button type="button" onClick={() => onAbrir(f.idProfesional)} className="flex items-center gap-2 font-semibold text-neutral-800 hover:underline">
                          {f.foto ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={f.foto} alt="" className="w-7 h-7 rounded-full object-cover" />
                          ) : (
                            <span className="w-7 h-7 rounded-full bg-neutral-100" />
                          )}
                          {f.nombre}
                          {f.destacada && <span className="text-[10px] font-bold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Destacada</span>}
                        </button>
                      </td>
                      <td className="py-2 text-right tabular-nums">{f.vistas}</td>
                      <td className="py-2 text-right tabular-nums">{f.pacientes}</td>
                      <td className="py-2 text-right tabular-nums">${formatearMonto(f.vendido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-neutral-100 pt-4 flex flex-col gap-3">
            <p className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Las reglas, las ponés vos</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
                Objetivo de la semana (pacientes con su código)
                <input value={objetivo} onChange={(e) => setObjetivo(e.target.value)} inputMode="numeric" className="w-24 border border-neutral-300 rounded-lg px-3 py-1.5 text-sm tabular-nums" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
                Pacientes en el mes para que su ficha salga destacada
                <input value={destacada} onChange={(e) => setDestacada(e.target.value)} inputMode="numeric" className="w-24 border border-neutral-300 rounded-lg px-3 py-1.5 text-sm tabular-nums" />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={guardar} disabled={guardando} className="bg-accent text-white text-sm font-bold rounded-lg px-4 py-1.5 disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar reglas"}
              </button>
              {mensaje && <span className="text-sm text-neutral-600">{mensaje}</span>}
            </div>
            <p className="text-xs text-neutral-500">Las fichas destacadas aparecen primero en la pantalla del local.</p>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- Su usuario (su espacio en /mi-espacio) ----------

// Una contraseña fácil de dictar por WhatsApp: su nombre sin acentos y cuatro números.
function contrasenaSugerida(nombre: string) {
  const base = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z]/g, "").slice(0, 8) || "WiiGo";
  const numeros = String(Math.floor(1000 + Math.random() * 9000));
  return `${base.charAt(0).toUpperCase()}${base.slice(1).toLowerCase()}-${numeros}`;
}

// wa.me necesita el número con código de país. En Argentina, los celulares
// van con 549 adelante: un número de 10 dígitos (261 555-0123) se completa solo.
function linkWhatsApp(telefono: string | null, texto: string) {
  let numero = (telefono ?? "").replace(/\D/g, "");
  if (numero.startsWith("0")) numero = numero.slice(1);
  if (numero.length === 10) numero = `549${numero}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function TarjetaUsuarioProfesional({ profesional }: { profesional: Profesional }) {
  const id = profesional.id_profesional;
  const [datos, setDatos] = useState<UsuarioDeProfesional | null>(null);
  const [email, setEmail] = useState(profesional.email ?? "");
  const [clave, setClave] = useState(() => contrasenaSugerida(profesional.nombre));
  const [cambiandoClave, setCambiandoClave] = useState(false);
  // La contraseña recién creada o cambiada: es la única vez que se puede
  // mandar, porque después queda guardada cifrada y nadie la puede leer.
  const [paraMandar, setParaMandar] = useState<{ email: string; clave: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    usuarioDeProfesional(id)
      .then(setDatos)
      .catch(() => setDatos({ disponible: true, usuario: null, autorizoImagenAt: null, actividad: [] }));
  }, [id]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  function crear() {
    setError(null);
    setGuardando(true);
    crearUsuarioProfesional(id, email, clave)
      .then((r) => {
        if (r.error) return setError(r.error);
        setParaMandar({ email: email.trim().toLowerCase(), clave });
        cargar();
      })
      .finally(() => setGuardando(false));
  }

  function guardarClave() {
    setError(null);
    setGuardando(true);
    cambiarClaveUsuarioProfesional(id, clave)
      .then((r) => {
        if (r.error) return setError(r.error);
        setParaMandar({ email: datos?.usuario?.email ?? "", clave });
        setCambiandoClave(false);
      })
      .finally(() => setGuardando(false));
  }

  function cambiarEstado(activo: boolean) {
    if (!activo && !confirm(`¿Dar de baja el usuario de ${profesional.nombre}? Deja de poder entrar a su espacio.`)) return;
    setError(null);
    cambiarEstadoUsuarioProfesional(id, activo).then((r) => (r.error ? setError(r.error) : cargar()));
  }

  const mensaje = paraMandar
    ? `Hola ${profesional.nombre}! Te armé tu usuario de WiiGo para que completes tu ficha de la pantalla del local.\n\nEntrá en ${typeof window !== "undefined" ? window.location.origin : "app.wiigo.com.ar"}\nMail: ${paraMandar.email}\nContraseña: ${paraMandar.clave}`
    : "";
  const usuario = datos?.usuario ?? null;
  const activo = usuario?.estado === "ACTIVO";

  return (
    <Tarjeta titulo="Su usuario" bajada="Con esto entra a su espacio a completar su ficha. Lo que sale en la pantalla del local lo aprobás vos.">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
      {!datos ? (
        <p className="text-sm text-neutral-400">Cargando...</p>
      ) : !datos.disponible ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Para darle usuario falta correr <b>sql/profesionales-usuario.sql</b> en Supabase.
        </p>
      ) : !usuario ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-600">Todavía no tiene usuario.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
              Mail para entrar
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="su mail"
                className="border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
              Contraseña
              <span className="flex gap-2">
                <input
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  className="flex-1 min-w-0 border border-neutral-300 rounded-lg px-3 py-2 text-sm font-mono text-neutral-900"
                />
                <button type="button" onClick={() => setClave(contrasenaSugerida(profesional.nombre))} className="text-xs font-semibold text-accent px-2">
                  Inventar otra
                </button>
              </span>
            </label>
          </div>
          <div>
            <button
              type="button"
              onClick={crear}
              disabled={guardando}
              className="bg-accent text-white text-sm font-bold rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {guardando ? "Creando..." : "Crear usuario"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
            <span className={`w-2 h-2 rounded-full ${activo ? "bg-emerald-500" : "bg-neutral-300"}`} />
            {activo ? "Activo" : "Dado de baja"} · {usuario.email}
            {usuario.ultimoIngreso && <span className="font-normal text-neutral-500">· entró el {fechaCorta(usuario.ultimoIngreso)}</span>}
            {!usuario.ultimoIngreso && <span className="font-normal text-neutral-500">· todavía no entró</span>}
          </p>
          <p className="text-xs text-neutral-500">
            {datos.autorizoImagenAt
              ? `Autorizó el uso de su imagen el ${fechaCorta(datos.autorizoImagenAt)}.`
              : "Todavía no aceptó la autorización de imagen: se la pide la primera vez que entra."}
          </p>

          {cambiandoClave && (
            <div className="flex flex-wrap gap-2 items-center">
              <input
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                className="w-48 border border-neutral-300 rounded-lg px-3 py-1.5 text-sm font-mono"
              />
              <button type="button" onClick={() => setClave(contrasenaSugerida(profesional.nombre))} className="text-xs font-semibold text-accent">
                Inventar otra
              </button>
              <button type="button" onClick={guardarClave} disabled={guardando} className="bg-accent text-white text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50">
                Guardar
              </button>
              <button type="button" onClick={() => setCambiandoClave(false)} className="text-xs text-neutral-500">
                Cancelar
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!cambiandoClave && (
              <button type="button" onClick={() => setCambiandoClave(true)} className="text-sm font-semibold border border-neutral-200 rounded-lg px-3 py-1.5 bg-white">
                Cambiar contraseña
              </button>
            )}
            <button
              type="button"
              onClick={() => cambiarEstado(!activo)}
              className="text-sm font-semibold border border-neutral-200 rounded-lg px-3 py-1.5 bg-white text-neutral-600"
            >
              {activo ? "Dar de baja el usuario" : "Volver a activarlo"}
            </button>
          </div>

          <div>
            <p className="text-xs font-bold text-neutral-500 uppercase tracking-wide mb-1.5">Todo lo que hizo</p>
            {datos.actividad.length === 0 ? (
              <p className="text-sm text-neutral-400">Todavía nada.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-neutral-100">
                {datos.actividad.map((a, i) => (
                  <li key={i} className="flex gap-3 py-1.5 text-sm">
                    <span className="w-24 shrink-0 text-xs text-neutral-400 tabular-nums pt-0.5">{fechaCorta(a.fecha)}</span>
                    <span className="text-neutral-800">
                      {a.accion}
                      {a.esperaAprobacion && (
                        <span className="ml-2 text-[11px] font-bold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">esperando tu OK</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {paraMandar && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex flex-wrap items-center gap-3">
          <p className="text-sm text-emerald-900 flex-1 min-w-[200px]">
            Listo. Mandale los datos ahora: la contraseña después no se puede volver a ver.
          </p>
          <a
            href={linkWhatsApp(profesional.telefono, mensaje)}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-[#25a35a] text-white text-sm font-bold rounded-lg px-3 py-1.5"
          >
            Mandarle los datos por WhatsApp
          </a>
        </div>
      )}
    </Tarjeta>
  );
}

function Tarjeta({ titulo, bajada, children }: { titulo: string; bajada?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-neutral-200 rounded-2xl p-5 flex flex-col gap-4">
      <div>
        <h3 className="text-[15px] font-extrabold text-neutral-900">{titulo}</h3>
        {bajada && <p className="text-xs text-neutral-500 mt-0.5">{bajada}</p>}
      </div>
      {children}
    </section>
  );
}

function Campo({
  label,
  nota,
  ancho = false,
  children,
}: {
  label: string;
  nota?: string;
  ancho?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${ancho ? "sm:col-span-2" : ""}`}>
      <span className="flex items-center justify-between gap-2 text-xs font-semibold text-neutral-600">
        {label}
        {nota && <span className="font-medium text-neutral-400">{nota}</span>}
      </span>
      {children}
    </label>
  );
}

// Fotos, formación, trayectoria y filminas se guardan solas al tocar su botón.
// Lo que se escribe ahí no tiene que marcar "hay cambios sin guardar" en la ficha.
function GuardaSola({ children }: { children: React.ReactNode }) {
  return <div onChange={(e) => e.stopPropagation()}>{children}</div>;
}

// Una versión chica de la ficha del asesor, con lo que se está escribiendo:
// así se ve el resultado antes de guardar.
function VistaPreviaKiosco({
  foto,
  nombre,
  titulo,
  especialidad,
  matricula,
  bio,
  fortalezas,
  tieneTurno,
}: {
  foto: string | null;
  nombre: string;
  titulo: string;
  especialidad: string;
  matricula: string;
  bio: string;
  fortalezas: { nombre: string; principal: boolean }[];
  tieneTurno: boolean;
}) {
  const verde = "#2d585b";
  return (
    <div className="lg:sticky lg:top-0 flex flex-col gap-2">
      <p className="text-[11px] font-bold uppercase tracking-[.1em] text-neutral-400">Así se ve en la pantalla del local</p>
      <div className="rounded-2xl overflow-hidden border-[6px] border-[#1f2a2c]" style={{ background: "#f7f9f2" }}>
        <div className="relative h-48" style={{ background: "linear-gradient(155deg, #8fa584 0%, #2d585b 100%)" }}>
          {foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-4xl font-extrabold text-white/70">
              {nombre.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="absolute inset-x-0 bottom-0 p-3" style={{ background: "linear-gradient(180deg, transparent, rgba(0,0,0,.55))" }}>
            <p className="text-white text-xl italic font-semibold leading-tight" style={{ fontFamily: "Georgia, serif" }}>
              {nombre}
            </p>
            {(titulo || especialidad) && (
              <p className="text-[9px] font-extrabold uppercase tracking-[.14em] text-white/90 mt-1">
                {[titulo, especialidad].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
        <div className="p-3 flex flex-col gap-2">
          {matricula && (
            <span className="self-start text-[10px] font-extrabold rounded-full px-2.5 py-0.5" style={{ background: "#e9f1f2", color: verde }}>
              ✓ Matrícula {matricula}
            </span>
          )}
          {bio ? (
            <p className="text-[11.5px] italic text-neutral-700 border-l-2 pl-2 line-clamp-3" style={{ borderColor: "#b36b4a" }}>
              {bio}
            </p>
          ) : (
            <p className="text-[11px] text-amber-700 border border-dashed border-amber-400 rounded-lg px-2 py-1">+ presentación corta</p>
          )}
          <div className="flex flex-wrap gap-1">
            {fortalezas.length > 0 ? (
              fortalezas.map((f) => (
                <span key={f.nombre} className="text-[9.5px] font-bold rounded-full px-2 py-0.5" style={{ background: "#e9f1f2", color: verde }}>
                  {f.principal ? "★ " : ""}
                  {f.nombre}
                </span>
              ))
            ) : (
              <span className="text-[9.5px] font-bold rounded-full px-2 py-0.5 text-amber-700 border border-dashed border-amber-400">+ fortalezas</span>
            )}
          </div>
          {tieneTurno ? (
            <span className="text-center text-xs font-extrabold text-white rounded-full py-2" style={{ background: verde }}>
              📅 Reservar turno
            </span>
          ) : (
            <span className="text-center text-[11px] text-amber-700 border border-dashed border-amber-400 rounded-full py-1.5">+ link de turnos</span>
          )}
        </div>
      </div>
      <p className="text-xs text-neutral-500">Cambia mientras escribís. Se publica al guardar.</p>
    </div>
  );
}

function FichaProfesional({
  profesional,
  fila,
  objetivosGlobales,
  codigos,
  consultorios,
  nombresPorConsultorio,
  categorias,
  pestanaInicial = "resumen",
  onCambio,
  onCerrar,
}: {
  profesional: Profesional;
  fila: FilaResumen;
  objetivosGlobales: Objetivo[];
  codigos: Codigo[];
  consultorios: DatosConsultorios;
  nombresPorConsultorio: Record<string, string[]>;
  categorias: string[];
  pestanaInicial?: Pestana;
  onCambio: () => void;
  onCerrar: () => void;
}) {
  const id = profesional.id_profesional;
  const formId = `ficha-${id}`;
  const activo = profesional.estado === "ACTIVO";

  const [pestana, setPestana] = useState<Pestana>(pestanaInicial);
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mostrarPin, setMostrarPin] = useState(false);
  const [publicado, setPublicado] = useState(profesional.publicado);

  // Lo que alimenta la vista previa y el porcentaje va controlado; el resto
  // del formulario se lee al guardar.
  const [nombre, setNombre] = useState(profesional.nombre);
  const [apellido, setApellido] = useState(profesional.apellido ?? "");
  const [dni, setDni] = useState(profesional.dni ?? "");
  const [categoria, setCategoria] = useState(profesional.categoria ?? "");
  const [escribiendoProfesion, setEscribiendoProfesion] = useState(false);
  const [matricula, setMatricula] = useState(profesional.matricula ?? "");
  const [titulo, setTitulo] = useState(profesional.titulo ?? "");
  const [especialidad, setEspecialidad] = useState(profesional.especialidad ?? "");
  const [bio, setBio] = useState(profesional.bio ?? "");
  const [foto, setFoto] = useState(profesional.foto);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [tipoAtencion, setTipoAtencion] = useState(profesional.tipo_atencion ?? "");
  const [linkPropio, setLinkPropio] = useState(profesional.link_reserva ?? "");
  const [linkPropioOnline, setLinkPropioOnline] = useState(profesional.link_reserva_online ?? "");
  const [agenda, setAgenda] = useState<EstadoAgenda>(() => agendaInicial(consultorios, id));

  const [catalogoFortalezas, setCatalogoFortalezas] = useState<FortalezaProfesional[]>([]);
  const [fortalezasSeleccionadas, setFortalezasSeleccionadas] = useState<Set<string>>(new Set());
  const [fortalezaPrincipal, setFortalezaPrincipal] = useState<string | null>(null);
  const [nuevaFortaleza, setNuevaFortaleza] = useState("");
  const [objetivosSeleccionados, setObjetivosSeleccionados] = useState<Set<string>>(new Set());

  const [saldos, setSaldos] = useState<SaldoMarca[]>([]);
  const [canjes, setCanjes] = useState<CanjeFila[]>([]);
  const [ventasGeneradas, setVentasGeneradas] = useState<VentaGeneradaFila[]>([]);
  const [cargandoResumen, setCargandoResumen] = useState(true);
  const [mostrarCodigoForm, setMostrarCodigoForm] = useState(false);
  const [canjeAbierto, setCanjeAbierto] = useState<string | null>(null);

  const cargarResumen = useCallback(
    () =>
      Promise.all([saldosDeProfesional(id), canjesDeProfesional(id), ventasGeneradasDeProfesional(id)])
        .then(([s, c, v]) => {
          setSaldos(s);
          setCanjes(c as CanjeFila[]);
          setVentasGeneradas(v);
        })
        .finally(() => setCargandoResumen(false)),
    [id]
  );

  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);

  useEffect(() => {
    Promise.all([listarFortalezas(), listarFortalezasDeProfesional(id), listarObjetivosDeProfesional(id)]).then(
      ([catalogo, propias, objetivos]) => {
        setCatalogoFortalezas(catalogo as FortalezaProfesional[]);
        const porId = new Map((catalogo as FortalezaProfesional[]).map((f) => [f.id_fortaleza, f.nombre]));
        const nombresPropios = new Set<string>();
        let principal: string | null = null;
        (propias as { id_fortaleza: string; principal: boolean }[]).forEach((p) => {
          const n = porId.get(p.id_fortaleza);
          if (!n) return;
          nombresPropios.add(n);
          if (p.principal) principal = n;
        });
        setFortalezasSeleccionadas(nombresPropios);
        setFortalezaPrincipal(principal);
        setObjetivosSeleccionados(new Set(objetivos));
      }
    );
  }, [id]);

  const intentarCerrar = useCallback(() => {
    if (sucio && !confirm("Tenés cambios sin guardar. ¿Cerrar igual?")) return;
    onCerrar();
  }, [sucio, onCerrar]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") intentarCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [intentarCerrar]);

  useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, []);

  function cambio() {
    setSucio(true);
    setGuardado(false);
  }

  const nombreCompleto = `${nombre}${apellido ? ` ${apellido}` : ""}`;
  const linkConsultorio = agenda.modo === "compartida" ? agenda.linkReserva || agenda.linkReservaOnline || null : null;
  const completitud = calcularCompletitud(
    {
      ...profesional,
      foto,
      titulo,
      especialidad,
      bio,
      tipo_atencion: tipoAtencion,
      link_reserva: agenda.modo === "propia" ? linkPropio || linkPropioOnline : null,
    },
    fortalezasSeleccionadas.size > 0,
    objetivosSeleccionados.size > 0,
    linkConsultorio
  );
  const faltan = completitud.items.filter((i) => !i.ok);
  const faltaEn = (p: Pestana) => faltan.some((i) => PESTANA_DE_ITEM[i.label] === p);
  const estadoPestana: Partial<Record<Pestana, "ok" | "falta">> = {
    datos: dni ? "ok" : "falta",
    perfil: faltaEn("perfil") ? "falta" : "ok",
    ayuda: faltaEn("ayuda") ? "falta" : "ok",
    turnos: faltaEn("turnos") ? "falta" : "ok",
  };
  const fortalezasVista = [...fortalezasSeleccionadas]
    .map((n) => ({ nombre: n, principal: n === fortalezaPrincipal }))
    .sort((a, b) => Number(b.principal) - Number(a.principal));
  const profesiones = [...new Set([...PROFESIONES_BASE, ...categorias, ...(categoria ? [categoria] : [])])];

  function togglePublicado() {
    const nuevo = !publicado;
    setPublicado(nuevo);
    cambiarPublicacionProfesional(id, nuevo).then((res) => {
      if (res.error) {
        setPublicado(!nuevo);
        setError(res.error);
      } else onCambio();
    });
  }

  function toggleEstado() {
    setMenu(false);
    cambiarEstadoProfesional(id, activo ? "INACTIVO" : "ACTIVO").then(onCambio);
  }

  function toggleEstadoCodigo(codigo: Codigo) {
    cambiarEstadoCodigo(codigo.id_codigo, codigo.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO").then(onCambio);
  }

  function toggleFortaleza(n: string) {
    cambio();
    setFortalezasSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(n)) {
        next.delete(n);
        if (fortalezaPrincipal === n) setFortalezaPrincipal(null);
      } else next.add(n);
      return next;
    });
  }

  function agregarFortalezaNueva() {
    const n = nuevaFortaleza.trim();
    if (!n) return;
    cambio();
    if (!catalogoFortalezas.some((f) => f.nombre.toLowerCase() === n.toLowerCase())) {
      setCatalogoFortalezas((prev) => [...prev, { id_fortaleza: `nueva-${n}`, nombre: n, orden: null, estado: "ACTIVA" }]);
    }
    setFortalezasSeleccionadas((prev) => new Set(prev).add(n));
    setNuevaFortaleza("");
  }

  function toggleObjetivo(idObjetivo: string) {
    cambio();
    setObjetivosSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(idObjetivo)) next.delete(idObjetivo);
      else next.add(idObjetivo);
      return next;
    });
  }

  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    const formData = new FormData();
    formData.set("archivo", archivo);
    setSubiendoFoto(true);
    subirFotoProfesional(id, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else if (res.url) {
          setFoto(res.url);
          onCambio();
        }
      })
      .finally(() => setSubiendoFoto(false));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    try {
      // Primero el consultorio (si es nuevo hay que crearlo para tener su id).
      if (consultorios.disponible) {
        const resAgenda = await resolverAgenda(agenda, consultorios);
        if (resAgenda.error) {
          setError(resAgenda.error);
          setPestana("turnos");
          return;
        }
        formData.set("modo_agenda", agenda.modo);
        formData.set("id_consultorio", resAgenda.idConsultorio ?? "");
      }
      const [r1, r2, r3] = await Promise.all([
        actualizarProfesional(id, formData),
        guardarFortalezasProfesional(
          id,
          [...fortalezasSeleccionadas].map((n) => ({ nombre: n, principal: n === fortalezaPrincipal }))
        ),
        guardarObjetivosProfesional(id, [...objetivosSeleccionados]),
      ]);
      const err = r1.error || r2.error || r3.error;
      if (err) setError(err);
      else {
        setSucio(false);
        setGuardado(true);
        onCambio();
      }
    } finally {
      setGuardando(false);
    }
  }

  const NOTA_PIE: Partial<Record<Pestana, string>> = {
    resumen: "Para editar, tocá una de las pestañas de arriba.",
    fotos: "Las fotos y los videos se guardan solos al subirlos.",
    historia: "La formación y la trayectoria se guardan solas. Su historia, con el botón.",
    conoceme: "Las filminas se guardan solas.",
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center sm:p-6" onClick={intentarCerrar}>
      <div
        role="dialog"
        aria-label={nombreCompleto}
        className="bg-neutral-50 w-full max-w-5xl h-full sm:h-auto sm:max-h-[calc(100vh-3rem)] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => {
          e.stopPropagation();
          if (menu) setMenu(false);
        }}
      >
        {/* ---------- cabecera ---------- */}
        <div className="bg-white border-b border-neutral-200 px-5 sm:px-6 pt-5">
          <div className="flex items-start gap-4 flex-wrap">
            <AvatarConAnillo foto={foto} nombre={nombreCompleto} porcentaje={completitud.porcentaje} tamano={72} />
            <div className="flex-1 min-w-[200px]">
              <h2 className="text-xl font-extrabold text-neutral-900 leading-tight">{nombreCompleto}</h2>
              <p className="text-sm text-neutral-500">
                {[categoria, especialidad].filter(Boolean).join(" · ") || "Sin profesión cargada"}
              </p>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-neutral-500 flex-wrap">
                <span className="w-28 h-1.5 rounded-full bg-neutral-200 overflow-hidden">
                  <span
                    className={`block h-full rounded-full ${completitud.porcentaje === 100 ? "bg-emerald-600" : "bg-amber-500"}`}
                    style={{ width: `${completitud.porcentaje}%` }}
                  />
                </span>
                <b className={completitud.porcentaje === 100 ? "text-emerald-700" : "text-amber-700"}>Perfil {completitud.porcentaje}%</b>
                {faltan.length === 0 ? (
                  <span>· Completo</span>
                ) : (
                  <span>
                    · Le {faltan.length === 1 ? "falta" : "faltan"}:{" "}
                    {faltan.map((i, idx) => (
                      <Fragment key={i.label}>
                        {idx > 0 && (idx === faltan.length - 1 ? " y " : ", ")}
                        <button
                          type="button"
                          onClick={() => setPestana(PESTANA_DE_ITEM[i.label] ?? "perfil")}
                          className="font-bold text-accent hover:underline"
                        >
                          {i.label.toLowerCase()}
                        </button>
                      </Fragment>
                    ))}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePublicado}
                disabled={!activo}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left disabled:opacity-50 ${
                  publicado ? "bg-emerald-50 border-emerald-200" : "bg-neutral-50 border-neutral-200"
                }`}
              >
                <span className={`relative w-9 h-5 rounded-full shrink-0 ${publicado ? "bg-emerald-600" : "bg-neutral-300"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${publicado ? "left-[18px]" : "left-0.5"}`} />
                </span>
                <span>
                  <b className={`block text-xs ${publicado ? "text-emerald-700" : "text-neutral-600"}`}>{publicado ? "Publicado" : "Borrador"}</b>
                  <span className="block text-[11px] text-neutral-500">
                    {publicado ? "Se ve en la pantalla del local" : "No se ve en la pantalla"}
                  </span>
                </span>
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu((v) => !v);
                  }}
                  className="w-9 h-9 rounded-xl border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-900 text-lg leading-none"
                  aria-label="Más opciones"
                >
                  ⋯
                </button>
                {menu && (
                  <div className="absolute right-0 top-11 z-20 bg-white border border-neutral-200 rounded-xl shadow-lg py-1 w-60">
                    <button
                      type="button"
                      onClick={() => {
                        setMostrarPin(true);
                        setMenu(false);
                        setPestana("resumen");
                      }}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-50"
                    >
                      🔒 Cambiar PIN para pagar en caja
                    </button>
                    <button type="button" onClick={toggleEstado} className="block w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                      {activo ? "Desactivar profesional" : "Activar profesional"}
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={intentarCerrar}
                aria-label="Cerrar"
                className="w-9 h-9 rounded-xl text-xl text-neutral-400 hover:text-neutral-900"
              >
                ✕
              </button>
            </div>
          </div>

          <nav role="tablist" aria-label="Partes de la ficha" className="flex gap-1.5 mt-4 pb-3 overflow-x-auto sm:flex-wrap">
            {PESTANAS.map((p) => {
              const on = pestana === p.clave;
              const est = estadoPestana[p.clave];
              return (
                <button
                  key={p.clave}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPestana(p.clave)}
                  className={`shrink-0 flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[13px] font-semibold ${
                    on ? "bg-accent border-accent text-white" : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                  }`}
                >
                  <span aria-hidden="true">{p.icono}</span>
                  {p.label}
                  {est && (
                    <span
                      className={`w-4 h-4 rounded-full grid place-items-center text-[10px] font-extrabold text-white ${
                        est === "ok" ? "bg-emerald-600" : "bg-amber-500"
                      }`}
                    >
                      {est === "ok" ? "✓" : "!"}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ---------- cuerpo ---------- */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">
          {!activo && (
            <p className="text-sm text-neutral-600 bg-neutral-100 rounded-xl px-4 py-2.5 mb-4">
              Este profesional está desactivado: no se ve en la pantalla del local y su código no funciona.
            </p>
          )}
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4">{error}</p>}

          {/* El resumen va fuera del formulario: adentro tiene sus propios formularios (código, pagos). */}
          <div hidden={pestana !== "resumen"}>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white border border-neutral-200 rounded-2xl px-4 py-3">
                  <p className="text-xs font-semibold text-neutral-500">Ventas con su código</p>
                  <p className="text-2xl font-extrabold tabular-nums">{fila.ventasReferidas}</p>
                </div>
                <div className="bg-white border border-neutral-200 rounded-2xl px-4 py-3">
                  <p className="text-xs font-semibold text-neutral-500">Vendido con su código</p>
                  <p className="text-2xl font-extrabold tabular-nums">${formatearMonto(fila.totalVenta)}</p>
                </div>
                <div className="bg-white border border-neutral-200 rounded-2xl px-4 py-3">
                  <p className="text-xs font-semibold text-neutral-500">A pagar</p>
                  <p className={`text-2xl font-extrabold tabular-nums ${fila.comisionPendiente > 0 ? "text-red-600" : "text-neutral-400"}`}>
                    ${formatearMonto(fila.comisionPendiente)}
                  </p>
                </div>
              </div>

              {!profesional.dni && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                  Sin DNI cargado: todavía no puede pagar en caja con su saldo.{" "}
                  <button type="button" onClick={() => setPestana("datos")} className="font-bold underline">
                    Cargarlo
                  </button>
                </p>
              )}
              {mostrarPin && <FormPin idProfesional={id} onGuardado={() => setMostrarPin(false)} />}

              <Tarjeta titulo="Códigos" bajada="Tocá un código para pausarlo o volver a activarlo.">
                <div className="flex flex-wrap gap-2 items-center">
                  {codigos.length === 0 && <span className="text-sm text-neutral-400">Sin códigos todavía.</span>}
                  {codigos.map((c) => (
                    <button
                      type="button"
                      key={c.id_codigo}
                      onClick={() => toggleEstadoCodigo(c)}
                      className={`text-sm font-mono font-bold px-2.5 py-1 rounded-lg ${
                        c.estado === "ACTIVO" ? "bg-accent-tint text-accent-dark" : "bg-neutral-100 text-neutral-400 line-through"
                      }`}
                    >
                      {c.codigo} {c.limite_usos != null && `(${c.usos}/${c.limite_usos})`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setMostrarCodigoForm((v) => !v)}
                    className="text-sm font-semibold text-accent border border-neutral-200 rounded-lg px-3 py-1 bg-white"
                  >
                    {mostrarCodigoForm ? "Cancelar" : "+ Agregar código"}
                  </button>
                </div>
                {mostrarCodigoForm && (
                  <FormNuevoCodigo
                    idProfesional={id}
                    onCreado={() => {
                      setMostrarCodigoForm(false);
                      onCambio();
                    }}
                  />
                )}
              </Tarjeta>

              <TarjetaUsuarioProfesional profesional={profesional} />

              <Tarjeta titulo="Saldo por marca" bajada="Cada marca es una bolsa aparte: no se puede gastar el saldo de una en otra.">
                {cargandoResumen ? (
                  <p className="text-sm text-neutral-400">Cargando...</p>
                ) : saldos.length === 0 ? (
                  <p className="text-sm text-neutral-400">Todavía no generó saldo en ninguna marca.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {saldos.map((s) => (
                      <FilaSaldoMarca
                        key={s.idMarca}
                        idProfesional={id}
                        saldo={s}
                        onCambio={() => {
                          cargarResumen();
                          onCambio();
                        }}
                      />
                    ))}
                  </div>
                )}
              </Tarjeta>

              <Tarjeta titulo="Ventas con su código" bajada="Las ventas donde se usó su código: es lo que le fue sumando saldo.">
                {cargandoResumen ? (
                  <p className="text-sm text-neutral-400">Cargando...</p>
                ) : ventasGeneradas.length === 0 ? (
                  <p className="text-sm text-neutral-400">
                    Todavía no hay ventas con su código. Si esperabas ver una, fijate que la marca de esos productos tenga el programa
                    habilitado en &ldquo;Configuración por marca&rdquo;.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-neutral-400 border-b border-neutral-200">
                          <th className="py-2 pr-3">Fecha</th>
                          <th className="py-2 pr-3">Venta</th>
                          <th className="py-2 pr-3 text-right">Total</th>
                          <th className="py-2 text-right">Comisión</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ventasGeneradas.map((v) => (
                          <tr key={v.idReferido} className="border-b border-neutral-100 last:border-0">
                            <td className="py-2 pr-3 whitespace-nowrap text-neutral-500">
                              {new Date(v.fecha).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            </td>
                            <td className="py-2 pr-3">{v.numeroVenta ? `#${v.numeroVenta}` : "—"}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">${formatearMonto(v.totalVenta)}</td>
                            <td className="py-2 text-right tabular-nums font-semibold text-emerald-600">+${formatearMonto(v.comisionGenerada)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Tarjeta>

              <Tarjeta titulo="Pagos y canjes">
                {cargandoResumen ? (
                  <p className="text-sm text-neutral-400">Cargando...</p>
                ) : canjes.length === 0 ? (
                  <p className="text-sm text-neutral-400">Todavía no se le pagó ni canjeó nada.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-neutral-400 border-b border-neutral-200">
                          <th className="py-2 pr-3">Fecha</th>
                          <th className="py-2 pr-3">Marca</th>
                          <th className="py-2 pr-3">Tipo</th>
                          <th className="py-2 pr-3 text-right">Monto</th>
                          <th className="py-2">Venta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {canjes.map((c) => {
                          const abierto = canjeAbierto === c.idMovimiento;
                          return (
                            <Fragment key={c.idMovimiento}>
                              <tr
                                onClick={() => c.idVenta && setCanjeAbierto(abierto ? null : c.idMovimiento)}
                                className={`border-b border-neutral-100 last:border-0 ${c.idVenta ? "cursor-pointer hover:bg-neutral-50" : ""}`}
                              >
                                <td className="py-2 pr-3 whitespace-nowrap text-neutral-500">{formatearFechaHora(c.fecha)}</td>
                                <td className="py-2 pr-3">{c.nombreMarca}</td>
                                <td className="py-2 pr-3">
                                  <span className={`font-semibold ${c.tipo === "CANJE" ? "text-purple-600" : "text-emerald-600"}`}>
                                    {c.tipo === "CANJE" ? "Canje" : "Pago"}
                                  </span>
                                </td>
                                <td className="py-2 pr-3 text-right tabular-nums font-semibold">${formatearMonto(c.monto)}</td>
                                <td className="py-2">
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
                  </div>
                )}
              </Tarjeta>

              {(profesional.telefono || profesional.email) && (
                <p className="text-xs text-neutral-500">
                  {profesional.telefono && <span className="mr-4">📞 {profesional.telefono}</span>}
                  {profesional.email && <span>✉️ {profesional.email}</span>}
                </p>
              )}
            </div>
          </div>

          {/* Todas las pestañas que se editan son un solo formulario: las
              escondidas siguen montadas, así nada se pierde al cambiar de pestaña. */}
          <form id={formId} onSubmit={handleSubmit} onChange={cambio}>
            {publicado && <input type="hidden" name="publicado" value="on" />}
            <input type="hidden" name="categoria" value={categoria} />
            <input type="hidden" name="tipo_atencion" value={tipoAtencion} />

            {/* ---------- datos personales ---------- */}
            <div hidden={pestana !== "datos"}>
              <Tarjeta titulo="Datos personales" bajada="Para ubicarla y para que pueda pagar en caja con su saldo.">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  <Campo label="Nombre">
                    <input name="nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} />
                  </Campo>
                  <Campo label="Apellido">
                    <input name="apellido" value={apellido} onChange={(e) => setApellido(e.target.value)} className={INPUT} />
                  </Campo>
                  <Campo label="DNI" nota="🔒 privado">
                    <input name="dni" inputMode="numeric" value={dni} onChange={(e) => setDni(e.target.value)} className={INPUT} />
                  </Campo>
                  <Campo label="Fecha de nacimiento" nota="🔒 privado">
                    <input name="fecha_nacimiento" type="date" defaultValue={profesional.fecha_nacimiento ?? ""} className={INPUT} />
                  </Campo>
                  <Campo label="Mail">
                    <input name="email" type="email" defaultValue={profesional.email ?? ""} className={INPUT} />
                  </Campo>
                  <Campo label="WhatsApp" nota="🔒 privado">
                    <input name="telefono" inputMode="tel" defaultValue={profesional.telefono ?? ""} className={INPUT} />
                  </Campo>
                  <div className="sm:col-span-2 flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-neutral-600">Profesión</span>
                    <div className="flex flex-wrap gap-2">
                      {profesiones.map((o) => {
                        const on = !escribiendoProfesion && categoria === o;
                        return (
                          <button
                            type="button"
                            key={o}
                            onClick={() => {
                              cambio();
                              setEscribiendoProfesion(false);
                              setCategoria(o);
                            }}
                            className={`text-sm px-3 py-1.5 rounded-full border font-semibold ${
                              on ? "border-accent bg-accent-tint text-accent-dark" : "border-neutral-300 bg-white text-neutral-600"
                            }`}
                          >
                            {o}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          cambio();
                          setEscribiendoProfesion(true);
                          setCategoria("");
                        }}
                        className={`text-sm px-3 py-1.5 rounded-full border font-semibold ${
                          escribiendoProfesion ? "border-accent bg-accent-tint text-accent-dark" : "border-neutral-300 bg-white text-neutral-600"
                        }`}
                      >
                        Otra
                      </button>
                    </div>
                    {escribiendoProfesion && (
                      <input
                        value={categoria}
                        onChange={(e) => setCategoria(e.target.value)}
                        placeholder="¿Cuál?"
                        className={`${INPUT} max-w-xs`}
                      />
                    )}
                  </div>
                  <Campo label="Matrícula">
                    <input
                      name="matricula"
                      value={matricula}
                      onChange={(e) => setMatricula(e.target.value)}
                      placeholder="Ej: MP 4521"
                      className={INPUT}
                    />
                  </Campo>
                  <Campo label="Observaciones" nota="Solo para vos">
                    <input name="observaciones" defaultValue={profesional.observaciones ?? ""} className={INPUT} />
                  </Campo>
                </div>
                <p className="text-xs text-neutral-500 bg-neutral-100 rounded-xl px-3 py-2">
                  🔒 Lo marcado como privado nunca se muestra en la pantalla del local.
                </p>
              </Tarjeta>
            </div>

            {/* ---------- perfil ---------- */}
            <div hidden={pestana !== "perfil"}>
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
                <Tarjeta titulo="Cómo la ve el cliente">
                  <div className="flex items-center gap-4">
                    <span className="w-24 h-24 rounded-full overflow-hidden bg-neutral-100 grid place-items-center text-3xl font-bold text-neutral-400 shrink-0">
                      {foto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={foto} alt="" className="w-full h-full object-cover object-top" />
                      ) : (
                        nombre.charAt(0).toUpperCase()
                      )}
                    </span>
                    <div className="flex flex-col gap-1.5 items-start">
                      <b className="text-sm">Foto de perfil</b>
                      <span className="text-xs text-neutral-500">De medio cuerpo y con buena luz. Se guarda apenas la elegís.</span>
                      <label className="text-sm font-semibold text-accent border border-neutral-200 rounded-lg px-3 py-1.5 bg-white cursor-pointer">
                        {subiendoFoto ? "Subiendo..." : foto ? "Cambiar foto" : "Subir foto"}
                        <input type="file" accept="image/*" onChange={handleFoto} disabled={subiendoFoto} className="hidden" />
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                    <Campo label="Título">
                      <input
                        name="titulo"
                        value={titulo}
                        onChange={(e) => setTitulo(e.target.value)}
                        placeholder="Ej: Lic. en Nutrición"
                        className={INPUT}
                      />
                    </Campo>
                    <Campo label="Especialidad">
                      <input
                        name="especialidad"
                        value={especialidad}
                        onChange={(e) => setEspecialidad(e.target.value)}
                        placeholder="Ej: Nutrición deportiva"
                        className={INPUT}
                      />
                    </Campo>
                    <Campo label="Presentación corta" nota={`${bio.length} letras`} ancho>
                      <textarea
                        name="bio"
                        rows={4}
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="Dos o tres renglones, como si se lo contara a un cliente. Ej: Acompaño a deportistas y a personas que quieren comer mejor sin dietas imposibles."
                        className={INPUT}
                      />
                    </Campo>
                  </div>
                  <p className="text-xs text-blue-900 bg-accent-tint rounded-xl px-3 py-2">
                    💡 Es lo primero que lee el cliente. Que hable de lo que le va a pasar a él, no de los títulos: esos ya se ven arriba.
                  </p>
                </Tarjeta>
                <VistaPreviaKiosco
                  foto={foto}
                  nombre={nombreCompleto}
                  titulo={titulo}
                  especialidad={especialidad}
                  matricula={matricula}
                  bio={bio}
                  fortalezas={fortalezasVista}
                  tieneTurno={Boolean(linkConsultorio || (agenda.modo === "propia" && (linkPropio || linkPropioOnline)))}
                />
              </div>
            </div>

            {/* ---------- en qué ayuda ---------- */}
            <div hidden={pestana !== "ayuda"}>
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
                <div className="flex flex-col gap-4">
                  <Tarjeta titulo="¿En qué se destaca?" bajada="Elegí 2 o 3. Con la ★ marcás la principal.">
                    <div className="flex flex-wrap gap-2">
                      {catalogoFortalezas.map((f) => {
                        const on = fortalezasSeleccionadas.has(f.nombre);
                        return (
                          <button
                            key={f.id_fortaleza}
                            type="button"
                            onClick={() => toggleFortaleza(f.nombre)}
                            className={`text-sm font-semibold px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${
                              on ? "bg-accent-tint border-accent text-accent-dark" : "border-neutral-300 bg-white text-neutral-600"
                            }`}
                          >
                            {f.nombre}
                            {on && (
                              <span
                                role="button"
                                tabIndex={-1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cambio();
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
                    <div className="flex gap-2 max-w-sm">
                      <input
                        value={nuevaFortaleza}
                        onChange={(e) => setNuevaFortaleza(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            agregarFortalezaNueva();
                          }
                        }}
                        placeholder="Crear otra..."
                        className={INPUT}
                      />
                      <button type="button" onClick={agregarFortalezaNueva} className="text-sm font-semibold text-accent px-2 shrink-0">
                        + Crear
                      </button>
                    </div>
                  </Tarjeta>
                  <Tarjeta
                    titulo="¿Cómo puede ayudarte?"
                    bajada="Son los mismos objetivos de “Encontrar productos para mí”: así el asesor la recomienda según lo que busca el cliente."
                  >
                    <div className="flex flex-wrap gap-2">
                      {objetivosGlobales.length === 0 && (
                        <p className="text-sm text-neutral-400">Todavía no cargaste objetivos en Catálogo asesor.</p>
                      )}
                      {objetivosGlobales.map((o) => {
                        const on = objetivosSeleccionados.has(o.id_objetivo);
                        return (
                          <button
                            key={o.id_objetivo}
                            type="button"
                            onClick={() => toggleObjetivo(o.id_objetivo)}
                            className={`text-sm font-semibold px-3 py-1.5 rounded-full border ${
                              on ? "bg-accent-tint border-accent text-accent-dark" : "border-neutral-300 bg-white text-neutral-600"
                            }`}
                          >
                            {o.nombre}
                          </button>
                        );
                      })}
                    </div>
                  </Tarjeta>
                </div>
                <VistaPreviaKiosco
                  foto={foto}
                  nombre={nombreCompleto}
                  titulo={titulo}
                  especialidad={especialidad}
                  matricula={matricula}
                  bio={bio}
                  fortalezas={fortalezasVista}
                  tieneTurno={Boolean(linkConsultorio || (agenda.modo === "propia" && (linkPropio || linkPropioOnline)))}
                />
              </div>
            </div>

            {/* ---------- turnos ---------- */}
            <div hidden={pestana !== "turnos"}>
              <Tarjeta titulo="Turnos y precios">
                {consultorios.disponible && (
                  <SelectorAgenda
                    estado={agenda}
                    onChange={(a) => {
                      cambio();
                      setAgenda(a);
                    }}
                    consultorios={consultorios}
                    nombresPorConsultorio={nombresPorConsultorio}
                    nombrePropio={nombreCompleto}
                  />
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-neutral-600">Atiende</span>
                  <div className="inline-flex flex-wrap self-start gap-1 border border-neutral-300 rounded-xl p-1 bg-white">
                    {[
                      { valor: "Presencial", label: "Presencial" },
                      { valor: "Virtual", label: "Online" },
                      { valor: "Presencial y virtual", label: "Las dos" },
                    ].map((o) => (
                      <button
                        key={o.valor}
                        type="button"
                        onClick={() => {
                          cambio();
                          setTipoAtencion(o.valor);
                        }}
                        className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold ${
                          tipoAtencion === o.valor ? "bg-accent text-white" : "text-neutral-600"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  {agenda.modo === "propia" ? (
                    <>
                      <Campo label="Link de turnos — Presencial">
                        <input
                          name="link_reserva"
                          value={linkPropio}
                          onChange={(e) => setLinkPropio(e.target.value)}
                          placeholder="Cal.com, Google Calendar o WhatsApp"
                          className={INPUT}
                        />
                      </Campo>
                      <Campo label="Link de turnos — Online">
                        <input
                          name="link_reserva_online"
                          value={linkPropioOnline}
                          onChange={(e) => setLinkPropioOnline(e.target.value)}
                          placeholder="Para turnos por videollamada"
                          className={INPUT}
                        />
                      </Campo>
                    </>
                  ) : (
                    // Con agenda compartida no se muestran, pero se guardan igual:
                    // si un día deja el consultorio, vuelven a estar.
                    <>
                      <input type="hidden" name="link_reserva" value={linkPropio} />
                      <input type="hidden" name="link_reserva_online" value={linkPropioOnline} />
                    </>
                  )}
                  <Campo label="Precio — Presencial">
                    <input type="number" name="precio_presencial" defaultValue={profesional.precio_presencial ?? ""} placeholder="Ej: 15000" className={INPUT} />
                  </Campo>
                  <Campo label="Precio — Online">
                    <input type="number" name="precio_online" defaultValue={profesional.precio_online ?? ""} placeholder="Ej: 12000" className={INPUT} />
                  </Campo>
                  <Campo label="Ciudad" nota="Solo si no atiende en el local" ancho>
                    <input name="ciudad" defaultValue={profesional.ciudad ?? ""} placeholder="Ej: Buenos Aires" className={INPUT} />
                  </Campo>
                </div>
                <p className="text-xs text-blue-900 bg-accent-tint rounded-xl px-3 py-2">
                  💡 El precio es informativo: el cliente lo ve antes de reservar, y la consulta la cobra ella directo.
                </p>
              </Tarjeta>
            </div>

            {/* ---------- fotos ---------- */}
            <div hidden={pestana !== "fotos"}>
              <Tarjeta titulo="Fotos y videos" bajada="Las fotos se ven en su ficha de la pantalla del local. Se guardan apenas las subís.">
                <GuardaSola>
                  <SeccionGaleria idProfesional={id} />
                  <SeccionVideos idProfesional={id} />
                </GuardaSola>
              </Tarjeta>
            </div>

            {/* ---------- historia ---------- */}
            <div hidden={pestana !== "historia"}>
              <div className="flex flex-col gap-4">
                <Tarjeta titulo="Su historia" bajada="Opcional. La versión larga: cómo llegó a su profesión y con quién trabaja mejor.">
                  <textarea name="biografia_completa" rows={5} defaultValue={profesional.biografia_completa ?? ""} placeholder="Se puede dejar vacía." className={INPUT} />
                </Tarjeta>
                <Tarjeta titulo="Formación" bajada="Títulos, posgrados y cursos.">
                  <GuardaSola>
                    <SeccionFormacion idProfesional={id} />
                  </GuardaSola>
                </Tarjeta>
                <Tarjeta titulo="Trayectoria" bajada="Dónde trabajó y desde cuándo.">
                  <GuardaSola>
                    <SeccionTrayectoria idProfesional={id} />
                  </GuardaSola>
                </Tarjeta>
              </div>
            </div>

            {/* ---------- conóceme ---------- */}
            <div hidden={pestana !== "conoceme"}>
              <Tarjeta
                titulo="Conóceme"
                bajada="Las filminas que pasa la pantalla cuando el cliente toca “Conóceme”. Las de formación, trayectoria y fortalezas se arman solas con lo que ya cargaste."
              >
                <GuardaSola>
                  <SeccionConoceme idProfesional={id} />
                </GuardaSola>
              </Tarjeta>
            </div>
          </form>
        </div>

        {/* ---------- pie ---------- */}
        <div className="bg-white border-t border-neutral-200 px-5 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-neutral-500">
            {guardado && !sucio ? (
              <span className="font-semibold text-emerald-700">✓ Cambios guardados</span>
            ) : sucio ? (
              <span className="font-semibold text-amber-700">Hay cambios sin guardar</span>
            ) : (
              NOTA_PIE[pestana] ?? "Los cambios de todas las pestañas se guardan juntos."
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={intentarCerrar}
              className="text-sm font-semibold text-neutral-600 border border-neutral-200 rounded-xl px-4 py-2 bg-white"
            >
              Cerrar
            </button>
            <button
              type="submit"
              form={formId}
              disabled={guardando || !sucio}
              className="text-sm font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 rounded-xl px-5 py-2"
            >
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
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
