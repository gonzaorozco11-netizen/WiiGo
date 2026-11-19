"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EnCursoVista, GranelVista } from "@/lib/fraccionado";
import { terminarFraccionado } from "@/app/(app)/fraccionar/actions";
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
  const [paso, setPaso] = useState(Math.min(PASOS, Math.max(1, pasoInicial)));
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
  const porProducto = new Map<string, { nombre: string; n: number; vtos: Set<string> }>();
  for (const l of lineas) {
    const p = porProducto.get(l.idVarianteBolsa) ?? { nombre: l.nombre, n: 0, vtos: new Set<string>() };
    p.n += l.bolsitas ?? 0;
    if (l.vencimiento) p.vtos.add(l.vencimiento);
    porProducto.set(l.idVarianteBolsa, p);
  }
  const total = lineas.reduce((a, l) => a + (l.bolsitas ?? 0), 0);
  const fecha = (iso: string) => iso.split("-").reverse().join("/");

  // El vencimiento que cargaron sale impreso (Gonzalo, 18/11). Si el mismo producto tiene dos
  // fechas distintas (dos bolsas), no se puede imprimir una sola: esas se escriben a mano.
  const impreso = (p: { vtos: Set<string> }) => p.vtos.size === 1;
  const aMano = [...porProducto.values()].filter((p) => !impreso(p));

  // Lo recibido sin código: entra marcado; se puede sacar si no se quiere imprimir ahora.
  const [sinSumar, setSinSumar] = useState<Set<string>>(new Set());
  const recibidosElegidos = recibidos.filter((r) => !sinSumar.has(r.idVariante) && !porProducto.has(r.idVariante));
  const etiquetas = total + recibidosElegidos.reduce((a, r) => a + r.n, 0);
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
        <ul className={`${tarjeta} grid gap-1.5`}>
          {[...porProducto.values()].map((p) => (
            <li key={p.nombre} className="flex justify-between gap-3 text-sm">
              <span>{p.nombre}</span>
              <b className="tabular-nums">{p.n}</b>
            </li>
          ))}
        </ul>
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
        <button type="button" onClick={imprimir} className={`${azul} mt-4`}>
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
          {[...porProducto.values()].map((p) => (
            <li key={p.nombre} className={`${tarjeta} flex flex-wrap items-center justify-between gap-2`}>
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
            <b className="block text-[16px]">{aMano.length === 0 ? `Pegué las ${etiquetas} etiquetas` : `Escribí los vencimientos y pegué las ${etiquetas} etiquetas`}</b>
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
      {cuerpo}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error} Lo demás quedó para volver a intentar.
        </p>
      )}
    </div>
  );
}
