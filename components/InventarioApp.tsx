"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConteoInventario, FirmaInventario, ProductoInventario } from "@/lib/inventario";
import { ZONAS_INVENTARIO } from "@/lib/inventario";
import { cerrarInventario, empezarInventario, firmarInventario, guardarConteoInventario } from "@/app/(app)/inventario/actions";
import { guardarCodigoBarras } from "@/app/(app)/codigos/actions";
import EscanerCodigo from "@/components/EscanerCodigo";
import PadFirma from "@/components/PadFirma";
import { kgAGramos, textoGramos } from "@/lib/gramos";

// Inventario general: cada uno elige dónde está contando, escanea o busca el
// producto y pone cuántos hay ahí. Si el código no está cargado, se lo carga
// en el momento (así el inventario también completa los códigos de fábrica).

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const soloDigitos = (s: string | null) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");
const esInterno = (c: string | null) => /^20\d{9}$/.test((c ?? "").trim());
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" });

export default function InventarioApp({
  abierto,
  esAdmin,
  miNombre,
  catalogo,
  conteos,
  firmas,
  desde,
}: {
  abierto: boolean;
  esAdmin: boolean;
  miNombre: string | null;
  catalogo: ProductoInventario[];
  conteos: ConteoInventario[];
  firmas: FirmaInventario[];
  desde?: string;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!abierto) {
    return (
      <div className="max-w-md mx-auto text-center py-14">
        <h1 className="text-lg font-semibold text-neutral-900">Inventario del local</h1>
        {esAdmin ? (
          <>
            <p className="text-sm text-neutral-500 mt-1 mb-5">Cuando lo abras, Tomás, Florencia y vos pueden empezar a contar desde sus tablets o celulares.</p>
            <button
              type="button"
              disabled={pendiente}
              onClick={() =>
                startTransition(async () => {
                  const r = await empezarInventario();
                  if (r.error) setError(r.error);
                  else router.refresh();
                })
              }
              className="rounded-xl bg-accent text-white px-5 py-3 font-semibold hover:bg-accent-dark disabled:opacity-40"
            >
              Empezar el inventario de hoy
            </button>
            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
          </>
        ) : (
          <p className="text-sm text-neutral-500 mt-1">Todavía no hay un inventario abierto. Avisale a Gonzalo para que lo abra.</p>
        )}
      </div>
    );
  }

  return <Contando esAdmin={esAdmin} miNombre={miNombre} catalogo={catalogo} conteos={conteos} firmas={firmas} desde={desde ?? ""} />;
}

function Contando({
  esAdmin,
  miNombre,
  catalogo,
  conteos,
  firmas,
  desde,
}: {
  esAdmin: boolean;
  miNombre: string | null;
  catalogo: ProductoInventario[];
  conteos: ConteoInventario[];
  firmas: FirmaInventario[];
  desde: string;
}) {
  const router = useRouter();
  const [zona, setZona] = useState<string>(ZONAS_INVENTARIO[0]);
  useEffect(() => {
    try {
      const z = localStorage.getItem("inventario.zona");
      if (z && (ZONAS_INVENTARIO as readonly string[]).includes(z)) setZona(z); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {}
  }, []);
  function elegirZona(z: string) {
    setZona(z);
    try {
      localStorage.setItem("inventario.zona", z);
    } catch {}
  }

  const [busqueda, setBusqueda] = useState("");
  const [sel, setSel] = useState<ProductoInventario | null>(null);
  const [escaneando, setEscaneando] = useState(false);
  const [codigoDesconocido, setCodigoDesconocido] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const porId = useMemo(() => new Map(catalogo.map((p) => [p.idVariante, p])), [catalogo]);
  const conteosDe = (id: string) => conteos.filter((c) => c.idVariante === id);
  const misEnZona = conteos.filter((c) => c.zona === zona && c.quien === miNombre).sort((a, b) => b.cuando.localeCompare(a.cuando));
  const yaFirme = firmas.some((f) => f.nombre === miNombre);

  const resultados = useMemo(() => {
    const palabras = plano(busqueda).split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    return catalogo.filter((p) => palabras.every((w) => plano(`${p.nombre} ${p.marca} ${p.codigo ?? ""}`).includes(w))).slice(0, 25);
  }, [busqueda, catalogo]);

  function leido(valor: string) {
    setEscaneando(false);
    const d = soloDigitos(valor);
    const p = catalogo.find((x) => x.codigo && soloDigitos(x.codigo) === d);
    if (p) {
      setSel(p);
      setAviso(null);
    } else setCodigoDesconocido(valor.trim());
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-neutral-900">Inventario del local</h1>
        <p className="text-sm text-neutral-500">
          Abierto desde las {hora(desde)}. Contá lo que hay en el lugar que elegiste (góndola o depósito); si un producto está en dos lugares, se suma solo.
        </p>
      </div>

      <p className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">¿Dónde estás contando?</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {ZONAS_INVENTARIO.map((z) => {
          const n = new Set(conteos.filter((c) => c.zona === z).map((c) => c.idVariante)).size;
          return (
            <button
              key={z}
              type="button"
              onClick={() => elegirZona(z)}
              aria-pressed={zona === z}
              className={`rounded-full border px-3.5 py-2 text-sm font-semibold ${zona === z ? "bg-accent border-accent text-white" : "bg-white border-neutral-300 text-neutral-800"}`}
            >
              {z}
              {n > 0 && <span className="ml-1 font-normal opacity-75">· {n}</span>}
            </button>
          );
        })}
      </div>

      {aviso && <p className="mb-3 text-sm rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2">{aviso}</p>}

      {sel ? (
        <Contar
          p={sel}
          zona={zona}
          otros={conteosDe(sel.idVariante)}
          onListo={(texto) => {
            setSel(null);
            setBusqueda("");
            setAviso(texto);
            router.refresh();
          }}
          onCancelar={() => setSel(null)}
        />
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar el producto…"
              className="flex-1 rounded-xl border border-neutral-300 px-4 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button type="button" onClick={() => setEscaneando(true)} className="shrink-0 rounded-xl bg-neutral-900 text-white px-4 text-sm font-semibold">
              📷 Escanear
            </button>
          </div>
          {resultados.length > 0 && (
            <ul className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100 mb-4">
              {resultados.map((p) => {
                const aca = conteos.find((c) => c.idVariante === p.idVariante && c.zona === zona);
                const otros = conteos.filter((c) => c.idVariante === p.idVariante && c.zona !== zona);
                return (
                  <li key={p.idVariante}>
                    <button type="button" onClick={() => setSel(p)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-neutral-50">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-neutral-900">{p.nombre}</span>
                        <span className="block text-xs text-neutral-500">
                          {p.marca}
                          {otros.length > 0 && ` · ya contado en ${otros.map((o) => `${o.zona}: ${p.enGramos ? textoGramos(o.cantidad) : o.cantidad}`).join(", ")}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{aca ? (p.enGramos ? textoGramos(aca.cantidad) : aca.cantidad) : "—"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <section className="mt-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
          Contaste en {zona} · {misEnZona.length}
        </h2>
        {misEnZona.length === 0 ? (
          <p className="text-sm text-neutral-400">Todavía nada en este lugar.</p>
        ) : (
          <ul className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
            {misEnZona.map((c) => {
              const p = porId.get(c.idVariante);
              return (
                <li key={c.idVariante}>
                  <button type="button" onClick={() => p && setSel(p)} className="w-full text-left px-4 py-2 flex justify-between gap-3 text-sm hover:bg-neutral-50">
                    <span className="min-w-0 truncate">{p?.nombre ?? "Producto"}</span>
                    <b className="tabular-nums shrink-0">{p?.enGramos ? textoGramos(c.cantidad) : c.cantidad}</b>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!yaFirme ? <TerminarMiParte cuantos={new Set(conteos.filter((c) => c.quien === miNombre).map((c) => c.idVariante)).size} /> : (
        <p className="mt-6 text-sm rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2">✓ Ya firmaste tu parte. Si contás algo más, queda sumado igual.</p>
      )}

      {esAdmin && <PanelAdmin catalogo={catalogo} conteos={conteos} firmas={firmas} />}

      {escaneando && <EscanerCodigo titulo="Escaneá el producto que vas a contar" onLeido={leido} onCerrar={() => setEscaneando(false)} />}
      {codigoDesconocido && (
        <ElegirProducto
          codigo={codigoDesconocido}
          catalogo={catalogo}
          onElegido={(p, texto) => {
            setCodigoDesconocido(null);
            setSel(p);
            setAviso(texto);
            router.refresh();
          }}
          onCerrar={() => setCodigoDesconocido(null)}
        />
      )}
    </div>
  );
}

function Contar({
  p,
  zona,
  otros,
  onListo,
  onCancelar,
}: {
  p: ProductoInventario;
  zona: string;
  otros: ConteoInventario[];
  onListo: (texto: string) => void;
  onCancelar: () => void;
}) {
  const aca = otros.find((o) => o.zona === zona);
  const resto = otros.filter((o) => o.zona !== zona);
  const [valor, setValor] = useState<string>(aca ? (p.enGramos ? String(aca.cantidad / 1000).replace(".", ",") : String(aca.cantidad)) : "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();
  const n = p.enGramos ? kgAGramos(valor) : valor === "" ? null : Math.max(0, Math.round(Number(valor)) || 0);

  function guardar() {
    if (n == null) return;
    setError(null);
    startTransition(async () => {
      const r = await guardarConteoInventario(p.idVariante, zona, n);
      if (r.error) setError(r.error);
      else onListo(`✓ ${p.nombre}: ${p.enGramos ? textoGramos(n) : n} en ${zona}.`);
    });
  }

  return (
    <div className="rounded-2xl border-2 border-accent bg-white p-4 space-y-3 mb-4">
      <div>
        <p className="font-semibold text-neutral-900">{p.nombre}</p>
        <p className="text-xs text-neutral-500">
          {p.marca} · contando en <b>{zona}</b>
          {resto.length > 0 && <> · en {resto.map((o) => `${o.zona} ya contaron ${p.enGramos ? textoGramos(o.cantidad) : o.cantidad}`).join(", ")} (se suma)</>}
        </p>
      </div>
      <div className="flex items-center justify-center gap-3">
        {!p.enGramos && (
          <button type="button" onClick={() => setValor(String(Math.max(0, (Number(valor) || 0) - 1)))} className="w-12 h-12 rounded-xl border border-neutral-300 text-2xl" aria-label="Uno menos">
            −
          </button>
        )}
        <input
          autoFocus
          inputMode={p.enGramos ? "decimal" : "numeric"}
          value={valor}
          onChange={(e) => setValor(e.target.value.replace(p.enGramos ? /[^\d,.]/g : /\D/g, ""))}
          placeholder="?"
          aria-label={`Cuántos hay de ${p.nombre}`}
          className="w-24 h-12 rounded-xl border border-neutral-300 text-center text-2xl font-semibold tabular-nums"
        />
        {p.enGramos ? (
          <span className="text-sm font-semibold text-neutral-600">kg (pesalo)</span>
        ) : (
          <button type="button" onClick={() => setValor(String((Number(valor) || 0) + 1))} className="w-12 h-12 rounded-xl border border-neutral-300 text-2xl" aria-label="Uno más">
            +
          </button>
        )}
      </div>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancelar} className="flex-1 rounded-xl border border-neutral-300 px-4 py-3 text-sm">
          Volver
        </button>
        <button type="button" onClick={guardar} disabled={n == null || guardando} className="flex-[2] rounded-xl bg-accent text-white px-4 py-3 font-semibold disabled:opacity-40">
          {guardando ? "Guardando…" : n == null ? "Guardar" : `Guardar: hay ${p.enGramos ? textoGramos(n) : n} acá`}
        </button>
      </div>
    </div>
  );
}

/** El código no está en el sistema: se elige el producto y el código queda cargado. */
function ElegirProducto({
  codigo,
  catalogo,
  onElegido,
  onCerrar,
}: {
  codigo: string;
  catalogo: ProductoInventario[];
  onElegido: (p: ProductoInventario, texto: string) => void;
  onCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();
  const lista = useMemo(() => {
    const palabras = plano(busqueda).split(/\s+/).filter(Boolean);
    return catalogo
      .filter((p) => !p.enGramos)
      .filter((p) => !palabras.length || palabras.every((w) => plano(`${p.nombre} ${p.marca}`).includes(w)))
      // Primero los que todavía no tienen código de fábrica: es lo más probable.
      .sort((a, b) => Number(!esInterno(a.codigo) && !!a.codigo) - Number(!esInterno(b.codigo) && !!b.codigo))
      .slice(0, 40);
  }, [busqueda, catalogo]);

  function elegir(p: ProductoInventario) {
    setError(null);
    startTransition(async () => {
      const r = await guardarCodigoBarras(p.idVariante, codigo);
      if (r.error) {
        // No se pudo guardar el código (ya tiene otro, o es de otro producto): se cuenta igual.
        onElegido(p, `Se cuenta igual, pero el código no se guardó: ${r.error}`);
      } else onElegido(p, `✓ Código ${codigo} guardado en ${p.nombre}. Ahora contalo.`);
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(20,17,13,.8)" }} onClick={onCerrar}>
      <div className="w-full max-w-lg bg-white rounded-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-neutral-200">
          <p className="text-sm font-semibold">
            No conozco el código <span className="font-mono">{codigo}</span>
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">¿Qué producto es? Tocalo y el código queda guardado para la próxima.</p>
        </div>
        <div className="p-3 border-b border-neutral-200">
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar el producto…"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="overflow-y-auto">
          {lista.map((p) => (
            <button key={p.idVariante} type="button" disabled={guardando} onClick={() => elegir(p)} className="w-full text-left px-4 py-2.5 hover:bg-neutral-50 border-b border-neutral-100">
              <span className="block text-sm font-medium">{p.nombre}</span>
              <span className="block text-xs text-neutral-400">{p.marca}</span>
            </button>
          ))}
        </div>
        {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
        <button type="button" onClick={onCerrar} className="px-4 py-3 text-sm text-neutral-500 border-t border-neutral-200">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function TerminarMiParte({ cuantos }: { cuantos: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [firma, setFirma] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} disabled={cuantos === 0} className="mt-6 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 font-semibold disabled:opacity-40">
        Terminé mi parte · firmar
      </button>
    );
  }
  return (
    <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
      <p className="text-sm text-neutral-700">
        Contaste <b>{cuantos} productos</b>. Con tu firma confirmás que había lo que anotaste.
      </p>
      <PadFirma onCambio={setFirma} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={!firma || guardando}
        onClick={() =>
          startTransition(async () => {
            const r = await firmarInventario(firma);
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
        className="w-full rounded-xl bg-accent text-white px-4 py-3 font-semibold disabled:opacity-40"
      >
        {guardando ? "Guardando…" : "Firmo mi parte"}
      </button>
    </div>
  );
}

function PanelAdmin({ catalogo, conteos, firmas }: { catalogo: ProductoInventario[]; conteos: ConteoInventario[]; firmas: FirmaInventario[] }) {
  const router = useRouter();
  const [enCero, setEnCero] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();
  const contados = new Set(conteos.map((c) => c.idVariante));
  const vendibles = catalogo.filter((p) => !p.enGramos);
  const faltan = vendibles.filter((p) => !contados.has(p.idVariante));
  const pct = vendibles.length ? Math.round(((vendibles.length - faltan.length) / vendibles.length) * 100) : 0;
  const quienes = [...new Set(conteos.map((c) => c.quien).filter(Boolean))] as string[];
  const faltanFirmar = quienes.filter((q) => !firmas.some((f) => f.nombre === q));

  return (
    <section className="mt-10 rounded-2xl border border-neutral-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-semibold text-neutral-900">Cómo va (solo lo ves vos)</h2>
          <p className="text-xs text-neutral-500">{quienes.length ? `Contando: ${quienes.join(", ")}` : "Nadie contó todavía"}</p>
        </div>
        <p className="text-right">
          <b className="block text-xl tabular-nums">
            {vendibles.length - faltan.length} / {vendibles.length}
          </b>
          <span className="text-xs text-neutral-500">productos contados</span>
        </p>
      </div>
      <div className="px-4 pt-3">
        <div className="h-2.5 rounded-full bg-neutral-100 overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
        {ZONAS_INVENTARIO.map((z) => {
          const deZona = conteos.filter((c) => c.zona === z);
          const gente = [...new Set(deZona.map((c) => c.quien).filter(Boolean))].join(", ");
          return (
            <div key={z} className={`rounded-xl border px-3 py-2 ${deZona.length ? "border-neutral-200 bg-neutral-50" : "border-dashed border-neutral-300"}`}>
              <span className="block text-xs font-semibold text-neutral-700">{z}</span>
              <span className="block text-lg font-semibold tabular-nums">{new Set(deZona.map((c) => c.idVariante)).size}</span>
              <span className="block text-[11px] text-neutral-500 truncate">{gente || "nadie todavía"}</span>
            </div>
          );
        })}
      </div>

      {firmas.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">Firmaron</p>
          <div className="flex flex-wrap gap-3">
            {firmas.map((f) => (
              <div key={f.nombre + f.cuando} className="rounded-xl border border-neutral-200 px-3 py-2 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.firma} alt={`Firma de ${f.nombre}`} className="h-8 w-auto mb-1" />
                <b>{f.nombre}</b> · {f.productos} productos · {hora(f.cuando)}
                <span className="block text-neutral-500">{f.zonas}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="px-4 pb-3">
        <summary className="cursor-pointer text-sm font-semibold text-amber-800">Todavía no los contó nadie · {faltan.length}</summary>
        <ul className="mt-2 max-h-72 overflow-y-auto text-sm divide-y divide-neutral-100">
          {faltan.map((p) => (
            <li key={p.idVariante} className="py-1.5 flex justify-between gap-2">
              <span className="min-w-0 truncate">{p.nombre}</span>
              <span className="text-xs text-neutral-400 shrink-0">{p.marca}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="border-t border-neutral-200 p-4 space-y-3">
        {resultado ? (
          <p className="text-sm rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2">{resultado}</p>
        ) : (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={enCero} onChange={(e) => setEnCero(e.target.checked)} className="mt-1" />
              <span>Lo que no contó nadie, ponerlo en 0 (si no, queda con el stock que tenía)</span>
            </label>
            {faltanFirmar.length > 0 && <p className="text-xs text-amber-800">Falta que firmen: {faltanFirmar.join(", ")}.</p>}
            {!confirmar ? (
              <button type="button" onClick={() => setConfirmar(true)} className="w-full rounded-xl bg-neutral-900 text-white px-4 py-3 font-semibold">
                Cerrar inventario y cargar el stock
              </button>
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmar(false)} className="flex-1 rounded-xl border border-neutral-300 px-4 py-3 text-sm">
                  Todavía no
                </button>
                <button
                  type="button"
                  disabled={guardando}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await cerrarInventario(enCero);
                      if (r.error) setResultado(`No se pudo: ${r.error}`);
                      else {
                        setResultado(`✓ Stock cargado: ${r.cargados} productos${r.enCero ? ` y ${r.enCero} puestos en 0` : ""}.`);
                        router.refresh();
                      }
                    })
                  }
                  className="flex-[2] rounded-xl bg-red-700 text-white px-4 py-3 font-semibold disabled:opacity-40"
                >
                  {guardando ? "Cargando…" : "Sí, cargar el stock ahora"}
                </button>
              </div>
            )}
            <p className="text-xs text-neutral-500">
              Cada producto queda con lo que se contó, sumando todos los lugares. Si se vendió algo después de contarlo, se descuenta solo.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
