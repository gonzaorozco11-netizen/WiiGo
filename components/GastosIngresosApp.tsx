"use client";

import { useEffect, useMemo, useState } from "react";
import type { Local, Marca, Gasto, CategoriaGasto, SubcategoriaGasto, CategoriaCargoMarca, SubcategoriaCargoMarca, CategoriaIngreso, SubcategoriaIngreso } from "@/lib/supabase";
import {
  crearGasto,
  crearRecurrente,
  listarRecurrentes,
  cargarRecurrente,
  anularGasto,
  listarCategorias,
  listarSubcategorias,
  crearCategoriaGasto,
  renombrarCategoriaGasto,
  desactivarCategoria,
  desactivarSubcategoria,
  crearSubcategoriaGasto,
  renombrarSubcategoriaGasto,
  contarGastosPorCategoria,
  aplicarTipoACategoria,
  resumenGastos,
  listarPresupuestos,
  guardarPresupuesto,
  obtenerGasto,
} from "@/app/(app)/gastos/actions";
import { registrarPagoComercial } from "@/app/(app)/situacion-marca/actions";
import { estaPeriodoCerrado, reabrirCierreCompleto } from "@/app/(app)/resultado-mes/actions";
import ModalEditarGasto from "@/components/ModalEditarGasto";
import {
  registrarCargoMarcaUnico,
  crearCargoRecurrenteMarca,
  listarCargosRecurrentesMarca,
  cargarCargoRecurrenteMarca,
  listarMarcasConSaldoPendiente,
  crearIngreso,
  crearIngresoRecurrente,
  listarIngresosRecurrentes,
  cargarIngresoRecurrente,
  listarUltimosMovimientos,
  resumenUnificado,
  type ResumenUnificado,
  anularCargoMarca,
  anularIngreso,
  listarCategoriasCargoMarca,
  listarSubcategoriasCargoMarca,
  crearCategoriaCargoMarca,
  renombrarCategoriaCargoMarca,
  desactivarCategoriaCargoMarca,
  crearSubcategoriaCargoMarca,
  renombrarSubcategoriaCargoMarca,
  desactivarSubcategoriaCargoMarca,
  contarCargosPorCategoria,
  listarCategoriasIngreso,
  listarSubcategoriasIngreso,
  crearCategoriaIngreso,
  renombrarCategoriaIngreso,
  desactivarCategoriaIngreso,
  crearSubcategoriaIngreso,
  renombrarSubcategoriaIngreso,
  desactivarSubcategoriaIngreso,
  contarIngresosPorCategoria,
  type MovimientoUnificado,
} from "@/app/(app)/gastos-ingresos/actions";
import ModalAnularMovimiento from "@/components/ModalAnularMovimiento";

type Tab = "gasto" | "cargo" | "ingreso";
type Recurrencia = "UNICO" | "MENSUAL" | "ANUAL";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const MEDIO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO_ADMIN: "🔒 Caja Administración",
  TRANSFERENCIA: "🏦 Transferencia",
  MERCADO_PAGO: "💳 Mercado Pago / Tarjeta",
};

function formatearMonto(valor: number) {
  return Math.round(Math.abs(valor)).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

function periodoActual(recurrencia: string) {
  const ahora = new Date();
  return recurrencia === "ANUAL" ? String(ahora.getFullYear()) : ahora.toISOString().slice(0, 7);
}

function formatearFecha(fechaISO: string) {
  return new Date(fechaISO).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type PendienteRecurrente = {
  id: string;
  tipo: Tab;
  descripcion: string;
  montoEstimado: number;
  extra: string | null;
  necesitaMedioPago: boolean;
  puedeIva: boolean;
  llevaIvaDefault: boolean;
};

const TIPO_BADGE: Record<Tab, { label: string; clases: string }> = {
  gasto: { label: "Gasto", clases: "bg-red-100 text-red-700" },
  cargo: { label: "Cargo a marca", clases: "bg-purple-100 text-purple-700" },
  ingreso: { label: "Ingreso", clases: "bg-emerald-100 text-emerald-700" },
};

export default function GastosIngresosApp({
  locales,
  marcas,
  usuarios,
  categoriasGasto: categoriasGastoIniciales,
  subcategoriasGasto: subcategoriasGastoIniciales,
  categoriasCargo: categoriasCargoIniciales,
  subcategoriasCargo: subcategoriasCargoIniciales,
  categoriasIngreso: categoriasIngresoIniciales,
  subcategoriasIngreso: subcategoriasIngresoIniciales,
  topeAutorizacion,
  puedeAutorizarSinLimite,
  ivaGeneralPorcentaje,
}: {
  locales: Local[];
  usuarios: { id_usuario: string; nombre: string }[];
  marcas: Marca[];
  categoriasGasto: CategoriaGasto[];
  subcategoriasGasto: SubcategoriaGasto[];
  categoriasCargo: CategoriaCargoMarca[];
  subcategoriasCargo: SubcategoriaCargoMarca[];
  categoriasIngreso: CategoriaIngreso[];
  subcategoriasIngreso: SubcategoriaIngreso[];
  topeAutorizacion: number;
  puedeAutorizarSinLimite: boolean;
  ivaGeneralPorcentaje: number;
}) {
  const [vista, setVista] = useState<"cargar" | "resumen" | "categorias">("cargar");
  const [categoriasGasto, setCategoriasGasto] = useState(categoriasGastoIniciales);
  const [subcategoriasGasto, setSubcategoriasGasto] = useState(subcategoriasGastoIniciales);
  const [categoriasCargo, setCategoriasCargo] = useState(categoriasCargoIniciales);
  const [subcategoriasCargo, setSubcategoriasCargo] = useState(subcategoriasCargoIniciales);
  const [categoriasIngreso, setCategoriasIngreso] = useState(categoriasIngresoIniciales);
  const [subcategoriasIngreso, setSubcategoriasIngreso] = useState(subcategoriasIngresoIniciales);

  function recargarCategorias() {
    Promise.all([
      listarCategorias(),
      listarSubcategorias(),
      listarCategoriasCargoMarca(),
      listarSubcategoriasCargoMarca(),
      listarCategoriasIngreso(),
      listarSubcategoriasIngreso(),
    ]).then(([cg, sg, cc, sc, ci, si]) => {
      setCategoriasGasto(cg as CategoriaGasto[]);
      setSubcategoriasGasto(sg as SubcategoriaGasto[]);
      setCategoriasCargo(cc as CategoriaCargoMarca[]);
      setSubcategoriasCargo(sc as SubcategoriaCargoMarca[]);
      setCategoriasIngreso(ci as CategoriaIngreso[]);
      setSubcategoriasIngreso(si as SubcategoriaIngreso[]);
    });
  }

  const [tab, setTab] = useState<Tab>("gasto");
  const [modoCargo, setModoCargo] = useState<"CARGO" | "PAGO">("CARGO");
  const [recurrencia, setRecurrencia] = useState<Recurrencia>("UNICO");
  const [idMarca, setIdMarca] = useState(marcas[0]?.id_marca ?? "");
  const [idCategoria, setIdCategoria] = useState(categoriasGasto[0]?.id_categoria ?? "__nueva__");
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [nuevaCategoriaTipo, setNuevaCategoriaTipo] = useState<"FIJO" | "VARIABLE">("VARIABLE");
  const [idSubcategoria, setIdSubcategoria] = useState("");
  const [nuevaSubcategoria, setNuevaSubcategoria] = useState("");
  const [idUsuarioAdelanto, setIdUsuarioAdelanto] = useState("");
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [medioPago, setMedioPago] = useState<"TRANSFERENCIA" | "EFECTIVO_ADMIN" | "MERCADO_PAGO">("TRANSFERENCIA");
  const [idLocal, setIdLocal] = useState("");
  const [diaMes, setDiaMes] = useState("1");
  const [mesAnual, setMesAnual] = useState("1");
  const [llevaIva, setLlevaIva] = useState(false);
  const [claveAdmin, setClaveAdmin] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensajeOk, setMensajeOk] = useState<string | null>(null);

  const [pendientes, setPendientes] = useState<PendienteRecurrente[]>([]);
  const [montoCargar, setMontoCargar] = useState<Record<string, string>>({});
  const [medioCargar, setMedioCargar] = useState<Record<string, string>>({});
  const [ivaCargar, setIvaCargar] = useState<Record<string, boolean>>({});
  const [cargandoId, setCargandoId] = useState<string | null>(null);

  const [pendienteCobro, setPendienteCobro] = useState<{ idMarca: string; nombre: string; saldo: number }[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoUnificado[]>([]);
  const [cargandoListas, setCargandoListas] = useState(true);
  const [anulandoMov, setAnulandoMov] = useState<MovimientoUnificado | null>(null);
  const [periodoCerradoInfo, setPeriodoCerradoInfo] = useState<{
    fd: FormData;
    periodo: string;
    crear: (fd: FormData) => Promise<{ error: string | null }>;
  } | null>(null);

  function confirmarAgregarAPeriodoCerrado() {
    if (!periodoCerradoInfo) return;
    const { fd, periodo, crear } = periodoCerradoInfo;
    setPeriodoCerradoInfo(null);
    setGuardando(true);
    reabrirCierreCompleto(periodo).then((res) => {
      if (res.error) {
        setError(res.error);
        setGuardando(false);
        return;
      }
      ejecutarGuardado(crear(fd), true);
    });
  }

  function confirmarCargarEnProximoMes() {
    if (!periodoCerradoInfo) return;
    const { fd, crear } = periodoCerradoInfo;
    const hoy = new Date();
    const fechaProxima = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1).toISOString().slice(0, 10);
    const fd2 = new FormData();
    for (const [k, v] of fd.entries()) fd2.append(k, v as string);
    fd2.set("fecha_override", fechaProxima);
    setPeriodoCerradoInfo(null);
    ejecutarGuardado(crear(fd2), true);
  }

  function anularMovimiento(m: MovimientoUnificado, motivo: string) {
    if (m.tipo === "GASTO") return anularGasto(m.id, motivo);
    if (m.tipo === "CARGO_MARCA") return anularCargoMarca(m.id, motivo);
    return anularIngreso(m.id, motivo);
  }

  const montoNum = Number(monto.replace(/[^\d.-]/g, "")) || 0;
  const montoConIva = redondear2(montoNum * (1 + ivaGeneralPorcentaje / 100));
  const mostrarAuth = tab === "gasto" && recurrencia === "UNICO" && !puedeAutorizarSinLimite && montoNum > topeAutorizacion;

  const categorias = tab === "gasto" ? categoriasGasto : tab === "cargo" ? categoriasCargo : categoriasIngreso;
  const subcategorias = tab === "gasto" ? subcategoriasGasto : tab === "cargo" ? subcategoriasCargo : subcategoriasIngreso;
  const subDisponibles = subcategorias.filter((s) => s.id_categoria === idCategoria);
  const nombreSubSeleccionada = idSubcategoria === "__nueva__" ? nuevaSubcategoria : subDisponibles.find((s) => s.id_subcategoria === idSubcategoria)?.nombre ?? "";
  const mostrarAdelanto = tab === "gasto" && recurrencia === "UNICO" && nombreSubSeleccionada.toLowerCase().includes("adelanto");

  function recargarListas() {
    setCargandoListas(true);
    Promise.all([listarRecurrentes(), listarCargosRecurrentesMarca(), listarIngresosRecurrentes(), listarMarcasConSaldoPendiente(), listarUltimosMovimientos()])
      .then(([gastoRec, cargoRec, ingresoRec, saldos, ultimos]) => {
        const pend: PendienteRecurrente[] = [];
        for (const r of gastoRec) {
          if (r.ultimo_mes_cargado !== periodoActual("MENSUAL")) {
            pend.push({
              id: r.id_recurrente,
              tipo: "gasto",
              descripcion: r.descripcion,
              montoEstimado: r.monto_estimado,
              extra: null,
              necesitaMedioPago: true,
              puedeIva: true,
              llevaIvaDefault: !!r.lleva_iva,
            });
          }
        }
        for (const r of cargoRec) {
          if (r.ultimo_periodo_cargado !== periodoActual(r.recurrencia)) {
            pend.push({
              id: r.id_recurrente,
              tipo: "cargo",
              descripcion: r.descripcion,
              montoEstimado: r.monto_estimado,
              extra: r.nombreMarca,
              necesitaMedioPago: false,
              puedeIva: true,
              llevaIvaDefault: !!r.lleva_iva,
            });
          }
        }
        for (const r of ingresoRec) {
          if (r.ultimo_periodo_cargado !== periodoActual(r.recurrencia)) {
            pend.push({
              id: r.id_recurrente,
              tipo: "ingreso",
              descripcion: r.descripcion,
              montoEstimado: r.monto_estimado,
              extra: null,
              necesitaMedioPago: true,
              puedeIva: true,
              llevaIvaDefault: !!r.lleva_iva,
            });
          }
        }
        setPendientes(pend);
        setPendienteCobro(saldos);
        setMovimientos(ultimos);
      })
      .finally(() => setCargandoListas(false));
  }

  useEffect(recargarListas, []);

  function handleCambiarTab(nuevoTab: Tab) {
    setTab(nuevoTab);
    setModoCargo("CARGO");
    setRecurrencia("UNICO");
    const cats = nuevoTab === "gasto" ? categoriasGasto : nuevoTab === "cargo" ? categoriasCargo : categoriasIngreso;
    setIdCategoria(cats[0]?.id_categoria ?? "__nueva__");
    setIdSubcategoria("");
    setNuevaCategoria("");
    setNuevaSubcategoria("");
    setMonto("");
    setDescripcion("");
    setLlevaIva(false);
    setError(null);
    setMensajeOk(null);
  }

  function handleCambiarCategoria(id: string) {
    setIdCategoria(id);
    setIdSubcategoria("");
    setNuevaSubcategoria("");
  }

  function resetForm() {
    setMonto("");
    setDescripcion("");
    setNuevaCategoria("");
    setNuevaSubcategoria("");
    setIdSubcategoria("");
    setClaveAdmin("");
    setLlevaIva(false);
    setIdUsuarioAdelanto("");
  }

  function ejecutarGuardado(promesa: Promise<{ error: string | null }>, esUnico: boolean) {
    setGuardando(true);
    promesa
      .then((res) => {
        if (res.error) {
          setError(res.error);
          return;
        }
        setMensajeOk(esUnico ? "Guardado." : "Guardado — vas a tener que confirmarlo cada período en 'Pendiente de cargar'.");
        resetForm();
        recargarListas();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar"))
      .finally(() => setGuardando(false));
  }

  async function handleGuardar() {
    setError(null);
    setMensajeOk(null);
    const montoNum = Number(monto.replace(/[^\d.-]/g, "")) || 0;
    if (!montoNum || montoNum <= 0) {
      setError("El monto tiene que ser mayor a 0");
      return;
    }
    if (tab === "cargo" && !idMarca) {
      setError("Elegí una marca");
      return;
    }

    if (tab === "cargo" && modoCargo === "PAGO") {
      const fdPago = new FormData();
      fdPago.append("monto", String(montoNum));
      fdPago.append("descripcion", descripcion);
      ejecutarGuardado(registrarPagoComercial(idMarca, fdPago), true);
      return;
    }

    if (idCategoria === "__nueva__" && !nuevaCategoria.trim()) {
      setError("Elegí o creá una categoría");
      return;
    }

    const fd = new FormData();
    if (idCategoria === "__nueva__") {
      fd.append("nueva_categoria", nuevaCategoria);
      if (tab === "gasto") fd.append("tipo", nuevaCategoriaTipo);
    }
    else fd.append("id_categoria", idCategoria);
    if (idSubcategoria === "__nueva__" && nuevaSubcategoria.trim()) {
      fd.append(tab === "gasto" ? "nueva_subcategoria_gasto" : "nueva_subcategoria", nuevaSubcategoria);
    } else if (idSubcategoria) {
      fd.append("id_subcategoria", idSubcategoria);
    }
    fd.append("descripcion", descripcion);
    if (llevaIva) fd.append("lleva_iva", "on");

    if (recurrencia !== "UNICO") {
      fd.append("monto_estimado", String(montoNum));
      fd.append("dia_mes", diaMes);
      if (tab === "gasto") {
        if (idLocal) fd.append("id_local", idLocal);
      } else {
        fd.append("recurrencia", recurrencia);
        if (recurrencia === "ANUAL") fd.append("mes_anual", mesAnual);
      }
      const promesa = tab === "gasto" ? crearRecurrente(fd) : tab === "cargo" ? crearCargoRecurrenteMarca(idMarca, fd) : crearIngresoRecurrente(fd);
      ejecutarGuardado(promesa, false);
      return;
    }

    // Único — se carga con fecha de hoy, por eso acá (y solo acá) importa
    // si el mes de hoy ya está cerrado en el Tablero de Resultados.
    fd.append("monto", String(montoNum));
    if (tab !== "cargo") {
      fd.append("medio_pago", medioPago);
      if (idLocal) fd.append("id_local", idLocal);
    }
    if (tab === "gasto" && claveAdmin) fd.append("clave_admin", claveAdmin);
    if (mostrarAdelanto && idUsuarioAdelanto) fd.append("id_usuario_adelanto", idUsuarioAdelanto);

    function crear(fdFinal: FormData) {
      return tab === "gasto" ? crearGasto(fdFinal) : tab === "cargo" ? registrarCargoMarcaUnico(idMarca, fdFinal) : crearIngreso(fdFinal);
    }

    setGuardando(true);
    const hoy = new Date().toISOString().slice(0, 10);
    const cerrado = await estaPeriodoCerrado(hoy);
    if (cerrado) {
      setGuardando(false);
      setPeriodoCerradoInfo({ fd, periodo: hoy.slice(0, 7), crear });
      return;
    }
    ejecutarGuardado(crear(fd), true);
  }

  function handleCargarPendiente(item: PendienteRecurrente) {
    const montoNum = Number((montoCargar[item.id] ?? String(item.montoEstimado)).replace(/[^\d.-]/g, "")) || 0;
    const medio = medioCargar[item.id] ?? "TRANSFERENCIA";
    const iva = ivaCargar[item.id] ?? item.llevaIvaDefault;
    setError(null);
    setCargandoId(item.id);
    let promesa: Promise<{ error: string | null } | void>;
    if (item.tipo === "gasto") promesa = cargarRecurrente(item.id, montoNum, medio, iva);
    else if (item.tipo === "cargo") promesa = cargarCargoRecurrenteMarca(item.id, montoNum, iva);
    else promesa = cargarIngresoRecurrente(item.id, montoNum, medio, iva);
    promesa
      .then((res) => {
        if (res && res.error) {
          setError(res.error);
          return;
        }
        recargarListas();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar"))
      .finally(() => setCargandoId(null));
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Gastos e Ingresos</h1>
      <p className="text-sm text-neutral-500 mb-5 max-w-2xl">
        Un solo lugar para registrar cualquier movimiento de plata: un gasto propio, un cargo a una marca en
        consignación, o un ingreso que no viene de una venta. Lo recurrente (canon mensual, alquiler, etc.) se define
        una vez y cada período se confirma acá abajo, en &quot;Pendiente de cargar&quot;.
      </p>

      <div className="inline-flex gap-1 bg-neutral-100 border border-neutral-200 rounded-lg p-1 mb-5">
        <button
          type="button"
          onClick={() => setVista("cargar")}
          className={`px-3.5 py-1.5 rounded-md text-sm font-medium ${vista === "cargar" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}`}
        >
          Cargar movimiento
        </button>
        <button
          type="button"
          onClick={() => setVista("resumen")}
          className={`px-3.5 py-1.5 rounded-md text-sm font-medium ${vista === "resumen" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}`}
        >
          📊 Resumen
        </button>
        <button
          type="button"
          onClick={() => setVista("categorias")}
          className={`px-3.5 py-1.5 rounded-md text-sm font-medium ${vista === "categorias" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}`}
        >
          🏷️ Categorías
        </button>
      </div>

      {vista === "resumen" ? (
        <VistaResumen
          locales={locales}
          categoriasGasto={categoriasGasto}
          subcategoriasGasto={subcategoriasGasto}
          categoriasCargo={categoriasCargo}
          categoriasIngreso={categoriasIngreso}
          puedeAutorizarSinLimite={puedeAutorizarSinLimite}
          topeAutorizacion={topeAutorizacion}
          ivaGeneralPorcentaje={ivaGeneralPorcentaje}
        />
      ) : vista === "categorias" ? (
        <VistaCategorias
          categoriasGasto={categoriasGasto}
          subcategoriasGasto={subcategoriasGasto}
          categoriasCargo={categoriasCargo}
          subcategoriasCargo={subcategoriasCargo}
          categoriasIngreso={categoriasIngreso}
          subcategoriasIngreso={subcategoriasIngreso}
          onCambio={recargarCategorias}
        />
      ) : (
      <>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {(["gasto", "cargo", "ingreso"] as const).map((t) => (
          <button
            key={t}
            onClick={() => handleCambiarTab(t)}
            className={`flex-1 min-w-[160px] flex items-center gap-2 px-3.5 py-2.5 rounded-xl border-[1.5px] text-sm font-bold ${
              tab === t
                ? t === "gasto"
                  ? "border-red-500 bg-red-50 text-red-700"
                  : t === "cargo"
                  ? "border-purple-500 bg-purple-50 text-purple-700"
                  : "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-neutral-200 text-neutral-500 bg-white"
            }`}
          >
            {t === "gasto" ? "💸 Gasto mío" : t === "cargo" ? "🏷️ Cargo a una marca" : "💰 Otro ingreso"}
          </button>
        ))}
      </div>

      <div className="bg-white border border-neutral-200 rounded-2xl p-5 mb-6">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3" role="alert">
            {error}
          </p>
        )}
        {mensajeOk && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">{mensajeOk}</p>}

        {tab === "cargo" && (
          <div className="mb-3">
            <label className="block text-sm font-medium text-neutral-700 mb-1">Marca</label>
            <select value={idMarca} onChange={(e) => setIdMarca(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm">
              {marcas.length === 0 && <option value="">No hay marcas en consignación</option>}
              {marcas.map((m) => (
                <option key={m.id_marca} value={m.id_marca}>{m.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {tab === "cargo" && (
          <div className="flex gap-1.5 mb-3">
            <button
              onClick={() => setModoCargo("CARGO")}
              className={`flex-1 text-center py-2 rounded-lg border-[1.5px] text-xs font-bold ${
                modoCargo === "CARGO" ? "border-purple-500 bg-purple-50 text-purple-700" : "border-neutral-200 text-neutral-500 bg-white"
              }`}
            >
              🏷️ Cargo nuevo
            </button>
            <button
              onClick={() => {
                setModoCargo("PAGO");
                setRecurrencia("UNICO");
              }}
              className={`flex-1 text-center py-2 rounded-lg border-[1.5px] text-xs font-bold ${
                modoCargo === "PAGO" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-neutral-200 text-neutral-500 bg-white"
              }`}
            >
              💵 Pago recibido
            </button>
          </div>
        )}

        {!(tab === "cargo" && modoCargo === "PAGO") && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Categoría</label>
              <select value={idCategoria} onChange={(e) => handleCambiarCategoria(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm">
                {categorias.map((c) => (
                  <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>
                ))}
                <option value="__nueva__">+ Crear categoría nueva…</option>
              </select>
              {idCategoria === "__nueva__" && (
                <>
                  <input
                    value={nuevaCategoria}
                    onChange={(e) => setNuevaCategoria(e.target.value)}
                    placeholder="Nombre de la categoría nueva"
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
                  />
                  {tab === "gasto" && (
                    <select
                      value={nuevaCategoriaTipo}
                      onChange={(e) => setNuevaCategoriaTipo(e.target.value as "FIJO" | "VARIABLE")}
                      className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
                    >
                      <option value="VARIABLE">Variable — depende del mes</option>
                      <option value="FIJO">Fijo — todos los meses igual</option>
                    </select>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Subcategoría (opcional)</label>
              <select value={idSubcategoria} onChange={(e) => setIdSubcategoria(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Sin subcategoría</option>
                {subDisponibles.map((s) => (
                  <option key={s.id_subcategoria} value={s.id_subcategoria}>{s.nombre}</option>
                ))}
                <option value="__nueva__">+ Crear subcategoría nueva…</option>
              </select>
              {idSubcategoria === "__nueva__" && (
                <input
                  value={nuevaSubcategoria}
                  onChange={(e) => setNuevaSubcategoria(e.target.value)}
                  placeholder="Nombre de la subcategoría nueva"
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
                />
              )}
            </div>
          </div>
        )}

        {mostrarAdelanto && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3">
            <label className="block text-sm font-medium text-purple-700 mb-1">👤 Empleado al que se le descuenta</label>
            <select value={idUsuarioAdelanto} onChange={(e) => setIdUsuarioAdelanto(e.target.value)} className="w-full border border-purple-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Elegir empleado…</option>
              {usuarios.map((u) => (
                <option key={u.id_usuario} value={u.id_usuario}>{u.nombre}</option>
              ))}
            </select>
            <p className="text-xs text-purple-600 mt-1.5">Este monto se descuenta solo del sueldo en la pestaña Nómina.</p>
          </div>
        )}

        <div className={`grid grid-cols-1 gap-3 mb-3 ${tab === "cargo" && modoCargo === "PAGO" ? "" : "sm:grid-cols-2"}`}>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              {tab === "cargo" && modoCargo === "PAGO" ? "Monto pagado" : `Monto ${recurrencia !== "UNICO" ? "estimado " : ""}(sin IVA)`}
            </label>
            <input value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$0" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />

            {!(tab === "cargo" && modoCargo === "PAGO") && (
              <div className="mt-2">
                <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
                  <input type="checkbox" checked={llevaIva} onChange={(e) => setLlevaIva(e.target.checked)} />
                  Agregar IVA ({ivaGeneralPorcentaje}%)
                </label>
                {llevaIva && montoNum > 0 && (
                  <p className="text-xs text-neutral-500 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 mt-1.5">
                    ${formatearMonto(montoNum)} + IVA ${formatearMonto(montoConIva - montoNum)} = <span className="font-bold text-neutral-800">${formatearMonto(montoConIva)}</span>
                  </p>
                )}
              </div>
            )}
          </div>
          {!(tab === "cargo" && modoCargo === "PAGO") && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Recurrencia</label>
              <select
                value={recurrencia}
                onChange={(e) => setRecurrencia(e.target.value as Recurrencia)}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="UNICO">Único</option>
                <option value="MENSUAL">Mensual</option>
                {tab !== "gasto" && <option value="ANUAL">Anual</option>}
              </select>
            </div>
          )}
        </div>

        {recurrencia !== "UNICO" && !(tab === "cargo" && modoCargo === "PAGO") && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Día del mes</label>
              <input type="number" min="1" max="28" value={diaMes} onChange={(e) => setDiaMes(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            {recurrencia === "ANUAL" && (
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Mes del año</label>
                <select value={mesAnual} onChange={(e) => setMesAnual(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm">
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {(tab === "gasto" || tab === "ingreso") && recurrencia === "UNICO" && (
          <div className="mb-3">
            <label className="block text-sm font-medium text-neutral-700 mb-1">{tab === "gasto" ? "¿De dónde sale la plata?" : "¿Dónde entró la plata?"}</label>
            <div className="flex flex-col gap-1.5">
              {(["TRANSFERENCIA", "EFECTIVO_ADMIN", "MERCADO_PAGO"] as const).map((opcion) => (
                <label key={opcion} className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer ${medioPago === opcion ? "border-accent bg-accent-tint" : "border-neutral-300"}`}>
                  <input type="radio" checked={medioPago === opcion} onChange={() => setMedioPago(opcion)} />
                  {MEDIO_PAGO_LABEL[opcion]}
                </label>
              ))}
            </div>
            <p className="text-xs text-neutral-400 mt-1.5">
              {tab === "gasto" ? "Para descontar del efectivo de un turno abierto, cargalo directamente en Gastos." : ""}
            </p>
          </div>
        )}

        {(tab === "gasto" || tab === "ingreso") && (
          <div className="mb-3">
            <label className="block text-sm font-medium text-neutral-700 mb-1">Local (opcional)</label>
            <select value={idLocal} onChange={(e) => setIdLocal(e.target.value)} className="w-full sm:w-64 border border-neutral-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Sin local</option>
              {locales.map((l) => (
                <option key={l.id_local} value={l.id_local}>{l.nombre}</option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción</label>
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Nota corta..." className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
        </div>

        {tab === "cargo" && (
          <p className="text-xs text-neutral-400 mb-3">
            {modoCargo === "CARGO"
              ? "Esto solo genera la deuda en la cuenta comercial de la marca — cuando te pague de verdad, elegí \"Pago recibido\" acá arriba."
              : "Esto baja el saldo de la cuenta comercial de la marca — no queda atado a un cargo puntual, así que anotá en la descripción a qué corresponde si te sirve."}
          </p>
        )}

        {mostrarAuth && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
            <p className="text-sm font-semibold text-red-700 mb-1">⚠️ Requiere autorización</p>
            <p className="text-xs text-red-700 mb-2">
              Este monto supera el tope de ${formatearMonto(topeAutorizacion)} configurado para gastos sin aprobar.
              Hace falta la contraseña de un admin o de alguien autorizado para confirmarlo.
            </p>
            <input
              type="password"
              value={claveAdmin}
              onChange={(e) => setClaveAdmin(e.target.value)}
              placeholder="Contraseña de quien autoriza"
              className="w-full sm:w-64 border border-red-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="flex justify-end">
          <button onClick={handleGuardar} disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm">
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>

      {pendientes.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-neutral-900 mb-2">⏰ Pendiente de cargar este período</h2>
          <div className="bg-white border border-neutral-200 rounded-xl divide-y divide-neutral-100">
            {pendientes.map((p) => (
              <div key={`${p.tipo}-${p.id}`} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TIPO_BADGE[p.tipo].clases}`}>{TIPO_BADGE[p.tipo].label}</span>
                <span className="text-sm flex-1 min-w-[140px]">
                  {p.extra && <span className="font-semibold">{p.extra} — </span>}
                  {p.descripcion}
                </span>
                <input
                  value={montoCargar[p.id] ?? String(p.montoEstimado)}
                  onChange={(e) => setMontoCargar((v) => ({ ...v, [p.id]: e.target.value }))}
                  className="w-24 border border-neutral-300 rounded-lg px-2 py-1 text-xs text-right"
                />
                {p.puedeIva && (
                  <label className="flex items-center gap-1 text-xs text-neutral-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ivaCargar[p.id] ?? p.llevaIvaDefault}
                      onChange={(e) => setIvaCargar((v) => ({ ...v, [p.id]: e.target.checked }))}
                    />
                    +IVA
                  </label>
                )}
                {p.necesitaMedioPago && (
                  <select
                    value={medioCargar[p.id] ?? "TRANSFERENCIA"}
                    onChange={(e) => setMedioCargar((v) => ({ ...v, [p.id]: e.target.value }))}
                    className="border border-neutral-300 rounded-lg px-1.5 py-1 text-xs"
                  >
                    <option value="TRANSFERENCIA">Transferencia</option>
                    <option value="EFECTIVO_ADMIN">Caja Admin.</option>
                    <option value="MERCADO_PAGO">MP/Tarjeta</option>
                  </select>
                )}
                <button
                  onClick={() => handleCargarPendiente(p)}
                  disabled={cargandoId === p.id}
                  className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-2.5 py-1.5 rounded-lg"
                >
                  {cargandoId === p.id ? "..." : "Cargar"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendienteCobro.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-neutral-900 mb-2">⚠ Pendiente de cobro a marcas</h2>
          <div className="bg-amber-50 border border-amber-200 rounded-xl divide-y divide-amber-100">
            {pendienteCobro.map((s) => (
              <div key={s.idMarca} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-semibold text-neutral-800">{s.nombre}</span>
                <span className="font-bold text-amber-700 tabular-nums">${formatearMonto(s.saldo)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-bold text-neutral-900 mb-2">Últimos movimientos</h2>
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          {cargandoListas ? (
            <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
          ) : movimientos.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay movimientos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="p-3">Tipo</th>
                    <th className="p-3">Fecha</th>
                    <th className="p-3">Concepto</th>
                    <th className="p-3">Categoría</th>
                    <th className="p-3 text-right">Monto</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((m) => {
                    const badgeKey = m.tipo === "GASTO" ? "gasto" : m.tipo === "CARGO_MARCA" ? "cargo" : "ingreso";
                    return (
                      <tr key={`${m.tipo}-${m.id}`} className="border-b border-neutral-100 last:border-0">
                        <td className="p-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TIPO_BADGE[badgeKey].clases}`}>{TIPO_BADGE[badgeKey].label}</span>
                        </td>
                        <td className="p-3 whitespace-nowrap text-neutral-500">{formatearFecha(m.fecha)}</td>
                        <td className="p-3">
                          {m.concepto}
                          {m.recurrente && <span className="text-[10px] text-neutral-400 ml-1">🔁</span>}
                        </td>
                        <td className="p-3 text-neutral-500">{m.categoria}</td>
                        <td className={`p-3 text-right tabular-nums font-semibold ${m.monto >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {m.monto >= 0 ? "+" : "-"}${formatearMonto(m.monto)}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <button onClick={() => setAnulandoMov(m)} className="text-red-600 text-xs font-medium">
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
      </div>

      {anulandoMov && (
        <ModalAnularMovimiento
          titulo="Eliminar movimiento"
          descripcion={`${anulandoMov.concepto} — $${formatearMonto(anulandoMov.monto)}`}
          onConfirmar={async (motivo) => {
            const res = await anularMovimiento(anulandoMov, motivo);
            if (!res.error) {
              setAnulandoMov(null);
              recargarListas();
            }
            return res;
          }}
          onClose={() => setAnulandoMov(null)}
        />
      )}

      {periodoCerradoInfo && (
        <ModalPeriodoCerrado
          periodo={periodoCerradoInfo.periodo}
          guardando={guardando}
          onAgregarIgual={confirmarAgregarAPeriodoCerrado}
          onCargarProximoMes={confirmarCargarEnProximoMes}
          onCancelar={() => setPeriodoCerradoInfo(null)}
        />
      )}
      </>
      )}
    </div>
  );
}

// ===================== VISTA RESUMEN (gastos + cargos + ingresos) =====================

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function inicioDeMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function formatearFechaCorta(fechaISO: string) {
  return new Date(fechaISO).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

type ResumenGastosData = {
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

const TIPO_MOV_BADGE: Record<MovimientoUnificado["tipo"], { label: string; clases: string }> = {
  GASTO: { label: "Gasto", clases: "bg-red-100 text-red-700" },
  CARGO_MARCA: { label: "Cargo a marca", clases: "bg-purple-100 text-purple-700" },
  INGRESO: { label: "Ingreso", clases: "bg-emerald-100 text-emerald-700" },
};

function VistaResumen({
  locales,
  categoriasGasto,
  subcategoriasGasto,
  categoriasCargo,
  categoriasIngreso,
  puedeAutorizarSinLimite,
  topeAutorizacion,
  ivaGeneralPorcentaje,
}: {
  locales: Local[];
  categoriasGasto: CategoriaGasto[];
  subcategoriasGasto: SubcategoriaGasto[];
  categoriasCargo: CategoriaCargoMarca[];
  categoriasIngreso: CategoriaIngreso[];
  puedeAutorizarSinLimite: boolean;
  topeAutorizacion: number;
  ivaGeneralPorcentaje: number;
}) {
  const [filtroLocal, setFiltroLocal] = useState("");
  const [periodo, setPeriodo] = useState<"hoy" | "semana" | "mes">("mes");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"TODO" | MovimientoUnificado["tipo"]>("TODO");
  const [texto, setTexto] = useState("");
  const [datos, setDatos] = useState<ResumenUnificado | null>(null);
  const [resumenG, setResumenG] = useState<ResumenGastosData | null>(null);
  const [presupuestos, setPresupuestos] = useState<Map<string, number>>(new Map());
  const [cargando, setCargando] = useState(false);
  const [anulando, setAnulando] = useState<MovimientoUnificado | null>(null);
  const [cargandoEditar, setCargandoEditar] = useState<string | null>(null);
  const [gastoEditando, setGastoEditando] = useState<Gasto | null>(null);

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
      resumenUnificado({ idLocal: filtroLocal || undefined, desde, hasta }),
      resumenGastos({ idLocal: filtroLocal || undefined, desde, hasta }),
      listarPresupuestos(),
    ])
      .then(([u, r, p]) => {
        setDatos(u);
        setResumenG(r);
        setPresupuestos(new Map(p.map((x) => [x.id_categoria, x.monto_mensual])));
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [filtroLocal, desde, hasta]);

  const categoriasUnificadas = useMemo(() => {
    const nombres = new Set<string>();
    categoriasGasto.forEach((c) => nombres.add(c.nombre));
    categoriasCargo.forEach((c) => nombres.add(c.nombre));
    categoriasIngreso.forEach((c) => nombres.add(c.nombre));
    return [...nombres].sort((a, b) => a.localeCompare(b));
  }, [categoriasGasto, categoriasCargo, categoriasIngreso]);

  const itemsFiltrados = useMemo(() => {
    if (!datos) return [];
    const textoNorm = texto.trim().toLowerCase();
    return datos.items.filter((m) => {
      if (filtroTipo !== "TODO" && m.tipo !== filtroTipo) return false;
      if (filtroCategoria && m.categoria !== filtroCategoria) return false;
      if (textoNorm && !`${m.concepto} ${m.categoria}`.toLowerCase().includes(textoNorm)) return false;
      return true;
    });
  }, [datos, filtroTipo, filtroCategoria, texto]);

  function anularMovimientoResumen(m: MovimientoUnificado, motivo: string) {
    if (m.tipo === "GASTO") return anularGasto(m.id, motivo);
    if (m.tipo === "CARGO_MARCA") return anularCargoMarca(m.id, motivo);
    return anularIngreso(m.id, motivo);
  }

  function handleEditar(m: MovimientoUnificado) {
    setCargandoEditar(m.id);
    obtenerGasto(m.id)
      .then((g) => {
        if (g) setGastoEditando(g);
      })
      .finally(() => setCargandoEditar(null));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs">🔍</span>
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por descripción o categoría…"
            className="w-full border border-neutral-300 rounded-lg pl-7 pr-2.5 py-1.5 text-sm"
          />
        </div>
        <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm">
          <option value="">Todos los locales</option>
          {locales.map((l) => (
            <option key={l.id_local} value={l.id_local}>{l.nombre}</option>
          ))}
        </select>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm">
          <option value="">Todas las categorías</option>
          {categoriasUnificadas.map((nombre) => (
            <option key={nombre} value={nombre}>{nombre}</option>
          ))}
        </select>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as typeof periodo)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm">
          <option value="mes">Este mes</option>
          <option value="semana">Últimos 7 días</option>
          <option value="hoy">Hoy</option>
        </select>
      </div>

      <div className="flex gap-1.5 mb-4">
        {(["TODO", "GASTO", "CARGO_MARCA", "INGRESO"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFiltroTipo(t)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
              filtroTipo === t
                ? t === "GASTO"
                  ? "bg-red-50 border-red-300 text-red-700"
                  : t === "CARGO_MARCA"
                  ? "bg-purple-50 border-purple-300 text-purple-700"
                  : t === "INGRESO"
                  ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                  : "bg-accent-tint border-accent text-accent-dark"
                : "border-neutral-200 text-neutral-500 bg-white"
            }`}
          >
            {t === "TODO" ? "Todo" : t === "GASTO" ? "Gastos" : t === "CARGO_MARCA" ? "Cargos" : "Ingresos"}
          </button>
        ))}
      </div>

      {datos && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-5">
          <div className="bg-white border border-neutral-200 border-t-4 border-t-red-600 rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">💸 Gastos</p>
            <p className="text-xl font-extrabold text-neutral-900 tabular-nums">${formatearMonto(datos.totalGastos)}</p>
          </div>
          <div className="bg-white border border-neutral-200 border-t-4 border-t-purple-600 rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">🏷️ Cargos a marca</p>
            <p className="text-xl font-extrabold text-neutral-900 tabular-nums">${formatearMonto(datos.totalCargos)}</p>
          </div>
          <div className="bg-white border border-neutral-200 border-t-4 border-t-emerald-600 rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">💰 Otros ingresos</p>
            <p className="text-xl font-extrabold text-neutral-900 tabular-nums">${formatearMonto(datos.totalIngresos)}</p>
          </div>
          <div className="bg-white border border-neutral-200 border-t-4 border-t-accent rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Σ Balance del período</p>
            <p className={`text-xl font-extrabold tabular-nums ${datos.balance < 0 ? "text-red-600" : "text-emerald-600"}`}>
              {datos.balance >= 0 ? "+" : "-"}${formatearMonto(Math.abs(datos.balance))}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-6">
        <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Movimientos</h2>
          <span className="text-xs text-neutral-400">{itemsFiltrados.length} resultados</span>
        </div>
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : itemsFiltrados.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">No hay movimientos con estos filtros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Descripción</th>
                  <th className="p-3 text-right">Monto</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {itemsFiltrados.map((m) => (
                  <tr key={`${m.tipo}-${m.id}`} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3 whitespace-nowrap text-neutral-500">{formatearFechaCorta(m.fecha)}</td>
                    <td className="p-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TIPO_MOV_BADGE[m.tipo].clases}`}>{TIPO_MOV_BADGE[m.tipo].label}</span>
                    </td>
                    <td className="p-3">
                      {m.concepto}
                      {m.recurrente && <span className="text-[10px] text-neutral-400 ml-1">🔁</span>}
                      <span className="block text-xs text-neutral-400">{m.categoria}</span>
                    </td>
                    <td className={`p-3 text-right tabular-nums font-semibold ${m.monto >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {m.monto >= 0 ? "+" : "-"}${formatearMonto(m.monto)}
                    </td>
                    <td className="p-3 whitespace-nowrap text-right">
                      {m.tipo === "GASTO" && (
                        <button onClick={() => handleEditar(m)} disabled={cargandoEditar === m.id} className="text-accent text-xs font-medium mr-2.5 disabled:opacity-40">
                          {cargandoEditar === m.id ? "..." : "Editar"}
                        </button>
                      )}
                      <button onClick={() => setAnulando(m)} className="text-red-600 text-xs font-medium">
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {resumenG && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 mb-4">
            <div className="bg-white border border-neutral-200 border-t-4 border-t-purple-600 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">📌 Gastos fijos</p>
              <p className="text-xl font-extrabold text-neutral-900 tabular-nums">${formatearMonto(resumenG.totalFijos)}</p>
            </div>
            <div className="bg-white border border-neutral-200 border-t-4 border-t-emerald-600 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">📈 Gastos variables</p>
              <p className="text-xl font-extrabold text-neutral-900 tabular-nums">${formatearMonto(resumenG.totalVariables)}</p>
            </div>
            <div className="bg-white border border-neutral-200 border-t-4 border-t-red-600 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">🧾 Pendientes de factura</p>
              <p className="text-xl font-extrabold text-neutral-900 tabular-nums">{resumenG.pendientesFactura}</p>
            </div>
          </div>

          {resumenG.porCategoria.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-1">
              {resumenG.porCategoria.map((c) => {
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
          <p className="text-xs text-neutral-400 mb-5">% de gastos sobre el total de gastos del período filtrado.</p>

          <PresupuestosPorCategoriaResumen categorias={categoriasGasto} presupuestos={presupuestos} onGuardado={recargar} />
        </>
      )}

      {anulando && (
        <ModalAnularMovimiento
          titulo="Eliminar movimiento"
          descripcion={`${anulando.concepto} — $${formatearMonto(anulando.monto)}`}
          onConfirmar={async (motivo) => {
            const res = await anularMovimientoResumen(anulando, motivo);
            if (!res.error) {
              setAnulando(null);
              recargar();
            }
            return res;
          }}
          onClose={() => setAnulando(null)}
        />
      )}

      {gastoEditando && (
        <ModalEditarGasto
          gasto={gastoEditando}
          categorias={categoriasGasto}
          subcategorias={subcategoriasGasto}
          puedeAutorizarSinLimite={puedeAutorizarSinLimite}
          topeAutorizacion={topeAutorizacion}
          ivaGeneralPorcentaje={ivaGeneralPorcentaje}
          onClose={() => setGastoEditando(null)}
          onGuardado={recargar}
        />
      )}
    </div>
  );
}

function PresupuestosPorCategoriaResumen({
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
      <button type="button" onClick={() => setAbierto((v) => !v)} className="text-xs font-semibold text-accent">
        {abierto ? "▾" : "▸"} Presupuestos mensuales por categoría de gasto
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
                type="button"
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

function ModalPeriodoCerrado({
  periodo,
  guardando,
  onAgregarIgual,
  onCargarProximoMes,
  onCancelar,
}: {
  periodo: string;
  guardando: boolean;
  onAgregarIgual: () => void;
  onCargarProximoMes: () => void;
  onCancelar: () => void;
}) {
  const [anio, mes] = periodo.split("-");
  const nombreMes = `${MESES[Number(mes) - 1] ?? mes} ${anio}`;
  const hoy = new Date();
  const proximoMes = MESES[(hoy.getMonth() + 1) % 12];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5">
        <h3 className="text-sm font-bold text-neutral-900 mb-2">{nombreMes} ya está cerrado</h3>
        <p className="text-sm text-neutral-500 mb-4">
          Este movimiento queda invisible en el Tablero de Resultados si lo cargás así nomás — {nombreMes} ya se cerró y
          quedó congelado.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onAgregarIgual}
            disabled={guardando}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium px-4 py-2.5 rounded-lg text-sm text-left"
          >
            Agregarlo a {nombreMes} igual
            <span className="block text-xs font-normal opacity-90">Reabre el cierre — vas a tener que cerrarlo de nuevo con los valores reales.</span>
          </button>
          <button
            type="button"
            onClick={onCargarProximoMes}
            disabled={guardando}
            className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-4 py-2.5 rounded-lg text-sm text-left"
          >
            Cargarlo en {proximoMes}
            <span className="block text-xs font-normal opacity-90">No toca el cierre de {nombreMes} — se guarda con fecha de {proximoMes}, el mes que sigue abierto.</span>
          </button>
          <button type="button" onClick={onCancelar} disabled={guardando} className="text-sm font-medium text-neutral-500 px-4 py-2 disabled:opacity-50">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== VISTA CATEGORÍAS (Gastos, Cargo a marca, Ingreso) =====================

function VistaCategorias({
  categoriasGasto,
  subcategoriasGasto,
  categoriasCargo,
  subcategoriasCargo,
  categoriasIngreso,
  subcategoriasIngreso,
  onCambio,
}: {
  categoriasGasto: CategoriaGasto[];
  subcategoriasGasto: SubcategoriaGasto[];
  categoriasCargo: CategoriaCargoMarca[];
  subcategoriasCargo: SubcategoriaCargoMarca[];
  categoriasIngreso: CategoriaIngreso[];
  subcategoriasIngreso: SubcategoriaIngreso[];
  onCambio: () => void;
}) {
  return (
    <div>
      <p className="text-xs text-neutral-400 mb-4 max-w-lg">
        Categorías de todo lo que carga esta pantalla — gastos, cargos a marca e ingresos — en un solo lugar. Tocá
        el nombre para renombrarla. &quot;Desactivar&quot; no borra nada, solo deja de aparecer para elegirla de nuevo.
      </p>

      <BloqueCategorias
        icono="💸"
        titulo="Gastos"
        categorias={categoriasGasto}
        subcategorias={subcategoriasGasto}
        conTipo
        onContar={contarGastosPorCategoria}
        onCrear={(nombre, tipo) => crearCategoriaGasto(nombre, tipo ?? "VARIABLE")}
        onRenombrar={(id, nombre, tipo) => renombrarCategoriaGasto(id, nombre, tipo ?? "VARIABLE")}
        onDesactivar={desactivarCategoria}
        onCrearSub={crearSubcategoriaGasto}
        onRenombrarSub={renombrarSubcategoriaGasto}
        onDesactivarSub={desactivarSubcategoria}
        onAplicarTipo={aplicarTipoACategoria}
        onCambio={onCambio}
      />

      <BloqueCategorias
        icono="🏷️"
        titulo="Cargo a marca"
        categorias={categoriasCargo}
        subcategorias={subcategoriasCargo}
        conTipo={false}
        onContar={contarCargosPorCategoria}
        onCrear={(nombre) => crearCategoriaCargoMarca(nombre)}
        onRenombrar={(id, nombre) => renombrarCategoriaCargoMarca(id, nombre)}
        onDesactivar={desactivarCategoriaCargoMarca}
        onCrearSub={crearSubcategoriaCargoMarca}
        onRenombrarSub={renombrarSubcategoriaCargoMarca}
        onDesactivarSub={desactivarSubcategoriaCargoMarca}
        onCambio={onCambio}
      />

      <BloqueCategorias
        icono="💰"
        titulo="Otro ingreso"
        categorias={categoriasIngreso}
        subcategorias={subcategoriasIngreso}
        conTipo={false}
        onContar={contarIngresosPorCategoria}
        onCrear={(nombre) => crearCategoriaIngreso(nombre)}
        onRenombrar={(id, nombre) => renombrarCategoriaIngreso(id, nombre)}
        onDesactivar={desactivarCategoriaIngreso}
        onCrearSub={crearSubcategoriaIngreso}
        onRenombrarSub={renombrarSubcategoriaIngreso}
        onDesactivarSub={desactivarSubcategoriaIngreso}
        onCambio={onCambio}
      />
    </div>
  );
}

type CategoriaBase = { id_categoria: string; nombre: string; estado: string; tipo_default?: string };
type SubcategoriaBase = { id_subcategoria: string; id_categoria: string; nombre: string; estado: string };

function BloqueCategorias({
  icono,
  titulo,
  categorias,
  subcategorias,
  conTipo,
  onContar,
  onCrear,
  onRenombrar,
  onDesactivar,
  onCrearSub,
  onRenombrarSub,
  onDesactivarSub,
  onAplicarTipo,
  onCambio,
}: {
  icono: string;
  titulo: string;
  categorias: CategoriaBase[];
  subcategorias: SubcategoriaBase[];
  conTipo: boolean;
  onContar: () => Promise<{ porCategoria: Record<string, number>; porSubcategoria: Record<string, number> }>;
  onCrear: (nombre: string, tipo?: "FIJO" | "VARIABLE") => Promise<{ error: string | null }>;
  onRenombrar: (id: string, nombre: string, tipo?: "FIJO" | "VARIABLE") => Promise<{ error: string | null }>;
  onDesactivar: (id: string) => Promise<{ error: string | null }>;
  onCrearSub: (idCategoria: string, nombre: string) => Promise<{ error: string | null }>;
  onRenombrarSub: (id: string, nombre: string) => Promise<{ error: string | null }>;
  onDesactivarSub: (id: string) => Promise<{ error: string | null }>;
  onAplicarTipo?: (id: string) => Promise<{ error: string | null; actualizados?: number }>;
  onCambio: () => void;
}) {
  const [desactivandoId, setDesactivandoId] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [valorEdit, setValorEdit] = useState("");
  const [valorTipoEdit, setValorTipoEdit] = useState<"FIJO" | "VARIABLE">("VARIABLE");
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [nombreNueva, setNombreNueva] = useState("");
  const [tipoNueva, setTipoNueva] = useState<"VARIABLE" | "FIJO">("VARIABLE");
  const [agregandoSubDe, setAgregandoSubDe] = useState<string | null>(null);
  const [nombreNuevaSub, setNombreNuevaSub] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [conteo, setConteo] = useState<{ porCategoria: Record<string, number>; porSubcategoria: Record<string, number> }>({
    porCategoria: {},
    porSubcategoria: {},
  });

  useEffect(() => {
    onContar().then(setConteo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function etiquetaCantidad(n: number) {
    return `${n} ${n === 1 ? "cargado" : "cargados"}`;
  }

  function handleDesactivarCategoria(c: CategoriaBase) {
    const cantidad = conteo.porCategoria[c.id_categoria] ?? 0;
    if (cantidad > 0) {
      const ok = confirm(
        `"${c.nombre}" ya tiene ${etiquetaCantidad(cantidad)}. Si la desactivás, no vas a poder elegirla de nuevo — para seguir comparándola, dejala activa.\n\n¿Desactivar de todos modos?`
      );
      if (!ok) return;
    }
    setDesactivandoId(c.id_categoria);
    onDesactivar(c.id_categoria)
      .then((res) => {
        if (res.error) alert(res.error);
        else onCambio();
      })
      .finally(() => setDesactivandoId(null));
  }

  function handleDesactivarSubcategoria(s: SubcategoriaBase) {
    const cantidad = conteo.porSubcategoria[s.id_subcategoria] ?? 0;
    if (cantidad > 0) {
      const ok = confirm(`"${s.nombre}" ya tiene ${etiquetaCantidad(cantidad)}. Si la desactivás, no vas a poder elegirla de nuevo.\n\n¿Desactivar de todos modos?`);
      if (!ok) return;
    }
    setDesactivandoId(s.id_subcategoria);
    onDesactivarSub(s.id_subcategoria)
      .then((res) => {
        if (res.error) alert(res.error);
        else onCambio();
      })
      .finally(() => setDesactivandoId(null));
  }

  function guardarNuevaCategoria() {
    if (!nombreNueva.trim()) return;
    setGuardando(true);
    onCrear(nombreNueva, tipoNueva)
      .then((res) => {
        if (res.error) alert(res.error);
        else {
          onCambio();
          setMostrarNueva(false);
          setNombreNueva("");
        }
      })
      .finally(() => setGuardando(false));
  }

  function guardarNuevaSubcategoria(idCategoria: string) {
    if (!nombreNuevaSub.trim()) return;
    setGuardando(true);
    onCrearSub(idCategoria, nombreNuevaSub)
      .then((res) => {
        if (res.error) alert(res.error);
        else {
          onCambio();
          setAgregandoSubDe(null);
          setNombreNuevaSub("");
        }
      })
      .finally(() => setGuardando(false));
  }

  function preguntarAplicarACategoria(c: CategoriaBase, tipoNuevo: "FIJO" | "VARIABLE") {
    if (!onAplicarTipo) return;
    const cantidad = conteo.porCategoria[c.id_categoria] ?? 0;
    if (cantidad === 0) return;
    const etiqueta = tipoNuevo === "FIJO" ? "Fijo" : "Variable";
    const ok = confirm(`Ya cargaste ${etiquetaCantidad(cantidad)} en "${c.nombre}" (con cualquier subcategoría). ¿Marcarlos también como ${etiqueta} ahora?`);
    if (!ok) return;
    onAplicarTipo(c.id_categoria).then((res) => {
      if (res.error) alert(res.error);
      else onCambio();
    });
  }

  function guardarRenombreCategoria(c: CategoriaBase) {
    if (!valorEdit.trim()) {
      setEditando(null);
      return;
    }
    const tipoCambio = conTipo && valorTipoEdit !== c.tipo_default;
    if (valorEdit === c.nombre && !tipoCambio) {
      setEditando(null);
      return;
    }
    setGuardando(true);
    onRenombrar(c.id_categoria, valorEdit, valorTipoEdit)
      .then((res) => {
        if (res.error) alert(res.error);
        else {
          onCambio();
          setEditando(null);
          if (tipoCambio) preguntarAplicarACategoria(c, valorTipoEdit);
        }
      })
      .finally(() => setGuardando(false));
  }

  function guardarRenombreSubcategoria(s: SubcategoriaBase) {
    if (!valorEdit.trim() || valorEdit === s.nombre) {
      setEditando(null);
      return;
    }
    setGuardando(true);
    onRenombrarSub(s.id_subcategoria, valorEdit)
      .then((res) => {
        if (res.error) alert(res.error);
        else {
          onCambio();
          setEditando(null);
        }
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="mb-6">
      <h2 className="text-sm font-bold text-neutral-900 mb-2">
        {icono} {titulo}
      </h2>

      {!mostrarNueva ? (
        <button
          type="button"
          onClick={() => setMostrarNueva(true)}
          className="bg-accent hover:bg-accent-dark text-white font-medium px-3.5 py-1.5 rounded-lg text-sm mb-3"
        >
          + Nueva categoría
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 bg-accent-tint border border-accent rounded-lg p-3 mb-3">
          <input
            autoFocus
            value={nombreNueva}
            onChange={(e) => setNombreNueva(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && guardarNuevaCategoria()}
            placeholder="Nombre de la categoría"
            className="flex-1 min-w-[160px] border border-neutral-300 rounded-md px-2.5 py-1.5 text-sm"
          />
          {conTipo && (
            <select value={tipoNueva} onChange={(e) => setTipoNueva(e.target.value as "VARIABLE" | "FIJO")} className="border border-neutral-300 rounded-md px-2 py-1.5 text-sm">
              <option value="VARIABLE">Variable</option>
              <option value="FIJO">Fijo</option>
            </select>
          )}
          <button type="button" onClick={guardarNuevaCategoria} disabled={guardando} className="bg-accent text-white text-xs font-bold px-3 py-1.5 rounded-md disabled:opacity-50">
            Guardar
          </button>
          <button
            type="button"
            onClick={() => {
              setMostrarNueva(false);
              setNombreNueva("");
            }}
            className="text-xs font-semibold text-neutral-500 px-2"
          >
            Cancelar
          </button>
        </div>
      )}

      {categorias.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8 bg-white border border-neutral-200 rounded-xl">Todavía no hay categorías creadas.</p>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          {categorias.map((c) => {
            const subs = subcategorias.filter((s) => s.id_categoria === c.id_categoria);
            return (
              <div key={c.id_categoria} className="border-b border-neutral-100 last:border-0">
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  {editando === c.id_categoria ? (
                    <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                      <input
                        autoFocus
                        value={valorEdit}
                        onChange={(e) => setValorEdit(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") guardarRenombreCategoria(c);
                          if (e.key === "Escape") setEditando(null);
                        }}
                        className="text-sm font-bold border border-accent rounded-md px-2 py-1 flex-1 min-w-[120px]"
                      />
                      {conTipo && (
                        <select value={valorTipoEdit} onChange={(e) => setValorTipoEdit(e.target.value as "FIJO" | "VARIABLE")} className="text-xs border border-accent rounded-md px-1.5 py-1">
                          <option value="VARIABLE">Variable</option>
                          <option value="FIJO">Fijo</option>
                        </select>
                      )}
                      <button type="button" onClick={() => guardarRenombreCategoria(c)} disabled={guardando} className="text-[11px] font-bold text-accent px-1.5">
                        Guardar
                      </button>
                      <button type="button" onClick={() => setEditando(null)} className="text-[11px] text-neutral-400 px-1">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditando(c.id_categoria);
                        setValorEdit(c.nombre);
                        setValorTipoEdit(c.tipo_default === "FIJO" ? "FIJO" : "VARIABLE");
                      }}
                      className="text-sm font-bold text-neutral-900 text-left hover:text-accent underline decoration-dotted decoration-neutral-300 underline-offset-4"
                      title="Tocar para renombrar"
                    >
                      {c.nombre}
                      {conTipo && (
                        <span className={`text-[10px] font-bold ml-2 px-1.5 py-0.5 rounded-full no-underline ${c.tipo_default === "FIJO" ? "bg-purple-100 text-purple-700" : "bg-accent-tint text-accent-dark"}`}>
                          {c.tipo_default === "FIJO" ? "Fijo" : "Variable"}
                        </span>
                      )}
                      <span className="text-xs font-medium text-neutral-400 ml-2 no-underline">
                        {subs.length} {subs.length === 1 ? "subcategoría" : "subcategorías"}
                        {(conteo.porCategoria[c.id_categoria] ?? 0) > 0 && <> · {conteo.porCategoria[c.id_categoria]} {conteo.porCategoria[c.id_categoria] === 1 ? "cargado" : "cargados"}</>}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDesactivarCategoria(c)}
                    disabled={desactivandoId === c.id_categoria}
                    className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-600 rounded-lg px-2.5 py-1 disabled:opacity-40 whitespace-nowrap"
                  >
                    {desactivandoId === c.id_categoria ? "..." : "Desactivar"}
                  </button>
                </div>
                <div className="px-4 pb-3 pl-7 space-y-1.5">
                  {subs.map((s) => (
                    <div key={s.id_subcategoria} className="flex items-center justify-between gap-3 text-xs text-neutral-600 border-t border-dashed border-neutral-100 pt-1.5 first:border-0 first:pt-0">
                      {editando === s.id_subcategoria ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <input
                            autoFocus
                            value={valorEdit}
                            onChange={(e) => setValorEdit(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") guardarRenombreSubcategoria(s);
                              if (e.key === "Escape") setEditando(null);
                            }}
                            className="border border-accent rounded-md px-2 py-0.5 text-xs flex-1"
                          />
                          <button type="button" onClick={() => guardarRenombreSubcategoria(s)} disabled={guardando} className="text-[10.5px] font-bold text-accent px-1">
                            Guardar
                          </button>
                          <button type="button" onClick={() => setEditando(null)} className="text-[10.5px] text-neutral-400 px-1">
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditando(s.id_subcategoria);
                            setValorEdit(s.nombre);
                          }}
                          className="text-left hover:text-accent underline decoration-dotted decoration-neutral-300 underline-offset-4"
                          title="Tocar para renombrar"
                        >
                          {s.nombre}
                          {(conteo.porSubcategoria[s.id_subcategoria] ?? 0) > 0 && (
                            <span className="text-neutral-400 ml-1.5 no-underline">
                              · {conteo.porSubcategoria[s.id_subcategoria]} {conteo.porSubcategoria[s.id_subcategoria] === 1 ? "cargado" : "cargados"}
                            </span>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDesactivarSubcategoria(s)}
                        disabled={desactivandoId === s.id_subcategoria}
                        className="text-[10.5px] font-bold text-red-600 bg-red-50 border border-red-600 rounded-lg px-2 py-0.5 disabled:opacity-40 whitespace-nowrap"
                      >
                        {desactivandoId === s.id_subcategoria ? "..." : "Desactivar"}
                      </button>
                    </div>
                  ))}
                  {agregandoSubDe === c.id_categoria ? (
                    <div className="flex items-center gap-1.5 pt-1.5 border-t border-dashed border-neutral-100">
                      <input
                        autoFocus
                        value={nombreNuevaSub}
                        onChange={(e) => setNombreNuevaSub(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && guardarNuevaSubcategoria(c.id_categoria)}
                        placeholder="Nueva subcategoría..."
                        className="flex-1 border border-neutral-300 rounded-md px-2 py-1 text-xs"
                      />
                      <button type="button" onClick={() => guardarNuevaSubcategoria(c.id_categoria)} disabled={guardando} className="text-[11px] font-bold text-accent disabled:opacity-50">
                        Agregar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAgregandoSubDe(null);
                          setNombreNuevaSub("");
                        }}
                        className="text-[11px] text-neutral-400"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setAgregandoSubDe(c.id_categoria)} className="text-[11px] font-bold text-accent pt-1">
                      + Agregar subcategoría
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
