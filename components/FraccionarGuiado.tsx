"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BolsitaDeGranel, EnCursoVista, GranelVista } from "@/lib/fraccionado";
import { PASO_PARA_ETIQUETAR, cuantasLoQueFalta, cuantasTodaLaBolsa } from "@/lib/fraccionarSugerido";
import { descartarEnCurso, guardarEnCurso } from "@/app/(app)/fraccionar/actions";
import { textoGramos } from "@/lib/gramos";
import { calcularVencimiento, duracionSugerida, fechaCorta } from "@/lib/rotulado";

// Fraccionar paso a paso (Gonzalo, 16/11; maqueta «Fraccionar paso a paso»).
// Para la tablet: letra y botones grandes, un paso por pantalla.
//
// Desde el 17/11 (maqueta aprobada, «para ahorrar hojas de impresión») cada
// producto tiene 4 pasos y las etiquetas van TODAS JUNTAS al final:
//   1 cuánto · 2 preparar · 3 cuántas armaste y cuánto quedó · 4 vencimiento
// y queda «fraccionado, falta la etiqueta» (fraccionados_en_curso, paso 5).
// Imprimir, pegar y sumar al stock se hace una vez para toda la tanda en
// FraccionarTanda. El stock se mueve recién ahí.

const PASOS = 4;
/** Hasta cuánto se puede pasar cada bolsita: de 1 kg salen justo 4 de 250 g, y si se pasan la última sale corta. */
const TOLERANCIA_G = 2;
const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Cuántas hacer al elegir una bolsita: lo que falta para llegar a 5 + 3; si ya está completa, toda la bolsa. */
function cuantasDeEntrada(granel: GranelVista, b: BolsitaDeGranel) {
  const falta = cuantasLoQueFalta(granel, b);
  return falta > 0 ? falta : cuantasTodaLaBolsa(granel, b).bolsitas;
}

export default function FraccionarGuiado({
  granel,
  inicial,
  idBolsa,
  onSalir,
  onEtiquetar,
}: {
  granel: GranelVista;
  inicial?: EnCursoVista | null;
  /** Desde «Para fraccionar antes de cerrar el turno»: esa bolsita ya elegida. */
  idBolsa?: string;
  onSalir: () => void;
  /** «Era el último»: va directo a imprimir las etiquetas de toda la tanda. */
  onEtiquetar?: () => void;
}) {
  const router = useRouter();
  const bolsaInicial = inicial
    ? granel.bolsitas.find((b) => b.idVariante === inicial.idVarianteBolsa) ?? null
    : idBolsa
      ? granel.bolsitas.find((b) => b.idVariante === idBolsa) ?? null
      : null;
  const [paso, setPaso] = useState(inicial ? Math.min(PASOS, Math.max(1, inicial.paso)) : 1);
  const [idEnCurso, setIdEnCurso] = useState<string | null>(inicial?.id ?? null);
  const [sinTabla, setSinTabla] = useState(false);
  const [bolsa, setBolsa] = useState<BolsitaDeGranel | null>(bolsaInicial ?? (granel.bolsitas.length === 1 ? granel.bolsitas[0] : null));
  const [checks, setChecks] = useState<Record<string, boolean>>(inicial && inicial.paso > 2 ? { guantes: true, balanza: true, peso: true } : {});
  const maximo = bolsa ? Math.floor(granel.gramos / bolsa.peso) : 0;
  const [hechas, setHechas] = useState<number>(() => {
    if (inicial?.bolsitas) return inicial.bolsitas;
    const b = bolsaInicial ?? (granel.bolsitas.length === 1 ? granel.bolsitas[0] : null);
    return b ? cuantasDeEntrada(granel, b) : 0;
  });
  const [queda, setQueda] = useState<"si" | "no" | null>(inicial?.seTermino == null ? null : inicial.seTermino ? "no" : "si");
  const [confirmarFin, setConfirmarFin] = useState(false);
  const [quedan, setQuedan] = useState<string>(inicial?.gramosQuedan == null ? "" : String(inicial.gramosQuedan));
  const [vto, setVto] = useState(inicial?.vencimiento ?? "");
  // La bolsa grande sin vencimiento (Gonzalo, 25/11): se calcula con lo que dura el producto
  // desde hoy (lib/rotulado.ts, lo mismo que usa la etiqueta) y sale impreso como cualquier otro.
  const [sinFecha, setSinFecha] = useState(false);
  const duracion = bolsa ? (bolsa.dias ? { dias: bolsa.dias, tipo: "lo cargado en el producto" } : duracionSugerida(bolsa.nombre)) : null;
  function bolsaSinFecha() {
    if (!duracion) return;
    setVto(calcularVencimiento(hoyIso(), duracion.dias, null));
    setSinFecha(true);
  }
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  const n = hechas > 0 ? hechas : maximo;
  const usados = bolsa ? n * bolsa.peso : 0;
  const esperado = Math.max(0, granel.gramos - usados);
  const quedanG = queda === "no" ? 0 : quedan.trim() === "" ? esperado : Math.max(0, Math.round(Number(quedan.replace(",", ".")) || 0));
  const merma = Math.max(0, esperado - quedanG);
  // Según el sistema queda granel para al menos una bolsita más: «se terminó» pide confirmación.
  const alcanzaParaMas = bolsa ? esperado >= bolsa.peso : false;

  // Guarda por dónde va, para retomarlo si sale.
  async function guardar(nuevoPaso: number) {
    if (!bolsa || sinTabla) return idEnCurso;
    const r = await guardarEnCurso({
      idEnCurso,
      idVarianteGranel: granel.idVariante,
      idVarianteBolsa: bolsa.idVariante,
      paso: nuevoPaso,
      bolsitas: n,
      seTermino: queda == null ? null : queda === "no",
      gramosQuedan: queda === "si" && quedan.trim() !== "" ? quedanG : null,
      vencimiento: vto || null,
    });
    if (r.sinTabla) setSinTabla(true);
    if (r.error) setError(r.error);
    if (r.id) setIdEnCurso(r.id);
    return r.id ?? idEnCurso;
  }

  function ir(nuevo: number) {
    setError(null);
    startTransition(async () => {
      await guardar(nuevo);
      setPaso(nuevo);
      window.scrollTo({ top: 0 });
    });
  }

  /** Paso 4 → queda «fraccionado, falta la etiqueta». */
  function terminarEste() {
    setError(null);
    startTransition(async () => {
      const id = await guardar(PASO_PARA_ETIQUETAR);
      if (!id) {
        setError(sinTabla ? "Falta correr sql/fraccionado-guiado.sql: sin eso no se puede guardar para etiquetar después." : "No se pudo guardar. Probá de nuevo.");
        return;
      }
      setPaso(PASO_PARA_ETIQUETAR);
      window.scrollTo({ top: 0 });
      router.refresh();
    });
  }

  function descartar() {
    startTransition(async () => {
      if (idEnCurso) await descartarEnCurso(idEnCurso);
      router.refresh();
      onSalir();
    });
  }

  const boton = "block w-full rounded-2xl px-4 py-4 text-[17px] font-extrabold disabled:opacity-40";
  const azul = `${boton} bg-accent text-white hover:bg-accent-dark`;
  const verde = `${boton} bg-emerald-600 text-white hover:bg-emerald-700`;
  const claro = `${boton} border-2 border-neutral-200 bg-white text-neutral-800`;
  const tarjeta = "rounded-2xl border border-neutral-200 bg-white p-4";

  const check = (k: string, titulo: string, sub: string) => (
    <button key={k} type="button" onClick={() => setChecks((c) => ({ ...c, [k]: !c[k] }))} aria-pressed={!!checks[k]} className="flex w-full items-start gap-3 border-b border-neutral-100 py-3 text-left last:border-0">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 text-white font-black ${checks[k] ? "border-emerald-600 bg-emerald-600" : "border-neutral-300"}`}>{checks[k] ? "✓" : ""}</span>
      <span>
        <b className="block text-[16px] text-neutral-900">{titulo}</b>
        <small className="text-[13px] text-neutral-500">{sub}</small>
      </span>
    </button>
  );

  const cabecera = (
    <>
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => (paso > 1 && paso <= PASOS ? setPaso(paso - 1) : onSalir())}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-neutral-200 bg-white text-xl font-extrabold"
          aria-label="Volver"
        >
          ←
        </button>
        <h1 className="min-w-0 flex-1 text-[22px] font-black leading-tight text-neutral-900">{granel.nombre}</h1>
        {paso <= PASOS && (
          <button type="button" onClick={onSalir} className="text-sm font-semibold text-neutral-500 underline underline-offset-4">
            Seguir después
          </button>
        )}
      </div>
      {paso <= PASOS && (
        <>
          <div className="mb-1 flex gap-1" aria-hidden="true">
            {Array.from({ length: PASOS }, (_, i) => (
              <i key={i} className={`h-1.5 flex-1 rounded-full ${i + 1 < paso ? "bg-emerald-600" : i + 1 === paso ? "bg-accent" : "bg-neutral-200"}`} />
            ))}
          </div>
          <p className="mb-1 text-xs font-extrabold uppercase tracking-widest text-accent">
            Paso {paso} de {PASOS}
          </p>
        </>
      )}
    </>
  );

  let cuerpo: React.ReactNode = null;
  if (paso === 1) {
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">¿Cuánto vas a fraccionar?</h2>
        <p className="mb-4 text-neutral-500">
          Hay <b className="text-neutral-900">{textoGramos(granel.gramos)}</b> a granel.
          {granel.bolsitas.length > 1 ? " Elegí la bolsita y te digo cuántas salen." : ""}
        </p>
        {granel.bolsitas.map((b) => {
          const salen = Math.floor(granel.gramos / b.peso);
          const poco = b.minimo > 0 ? b.enGondola < b.minimo : b.enGondola <= 2;
          return (
            <button
              key={b.idVariante}
              type="button"
              onClick={() => {
                setBolsa(b);
                setHechas(cuantasDeEntrada(granel, b));
              }}
              aria-pressed={bolsa?.idVariante === b.idVariante}
              disabled={salen <= 0}
              className={`mb-2 grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border-2 bg-white p-4 text-left disabled:opacity-40 ${bolsa?.idVariante === b.idVariante ? "border-accent bg-accent-tint" : "border-neutral-200"}`}
            >
              <span className="w-20 text-2xl font-black">{textoGramos(b.peso)}</span>
              <span className="text-neutral-500">
                Salen <b className="text-lg text-neutral-900">{salen}</b> bolsitas
              </span>
              <span className="text-right text-xs font-bold text-neutral-500">
                En el local
                <b className={`block text-base ${poco ? "text-red-600" : "text-neutral-900"}`}>
                  {b.enGondola} de {b.objetivo}
                </b>
              </span>
            </button>
          );
        })}
        {/* Lo que falta para llegar a 5 + 3, o cerrar la bolsa entera (17/11). */}
        {bolsa && maximo > 0 && (() => {
          const falta = cuantasLoQueFalta(granel, bolsa);
          const toda = cuantasTodaLaBolsa(granel, bolsa);
          const opcion = (clave: string, titulo: string, cuantas: number, detalle: string) => (
            <button
              key={clave}
              type="button"
              onClick={() => setHechas(cuantas)}
              aria-pressed={hechas === cuantas}
              className={`grid gap-0.5 rounded-2xl border-2 bg-white p-4 text-left ${hechas === cuantas ? "border-accent bg-accent-tint" : "border-neutral-200"}`}
            >
              <span className="text-sm font-extrabold text-neutral-600">{titulo}</span>
              <span className="text-3xl font-black tabular-nums">{cuantas}</span>
              <span className="text-xs text-neutral-500">{detalle}</span>
            </button>
          );
          return (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {falta > 0 &&
                  opcion("falta", "Lo que falta", falta, `${textoGramos(falta * bolsa.peso)} · quedan ${bolsa.enGondola + falta} en el local`)}
                {/* Solo si cerrar la bolsa da más que lo que falta: una bolsa de 1 kg puede no alcanzar. */}
                {toda.bolsitas > falta &&
                  opcion(
                    "toda",
                    toda.gramos >= granel.gramosBolsa ? "Toda la bolsa" : "Todo lo que queda",
                    toda.bolsitas,
                    `${textoGramos(toda.gramos)} · quedan ${bolsa.enGondola + toda.bolsitas} en el local`
                  )}
              </div>
              {falta <= 0 && <p className="mt-2 text-sm text-neutral-500">Ya tiene sus {bolsa.objetivo} en el local: solo hace falta si querés cerrar la bolsa.</p>}
            </>
          );
        })()}
        <button
          type="button"
          disabled={!bolsa || maximo <= 0 || hechas <= 0 || guardando}
          onClick={() => {
            // Si con lo que va a hacer sobra granel, de entrada «Sí, queda» (que no se anote merma por apuro).
            if (bolsa && queda == null && granel.gramos - hechas * bolsa.peso >= bolsa.peso) setQueda("si");
            ir(2);
          }}
          className={`${azul} mt-3`}
        >
          Seguir
        </button>
      </>
    );
  } else if (paso === 2 && bolsa) {
    const todo = checks.guantes && checks.balanza && checks.peso;
    // De una bolsa justa (1 kg en 250 g) salen exactas: pasarse en una deja la última corta.
    const justas = granel.gramosBolsa > 0 && granel.gramosBolsa % bolsa.peso === 0 ? granel.gramosBolsa / bolsa.peso : null;
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">A fraccionar</h2>
        <p className="mb-4 text-neutral-500">
          Vas a hacer <b className="text-neutral-900">{n} bolsitas de {textoGramos(bolsa.peso)}</b> ({textoGramos(n * bolsa.peso)}). Tildá antes de empezar:
        </p>
        <div className={tarjeta}>
          {check("guantes", "Guantes y cofia puestos", "Manos limpias, mesada limpia.")}
          {check("balanza", "Balanza en cero con la bolsita vacía", "Así pesás solo el producto.")}
          {check("peso", `Cada bolsita: ${textoGramos(bolsa.peso)} exactos`, `Ni menos de ${textoGramos(bolsa.peso)} ni más de ${textoGramos(bolsa.peso + TOLERANCIA_G)}.`)}
        </div>
        {justas && (
          <div className="mt-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-900">
            <b className="block text-[16px]">
              De cada bolsa de {textoGramos(granel.gramosBolsa)} salen justo {justas}.
            </b>
            <span className="text-sm">Si te pasás en una, la última sale corta y lo que falta se anota como merma. Pesá con cuidado.</span>
          </div>
        )}
        <button type="button" disabled={!todo || guardando} onClick={() => ir(3)} className={`${azul} mt-4`}>
          Terminé de fraccionar
        </button>
      </>
    );
  } else if (paso === 3 && bolsa) {
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">¿Cuántas armaste?</h2>
        <p className="mb-4 text-neutral-500">Poné las que hiciste de verdad, aunque sean menos de las que ibas a hacer.</p>
        <div className={`${tarjeta} text-center`}>
          <div className="my-2 flex items-center justify-center gap-5">
            <button type="button" onClick={() => setHechas(Math.max(1, n - 1))} className="h-16 w-16 rounded-full border-2 border-neutral-200 bg-white text-3xl font-extrabold" aria-label="Una menos">
              −
            </button>
            <span className="w-24 text-6xl font-black tabular-nums">{n}</span>
            <button type="button" onClick={() => setHechas(Math.min(maximo, n + 1))} className="h-16 w-16 rounded-full border-2 border-neutral-200 bg-white text-3xl font-extrabold" aria-label="Una más">
              +
            </button>
          </div>
          <p className="text-neutral-500">
            bolsitas de {textoGramos(bolsa.peso)} · usaste {textoGramos(usados)}
          </p>
        </div>
        <p className="mb-2 mt-5 font-extrabold text-neutral-900">¿Queda granel en la bolsa?</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setQueda("si");
              setConfirmarFin(false);
            }}
            aria-pressed={queda === "si"}
            className={`rounded-2xl border-2 bg-white p-3 font-extrabold ${queda === "si" ? "border-accent bg-accent-tint" : "border-neutral-200"}`}
          >
            Sí, queda
            <small className="block font-semibold text-neutral-500">Pesalo y poné cuánto</small>
          </button>
          <button
            type="button"
            onClick={() => (alcanzaParaMas && queda !== "no" ? setConfirmarFin(true) : setQueda("no"))}
            aria-pressed={queda === "no"}
            className={`rounded-2xl border-2 bg-white p-3 font-extrabold ${queda === "no" ? "border-accent bg-accent-tint" : "border-neutral-200"}`}
          >
            No, se terminó
            <small className="block font-semibold text-neutral-500">{esperado > 0 ? `Los ${textoGramos(esperado)} que faltan son merma` : "Justo"}</small>
          </button>
        </div>
        {confirmarFin && (
          <div role="alert" className="mt-2 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-red-900">
            <b className="block">¿Seguro que se terminó?</b>
            <span className="text-sm">
              Según el sistema quedan <b>{textoGramos(esperado)}</b>: alcanza para {Math.floor(esperado / bolsa.peso)} bolsitas más. Si de verdad no queda nada, esos{" "}
              {textoGramos(esperado)} se anotan como merma con tu nombre.
            </span>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setQueda("si"); setConfirmarFin(false); }} className="rounded-xl border-2 border-neutral-200 bg-white p-2.5 font-extrabold text-neutral-800">
                Me equivoqué, queda
              </button>
              <button type="button" onClick={() => { setQueda("no"); setConfirmarFin(false); }} className="rounded-xl bg-red-600 p-2.5 font-extrabold text-white">
                Sí, se terminó
              </button>
            </div>
          </div>
        )}
        {queda === "si" && (
          <div className={`${tarjeta} mt-2`}>
            <label htmlFor="quedan" className="font-extrabold">
              ¿Cuánto quedó? Pesá la bolsa de granel
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="quedan"
                inputMode="numeric"
                value={quedan}
                placeholder={String(esperado)}
                onChange={(e) => setQuedan(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border-2 border-neutral-200 px-3 py-2 text-3xl font-black tabular-nums"
              />
              <b className="text-xl">g</b>
            </div>
            <p className="mt-2 text-sm">
              El sistema esperaba <b>{textoGramos(esperado)}</b>.{" "}
              {quedan.trim() === "" ? (
                "Si no lo pesás, queda lo que figura."
              ) : merma > 0 ? (
                <b className="text-amber-700">Merma: {textoGramos(merma)} (queda anotada con tu nombre).</b>
              ) : quedanG > esperado ? (
                "Quedó más de lo esperado: se corrige el stock."
              ) : (
                "Justo, sin merma."
              )}
            </p>
          </div>
        )}
        <button type="button" disabled={!queda || confirmarFin || guardando} onClick={() => ir(4)} className={`${azul} mt-4`}>
          Seguir
        </button>
      </>
    );
  } else if (paso === 4 && bolsa) {
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">Anotá el vencimiento</h2>
        <p className="mb-4 text-neutral-500">
          Copialo de la <b className="text-neutral-900">bolsa grande de granel</b>. Al final, cuando imprimas las etiquetas de todo, te lo muestro para escribirlo en cada una.
        </p>
        <div className={tarjeta}>
          <label htmlFor="vto" className="font-extrabold">
            Vencimiento de la bolsa grande
          </label>
          <input
            id="vto"
            type="date"
            min={hoyIso()}
            value={vto}
            onChange={(e) => {
              setVto(e.target.value);
              setSinFecha(false);
            }}
            className="mt-2 block w-full rounded-xl border-2 border-neutral-200 px-3 py-2.5 text-xl font-extrabold"
          />
          {sinFecha && vto && duracion ? (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              La bolsa no tiene fecha: le pongo <b>{fechaCorta(vto)}</b>, {duracion.dias} días desde hoy ({duracion.tipo === "lo cargado en el producto" ? duracion.tipo : `lo que suele durar: ${duracion.tipo}`}). Sale impreso en la etiqueta.
            </p>
          ) : (
            <button type="button" onClick={bolsaSinFecha} className="mt-3 text-sm font-semibold text-neutral-600 underline underline-offset-4">
              La bolsa grande no tiene vencimiento
            </button>
          )}
        </div>
        <div className={`${tarjeta} mt-2 text-sm text-neutral-600`}>
          Dejá las <b>{n} bolsitas</b> juntas y aparte: las etiquetas se imprimen todas juntas al final, para gastar menos hojas.
        </div>
        <button type="button" disabled={!vto || guardando} onClick={terminarEste} className={`${verde} mt-4`}>
          {guardando ? "Guardando…" : "Listo"}
        </button>
      </>
    );
  } else if (paso === PASO_PARA_ETIQUETAR) {
    cuerpo = (
      <div className="pt-4 text-center">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-50 text-4xl text-emerald-600">✓</div>
        <h2 className="mt-3 text-2xl font-black">
          {n} {n === 1 ? "bolsita lista" : "bolsitas listas"} para etiquetar
        </h2>
        <p className="mb-5 text-neutral-500">{bolsa?.nombre}. Las etiquetas van al final, todas juntas.</p>
        <button type="button" onClick={onSalir} className={azul}>
          Fraccionar el siguiente
        </button>
        <button type="button" onClick={onEtiquetar ?? onSalir} className={`${claro} mt-2`}>
          Era el último: imprimir las etiquetas
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      {cabecera}
      {cuerpo}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {paso <= PASOS && idEnCurso && (
        <button type="button" onClick={descartar} disabled={guardando} className="mx-auto mt-6 block text-sm text-neutral-500 underline underline-offset-4">
          No lo hice: descartar
        </button>
      )}
    </div>
  );
}
