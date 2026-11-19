"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EnCursoVista, GranelVista } from "@/lib/fraccionado";
import { marcarEtiquetasImpresas, marcarEtiquetasPegadas, terminarFraccionado } from "@/app/(app)/fraccionar/actions";
import { PASO_IMPRESAS, PASO_PEGADAS } from "@/lib/fraccionarSugerido";
import { textoGramos } from "@/lib/gramos";
import type { RecibidoSinCodigo } from "@/lib/entradas";

// Las etiquetas de toda la tanda, juntas (Gonzalo, 17/11: «para ahorrar hojas
// de impresión»). Se fracciona producto por producto (FraccionarGuiado, pasos
// 1 a 4) y al final, una sola vez: imprimir todo → pegar con el vencimiento a
// mano → sumar todo al stock. Recién en ese último paso se mueve el stock.

const PASOS = 3;

type Linea = EnCursoVista & { nombre: string; peso: number };

export default function FraccionarTanda({
  pendientes,
  graneles,
  recibidos = [],
  pasoInicial = 1,
  onSalir,
}: {
  /** Lo fraccionado que espera la etiqueta (paso 5 de fraccionados_en_curso). */
  pendientes: EnCursoVista[];
  graneles: GranelVista[];
  /**
   * Lo que llegó cerrado sin código (granolas de 1 kg…) y espera su sticker: va en la
   * misma hoja, para aprovechar la plancha (Gonzalo, 19/11). Ya está en el stock.
   */
  recibidos?: RecibidoSinCodigo[];
  /** 2 al volver de imprimir en Códigos. */
  pasoInicial?: number;
  onSalir: () => void;
}) {
  const router = useRouter();
  // Si todo ya tiene la etiqueta impresa (otra persona la imprimió y no sumó), se arranca en «Pegalas».
  const todasImpresas = pendientes.length > 0 && pendientes.every((e) => e.paso >= PASO_IMPRESAS);
  // Ya pegadas (19/11): directo a «Sumalas al stock».
  const todasPegadas = pendientes.length > 0 && pendientes.every((e) => e.paso >= PASO_PEGADAS);
  const pasoGuardado = todasPegadas ? 3 : todasImpresas && recibidos.length === 0 ? 2 : 1;
  const [paso, setPaso] = useState(Math.min(PASOS, Math.max(pasoGuardado, pasoInicial)));
  const [pegadas, setPegadas] = useState(false);
  const [hechos, setHechos] = useState<{ nombre: string; bolsitas: number; ubicacion: string | null; merma: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  // Nombre y peso de cada bolsita, de los graneles.
  const bolsa = new Map(graneles.flatMap((g) => g.bolsitas.map((b) => [b.idVariante, b] as const)));
  // En el orden en que se fraccionaron: si hubo dos tandas del mismo granel, el stock se acomoda en orden.
  const lineas: Linea[] = [...pendientes]
    .sort((a, b) => a.actualizado.localeCompare(b.actualizado))
    .map((e) => ({ ...e, nombre: bolsa.get(e.idVarianteBolsa)?.nombre ?? "Bolsita", peso: bolsa.get(e.idVarianteBolsa)?.peso ?? 0 }));
  // Las etiquetas, juntas por producto (dos tandas del mismo van en un renglón).
  // Lo que ya se imprimió (PASO_IMPRESAS) no se vuelve a imprimir: va en `yaImpresas`.
  const porProducto = new Map<string, { nombre: string; n: number; vtos: Set<string> }>();
  const yaImpresas = new Map<string, { nombre: string; n: number; vtos: Set<string> }>();
  for (const l of lineas) {
    const destino = l.paso >= PASO_IMPRESAS ? yaImpresas : porProducto;
    const p = destino.get(l.idVarianteBolsa) ?? { nombre: l.nombre, n: 0, vtos: new Set<string>() };
    p.n += l.bolsitas ?? 0;
    if (l.vencimiento) p.vtos.add(l.vencimiento);
    destino.set(l.idVarianteBolsa, p);
  }
  const total = lineas.reduce((a, l) => a + (l.bolsitas ?? 0), 0);
  const totalYaImpresas = [...yaImpresas.values()].reduce((a, p) => a + p.n, 0);
  const idsSinImprimir = lineas.filter((l) => l.paso < PASO_IMPRESAS).map((l) => l.id);
  // Al pasar a «Pegalas» (volvió de imprimir o tocó «Ya las imprimí»), quedan anotadas como impresas.
  // Y al pasar a «Sumalas al stock», como pegadas: si se van sin sumar, el siguiente
  // turno ve que solo falta eso (19/11).
  const idsSinPegar = lineas.filter((l) => l.paso < PASO_PEGADAS).map((l) => l.id);
  useEffect(() => {
    if (paso >= 2 && idsSinImprimir.length > 0) {
      marcarEtiquetasImpresas(idsSinImprimir)
        .then(() => (paso >= 3 && idsSinPegar.length > 0 ? marcarEtiquetasPegadas(idsSinPegar) : undefined))
        .catch(() => {});
    } else if (paso >= 3 && idsSinPegar.length > 0) {
      marcarEtiquetasPegadas(idsSinPegar).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso]);

  // Cómo viene la tanda: quién hizo cada paso (sql/tanda-pasos.sql). Para el que la sigue.
  const hora = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" }) : null;
  const primero = (f: (e: Linea) => string | null) => lineas.map(f).find((x) => x) ?? null;
  const estadoTanda = [
    { hecho: true, texto: "Fraccionaron", quien: primero((e) => e.quien), cuando: null as string | null },
    { hecho: lineas.every((e) => e.paso >= PASO_IMPRESAS) || paso >= 2, texto: "Imprimieron las etiquetas", quien: primero((e) => e.impresasPor), cuando: hora(primero((e) => e.impresasEn)) },
    { hecho: lineas.every((e) => e.paso >= PASO_PEGADAS) || paso >= 3, texto: "Pegaron las etiquetas", quien: primero((e) => e.pegadasPor), cuando: hora(primero((e) => e.pegadasEn)) },
  ];
  const fecha = (iso: string) => iso.split("-").reverse().join("/");

  // El vencimiento que cargaron sale impreso (Gonzalo, 18/11). Si el mismo producto tiene dos
  // fechas distintas (dos bolsas), no se puede imprimir una sola: esas se escriben a mano.
  const impreso = (p: { vtos: Set<string> }) => p.vtos.size === 1;
  const aMano = [...porProducto.values()].filter((p) => !impreso(p));

  // Lo recibido sin código: entra marcado; se puede sacar si no se quiere imprimir ahora.
  const [sinSumar, setSinSumar] = useState<Set<string>>(new Set());
  const recibidosElegidos = recibidos.filter((r) => !sinSumar.has(r.idVariante) && !porProducto.has(r.idVariante));
  // Lo que sale en esta impresión: lo fraccionado sin imprimir + lo recibido sin código.
  const etiquetas = total - totalYaImpresas + recibidosElegidos.reduce((a, r) => a + r.n, 0);
  // Lo que hay que pegar: todo lo de la tanda (también lo impreso antes) + lo recibido.
  const aPegar = total + recibidosElegidos.reduce((a, r) => a + r.n, 0);
  const alternar = (id: string) =>
    setSinSumar((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  function imprimir() {
    const lote = [
      ...[...porProducto].map(([id, p]) => `${id}:${p.n}${impreso(p) ? `:${[...p.vtos][0]}` : ""}`),
      ...recibidosElegidos.map((r) => `${r.idVariante}:${r.n}`),
    ].join(",");
    router.push(`/codigos?lote=${lote}&volver=${encodeURIComponent("/fraccionar?tanda=2")}`);
  }

  function sumarTodo() {
    setError(null);
    startTransition(async () => {
      const listos: NonNullable<typeof hechos> = [];
      for (const l of lineas) {
        const r = await terminarFraccionado({
          idEnCurso: l.id,
          idVarianteGranel: l.idVarianteGranel,
          idVarianteBolsa: l.idVarianteBolsa,
          bolsitas: l.bolsitas ?? 0,
          seTermino: Boolean(l.seTermino),
          gramosQuedan: l.seTermino ? null : l.gramosQuedan,
          vencimiento: l.vencimiento ?? "",
        });
        if (r.error) {
          // Lo que ya entró, entró (se borró de la tanda); lo que falta queda para reintentar.
          setError(`${l.nombre}: ${r.error}`);
          if (listos.length) setHechos(listos);
          router.refresh();
          return;
        }
        listos.push({ nombre: l.nombre, bolsitas: l.bolsitas ?? 0, ubicacion: r.ubicacion ?? null, merma: r.merma ?? 0 });
      }
      setHechos(listos);
      router.refresh();
      window.scrollTo({ top: 0 });
    });
  }

  const boton = "block w-full rounded-2xl px-4 py-4 text-[17px] font-extrabold disabled:opacity-40";
  const azul = `${boton} bg-accent text-white hover:bg-accent-dark`;
  const verde = `${boton} bg-emerald-600 text-white hover:bg-emerald-700`;
  const tarjeta = "rounded-2xl border border-neutral-200 bg-white p-4";

  if (hechos && !error) {
    const bolsitas = hechos.reduce((a, h) => a + h.bolsitas, 0);
    return (
      <div className="mx-auto max-w-xl pt-4">
        <div className="text-center">
          <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-emerald-50 text-5xl text-emerald-600">✓</div>
          <h2 className="mt-3 text-2xl font-black">¡Listo! {bolsitas} bolsitas en el stock</h2>
          <p className="mb-4 text-neutral-500">Llevalas a la góndola: atrás las nuevas, adelante las que ya estaban.</p>
        </div>
        <ul className={`${tarjeta} grid gap-2`}>
          {hechos.map((h, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-x-3 text-sm">
              <span>
                <b>{h.bolsitas}</b> × {h.nombre}
                {h.merma > 0 && <span className="text-amber-700"> · merma {textoGramos(h.merma)}</span>}
              </span>
              <span className="font-bold text-neutral-700">{h.ubicacion ?? "su lugar de la góndola"}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onSalir} className={`${azul} mt-5`}>
          Volver
        </button>
      </div>
    );
  }

  let cuerpo: React.ReactNode = null;
  if (paso === 1) {
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">Imprimí todas juntas</h2>
        <p className="mb-4 text-neutral-500">
          <b className="text-neutral-900">{etiquetas} etiquetas</b> de {porProducto.size + recibidosElegidos.length}{" "}
          {porProducto.size + recibidosElegidos.length === 1 ? "producto" : "productos"}, en una sola impresión.{" "}
          {aMano.length === 0
            ? "El vencimiento que cargaste sale impreso en cada etiqueta."
            : "El vencimiento sale impreso; el de los que tienen dos fechas distintas sale en blanco y lo escribís a mano."}
        </p>
        {porProducto.size > 0 && (
          <ul className={`${tarjeta} grid gap-1.5`}>
            {[...porProducto.values()].map((p) => (
              <li key={p.nombre} className="flex justify-between gap-3 text-sm">
                <span>{p.nombre}</span>
                <b className="tabular-nums">{p.n}</b>
              </li>
            ))}
          </ul>
        )}
        {totalYaImpresas > 0 && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✓ {totalYaImpresas} {totalYaImpresas === 1 ? "etiqueta ya está impresa" : "etiquetas ya están impresas"} (
            {[...yaImpresas.values()].map((p) => p.nombre).join(", ")}): esas no se vuelven a imprimir.
          </p>
        )}
        {recibidos.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-extrabold text-neutral-900">También llegaron sin código</h3>
            <p className="mb-2 text-xs text-neutral-500">Ya están en el stock: aprovechá la hoja y pegales el sticker. Destildá lo que no quieras imprimir ahora.</p>
            <ul className="grid gap-1.5">
              {recibidos
                .filter((r) => !porProducto.has(r.idVariante))
                .map((r) => {
                  const va = !sinSumar.has(r.idVariante);
                  return (
                    <li key={r.idVariante}>
                      <button
                        type="button"
                        onClick={() => alternar(r.idVariante)}
                        aria-pressed={va}
                        className={`flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left text-sm ${va ? "" : "opacity-60"}`}
                      >
                        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 text-xs font-black text-white ${va ? "border-emerald-600 bg-emerald-600" : "border-neutral-300"}`}>
                          {va ? "✓" : ""}
                        </span>
                        <span className="min-w-0 flex-1">{r.nombre}</span>
                        <b className="tabular-nums">{r.n}</b>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
        <button type="button" onClick={imprimir} disabled={etiquetas === 0} className={`${azul} mt-4`}>
          🖨️ Imprimir {etiquetas} etiquetas
        </button>
        <button type="button" onClick={() => setPaso(2)} className="mx-auto mt-3 block text-sm font-semibold text-neutral-500 underline underline-offset-4">
          Ya las imprimí
        </button>
      </>
    );
  } else if (paso === 2) {
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">{aMano.length === 0 ? "Pegalas" : "Pegalas y escribí el vencimiento"}</h2>
        <p className="mb-4 text-neutral-500">
          {aMano.length === 0
            ? "Fijate que cada etiqueta tenga el vencimiento de su producto:"
            : "Las que dicen «a mano» salieron con el vencimiento en blanco: escribilo con birome."}
        </p>
        <ul className="grid gap-2">
          {[...porProducto.values(), ...yaImpresas.values()].map((p, i) => (
            <li key={`${p.nombre}-${i}`} className={`${tarjeta} flex flex-wrap items-center justify-between gap-2`}>
              <span>
                <b className="block">{p.nombre}</b>
                <small className="text-neutral-500">
                  {p.n} etiquetas · {impreso(p) ? "✓ sale impreso" : "✍ a mano"}
                </small>
              </span>
              <b className="text-xl tabular-nums">{[...p.vtos].map(fecha).join(" y ") || "—"}</b>
            </li>
          ))}
          {recibidosElegidos.map((r) => (
            <li key={r.idVariante} className={`${tarjeta} flex flex-wrap items-center justify-between gap-2`}>
              <span>
                <b className="block">{r.nombre}</b>
                <small className="text-neutral-500">{r.n} etiquetas · llegó cerrado, solo el código</small>
              </span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setPegadas(!pegadas)} aria-pressed={pegadas} className={`${tarjeta} mt-3 flex w-full items-start gap-3 text-left`}>
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 text-white font-black ${pegadas ? "border-emerald-600 bg-emerald-600" : "border-neutral-300"}`}>{pegadas ? "✓" : ""}</span>
          <span>
            <b className="block text-[16px]">{aMano.length === 0 ? `Pegué las ${aPegar} etiquetas` : `Escribí los vencimientos y pegué las ${aPegar} etiquetas`}</b>
            <small className="text-[13px] text-neutral-500">En el frente, sin tapar el producto. Si sobró alguna, tirala.</small>
          </span>
        </button>
        <button type="button" disabled={!pegadas} onClick={() => setPaso(3)} className={`${azul} mt-4`}>
          Seguir
        </button>
      </>
    );
  } else if (paso === 3) {
    cuerpo = (
      <>
        <h2 className="text-2xl font-black">Sumalas al stock</h2>
        <p className="mb-4 text-neutral-500">Recién acá entran a la venta. Revisá y confirmá.</p>
        <ul className={`${tarjeta} grid gap-2 tabular-nums`}>
          {lineas.map((l) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-x-3 text-sm">
              <span>{l.nombre}</span>
              <b className="text-emerald-700">+{l.bolsitas}</b>
            </li>
          ))}
        </ul>
        <button type="button" disabled={guardando || lineas.length === 0} onClick={sumarTodo} className={`${verde} mt-4`}>
          {guardando ? "Sumando…" : `✓ Sumar las ${total} al stock`}
        </button>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => (paso > 1 ? setPaso(paso - 1) : onSalir())}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-neutral-200 bg-white text-xl font-extrabold"
          aria-label="Volver"
        >
          ←
        </button>
        <h1 className="min-w-0 flex-1 text-[22px] font-black leading-tight text-neutral-900">Etiquetas de la tanda</h1>
        <button type="button" onClick={onSalir} className="text-sm font-semibold text-neutral-500 underline underline-offset-4">
          Seguir después
        </button>
      </div>
      <div className="mb-1 flex gap-1" aria-hidden="true">
        {Array.from({ length: PASOS }, (_, i) => (
          <i key={i} className={`h-1.5 flex-1 rounded-full ${i + 1 < paso ? "bg-emerald-600" : i + 1 === paso ? "bg-accent" : "bg-neutral-200"}`} />
        ))}
      </div>
      <p className="mb-1 text-xs font-extrabold uppercase tracking-widest text-accent">
        Paso {paso} de {PASOS}
      </p>
      {/* Lo ya hecho de la tanda (puede ser de otra persona u otro turno). */}
      <ul className="mb-3 grid gap-1 text-[13px]">
        {estadoTanda.map((s) => (
          <li key={s.texto} className={`flex items-center gap-2 ${s.hecho ? "text-emerald-700" : "text-neutral-400"}`}>
            <span aria-hidden="true">{s.hecho ? "✓" : "○"}</span>
            <span>
              {s.texto}
              {s.hecho && (s.quien || s.cuando) && (
                <span className="text-neutral-500">
                  {" "}
                  · {[s.quien, s.cuando].filter(Boolean).join(", ")}
                </span>
              )}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-2 text-neutral-400">
          <span aria-hidden="true">○</span>
          <span>Sumar al stock: recién ahí se pueden vender</span>
        </li>
      </ul>
      {cuerpo}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error} Lo demás quedó para volver a intentar.
        </p>
      )}
    </div>
  );
}
