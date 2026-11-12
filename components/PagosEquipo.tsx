"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  armarPagosEquipo,
  guardarConfigPago,
  pagarHonorario,
  subirFacturaPago,
  urlArchivoPago,
  darDeBajaHonorarioSuelto,
  type PagosEquipoMes,
  type FilaPago,
  type RespuestasPago,
  type MedioPagoEquipo,
} from "@/app/(app)/rrhh/pagos-actions";
import { obtenerUrlReciboSueldo } from "@/app/(app)/rrhh/actions";
import { SelectorMes } from "@/components/AsistenciaMes";

// RR.HH. → Sueldos → Pagos del equipo (Gonzalo, 2026-11-12; boceto aprobado
// https://claude.ai/artifact/V8oXTHuAmvb8qUP4wPChmR). Todo lo que se le paga
// a la gente en una lista: arriba cuánto llevás gastado, por pagar y en el
// año; después cada persona con su estado y un botón. «Editar» abre las
// preguntas de a una (empleado o factura, todos los meses, monto, día, cómo
// le pagás, si ya empezó). Ver app/(app)/rrhh/pagos-actions.ts.

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const TONO = {
  bien: "bg-emerald-50 text-emerald-700",
  ojo: "bg-amber-50 text-amber-700",
  mal: "bg-red-50 text-red-700",
  gris: "bg-neutral-100 text-neutral-500",
} as const;
const GRUPOS: { clave: FilaPago["grupo"]; titulo: string }[] = [
  { clave: "POR_HORA", titulo: "Empleados del local · por hora" },
  { clave: "SUELDO_FIJO", titulo: "Empleados · sueldo fijo" },
  { clave: "FACTURA", titulo: "Te facturan · servicios tercerizados" },
  { clave: "SIN_CARGAR", titulo: "Falta cargar cómo se les paga" },
  { clave: "NO_EMPEZO", titulo: "Todavía no empezaron" },
];
const MEDIOS: { valor: MedioPagoEquipo; texto: string; detalle: string }[] = [
  { valor: "TRANSFERENCIA", texto: "Transferencia", detalle: "a su alias o CBU" },
  { valor: "EFECTIVO_ADMIN", texto: "Efectivo", detalle: "de Caja Administración" },
  { valor: "MERCADO_PAGO", texto: "Mercado Pago", detalle: "desde la cuenta de MP" },
];
const fechaCorta = (iso: string) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "");

function abrirArchivo(promesa: Promise<string>) {
  promesa.then((url) => window.open(url, "_blank", "noopener")).catch(() => {});
}

export default function PagosEquipo({
  periodo,
  setPeriodo,
  onIrASueldos,
  onAbrirFicha,
}: {
  periodo: string;
  setPeriodo: (p: string) => void;
  onIrASueldos: () => void;
  onAbrirFicha: (idPersona: string) => void;
}) {
  const [d, setD] = useState<PagosEquipoMes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<FilaPago | null>(null);
  const [pagando, setPagando] = useState<FilaPago | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);

  const cargar = useCallback(() => {
    armarPagosEquipo(periodo)
      .then((r) => {
        setD(r);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los pagos."));
  }, [periodo]);
  useEffect(() => {
    const t = setTimeout(cargar, 0);
    return () => clearTimeout(t);
  }, [cargar]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!d) return <p className="text-sm text-neutral-400 text-center py-10">Cargando...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/organizacion" className="text-sm font-semibold text-accent hover:underline" title="Las personas se cargan en Equipo → Organización">
          + Agregar a alguien
        </Link>
        <SelectorMes periodo={periodo} setPeriodo={setPeriodo} />
      </div>

      {d.faltaSql && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          Para poder guardar cómo se le paga a cada uno, los pagos con su factura y la firma de los recibos, falta correr{" "}
          <b>sql/pagos-equipo.sql</b> en Supabase (una sola vez). Mientras tanto se ve todo, pero no se puede guardar.
        </p>
      )}
      {aviso && <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{aviso}</p>}

      {/* El resumen: lo gastado, lo que falta y el año. */}
      <section className="grid sm:grid-cols-3 gap-3">
        <div className="bg-white border border-neutral-200 rounded-xl px-4 py-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">Llevás gastado en {d.etiquetaMes.split(" ")[0].toLowerCase()}</p>
          <p className="tipo-titulo text-2xl font-bold tabular-nums text-neutral-900 mt-1">{pesos(d.resumen.gastado)}</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            Empleados {pesos(d.resumen.sueldos)} · honorarios pagados {pesos(d.resumen.honorarios)}
          </p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl px-4 py-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">Por pagar</p>
          <p className="tipo-titulo text-2xl font-bold tabular-nums text-neutral-900 mt-1">{pesos(d.resumen.porPagar)}</p>
          <p className="text-xs text-neutral-500 mt-0.5">{d.esMesActual ? "Lo que llevan los empleados y los honorarios sin pagar" : "Lo que quedó sin pagar de ese mes"}</p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl px-4 py-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">En lo que va del año</p>
          <p className="tipo-titulo text-2xl font-bold tabular-nums text-neutral-900 mt-1">{pesos(d.resumen.enElAnio)}</p>
          <p className="text-xs text-neutral-500 mt-0.5">Sueldos y honorarios, de enero a {d.etiquetaMes.split(" ")[0].toLowerCase()}</p>
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-xl p-4 space-y-2">
        {d.filas.length === 0 && <p className="text-sm text-neutral-400">No hay empleados ni tercerizados cargados. Se cargan en Equipo → Organización.</p>}
        {GRUPOS.map((g) => {
          const filas = d.filas.filter((f) => f.grupo === g.clave);
          if (filas.length === 0) return null;
          return (
            <div key={g.clave} className="space-y-2">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 pt-2">{g.titulo}</p>
              {filas.map((f) => (
                <FilaPersona
                  key={f.idPersona}
                  f={f}
                  onEditar={() => setEditando(f)}
                  onPagar={() => setPagando(f)}
                  onIrASueldos={onIrASueldos}
                  onAbrirFicha={() => onAbrirFicha(f.idPersona)}
                  onRecargar={cargar}
                />
              ))}
            </div>
          );
        })}
      </section>

      {d.sueltos.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="font-semibold text-amber-900">Honorarios fijos que no son de nadie</p>
          <p className="text-xs text-amber-800/80 mb-2">
            Están cargados como gasto de todos los meses, pero no los reconoce como de ninguna persona. Si uno está repetido, dalo de baja.
          </p>
          <ul className="space-y-1.5">
            {d.sueltos.map((s) => (
              <li key={s.idRecurrente} className="flex flex-wrap items-center gap-2 text-sm bg-white rounded-lg px-3 py-2">
                <span className="font-medium text-neutral-800">{s.descripcion}</span>
                <span className="tabular-nums text-neutral-600">{pesos(s.monto)} por mes</span>
                {bajando === s.idRecurrente ? (
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    ¿Seguro? Deja de sumarse todos los meses.
                    <button
                      type="button"
                      className="font-bold text-red-700"
                      onClick={() =>
                        darDeBajaHonorarioSuelto(s.idRecurrente).then((r) => {
                          setBajando(null);
                          if (r.error) setAviso(r.error);
                          else cargar();
                        })
                      }
                    >
                      Sí, dar de baja
                    </button>
                    <button type="button" className="text-neutral-500" onClick={() => setBajando(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setBajando(s.idRecurrente)} className="ml-auto text-xs font-semibold text-red-700 hover:underline">
                    Dar de baja
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {editando && (
        <ModalPreguntas
          fila={editando}
          onClose={() => setEditando(null)}
          onGuardado={(msg) => {
            setEditando(null);
            setAviso(msg ?? null);
            cargar();
          }}
        />
      )}
      {pagando && (
        <ModalPagarHonorario
          fila={pagando}
          periodo={periodo}
          etiquetaMes={d.etiquetaMes}
          onClose={() => setPagando(null)}
          onPagado={() => {
            setPagando(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

/** «Falta su factura» con el botón para subirla cuando llega. */
function SubirFactura({ idGasto, onSubida }: { idGasto: string; onSubida: () => void }) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="text-amber-700 cursor-pointer">
      Falta su factura · <span className="font-semibold text-accent hover:underline">{subiendo ? "Subiendo…" : "Subirla"}</span>
      <input
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (!archivo) return;
          const fd = new FormData();
          fd.set("factura", archivo);
          setSubiendo(true);
          subirFacturaPago(idGasto, fd)
            .then((r) => (r.error ? setError(r.error) : onSubida()))
            .finally(() => setSubiendo(false));
        }}
      />
      {error && <span className="block text-red-600">{error}</span>}
    </label>
  );
}

function FilaPersona({
  f,
  onEditar,
  onPagar,
  onIrASueldos,
  onAbrirFicha,
  onRecargar,
}: {
  f: FilaPago;
  onEditar: () => void;
  onPagar: () => void;
  onIrASueldos: () => void;
  onAbrirFicha: () => void;
  onRecargar: () => void;
}) {
  const pagada = Boolean(f.pagado);
  return (
    <div className={`rounded-xl border px-4 py-3 ${pagada ? "bg-emerald-50/60 border-emerald-100" : f.grupo === "SIN_CARGAR" || f.grupo === "NO_EMPEZO" ? "border-dashed border-neutral-300" : "border-neutral-200"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button type="button" onClick={onAbrirFicha} className="text-left min-w-0 flex-1 hover:underline">
          <span className="block font-semibold text-neutral-900">{f.nombre}</span>
          <span className="block text-xs text-neutral-500">{f.detalle}</span>
        </button>
        {f.monto !== null && (
          <span className="text-right tabular-nums">
            <b className="block text-[15px] text-neutral-900">{pesos(f.monto)}</b>
            {f.montoNota && <span className="block text-[11px] text-neutral-400">{f.montoNota}</span>}
          </span>
        )}
        {f.monto === null && f.montoNota === "variable" && <span className="text-xs text-neutral-500">monto variable</span>}
        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${TONO[f.estado.tono]}`}>{f.estado.texto}</span>
        <span className="flex gap-1.5">
          {f.accion === "PAGAR_HONORARIO" && (
            <button type="button" onClick={onPagar} className="bg-accent hover:bg-accent-dark text-white text-xs font-bold rounded-lg px-3 py-1.5">
              Pagar
            </button>
          )}
          {f.accion === "SUELDOS" && (
            <button type="button" onClick={onIrASueldos} className="bg-accent hover:bg-accent-dark text-white text-xs font-bold rounded-lg px-3 py-1.5">
              Cerrar y pagar
            </button>
          )}
          <button
            type="button"
            onClick={onEditar}
            className={`text-xs font-semibold rounded-lg px-3 py-1.5 border ${f.accion === "CARGAR" ? "bg-accent text-white border-accent" : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"}`}
          >
            {f.accion === "CARGAR" ? "Cargar" : "Editar"}
          </button>
        </span>
      </div>
      {f.pagado && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 pt-2 border-t border-dashed border-emerald-200 text-xs text-neutral-600">
          <span>
            Pagado {fechaCorta(f.pagado.fecha)} · {f.pagado.medio}
          </span>
          {f.pagado.comprobantePath && (
            <button
              type="button"
              className="text-accent font-semibold hover:underline"
              onClick={() => abrirArchivo(f.pagado!.idCierre ? obtenerUrlReciboSueldo(f.pagado!.comprobantePath!) : urlArchivoPago(f.pagado!.comprobantePath!))}
            >
              📎 Comprobante
            </button>
          )}
          {f.pagado.facturaPath && (
            <button type="button" className="text-accent font-semibold hover:underline" onClick={() => abrirArchivo(urlArchivoPago(f.pagado!.facturaPath!))}>
              🧾 Factura
            </button>
          )}
          {f.grupo === "FACTURA" && !f.pagado.facturaPath && f.pagado.idGasto && <SubirFactura idGasto={f.pagado.idGasto} onSubida={onRecargar} />}
          {f.pagado.idCierre && (
            <>
              <span className={f.pagado.firmado ? "text-emerald-700 font-semibold" : "text-amber-700"}>
                {f.pagado.firmado ? "Recibo firmado ✓" : "Falta que firme el recibo (le aparece en su usuario)"}
              </span>
              <a href={`/rrhh/recibo/${f.pagado.idCierre}`} target="_blank" rel="noopener noreferrer" className="text-accent font-semibold hover:underline">
                Ver recibo
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ===================== LAS PREGUNTAS =====================

function Opcion({ activa, titulo, detalle, onClick }: { activa: boolean; titulo: string; detalle?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`text-left rounded-xl border-2 px-3 py-2 text-sm ${activa ? "border-accent bg-accent-tint text-accent-dark" : "border-neutral-200 bg-white text-neutral-800"}`}
    >
      <span className="block font-semibold">{titulo}</span>
      {detalle && <span className="block text-xs text-neutral-500 font-normal">{detalle}</span>}
    </button>
  );
}

function Pregunta({ titulo, children, ayuda }: { titulo: string; children: React.ReactNode; ayuda?: string }) {
  return (
    <div className="border border-neutral-200 rounded-xl px-4 py-3">
      <p className="font-semibold text-neutral-900 text-sm mb-2">{titulo}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
      {ayuda && <p className="text-xs text-neutral-500 mt-2">{ayuda}</p>}
    </div>
  );
}

const numero = (s: string) => {
  const n = Number(s.replace(/[^\d,]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function ModalPreguntas({ fila, onClose, onGuardado }: { fila: FilaPago; onClose: () => void; onGuardado: (aviso?: string) => void }) {
  const c = fila.config;
  const [modalidad, setModalidad] = useState(c.modalidad);
  const [frecuencia, setFrecuencia] = useState(c.frecuencia);
  const [montoFijo, setMontoFijo] = useState(c.montoFijo);
  const [monto, setMonto] = useState(c.monto ? String(c.monto) : "");
  const [cobraPor, setCobraPor] = useState(c.cobraPor);
  const [valor, setValor] = useState(c.valor ? String(c.valor) : "");
  const [cobraPresentismo, setCobraPresentismo] = useState(c.cobraPresentismo);
  const [diaLegal, setDiaLegal] = useState(c.diaPago === null);
  const [dia, setDia] = useState(c.diaPago ? String(c.diaPago) : "");
  const [medio, setMedio] = useState<MedioPagoEquipo | null>(c.medioHabitual);
  const [alias, setAlias] = useState(c.alias ?? "");
  const [empezo, setEmpezo] = useState(c.empezo);
  const [ingreso, setIngreso] = useState(c.fechaIngreso ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esEmpleado = modalidad === "EMPLEADO";
  const nombreCorto = fila.nombre.split(" ")[0];
  const diaNum = Number(dia) || null;
  const resumen = esEmpleado
    ? `${fila.nombre}, empleado/a, ${cobraPor === "HORA" ? `${valor ? pesos(numero(valor) ?? 0) : "$…"} la hora` : `${valor ? pesos(numero(valor) ?? 0) : "$…"} por mes`}${cobraPresentismo ? ", con presentismo" : ""}, ${diaLegal ? "se paga el 4.º día hábil" : `se paga el día ${dia || "…"}`}${medio ? `, por ${MEDIOS.find((m) => m.valor === medio)?.texto.toLowerCase()}` : ""}${empezo ? "" : ". Todavía no empezó: no suma en los costos"}.`
    : `${fila.nombre}, te factura, ${frecuencia === "UNICA" ? "una sola vez" : "todos los meses"}, ${montoFijo ? (monto ? pesos(numero(monto) ?? 0) : "$…") : "monto variable"}${frecuencia === "MENSUAL" && dia ? `, el día ${dia}` : ""}${medio ? `, por ${MEDIOS.find((m) => m.valor === medio)?.texto.toLowerCase()}` : ""}${empezo ? "" : ". Todavía no empezó: no suma en los costos"}.`;

  function guardar() {
    const r: RespuestasPago = {
      modalidad,
      frecuencia: esEmpleado ? "MENSUAL" : frecuencia,
      montoFijo,
      monto: esEmpleado ? null : montoFijo ? numero(monto) : null,
      cobraPor,
      valor: esEmpleado ? numero(valor) : null,
      cobraPresentismo: esEmpleado ? cobraPresentismo : false,
      diaPago: esEmpleado && diaLegal ? null : diaNum,
      medioHabitual: medio,
      empezo,
      fechaIngreso: esEmpleado ? ingreso || null : c.fechaIngreso,
      alias: alias.trim() || null,
    };
    setGuardando(true);
    setError(null);
    guardarConfigPago(fila.idPersona, r)
      .then((res) => (res.error ? setError(res.error) : onGuardado(res.aviso)))
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-neutral-900">Cómo le pagás a {fila.nombre}</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="text-sm text-neutral-500 mb-3">Contestá y el sistema arma el resto. Después se cambia cuando quieras.</p>

        <div className="space-y-2.5">
          <Pregunta titulo={`¿${nombreCorto} es empleado/a o te factura?`}>
            <Opcion activa={esEmpleado} titulo="Empleado/a" detalle="ficha, recibo de sueldo, aguinaldo" onClick={() => setModalidad("EMPLEADO")} />
            <Opcion activa={!esEmpleado} titulo="Me factura" detalle="monotributo: te da una factura" onClick={() => setModalidad("FACTURA")} />
          </Pregunta>

          {esEmpleado ? (
            <>
              <Pregunta titulo="¿Cobra por hora o un sueldo fijo?">
                <Opcion activa={cobraPor === "HORA"} titulo="Por hora" onClick={() => setCobraPor("HORA")} />
                <Opcion activa={cobraPor === "MES"} titulo="Sueldo fijo por mes" onClick={() => setCobraPor("MES")} />
                <label className="flex items-center gap-2 text-sm w-full mt-1">
                  {cobraPor === "HORA" ? "Valor de la hora" : "Sueldo del mes"}
                  <span className="flex items-center border border-neutral-300 rounded-lg px-2">
                    $
                    <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="numeric" className="w-32 px-1.5 py-1.5 outline-none tabular-nums" placeholder="0" aria-label="Monto" />
                  </span>
                </label>
              </Pregunta>
              <Pregunta titulo="¿Cobra presentismo?" ayuda="Es un extra si no falta ni llega tarde (se configura en Asistencia → Reglas).">
                <Opcion activa={cobraPresentismo} titulo="Sí" onClick={() => setCobraPresentismo(true)} />
                <Opcion activa={!cobraPresentismo} titulo="No" onClick={() => setCobraPresentismo(false)} />
              </Pregunta>
              <Pregunta titulo="¿Qué día le pagás?">
                <Opcion activa={diaLegal} titulo="El 4.º día hábil" detalle="lo que marca la ley" onClick={() => setDiaLegal(true)} />
                <Opcion activa={!diaLegal} titulo="Otro día" onClick={() => setDiaLegal(false)} />
                {!diaLegal && (
                  <label className="flex items-center gap-2 text-sm w-full mt-1">
                    El día
                    <input value={dia} onChange={(e) => setDia(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" className="w-14 border border-neutral-300 rounded-lg px-2 py-1.5" />
                    de cada mes
                  </label>
                )}
              </Pregunta>
            </>
          ) : (
            <>
              <Pregunta titulo="¿Le pagás todos los meses?">
                <Opcion activa={frecuencia === "MENSUAL"} titulo="Sí, todos los meses" detalle="queda como gasto fijo" onClick={() => setFrecuencia("MENSUAL")} />
                <Opcion activa={frecuencia === "UNICA"} titulo="Solo esta vez" detalle="un trabajo puntual" onClick={() => setFrecuencia("UNICA")} />
              </Pregunta>
              <Pregunta titulo="¿Siempre el mismo monto?">
                <Opcion activa={montoFijo} titulo="Sí, monto fijo" onClick={() => setMontoFijo(true)} />
                <Opcion activa={!montoFijo} titulo="No, cambia" detalle="te lo pregunto al pagar" onClick={() => setMontoFijo(false)} />
                {montoFijo && (
                  <label className="flex items-center gap-2 text-sm w-full mt-1">
                    Monto
                    <span className="flex items-center border border-neutral-300 rounded-lg px-2">
                      $
                      <input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="numeric" className="w-32 px-1.5 py-1.5 outline-none tabular-nums" placeholder="0" aria-label="Monto" />
                    </span>
                  </label>
                )}
              </Pregunta>
              {frecuencia === "MENSUAL" && (
                <Pregunta titulo="¿Qué día del mes le pagás?" ayuda="Si llega el día y no está pagado, aparece como atrasado.">
                  <label className="flex items-center gap-2 text-sm">
                    El día
                    <input value={dia} onChange={(e) => setDia(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" className="w-14 border border-neutral-300 rounded-lg px-2 py-1.5" />
                  </label>
                </Pregunta>
              )}
            </>
          )}

          <Pregunta titulo="¿Cómo le pagás normalmente?">
            {MEDIOS.map((m) => (
              <Opcion key={m.valor} activa={medio === m.valor} titulo={m.texto} detalle={m.detalle} onClick={() => setMedio(m.valor)} />
            ))}
            {medio === "TRANSFERENCIA" && (
              <label className="flex items-center gap-2 text-sm w-full mt-1">
                Alias o CBU
                <input value={alias} onChange={(e) => setAlias(e.target.value)} className="flex-1 border border-neutral-300 rounded-lg px-2 py-1.5" placeholder="Ej. nombre.apellido.mp" />
              </label>
            )}
          </Pregunta>

          <Pregunta titulo="¿Ya empezó?">
            <Opcion activa={empezo} titulo="Sí" onClick={() => setEmpezo(true)} />
            <Opcion activa={!empezo} titulo="Todavía no" detalle="no suma en los costos hasta que empiece" onClick={() => setEmpezo(false)} />
            {empezo && esEmpleado && (
              <label className="flex items-center gap-2 text-sm w-full mt-1">
                Fecha de ingreso
                <input type="date" value={ingreso} onChange={(e) => setIngreso(e.target.value)} className="border border-neutral-300 rounded-lg px-2 py-1.5" />
              </label>
            )}
          </Pregunta>

          <p className="text-sm bg-accent-tint text-neutral-800 rounded-xl px-4 py-3">
            Queda así: <b>{resumen}</b>
          </p>
        </div>

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="text-sm text-neutral-500 px-3 py-2">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white text-sm font-bold rounded-lg px-5 py-2">
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== PAGAR HONORARIOS =====================

function ModalPagarHonorario({
  fila,
  periodo,
  etiquetaMes,
  onClose,
  onPagado,
}: {
  fila: FilaPago;
  periodo: string;
  etiquetaMes: string;
  onClose: () => void;
  onPagado: () => void;
}) {
  const [medio, setMedio] = useState<MedioPagoEquipo>(fila.config.medioHabitual ?? "TRANSFERENCIA");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hoy en Argentina, para la fecha que viene puesta.
  const [hoy] = useState(() => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10));

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("medio", medio);
    setGuardando(true);
    setError(null);
    pagarHonorario(fila.idPersona, periodo, formData)
      .then((r) => (r.error ? setError(r.error) : onPagado()))
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <form onSubmit={enviar} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">
            Pagarle a {fila.nombre} · {etiquetaMes.toLowerCase()}
          </h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <label className="block text-sm">
          <span className="block text-xs font-semibold text-neutral-600 mb-1">Monto</span>
          <span className="flex items-center border border-neutral-300 rounded-lg px-2 w-48">
            $
            <input name="monto" defaultValue={fila.monto ? String(fila.monto) : ""} inputMode="numeric" required className="w-full px-1.5 py-2 outline-none tabular-nums" />
          </span>
        </label>
        <div>
          <span className="block text-xs font-semibold text-neutral-600 mb-1">Cómo le pagaste</span>
          <div className="flex flex-wrap gap-2">
            {MEDIOS.map((m) => (
              <Opcion key={m.valor} activa={medio === m.valor} titulo={m.texto} detalle={m.detalle} onClick={() => setMedio(m.valor)} />
            ))}
          </div>
          {medio === "TRANSFERENCIA" && fila.config.alias && (
            <p className="text-xs text-neutral-500 mt-1.5">
              Su alias: <b className="select-all">{fila.config.alias}</b>
            </p>
          )}
        </div>
        <label className="block text-sm">
          <span className="block text-xs font-semibold text-neutral-600 mb-1">Fecha</span>
          <input type="date" name="fecha" defaultValue={hoy} className="border border-neutral-300 rounded-lg px-2 py-1.5" />
        </label>
        <label className="block text-sm">
          <span className="block text-xs font-semibold text-neutral-600 mb-1">Comprobante de la transferencia (opcional)</span>
          <input type="file" name="comprobante" accept="image/*,.pdf" className="w-full text-sm" />
        </label>
        <label className="block text-sm">
          <span className="block text-xs font-semibold text-neutral-600 mb-1">Su factura (es su recibo)</span>
          <input type="file" name="factura" accept="image/*,.pdf" className="w-full text-sm" />
          <span className="block text-xs text-neutral-400 mt-1">Si todavía no te la mandó, la subís después desde acá mismo.</span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm text-neutral-500 px-3 py-2">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg px-5 py-2">
            {guardando ? "Guardando…" : "Registrar el pago"}
          </button>
        </div>
      </form>
    </div>
  );
}
