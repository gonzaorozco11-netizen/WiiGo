"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConteoInventario, FirmaInventario, ProductoInventario, UbicacionPendiente } from "@/lib/inventario";
import { ZONAS_INVENTARIO, modulosDeZona, textoLugar } from "@/lib/inventario";
import type { ModuloGondola } from "@/lib/gondola";
import {
  cerrarInventario,
  confirmarUbicacion,
  empezarInventario,
  firmarInventario,
  guardarConteoInventario,
  resolverUbicacion,
  ubicarProducto,
} from "@/app/(app)/inventario/actions";

type ResumenUbicaciones = { confirmados: number; nuevos: number; movidos: number; pendientes: UbicacionPendiente[] };
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
  gondola = [],
  ubicaciones = null,
}: {
  abierto: boolean;
  esAdmin: boolean;
  miNombre: string | null;
  catalogo: ProductoInventario[];
  conteos: ConteoInventario[];
  firmas: FirmaInventario[];
  desde?: string;
  gondola?: ModuloGondola[];
  ubicaciones?: ResumenUbicaciones | null;
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

  return (
    <Contando
      esAdmin={esAdmin}
      miNombre={miNombre}
      catalogo={catalogo}
      conteos={conteos}
      firmas={firmas}
      desde={desde ?? ""}
      gondola={gondola}
      ubicaciones={ubicaciones}
    />
  );
}

function Contando({
  esAdmin,
  miNombre,
  catalogo,
  conteos,
  firmas,
  desde,
  gondola,
  ubicaciones,
}: {
  esAdmin: boolean;
  miNombre: string | null;
  catalogo: ProductoInventario[];
  conteos: ConteoInventario[];
  firmas: FirmaInventario[];
  desde: string;
  gondola: ModuloGondola[];
  ubicaciones: ResumenUbicaciones | null;
}) {
  // Después de contar en un mueble, se confirma dónde está el producto en él.
  const [ubicando, setUbicando] = useState<ProductoInventario | null>(null);
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
  const porFirmar = sinFirmar(conteos, firmas, miNombre);
  const firmeAlgo = firmas.some((f) => f.nombre === miNombre);

  // El granel (la bolsa grande, en kilos) solo está en el depósito: en la
  // góndola aparecen nada más las bolsitas, para no confundirlas (Gonzalo).
  const delLugar = useMemo(() => (zona === "Depósito" ? catalogo : catalogo.filter((p) => !p.enGramos)), [zona, catalogo]);

  const resultados = useMemo(() => {
    const palabras = plano(busqueda).split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    return delLugar.filter((p) => palabras.every((w) => plano(`${p.nombre} ${p.marca} ${p.codigo ?? ""}`).includes(w))).slice(0, 25);
  }, [busqueda, delLugar]);

  function leido(valor: string) {
    setEscaneando(false);
    const d = soloDigitos(valor);
    const p = delLugar.find((x) => x.codigo && soloDigitos(x.codigo) === d);
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

      {ubicando && modulosDeZona(gondola, zona).length > 0 ? (
        <Ubicar
          p={ubicando}
          modulos={modulosDeZona(gondola, zona)}
          gondola={gondola}
          onListo={(texto) => {
            setUbicando(null);
            if (texto) setAviso(texto);
            router.refresh();
          }}
        />
      ) : sel ? (
        <Contar
          p={sel}
          zona={zona}
          otros={conteosDe(sel.idVariante)}
          onListo={(texto) => {
            // Si el lugar tiene su mueble en la Góndola (no el granel), se confirma dónde está.
            if (!sel.enGramos && modulosDeZona(gondola, zona).length > 0) setUbicando(sel);
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
                        <span className="block text-sm font-medium text-neutral-900">
                          {p.nombre}
                          {p.enGramos && <span className="ml-1.5 align-middle rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[11px] font-bold">A GRANEL · en kilos</span>}
                        </span>
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

      {porFirmar.length > 0 || !firmeAlgo ? (
        <TerminarMiParte cuantos={new Set(porFirmar.map((c) => c.idVariante)).size} zonas={[...new Set(porFirmar.map((c) => c.zona))]} otraTanda={firmeAlgo} />
      ) : (
        <p className="mt-6 text-sm rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2">✓ Firmaste todo lo que contaste. Si contás otro módulo, al terminar te pide firmar de nuevo.</p>
      )}

      {esAdmin && ubicaciones && <PanelUbicaciones u={ubicaciones} />}
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

/**
 * ¿Está acá? El mueble del lugar donde se cuenta, en 3D como en Góndola, con
 * el lugar del producto marcado. Si está en otro lado o no tenía lugar, se
 * toca dónde está.
 */
function Ubicar({ p, modulos, gondola, onListo }: { p: ProductoInventario; modulos: ModuloGondola[]; gondola: ModuloGondola[]; onListo: (texto: string | null) => void }) {
  // Dónde lo tiene el plano (en este mueble o en otro).
  const plano = (() => {
    for (const m of gondola) {
      const l = m.lugares.find((x) => x.idProducto === p.idProducto);
      if (l) return { m, fila: l.fila, columna: l.columna };
    }
    return null;
  })();
  // Si el lugar tiene dos lados (las islas, Animalfit), arranca en el lado donde lo tiene el plano.
  const [lado, setLado] = useState(() => Math.max(0, modulos.findIndex((m) => m.id === plano?.m.id)));
  const modulo = modulos[lado] ?? modulos[0];
  const enEste = plano && plano.m.id === modulo.id ? plano : null;
  const [eligiendo, setEligiendo] = useState(!plano);
  const [elegido, setElegido] = useState<{ fila: number; columna: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();
  const textoPlano = plano ? textoLugar(gondola, plano.m, plano.fila, plano.columna) : null;

  function confirmar() {
    if (!textoPlano) return;
    setError(null);
    startTransition(async () => {
      const r = await confirmarUbicacion(p.idProducto, textoPlano);
      if (r.error) setError(r.error);
      else onListo(`✓ ${p.nombre}: confirmado en ${textoPlano}.`);
    });
  }
  function guardarLugar() {
    if (!elegido) return;
    setError(null);
    const hacia = textoLugar(gondola, modulo, elegido.fila, elegido.columna);
    startTransition(async () => {
      const r = await ubicarProducto(p.idProducto, modulo.id, elegido.fila, elegido.columna, hacia, textoPlano);
      if (r.error) setError(r.error);
      else onListo(r.pendiente ? `${p.nombre}: anotado que está en ${hacia}. Gonzalo decide si queda ahí.` : `✓ ${p.nombre}: ubicado en ${hacia}.`);
    });
  }

  return (
    <div className="rounded-2xl border-2 border-accent bg-white p-4 space-y-3 mb-4">
      <div>
        <p className="font-semibold text-neutral-900">{eligiendo ? (plano ? "¿Dónde está de verdad?" : "¿Dónde lo pusiste?") : "¿Está acá?"}</p>
        <p className="text-xs text-neutral-500">
          {p.nombre}
          {textoPlano ? ` · según el plano va en ${textoPlano}` : " · todavía no tiene lugar en la góndola"}
        </p>
      </div>

      {modulos.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {modulos.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setLado(i);
                setElegido(null);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${i === lado ? "border-accent bg-accent text-white" : "border-neutral-300 bg-white"}`}
            >
              {m.subtitulo ?? m.titulo}
            </button>
          ))}
        </div>
      )}

      <div className="flex justify-center py-1" style={{ perspective: "900px" }}>
        <div
          className="rounded-lg p-2.5 pb-3 w-full max-w-sm"
          style={{ background: "#c9a57a", transform: "rotateX(8deg) rotateY(-10deg)", boxShadow: "10px 14px 0 -4px #a8835a, 0 16px 28px rgba(0,0,0,.18)" }}
        >
          <p className="text-center text-[11px] font-extrabold uppercase tracking-wider text-[#3b2b19] mb-1.5">
            {textoLugar(gondola, modulo, 0, 0).split(" · ")[0]} · {modulo.titulo}
          </p>
          {modulo.filas.map((f, fi) => (
            <div key={fi} className="mb-1.5 border-b-[5px] border-[#a8835a] bg-[#f3ece0] px-1.5 pt-1.5 pb-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${f.lugares}, minmax(0, 1fr))` }}>
              {Array.from({ length: f.lugares }, (_, c) => {
                const l = modulo.lugares.find((x) => x.fila === fi && x.columna === c);
                const esEste = enEste && enEste.fila === fi && enEste.columna === c;
                const esElegido = elegido && elegido.fila === fi && elegido.columna === c;
                const libre = !l || l.idProducto === p.idProducto;
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={!eligiendo || !libre}
                    onClick={() => setElegido({ fila: fi, columna: c })}
                    className={`h-9 rounded text-[9px] leading-tight px-0.5 grid place-items-center text-center ${
                      esElegido
                        ? "bg-emerald-600 text-white font-bold"
                        : esEste && !eligiendo
                          ? "bg-accent text-white font-bold ring-4 ring-accent/30 motion-safe:animate-pulse"
                          : l && !libre
                            ? "bg-[#e8dcc6] text-neutral-600"
                            : eligiendo
                              ? "bg-white/70 border border-dashed border-emerald-500"
                              : "bg-white/50 border border-dashed border-black/15"
                    }`}
                  >
                    {esElegido || (esEste && !eligiendo) ? "ACÁ" : l && !libre ? l.nombre.split(" ").slice(0, 2).join(" ") : ""}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {eligiendo ? (
        <p className="text-xs text-neutral-600 bg-emerald-50 rounded-lg px-3 py-2">
          Tocá en el mueble el lugar donde está. Si está en otro mueble, elegilo arriba y volvé a contarlo ahí.
        </p>
      ) : !enEste ? (
        <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Según el plano no va en este mueble. Si está acá, tocá «Está en otro lugar» y marcá dónde.</p>
      ) : null}

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {eligiendo ? (
          <>
            <button type="button" onClick={() => (plano ? setEligiendo(false) : onListo(null))} className="rounded-xl border border-neutral-300 px-3 py-3 text-sm">
              {plano ? "Volver" : "Ahora no"}
            </button>
            <button type="button" onClick={guardarLugar} disabled={!elegido || guardando} className="rounded-xl bg-neutral-900 text-white px-3 py-3 text-sm font-semibold disabled:opacity-40">
              {guardando ? "Guardando…" : elegido ? "Guardar este lugar" : "Tocá un lugar"}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEligiendo(true)} className="rounded-xl border border-neutral-300 px-3 py-3 text-sm">
              Está en otro lugar
            </button>
            <button type="button" onClick={confirmar} disabled={guardando || !enEste} className="rounded-xl bg-emerald-600 text-white px-3 py-3 text-sm font-semibold disabled:opacity-40">
              {guardando ? "Guardando…" : "✓ Sí, está acá"}
            </button>
          </>
        )}
      </div>
      <button type="button" onClick={() => onListo(null)} className="w-full text-xs text-neutral-500">
        Saltear la ubicación
      </button>
    </div>
  );
}

/** Para Gonzalo: lo que confirmaron y lo que no coincide con su plano. */
function PanelUbicaciones({ u }: { u: ResumenUbicaciones }) {
  const router = useRouter();
  const [guardando, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function resolver(id: string, dejar: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await resolverUbicacion(id, dejar);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }
  return (
    <section className="mt-10 rounded-2xl border border-neutral-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h2 className="font-semibold text-neutral-900">Dónde está cada producto</h2>
        <p className="text-xs text-neutral-500">Lo que confirmaron mientras contaban, y lo que no coincide con tu plano de Góndola.</p>
      </div>
      <div className="p-4 flex flex-wrap gap-2 text-sm">
        <span className="rounded-xl bg-emerald-50 text-emerald-800 px-3 py-2">
          <b className="tabular-nums">{u.confirmados}</b> confirmados
        </span>
        <span className="rounded-xl bg-sky-50 text-sky-800 px-3 py-2">
          <b className="tabular-nums">{u.nuevos}</b> ubicados por primera vez
        </span>
        <span className="rounded-xl bg-amber-50 text-amber-800 px-3 py-2">
          <b className="tabular-nums">{u.movidos}</b> en otro lugar
        </span>
      </div>
      {u.pendientes.length > 0 && (
        <div className="px-4 pb-4 space-y-2">
          {u.pendientes.map((x) => (
            <div key={x.id} className="rounded-xl border border-l-4 border-amber-200 border-l-amber-500 p-3 text-sm">
              <p>
                <b>{x.producto}</b> · {x.quien ?? "Alguien"} lo encontró en <b>{x.hacia}</b>; en tu plano va en <b>{x.desde}</b>.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={guardando} onClick={() => resolver(x.id, true)} className="rounded-lg bg-neutral-900 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
                  Dejarlo donde está
                </button>
                <button type="button" disabled={guardando} onClick={() => resolver(x.id, false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
                  Que lo muevan a mi lugar
                </button>
              </div>
            </div>
          ))}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <p className="text-xs text-neutral-500">«Que lo muevan» lo deja marcado «falta poner» en su lugar, con la indicación, y el equipo lo ve en Góndola.</p>
        </div>
      )}
    </section>
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

/** Lo que contó alguien después de su última firma: lo que le falta firmar. */
function sinFirmar(conteos: ConteoInventario[], firmas: FirmaInventario[], nombre: string | null) {
  const ultima = firmas
    .filter((f) => f.nombre === nombre)
    .reduce<number | null>((max, f) => Math.max(max ?? 0, new Date(f.cuando).getTime()), null);
  return conteos.filter((c) => c.quien === nombre && (ultima == null || new Date(c.cuando).getTime() > ultima));
}

function TerminarMiParte({ cuantos, zonas, otraTanda }: { cuantos: number; zonas: string[]; otraTanda: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [firma, setFirma] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} disabled={cuantos === 0} className="mt-6 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 font-semibold disabled:opacity-40">
        {otraTanda ? `Terminé ${zonas.join(", ")} · firmar` : "Terminé mi parte · firmar"}
      </button>
    );
  }
  return (
    <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
      <p className="text-sm text-neutral-700">
        {otraTanda ? "Desde tu última firma contaste" : "Contaste"} <b>{cuantos} productos</b>
        {zonas.length > 0 && <> en {zonas.join(", ")}</>}. Con tu firma confirmás que había lo que anotaste.
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
  const faltanFirmar = quienes.filter((q) => sinFirmar(conteos, firmas, q).length > 0);
  const zonasSinContar = ZONAS_INVENTARIO.filter((z) => z !== "Depósito" && !conteos.some((c) => c.zona === z));
  const porId = new Map(catalogo.map((p) => [p.idVariante, p]));

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
      <p className="mx-4 mt-3 text-xs rounded-lg bg-sky-50 text-sky-900 px-3 py-2">
        Lo contado todavía <b>no cambió el stock</b>: se carga todo junto cuando tocás «Cerrar inventario y cargar el stock», abajo de todo.
      </p>
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

      {quienes.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">Qué contó cada uno</p>
          <div className="space-y-2">
            {quienes.map((q) => {
              const deQ = conteos.filter((c) => c.quien === q);
              const pendientes = new Set(sinFirmar(conteos, firmas, q).map((c) => c.zona + c.idVariante));
              const zonas = ZONAS_INVENTARIO.filter((z) => deQ.some((c) => c.zona === z));
              return (
                <details key={q} className="rounded-xl border border-neutral-200">
                  <summary className="cursor-pointer px-3 py-2 text-sm">
                    <b>{q}</b> · {deQ.length} productos
                    {pendientes.size > 0 ? <span className="ml-1 text-amber-700">· {pendientes.size} sin firmar</span> : <span className="ml-1 text-emerald-700">· todo firmado</span>}
                  </summary>
                  <div className="px-3 pb-3 space-y-3">
                    {zonas.map((z) => (
                      <div key={z}>
                        <p className="text-xs font-semibold text-neutral-600 mt-1 mb-1">{z}</p>
                        <ul className="text-sm divide-y divide-neutral-100">
                          {deQ
                            .filter((c) => c.zona === z)
                            .sort((a, b) => a.cuando.localeCompare(b.cuando))
                            .map((c) => {
                              const p = porId.get(c.idVariante);
                              return (
                                <li key={c.idVariante} className="py-1 flex justify-between gap-2">
                                  <span className="min-w-0 truncate">
                                    <span className="text-neutral-400 tabular-nums mr-1.5">{hora(c.cuando)}</span>
                                    {p?.nombre ?? "Producto"}
                                    {pendientes.has(c.zona + c.idVariante) && <span className="ml-1 text-[11px] text-amber-700">(sin firmar)</span>}
                                  </span>
                                  <b className="tabular-nums shrink-0">{p?.enGramos ? textoGramos(c.cantidad) : c.cantidad}</b>
                                </li>
                              );
                            })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
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
            {/* El 2026-11-10 se cerró con esto tildado antes de contar Animalfit y
                las islas, y 147 productos con stock quedaron en 0. */}
            {enCero && zonasSinContar.length > 0 && (
              <p className="text-sm rounded-lg bg-red-50 text-red-800 px-3 py-2">
                ⚠️ En <b>{zonasSinContar.join(", ")}</b> no contó nadie: todo lo que está ahí va a quedar en 0. Tildalo solo si recorrieron
                todo el local.
              </p>
            )}
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
