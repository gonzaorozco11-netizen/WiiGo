"use client";

import { useEffect, useState } from "react";
import type { Local, Marca, CategoriaGasto, SubcategoriaGasto, CategoriaCargoMarca, SubcategoriaCargoMarca, CategoriaIngreso, SubcategoriaIngreso } from "@/lib/supabase";
import { crearGasto, crearRecurrente, listarRecurrentes, cargarRecurrente } from "@/app/(app)/gastos/actions";
import { registrarPagoComercial } from "@/app/(app)/situacion-marca/actions";
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
  type MovimientoUnificado,
} from "@/app/(app)/gastos-ingresos/actions";

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
  categoriasGasto,
  subcategoriasGasto,
  categoriasCargo,
  subcategoriasCargo,
  categoriasIngreso,
  subcategoriasIngreso,
  topeAutorizacion,
  puedeAutorizarSinLimite,
  ivaGeneralPorcentaje,
}: {
  locales: Local[];
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
  const [tab, setTab] = useState<Tab>("gasto");
  const [modoCargo, setModoCargo] = useState<"CARGO" | "PAGO">("CARGO");
  const [recurrencia, setRecurrencia] = useState<Recurrencia>("UNICO");
  const [idMarca, setIdMarca] = useState(marcas[0]?.id_marca ?? "");
  const [idCategoria, setIdCategoria] = useState(categoriasGasto[0]?.id_categoria ?? "__nueva__");
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [idSubcategoria, setIdSubcategoria] = useState("");
  const [nuevaSubcategoria, setNuevaSubcategoria] = useState("");
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

  const montoNum = Number(monto.replace(/[^\d.-]/g, "")) || 0;
  const montoConIva = redondear2(montoNum * (1 + ivaGeneralPorcentaje / 100));
  const mostrarAuth = tab === "gasto" && recurrencia === "UNICO" && !puedeAutorizarSinLimite && montoNum > topeAutorizacion;

  const categorias = tab === "gasto" ? categoriasGasto : tab === "cargo" ? categoriasCargo : categoriasIngreso;
  const subcategorias = tab === "gasto" ? subcategoriasGasto : tab === "cargo" ? subcategoriasCargo : subcategoriasIngreso;
  const subDisponibles = subcategorias.filter((s) => s.id_categoria === idCategoria);

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
              puedeIva: false,
              llevaIvaDefault: false,
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
  }

  function handleGuardar() {
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
      setGuardando(true);
      registrarPagoComercial(idMarca, fdPago)
        .then((res) => {
          if (res.error) {
            setError(res.error);
            return;
          }
          setMensajeOk("Pago registrado.");
          resetForm();
          recargarListas();
        })
        .catch((err) => setError(err instanceof Error ? err.message : "No se pudo registrar el pago"))
        .finally(() => setGuardando(false));
      return;
    }

    if (idCategoria === "__nueva__" && !nuevaCategoria.trim()) {
      setError("Elegí o creá una categoría");
      return;
    }

    const fd = new FormData();
    if (idCategoria === "__nueva__") fd.append("nueva_categoria", nuevaCategoria);
    else fd.append("id_categoria", idCategoria);
    if (idSubcategoria === "__nueva__" && nuevaSubcategoria.trim()) {
      fd.append(tab === "gasto" ? "nueva_subcategoria_gasto" : "nueva_subcategoria", nuevaSubcategoria);
    } else if (idSubcategoria) {
      fd.append("id_subcategoria", idSubcategoria);
    }
    fd.append("descripcion", descripcion);
    if ((tab === "cargo" || tab === "ingreso") && llevaIva) fd.append("lleva_iva", "on");

    let promesa: Promise<{ error: string | null }>;

    if (tab === "gasto") {
      if (recurrencia === "UNICO") {
        fd.append("monto", String(montoNum));
        fd.append("tipo", "VARIABLE");
        fd.append("medio_pago", medioPago);
        if (idLocal) fd.append("id_local", idLocal);
        if (claveAdmin) fd.append("clave_admin", claveAdmin);
        promesa = crearGasto(fd);
      } else {
        fd.append("monto_estimado", String(montoNum));
        fd.append("dia_mes", diaMes);
        if (idLocal) fd.append("id_local", idLocal);
        promesa = crearRecurrente(fd);
      }
    } else if (tab === "cargo") {
      if (recurrencia === "UNICO") {
        fd.append("monto", String(montoNum));
        promesa = registrarCargoMarcaUnico(idMarca, fd);
      } else {
        fd.append("monto_estimado", String(montoNum));
        fd.append("recurrencia", recurrencia);
        fd.append("dia_mes", diaMes);
        if (recurrencia === "ANUAL") fd.append("mes_anual", mesAnual);
        promesa = crearCargoRecurrenteMarca(idMarca, fd);
      }
    } else {
      if (recurrencia === "UNICO") {
        fd.append("monto", String(montoNum));
        fd.append("medio_pago", medioPago);
        if (idLocal) fd.append("id_local", idLocal);
        promesa = crearIngreso(fd);
      } else {
        fd.append("monto_estimado", String(montoNum));
        fd.append("recurrencia", recurrencia);
        fd.append("dia_mes", diaMes);
        if (recurrencia === "ANUAL") fd.append("mes_anual", mesAnual);
        promesa = crearIngresoRecurrente(fd);
      }
    }

    setGuardando(true);
    promesa
      .then((res) => {
        if (res.error) {
          setError(res.error);
          return;
        }
        setMensajeOk(recurrencia === "UNICO" ? "Guardado." : "Guardado — vas a tener que confirmarlo cada período en 'Pendiente de cargar'.");
        resetForm();
        recargarListas();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar"))
      .finally(() => setGuardando(false));
  }

  function handleCargarPendiente(item: PendienteRecurrente) {
    const montoNum = Number((montoCargar[item.id] ?? String(item.montoEstimado)).replace(/[^\d.-]/g, "")) || 0;
    const medio = medioCargar[item.id] ?? "TRANSFERENCIA";
    const iva = ivaCargar[item.id] ?? item.llevaIvaDefault;
    setError(null);
    setCargandoId(item.id);
    let promesa: Promise<{ error: string | null } | void>;
    if (item.tipo === "gasto") promesa = cargarRecurrente(item.id, montoNum, medio);
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
                <input
                  value={nuevaCategoria}
                  onChange={(e) => setNuevaCategoria(e.target.value)}
                  placeholder="Nombre de la categoría nueva"
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-1.5"
                />
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

        <div className={`grid grid-cols-1 gap-3 mb-3 ${tab === "cargo" && modoCargo === "PAGO" ? "" : "sm:grid-cols-2"}`}>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              {tab === "cargo" && modoCargo === "PAGO" ? "Monto pagado" : `Monto ${recurrencia !== "UNICO" ? "estimado " : ""}${tab === "cargo" || tab === "ingreso" ? "(sin IVA)" : ""}`}
            </label>
            <input value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$0" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />

            {(tab === "cargo" || tab === "ingreso") && !(tab === "cargo" && modoCargo === "PAGO") && (
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
