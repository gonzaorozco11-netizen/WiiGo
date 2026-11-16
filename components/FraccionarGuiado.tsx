"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BolsitaDeGranel, EnCursoVista, GranelVista } from "@/lib/fraccionado";
import { descartarEnCurso, guardarEnCurso, terminarFraccionado } from "@/app/(app)/fraccionar/actions";
import { textoGramos } from "@/lib/gramos";

// Fraccionar paso a paso (Gonzalo, 2026-11-16; maqueta aprobada «Fraccionar paso a paso», v2).
// Para la tablet: letra y botones grandes, un paso por pantalla, así no se olvidan de nada.
//   1 tamaño · 2 preparar · 3 cuántas y cuánto quedó · 4 etiquetas · 5 vencimiento a mano y pegarlas
//   · 6 sumar al stock (recién acá se mueve el stock) · 7 llevarlas a la góndola.
// Lo que va por la mitad queda guardado (fraccionados_en_curso) y se retoma desde el Inicio.

const PASOS = 7;
const TOLERANCIA_G = 5;
const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function FraccionarGuiado({ granel, inicial, onSalir }: { granel: GranelVista; inicial?: EnCursoVista | null; onSalir: () => void }) {
  const router = useRouter();
  const bolsaInicial = inicial ? granel.bolsitas.find((b) => b.idVariante === inicial.idVarianteBolsa) ?? null : null;
  const [paso, setPaso] = useState(inicial ? Math.min(6, Math.max(1, inicial.paso)) : 1);
  const [idEnCurso, setIdEnCurso] = useState<string | null>(inicial?.id ?? null);
  const [sinTabla, setSinTabla] = useState(false);
  const [bolsa, setBolsa] = useState<BolsitaDeGranel | null>(bolsaInicial ?? (granel.bolsitas.length === 1 ? granel.bolsitas[0] : null));
  const [checks, setChecks] = useState<Record<string, boolean>>(inicial && inicial.paso > 2 ? { guantes: true, balanza: true, peso: true } : {});
  const maximo = bolsa ? Math.floor(granel.gramos / bolsa.peso) : 0;
  const [hechas, setHechas] = useState<number>(inicial?.bolsitas ?? 0);
  const [queda, setQueda] = useState<"si" | "no" | null>(inicial?.seTermino == null ? null : inicial.seTermino ? "no" : "si");
  const [quedan, setQuedan] = useState<string>(inicial?.gramosQuedan == null ? "" : String(inicial.gramosQuedan));
  // Al volver de Códigos (se retoma en el paso 4) las etiquetas ya se mandaron a imprimir.
  const [impreso, setImpreso] = useState(Boolean(inicial && inicial.paso >= 4));
  const [vto, setVto] = useState(inicial?.vencimiento ?? "");
  const [pegadas, setPegadas] = useState(Boolean(inicial && inicial.paso >= 6));
  const [resultado, setResultado] = useState<{ lote: string; merma: number; ubicacion: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  const n = hechas > 0 ? hechas : maximo;
  const usados = bolsa ? n * bolsa.peso : 0;
  const esperado = Math.max(0, granel.gramos - usados);
  const quedanG = queda === "no" ? 0 : quedan.trim() === "" ? esperado : Math.max(0, Math.round(Number(quedan.replace(",", ".")) || 0));
  const merma = Math.max(0, esperado - quedanG);

  // Guarda por dónde va, para retomarlo si sale (sin el SQL, sigue igual sin poder retomarse).
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

  function sumarAlStock() {
    if (!bolsa) return;
    setError(null);
    startTransition(async () => {
      const r = await terminarFraccionado({
        idEnCurso,
        idVarianteGranel: granel.idVariante,
        idVarianteBolsa: bolsa.idVariante,
        bolsitas: n,
        seTermino: queda === "no",
        gramosQuedan: queda === "si" ? quedanG : null,
        vencimiento: vto,
      });
      if (r.error) return setError(r.error);
      setIdEnCurso(null);
      setResultado({ lote: r.lote ?? "", merma: r.merma ?? 0, ubicacion: r.ubicacion ?? null });
      setPaso(7);
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

  // Las etiquetas se imprimen en Códigos de barras, con la impresora y el ajuste de siempre: ya viene
  // ese producto con la cantidad. Al terminar, «Volver al fraccionado» trae de nuevo acá.
  async function irAImprimir() {
    const id = await guardar(4);
    setImpreso(true);
    const volver = id ? `/fraccionar?seguir=${id}` : "/fraccionar";
    const url = `/codigos?imprimir=${bolsa!.idVariante}&n=${n}&volver=${encodeURIComponent(volver)}`;
    if (id) router.push(url);
    else window.open(url, "_blank");
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
          onClick={() => (paso > 1 && paso < 7 ? setPaso(paso - 1) : onSalir())}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-neutral-200 bg-white text-xl font-extrabold"
          aria-label="Volver"
        >
          ←
        </button>
        <h1 className="min-w-0 flex-1 text-[22px] font-black leading-tight text-neutral-900">{granel.nombre}</h1>
        {paso < 7 && (
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
        <h2 className="text-2xl font-black">¿De qué tamaño?</h2>
        <p className="mb-4 text-neutral-500">
          Hay <b className="text-neutral-900">{textoGramos(granel.gramos)}</b> a granel. Elegí la bolsita y te digo cuántas salen.
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
                setHechas(0);
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
                En góndola
                <b className={`block text-base ${poco ? "text-red-600" : "text-neutral-900"}`}>{b.enGondola}</b>
              </span>
            </button>
          );
        })}
        <button type="button" disabled={!bolsa || maximo <= 0 || guardando} onClick={() => ir(2)} className={`${azul} mt-3`}>
          Seguir
        </button>
      </>
    );
  } else if (paso === 2 && bolsa) {
    const todo = checks.guantes && checks.balanza && checks.peso;
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">A fraccionar</h2>
        <p className="mb-4 text-neutral-500">
          Tenés para <b className="text-neutral-900">{maximo} bolsitas de {textoGramos(bolsa.peso)}</b>. Tildá antes de empezar:
        </p>
        <div className={tarjeta}>
          {check("guantes", "Guantes y cofia puestos", "Manos limpias, mesada limpia.")}
          {check("balanza", "Balanza en cero con la bolsita vacía", "Así pesás solo el producto.")}
          {check("peso", `Cada bolsita: ${textoGramos(bolsa.peso)}`, `Que no baje de ${textoGramos(bolsa.peso)} (podés pasarte hasta ${textoGramos(bolsa.peso + TOLERANCIA_G)}).`)}
        </div>
        <button type="button" disabled={!todo || guardando} onClick={() => ir(3)} className={`${azul} mt-4`}>
          Terminé de fraccionar
        </button>
      </>
    );
  } else if (paso === 3 && bolsa) {
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">¿Cuántas armaste?</h2>
        <p className="mb-4 text-neutral-500">Podían salir {maximo}. Poné las que hiciste de verdad.</p>
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
          <button type="button" onClick={() => setQueda("si")} aria-pressed={queda === "si"} className={`rounded-2xl border-2 bg-white p-3 font-extrabold ${queda === "si" ? "border-accent bg-accent-tint" : "border-neutral-200"}`}>
            Sí, queda
            <small className="block font-semibold text-neutral-500">Pesalo y poné cuánto</small>
          </button>
          <button type="button" onClick={() => setQueda("no")} aria-pressed={queda === "no"} className={`rounded-2xl border-2 bg-white p-3 font-extrabold ${queda === "no" ? "border-accent bg-accent-tint" : "border-neutral-200"}`}>
            No, se terminó
            <small className="block font-semibold text-neutral-500">{esperado > 0 ? `Los ${textoGramos(esperado)} que faltan son merma` : "Justo"}</small>
          </button>
        </div>
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
                <b className="text-amber-700">Merma: {textoGramos(merma)} (queda anotada).</b>
              ) : quedanG > esperado ? (
                "Quedó más de lo esperado: se corrige el stock."
              ) : (
                "Justo, sin merma."
              )}
            </p>
          </div>
        )}
        <button type="button" disabled={!queda || guardando} onClick={() => ir(4)} className={`${azul} mt-4`}>
          Listo
        </button>
      </>
    );
  } else if (paso === 4 && bolsa) {
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">Imprimí las etiquetas</h2>
        <p className="mb-4 text-neutral-500">
          Salen <b className="text-neutral-900">{n}</b> etiquetas de {bolsa.nombre}, con la fecha de envasado impresa y el <b>vencimiento en blanco</b>: lo escribís a mano en el paso que sigue.
        </p>
        <div className={`${tarjeta} text-sm text-neutral-600`}>
          Se abre <b>Códigos de barras</b> con este producto y la cantidad ya puestos. Imprimí como siempre y, cuando salgan, tocá <b>«Volver al fraccionado»</b>.
        </div>
        <button type="button" disabled={guardando} onClick={irAImprimir} className={`${azul} mt-4`}>
          {impreso ? "🖨️ Imprimir de nuevo" : `🖨️ Imprimir ${n} etiquetas`}
        </button>
        <button type="button" disabled={!impreso || guardando} onClick={() => ir(5)} className={`${claro} mt-2`}>
          Ya salieron
        </button>
      </>
    );
  } else if (paso === 5) {
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">Escribí el vencimiento y pegalas</h2>
        <p className="mb-4 text-neutral-500">
          Copiá el <b className="text-neutral-900">vencimiento que dice la bolsa grande de granel</b> en cada etiqueta, con birome, que se lea bien.
        </p>
        <div className={tarjeta}>
          <label htmlFor="vto" className="font-extrabold">
            ¿Qué vencimiento escribiste?
          </label>
          <input id="vto" type="date" min={hoyIso()} value={vto} onChange={(e) => setVto(e.target.value)} className="mt-2 block w-full rounded-xl border-2 border-neutral-200 px-3 py-2.5 text-xl font-extrabold" />
          <small className="mt-1.5 block text-neutral-500">Queda guardado con esta tanda.</small>
        </div>
        <div className={`${tarjeta} mt-2`}>
          <button type="button" onClick={() => setPegadas(!pegadas)} aria-pressed={pegadas} className="flex w-full items-start gap-3 text-left">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 text-white font-black ${pegadas ? "border-emerald-600 bg-emerald-600" : "border-neutral-300"}`}>{pegadas ? "✓" : ""}</span>
            <span>
              <b className="block text-[16px]">Escribí el vencimiento y pegué las {n} etiquetas</b>
              <small className="text-[13px] text-neutral-500">En el frente, sin tapar el producto. Si sobró alguna, tirala.</small>
            </span>
          </button>
        </div>
        <button type="button" disabled={!vto || !pegadas || guardando} onClick={() => ir(6)} className={`${azul} mt-4`}>
          Seguir
        </button>
      </>
    );
  } else if (paso === 6 && bolsa) {
    const fila = "flex justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2.5";
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">Sumar al stock</h2>
        <p className="mb-4 text-neutral-500">Revisá y confirmá. Desde ahí ya se pueden vender.</p>
        <div className={`${tarjeta} grid gap-2 tabular-nums`}>
          <div className={fila}>
            <span>Entran a la góndola</span>
            <b className="text-emerald-700">
              +{n} × {textoGramos(bolsa.peso)}
            </b>
          </div>
          <div className={fila}>
            <span>Salen del granel</span>
            <b>−{textoGramos(usados)}</b>
          </div>
          <div className={fila}>
            <span>Queda a granel</span>
            <b>{textoGramos(quedanG)}</b>
          </div>
          {merma > 0 && (
            <div className={fila}>
              <span>Merma</span>
              <b className="text-amber-700">{textoGramos(merma)}</b>
            </div>
          )}
          <div className={fila}>
            <span>Vence (escrito a mano)</span>
            <b>{vto ? vto.split("-").reverse().join("/") : "—"}</b>
          </div>
        </div>
        <button type="button" disabled={guardando || !vto} onClick={sumarAlStock} className={`${verde} mt-4`}>
          {guardando ? "Sumando…" : `✓ Sumar ${n} al stock`}
        </button>
      </>
    );
  } else if (paso === 7) {
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">Llevalas a la góndola</h2>
        <p className="mb-4 text-neutral-500">Atrás las nuevas, adelante las que ya estaban: que se vendan primero.</p>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
          <span className="text-amber-900">Van en</span>
          <b className="block text-2xl font-black text-amber-900">{resultado?.ubicacion ?? "su lugar de la góndola"}</b>
        </div>
        <button type="button" onClick={() => setPaso(8)} className={`${verde} mt-4`}>
          Ya están en la góndola
        </button>
      </>
    );
  } else if (paso === 8) {
    cuerpo = (
      <div className="pt-6 text-center">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-emerald-50 text-5xl text-emerald-600">✓</div>
        <h2 className="mt-3 text-2xl font-black">¡Listo!</h2>
        <p className="text-neutral-500">
          {n} bolsitas de {bolsa?.nombre} en la góndola.
          <br />
          Lote {resultado?.lote}
          {resultado && resultado.merma > 0 ? ` · merma ${textoGramos(resultado.merma)}` : ""}. Queda en el historial con tu nombre y la hora.
        </p>
        <button type="button" onClick={onSalir} className={`${azul} mt-5`}>
          Fraccionar otro
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
      {paso < 6 && idEnCurso && (
        <button type="button" onClick={descartar} disabled={guardando} className="mx-auto mt-6 block text-sm text-neutral-500 underline underline-offset-4">
          No lo hice: descartar
        </button>
      )}
    </div>
  );
}
