"use client";

import { useCallback, useEffect, useState } from "react";
import {
  armarAsistenciaMes,
  asignarHorarioPersona,
  type AsistenciaMes as Datos,
  type CeldaAsistencia,
  type FilaAsistencia,
} from "@/app/(app)/rrhh/asistencia-actions";
import { completarSalidaManual } from "@/app/(app)/rrhh/actions";

// Asistencia → El mes: una fila por empleado y una casilla por día, con
// colores según qué pasó ese día. Arriba lo que hay que corregir; al tocar
// una casilla, abajo el detalle (y si quedó sin salida, cargarla ahí mismo).
// Tocar el nombre abre la ficha de la persona.

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const LETRA = ["", "L", "M", "M", "J", "V", "S", "D"];
const NOMBRE_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

const ESTILO: Record<CeldaAsistencia["estado"], string> = {
  ok: "bg-emerald-50 text-emerald-700",
  tarde: "bg-amber-100 text-amber-800",
  falta: "bg-red-100 text-red-700",
  sin_salida: "text-red-700 ring-1 ring-inset ring-red-400 [background:repeating-linear-gradient(45deg,#fee2e2_0_4px,transparent_4px_8px)]",
  en_curso: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-300",
  lic: "bg-violet-100 text-violet-700",
  feriado: "bg-neutral-100 text-neutral-400",
  no_trabaja: "bg-neutral-100",
  flex: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  vacio: "ring-1 ring-inset ring-neutral-200",
  futuro: "ring-1 ring-inset ring-dashed ring-neutral-200 opacity-60",
};
const TONO = {
  bien: "bg-emerald-50 text-emerald-700",
  ojo: "bg-amber-50 text-amber-700",
  mal: "bg-red-50 text-red-700",
  gris: "bg-neutral-100 text-neutral-500",
} as const;

function textoCelda(c: CeldaAsistencia) {
  if (c.estado === "falta") return "F";
  if (c.estado === "lic") return "V";
  if (c.estado === "sin_salida") return "?";
  if (c.estado === "en_curso") return "•";
  if (c.estado === "feriado") return "Fe";
  if (c.horas !== null) return c.horas % 1 === 0 ? String(c.horas) : c.horas.toFixed(1);
  return "";
}

export function moverMes(periodo: string, delta: number) {
  const [a, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function SelectorMes({ periodo, setPeriodo }: { periodo: string; setPeriodo: (p: string) => void }) {
  const [a, m] = periodo.split("-").map(Number);
  const actual = new Date().toISOString().slice(0, 7);
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => setPeriodo(moverMes(periodo, -1))} className="w-8 h-8 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50" aria-label="Mes anterior">
        ‹
      </button>
      <span className="px-3 text-sm font-semibold text-neutral-800 min-w-[130px] text-center">
        {MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1)} {a}
      </span>
      <button
        type="button"
        onClick={() => setPeriodo(moverMes(periodo, 1))}
        disabled={periodo >= actual}
        className="w-8 h-8 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
        aria-label="Mes siguiente"
      >
        ›
      </button>
    </div>
  );
}

export default function AsistenciaMes({
  periodo,
  setPeriodo,
  onAbrirFicha,
}: {
  periodo: string;
  setPeriodo: (p: string) => void;
  onAbrirFicha: (idPersona: string) => void;
}) {
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ fila: FilaAsistencia; dia: number } | null>(null);

  const cargar = useCallback(() => {
    setError(null);
    armarAsistenciaMes(periodo)
      .then((r) => {
        setD(r);
        setSel(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la asistencia."));
  }, [periodo]);
  useEffect(cargar, [cargar]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!d) return <p className="text-sm text-neutral-400 text-center py-10">Cargando...</p>;

  const abrirSinSalida = (idPersona: string, fecha: string) => {
    const fila = d.filas.find((f) => f.idPersona === idPersona);
    if (fila) setSel({ fila, dia: Number(fecha.slice(8, 10)) });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <SelectorMes periodo={periodo} setPeriodo={setPeriodo} />
      </div>

      {/* Lo que hay que corregir y lo de ahora */}
      <div className="grid md:grid-cols-3 gap-2.5">
        <div className={`rounded-xl px-4 py-3 text-[13px] ${d.sinSalida.length ? "bg-red-50 border border-red-200" : "bg-white border border-neutral-200"}`}>
          <p className="font-semibold text-neutral-900">
            {d.sinSalida.length ? `${d.sinSalida.length} ${d.sinSalida.length === 1 ? "fichaje sin salida" : "fichajes sin salida"}` : "Todos los días cerrados"}
          </p>
          {d.sinSalida.length > 0 ? (
            <p className="text-red-800/80">
              Esos días cuentan 0 horas hasta que los corrijas:{" "}
              {d.sinSalida.slice(0, 3).map((s, i) => (
                <button key={i} type="button" onClick={() => abrirSinSalida(s.idPersona, s.fecha)} className="text-accent font-semibold mr-1.5 hover:underline">
                  {s.nombre.split(" ")[0]} el {Number(s.fecha.slice(8, 10))}
                </button>
              ))}
              {d.sinSalida.length > 3 && <span>y {d.sinSalida.length - 3} más</span>}
            </p>
          ) : (
            <p className="text-neutral-500">Nadie dejó un día sin fichar la salida.</p>
          )}
        </div>
        <div
          className={`rounded-xl px-4 py-3 text-[13px] ${
            d.hoy !== null && (d.hoyNoFicho.length || d.sinDefinir.length) ? "bg-amber-50 border border-amber-200" : "bg-white border border-neutral-200"
          }`}
        >
          {d.hoy === null ? (
            <>
              <p className="font-semibold text-neutral-900">Mes cerrado</p>
              <p className="text-neutral-500">Estás mirando un mes que ya pasó.</p>
            </>
          ) : (
            <>
              <p className="font-semibold text-neutral-900">{d.hoyNoFicho.length ? "Hoy no fichó" : "Hoy ficharon todos"}</p>
              <p className="text-neutral-600">
                {d.hoyNoFicho.length ? d.hoyNoFicho.join(", ") : "Los que tienen horario fijo y ya tendrían que estar, entraron."}
              </p>
              {d.sinDefinir.length > 0 && <p className="text-amber-800 mt-1">Sin horario definido: {d.sinDefinir.join(", ")}. Se elige en Reglas.</p>}
            </>
          )}
        </div>
        <div className="rounded-xl px-4 py-3 text-[13px] bg-white border border-neutral-200">
          <p className="font-semibold text-neutral-900">Ahora{d.ahora?.turno ? ` · ${d.ahora.turno}` : ""}</p>
          {d.ahora && d.ahora.trabajando.length > 0 ? (
            <p className="text-neutral-600">{d.ahora.trabajando.map((t) => `${t.nombre} desde las ${t.desde}`).join(" · ")}</p>
          ) : (
            <p className="text-neutral-500">{d.ahora ? "No hay nadie fichado en este momento." : "—"}</p>
          )}
        </div>
      </div>

      {d.faltaSql && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Para poder elegir &ldquo;horario libre&rdquo; falta correr <b>sql/personas-horario-libre.sql</b> en Supabase.
        </p>
      )}

      {/* La grilla */}
      <div className="bg-white border border-neutral-200 rounded-xl p-4">
        {d.filas.length === 0 ? (
          <p className="text-sm text-neutral-400 py-4">No hay empleados cargados. Se cargan en Equipo → Organización.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-separate [border-spacing:2px] text-[11px]">
              <thead>
                <tr>
                  <th />
                  {d.diaSemana.map((dow, i) => (
                    <th
                      key={i}
                      className={`font-semibold text-[10.5px] text-center pb-1 ${
                        d.hoy === i + 1 ? "text-accent" : dow === 7 || d.feriados[i + 1] ? "text-red-400" : "text-neutral-400"
                      }`}
                      title={d.feriados[i + 1]}
                    >
                      {i + 1}
                      <br />
                      {LETRA[dow]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.filas.map((f) => (
                  <tr key={f.idPersona}>
                    {/* El nombre y el resumen del mes van juntos a la izquierda (y
                        quedan fijos al desplazar): así entra el mes entero sin
                        tener que correr la grilla para ver las horas. */}
                    <td className="sticky left-0 z-10 bg-white pr-3 py-1 whitespace-nowrap min-w-[175px] align-top">
                      <button type="button" onClick={() => onAbrirFicha(f.idPersona)} className="text-left hover:underline">
                        <span className="block text-[13.5px] font-semibold text-neutral-900">{f.nombre}</span>
                        <span className={`block text-[11px] ${f.horario.tipo === "SIN" ? "text-amber-700" : "text-neutral-400"}`}>
                          {f.horario.tipo === "FIJO" ? f.horario.texto.split(" · ")[0] : f.horario.texto} ·{" "}
                          {f.cobra === "POR_HORA" ? "por hora" : f.cobra === "FIJO" ? "fijo" : "sin sueldo"}
                        </span>
                      </button>
                      <span className="flex items-center gap-1.5 mt-1 text-[11.5px] text-neutral-600 tabular-nums">
                        <b className="text-neutral-900">{f.horas % 1 === 0 ? f.horas : f.horas.toFixed(1)} h</b>
                        {f.tardanzas !== null && f.tardanzas > 0 && <span className="text-amber-700">· {f.tardanzas} tarde</span>}
                        {f.faltas !== null && f.faltas > 0 && <span className="text-red-700">· {f.faltas} {f.faltas === 1 ? "falta" : "faltas"}</span>}
                        <span className={`text-[10.5px] font-bold rounded-full px-1.5 py-px ${TONO[f.presentismo.tono]}`} title="Presentismo del mes">
                          {f.presentismo.texto}
                        </span>
                      </span>
                    </td>
                    {f.celdas.map((c, i) => {
                      const elegida = sel?.fila.idPersona === f.idPersona && sel.dia === i + 1;
                      return (
                        <td key={i}>
                          <button
                            type="button"
                            onClick={() => setSel({ fila: f, dia: i + 1 })}
                            className={`w-[24px] h-[30px] rounded-md grid place-items-center font-bold tabular-nums ${ESTILO[c.estado]} ${
                              elegida ? "outline outline-2 outline-accent outline-offset-1" : ""
                            }`}
                            aria-label={`${f.nombre}, día ${i + 1}`}
                          >
                            {textoCelda(c)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-[12px] text-neutral-500">
          {[
            ["ok", "A tiempo"],
            ["tarde", "Tarde"],
            ["falta", "Faltó"],
            ["sin_salida", "Sin salida, corregir"],
            ["lic", "Licencia o vacaciones"],
            ["no_trabaja", "No trabaja ese día"],
            ["flex", "Horario libre: horas que fichó"],
          ].map(([k, t]) => (
            <span key={k} className="flex items-center gap-1.5">
              <i className={`inline-block w-4 h-3.5 rounded ${ESTILO[k as CeldaAsistencia["estado"]]}`} />
              {t}
            </span>
          ))}
        </div>
      </div>

      {sel && <DetalleDia d={d} sel={sel} onCorregido={cargar} onCerrar={() => setSel(null)} />}
    </div>
  );
}

function DetalleDia({
  d,
  sel,
  onCorregido,
  onCerrar,
}: {
  d: Datos;
  sel: { fila: FilaAsistencia; dia: number };
  onCorregido: () => void;
  onCerrar: () => void;
}) {
  const c = sel.fila.celdas[sel.dia - 1];
  const fecha = `${d.periodo}-${String(sel.dia).padStart(2, "0")}`;
  const esperada = d.sinSalida.find((s) => s.idPersona === sel.fila.idPersona && s.fecha === fecha)?.horaSalidaEsperada ?? "";
  const [hora, setHora] = useState(esperada);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titulo = `${sel.fila.nombre.split(" ")[0]} · ${NOMBRE_DIA[d.diaSemana[sel.dia - 1]]} ${sel.dia}`;

  const texto: Record<CeldaAsistencia["estado"], string> = {
    ok: `Entró a las ${c.entrada} y salió a las ${c.salida}: ${c.horas} h.`,
    tarde: `Llegó tarde: entró a las ${c.entrada} y salió a las ${c.salida} (${c.horas} h).`,
    falta: "No vino y no tenía licencia. Si fue un franco o un día acordado, cargalo como licencia en su ficha.",
    sin_salida: `Entró a las ${c.entrada} y no fichó la salida. Ese día cuenta 0 horas hasta que la cargues.`,
    en_curso: `Entró a las ${c.entrada} y todavía está trabajando.`,
    lic: "Estaba de vacaciones o de licencia.",
    feriado: `Feriado: ${d.feriados[sel.dia] ?? ""}.`,
    no_trabaja: "Ese día no está en su horario.",
    flex: `Horario libre: entró a las ${c.entrada} y salió a las ${c.salida} (${c.horas} h).`,
    vacio: sel.fila.horario.tipo === "LIBRE" ? "Horario libre: ese día no fichó, y no cuenta como falta." : "Sin fichajes ese día.",
    futuro: "Todavía no llegó ese día.",
  };

  function cargarSalida() {
    if (!/^\d{1,2}:\d{2}$/.test(hora)) {
      setError("Poné la hora como 15:00.");
      return;
    }
    setError(null);
    setGuardando(true);
    completarSalidaManual(sel.fila.idPersona, fecha, hora.padStart(5, "0"))
      .then((r) => (r.error ? setError(r.error) : onCorregido()))
      .finally(() => setGuardando(false));
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-accent-tint px-4 py-3 text-[13.5px]">
      <p className="flex-1 min-w-[240px]">
        <b>{titulo}.</b> {texto[c.estado]}
      </p>
      {c.estado === "sin_salida" && (
        <span className="flex items-center gap-2">
          <label htmlFor="hora-salida" className="text-xs text-neutral-600">
            Salió a las
          </label>
          <input
            id="hora-salida"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            placeholder="15:00"
            className="w-20 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm bg-white"
          />
          <button type="button" onClick={cargarSalida} disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white text-sm font-semibold px-3 py-1.5 rounded-lg">
            {guardando ? "Guardando…" : "Cargar la salida"}
          </button>
        </span>
      )}
      <button type="button" onClick={onCerrar} className="text-neutral-400 hover:text-neutral-700 text-sm" aria-label="Cerrar detalle">
        ✕
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Reglas → el horario de cada uno: fijo (uno de los horarios), libre o sin definir. */
export function HorarioDeCadaUno({ onCambio }: { onCambio?: () => void }) {
  const [d, setD] = useState<Datos | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(() => {
    armarAsistenciaMes().then(setD).catch(() => setD(null));
  }, []);
  useEffect(cargar, [cargar]);

  function cambiar(idPersona: string, valor: string) {
    setError(null);
    setGuardando(idPersona);
    asignarHorarioPersona(idPersona, valor)
      .then((r) => {
        if (r.error) setError(r.error);
        else {
          cargar();
          onCambio?.();
        }
      })
      .finally(() => setGuardando(null));
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">El horario de cada uno</p>
      <p className="text-[13px] text-neutral-500 mt-1 mb-3">
        Fijo: tiene días y horario, y se le controlan tardanzas y faltas. Libre: no tiene días ni horario fijos; si ficha, se le cuentan las
        horas, pero no hay tardanzas ni faltas. Vale tanto para los que cobran por hora como para los de sueldo fijo.
      </p>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {!d ? (
        <p className="text-sm text-neutral-400">Cargando...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
                <th className="text-left pb-2 pr-2">Persona</th>
                <th className="text-left pb-2 px-2">Cobra</th>
                <th className="text-left pb-2 px-2">Horario</th>
                <th className="text-left pb-2 pl-2">Qué se controla</th>
              </tr>
            </thead>
            <tbody>
              {d.filas.map((f) => {
                const valor = f.horario.tipo === "FIJO" ? f.horario.idHorario ?? "" : f.horario.tipo === "LIBRE" ? "LIBRE" : "";
                return (
                  <tr key={f.idPersona} className="border-b border-neutral-100 last:border-0">
                    <td className="py-2 pr-2 font-medium">{f.nombre}</td>
                    <td className="py-2 px-2 text-neutral-600">{f.cobra === "POR_HORA" ? "Por hora" : f.cobra === "FIJO" ? "Fijo" : "Sin sueldo"}</td>
                    <td className="py-2 px-2">
                      <select
                        aria-label={`Horario de ${f.nombre}`}
                        value={valor}
                        disabled={guardando === f.idPersona}
                        onChange={(e) => cambiar(f.idPersona, e.target.value)}
                        className={`border rounded-lg px-2 py-1.5 text-sm bg-white ${f.horario.tipo === "SIN" ? "border-amber-400" : "border-neutral-300"}`}
                      >
                        <option value="">Sin definir</option>
                        {d.horarios.map((h) => (
                          <option key={h.idHorario} value={h.idHorario}>
                            Fijo · {h.nombre} ({h.texto})
                          </option>
                        ))}
                        <option value="LIBRE">Libre</option>
                      </select>
                    </td>
                    <td className={`py-2 pl-2 ${f.horario.tipo === "SIN" ? "text-amber-700" : "text-neutral-600"}`}>
                      {f.horario.tipo === "FIJO" ? "Tardanzas, faltas y salidas antes" : f.horario.tipo === "LIBRE" ? "Solo las horas, si ficha" : "Falta elegir"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11.5px] text-neutral-400 mt-2">Con horario libre no hay nada que medir: si cobra presentismo, va completo, y al cerrar el sueldo podés sacarlo.</p>
    </div>
  );
}
