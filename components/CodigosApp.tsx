"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { esCodigoInterno, limpiarCodigoBarras, formatearCodigo } from "@/lib/codigos";
import { guardarCodigoBarras, volverAEtiquetaWiigo } from "@/app/(app)/codigos/actions";
import type { EntradaPendiente } from "@/lib/entradas";
import EscanerCodigo from "@/components/EscanerCodigo";
import CodigoDeBarras from "@/components/CodigoDeBarras";

export type ItemCodigo = {
  idVariante: string;
  producto: string;
  /** El sabor o el tamaño. null cuando el producto no tiene variaciones. */
  variante: string | null;
  sku: string | null;
  imagen: string | null;
  codigo: string | null;
  marca: string | null;
};

const SIN_MARCA = "Marcas que no están activas";

/**
 * Las planchas de etiquetas que se consiguen acá.
 *
 * Las medidas son las que vienen impresas en el paquete. `margenX` y `margenY`
 * son el borde de papel que la plancha deja antes de la primera etiqueta: si no
 * se respeta, todo sale corrido media etiqueta y se arruina la hoja entera.
 */
const PLANCHAS = [
  { id: "70x35", nombre: "70 × 35 mm — 24 por hoja", ancho: 70, alto: 35, cols: 3, filas: 8, margenX: 0, margenY: 8.5, sepX: 0, sepY: 0 },
  { id: "63x34", nombre: "63,5 × 33,9 mm — 24 por hoja (Avery L7159)", ancho: 63.5, alto: 33.9, cols: 3, filas: 8, margenX: 7.2, margenY: 13.1, sepX: 2.5, sepY: 0 },
  { id: "105x37", nombre: "105 × 37 mm — 16 por hoja", ancho: 105, alto: 37, cols: 2, filas: 8, margenX: 0, margenY: 0.5, sepX: 0, sepY: 0 },
  { id: "105x48", nombre: "105 × 48 mm — 12 por hoja", ancho: 105, alto: 48, cols: 2, filas: 6, margenX: 0, margenY: 4.5, sepX: 0, sepY: 0 },
  { id: "38x21", nombre: "38,1 × 21,2 mm — 65 por hoja", ancho: 38.1, alto: 21.2, cols: 5, filas: 13, margenX: 4.7, margenY: 10.7, sepX: 2.5, sepY: 0 },
] as const;

type Plancha = (typeof PLANCHAS)[number];

/**
 * El nombre como va impreso en la etiqueta.
 *
 * Los productos de suplementos traen la marca metida en el propio nombre
 * ("... x315gr 45 servicios - STAR NUTRITION"). En 70 mm eso se come el lugar
 * del nombre real, y además la marca ya se sabe: se saca el sufijo.
 */
function nombreParaEtiqueta(item: ItemCodigo) {
  const sinMarca = item.producto.replace(/\s+-\s+[A-ZÁÉÍÓÚÑ0-9 .&]{3,}$/u, "").trim();
  // Solo se saca si lo que queda sigue identificando al producto. Si sacarlo
  // dejara un nombre de cuatro letras, es que ese sufijo no era la marca.
  return sinMarca.length >= 12 ? sinMarca : item.producto;
}

export default function CodigosApp({
  items,
  entradas = [],
}: {
  items: ItemCodigo[];
  entradas?: EntradaPendiente[];
}) {
  // Si acaba de entrar mercadería que hay que etiquetar, la pantalla arranca
  // en Imprimir: es a lo que vino la operativa. Si no, arranca en Revisar, que
  // es lo primero que hay que hacer con un catálogo nuevo.
  const [tab, setTab] = useState<"revisar" | "imprimir">(entradas.length > 0 ? "imprimir" : "revisar");
  const [busqueda, setBusqueda] = useState("");
  const [soloFaltan, setSoloFaltan] = useState(false);
  const [escaneando, setEscaneando] = useState<ItemCodigo | "libre" | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "mal" } | null>(null);

  const conEtiqueta = useMemo(() => items.filter((i) => !i.codigo || esCodigoInterno(i.codigo)), [items]);
  const conEnvase = items.length - conEtiqueta.length;

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return items.filter((i) => {
      if (soloFaltan && i.codigo && !esCodigoInterno(i.codigo)) return false;
      if (!q) return true;
      return [i.producto, i.variante, i.sku, i.codigo, i.marca]
        .filter(Boolean)
        .some((t) => String(t).toLowerCase().includes(q));
    });
  }, [items, busqueda, soloFaltan]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Códigos de barras</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {items.length} productos · {conEnvase} se escanean del envase · {conEtiqueta.length} hay
            que imprimirlos y pegarlos
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEscaneando("libre")}
          className="rounded-lg bg-accent text-white px-4 py-2.5 text-sm font-semibold hover:bg-accent-dark"
        >
          📷 Escanear un envase
        </button>
      </div>

      {conEnvase === 0 && conEtiqueta.length > 20 && (
        <div className="mb-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <span className="text-xl leading-none">⚠️</span>
          <div className="text-sm text-neutral-700 leading-relaxed">
            <strong className="block text-amber-700 mb-1">Antes de imprimir, revisá los envases</strong>
            Todavía no hay ningún producto con el código de su envase cargado, así que el sistema les
            quiere imprimir un código a todos. La mayoría de lo que viene envasado de fábrica ya trae
            el suyo: si imprimís ahora, vas a estar pegando stickers encima de códigos que ya
            funcionaban.
          </div>
        </div>
      )}

      <div className="inline-flex gap-1 bg-neutral-100 rounded-xl p-1 mb-4">
        {(
          [
            ["revisar", "Revisar envases"],
            // No dice "etiquetas": en Aprobaciones esa palabra ya es el cartel
            // de precio de la góndola, que es otra cosa y lleva plata impresa.
            ["imprimir", `Imprimir códigos · ${conEtiqueta.length}`],
          ] as const
        ).map(([id, texto]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm rounded-lg ${
              tab === id ? "bg-white shadow-sm font-semibold" : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      {aviso && (
        <p
          className={`mb-4 text-sm rounded-lg px-3 py-2 ${
            aviso.tono === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {aviso.texto}
        </p>
      )}

      {tab === "revisar" ? (
        <Revisar
          items={filtrados}
          busqueda={busqueda}
          setBusqueda={setBusqueda}
          soloFaltan={soloFaltan}
          setSoloFaltan={setSoloFaltan}
          onEscanear={setEscaneando}
          onAviso={setAviso}
        />
      ) : (
        <Imprimir items={conEtiqueta} entradas={entradas} />
      )}

      {escaneando && (
        <EscanerDeLista
          item={escaneando === "libre" ? null : escaneando}
          items={items}
          onCerrar={() => setEscaneando(null)}
          onAviso={setAviso}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pestaña 1: revisar y cargar códigos                                */
/* ------------------------------------------------------------------ */

function Revisar({
  items,
  busqueda,
  setBusqueda,
  soloFaltan,
  setSoloFaltan,
  onEscanear,
  onAviso,
}: {
  items: ItemCodigo[];
  busqueda: string;
  setBusqueda: (s: string) => void;
  soloFaltan: boolean;
  setSoloFaltan: (b: boolean) => void;
  onEscanear: (i: ItemCodigo) => void;
  onAviso: (a: { texto: string; tono: "ok" | "mal" } | null) => void;
}) {
  const porMarca = useMemo(() => agruparPorMarca(items), [items]);

  return (
    <>
      <div className="flex gap-2 mb-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, SKU o código…"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="button"
          onClick={() => setSoloFaltan(!soloFaltan)}
          className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium border ${
            soloFaltan ? "bg-neutral-900 text-white border-neutral-900" : "bg-white border-neutral-300"
          }`}
        >
          Solo los que faltan
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-neutral-500 py-12 text-center">No hay productos que coincidan.</p>
      ) : (
        <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white">
          {porMarca.map(([marca, deLaMarca]) => (
            <div key={marca}>
              <p className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 bg-neutral-50 px-4 py-2 border-b border-neutral-200">
                {marca} · {deLaMarca.filter((i) => !i.codigo || esCodigoInterno(i.codigo)).length} sin código
              </p>
              {deLaMarca.map((i) => (
                <FilaProducto key={i.idVariante} item={i} onEscanear={onEscanear} onAviso={onAviso} />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function FilaProducto({
  item,
  onEscanear,
  onAviso,
}: {
  item: ItemCodigo;
  onEscanear: (i: ItemCodigo) => void;
  onAviso: (a: { texto: string; tono: "ok" | "mal" } | null) => void;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const propio = Boolean(item.codigo) && !esCodigoInterno(item.codigo);

  function quitar() {
    startTransition(async () => {
      const res = await volverAEtiquetaWiigo(item.idVariante);
      if (res.error) onAviso({ texto: res.error, tono: "mal" });
      else {
        onAviso({ texto: `${item.producto} vuelve a llevar código WiiGo para imprimir.`, tono: "ok" });
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-100 last:border-b-0">
      <span className="w-9 h-9 rounded-lg bg-neutral-100 overflow-hidden shrink-0 grid place-items-center text-neutral-300">
        {item.imagen ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imagen} alt="" className="w-full h-full object-contain" loading="lazy" />
        ) : (
          "—"
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-neutral-900 truncate">
          {item.producto}
          {item.variante && <span className="text-neutral-500"> — {item.variante}</span>}
        </span>
        <span className="block text-xs text-neutral-400">{item.sku ?? "sin SKU"}</span>
      </span>

      {propio ? (
        <span className="shrink-0 text-xs font-mono font-medium bg-emerald-50 text-emerald-700 rounded-full px-2.5 py-1">
          {item.codigo}
        </span>
      ) : (
        <span className="shrink-0 text-xs font-medium bg-amber-50 text-amber-700 rounded-full px-2.5 py-1">
          Sin código
        </span>
      )}

      <button
        type="button"
        onClick={() => onEscanear(item)}
        className="shrink-0 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
      >
        {propio ? "Cambiar" : "Escanear"}
      </button>

      {propio && (
        <button
          type="button"
          onClick={quitar}
          disabled={pendiente}
          title="Sacarle el código del envase y volver al código WiiGo para imprimir"
          className="shrink-0 text-xs text-neutral-400 hover:text-red-500 disabled:opacity-40"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * El escáner, con el producto al que se le va a asignar el código.
 *
 * Cuando se abre sin producto ("Escanear un envase") busca a quién pertenece el
 * código leído: si ya está cargado avisa cuál es, y si no, pide elegirlo de la
 * lista. Ese es el camino rápido para hacer veinte seguidos con el envase en la
 * mano en vez de buscar cada producto primero.
 */
function EscanerDeLista({
  item,
  items,
  onCerrar,
  onAviso,
}: {
  item: ItemCodigo | null;
  items: ItemCodigo[];
  onCerrar: () => void;
  onAviso: (a: { texto: string; tono: "ok" | "mal" } | null) => void;
}) {
  const router = useRouter();
  const [leido, setLeido] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [, startTransition] = useTransition();

  function asignar(destino: ItemCodigo, codigo: string) {
    startTransition(async () => {
      const res = await guardarCodigoBarras(destino.idVariante, codigo);
      if (res.error) {
        onAviso({ texto: res.error, tono: "mal" });
      } else {
        onAviso({ texto: `${destino.producto}: código ${limpiarCodigoBarras(codigo)} guardado.`, tono: "ok" });
        router.refresh();
      }
      onCerrar();
    });
  }

  if (!leido) {
    return (
      <EscanerCodigo
        onCerrar={onCerrar}
        onLeido={(valor) => {
          const codigo = limpiarCodigoBarras(valor);
          if (item) return asignar(item, codigo);

          const yaEs = items.find((i) => i.codigo === codigo);
          if (yaEs) {
            onAviso({ texto: `Ese código ya es de ${yaEs.producto}.`, tono: "ok" });
            onCerrar();
            return;
          }
          setLeido(codigo);
        }}
      />
    );
  }

  // Se leyó un código que no está en el sistema: hay que decir de quién es.
  const q = busqueda.trim().toLowerCase();
  const candidatos = items
    .filter((i) => !i.codigo || esCodigoInterno(i.codigo))
    .filter((i) => !q || [i.producto, i.variante, i.sku].filter(Boolean).some((t) => String(t).toLowerCase().includes(q)))
    .slice(0, 40);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(20,17,13,.8)" }}
      onClick={onCerrar}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-neutral-200">
          <p className="text-sm font-semibold">
            Leí <span className="font-mono">{leido}</span>
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">¿De qué producto es este envase?</p>
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
          {candidatos.length === 0 ? (
            <p className="text-sm text-neutral-500 p-6 text-center">Ninguno coincide.</p>
          ) : (
            candidatos.map((c) => (
              <button
                key={c.idVariante}
                type="button"
                onClick={() => asignar(c, leido)}
                className="w-full text-left px-4 py-2.5 hover:bg-neutral-50 border-b border-neutral-100"
              >
                <span className="block text-sm font-medium truncate">
                  {c.producto}
                  {c.variante && <span className="text-neutral-500"> — {c.variante}</span>}
                </span>
                <span className="block text-xs text-neutral-400">
                  {c.marca ?? "sin marca"} · {c.sku ?? "sin SKU"}
                </span>
              </button>
            ))
          )}
        </div>
        <button type="button" onClick={onCerrar} className="px-4 py-3 text-sm text-neutral-500 border-t border-neutral-200">
          Cancelar
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pestaña 2: imprimir la hoja                                        */
/* ------------------------------------------------------------------ */

function Imprimir({ items, entradas }: { items: ItemCodigo[]; entradas: EntradaPendiente[] }) {
  const porVariante = useMemo(() => new Map(entradas.map((e) => [e.idVariante, e])), [entradas]);
  const recibidos = useMemo(
    () => items.filter((i) => porVariante.has(i.idVariante)),
    [items, porVariante]
  );
  const [modo, setModo] = useState<"recibido" | "todo">(recibidos.length > 0 ? "recibido" : "todo");

  if (items.length === 0) {
    return (
      <p className="text-sm text-neutral-500 py-16 text-center">
        No hay nada para imprimir: todos los productos tienen el código de su propio envase cargado.
      </p>
    );
  }

  const visibles = modo === "recibido" ? recibidos : items;
  const unidades = (i: ItemCodigo) =>
    modo === "recibido" ? porVariante.get(i.idVariante)?.cantidad ?? 1 : 1;

  return (
    <>
      {/* Este bloque desaparece al imprimir; la hoja, que va adentro de
          ConfigurarImpresion, no — por eso no se puede envolver todo junto:
          `print:hidden` es display:none y se lleva puesto lo que tenga adentro. */}
      <div className="print:hidden">
        {recibidos.length > 0 && (
          <div className="inline-flex gap-1 bg-neutral-100 rounded-xl p-1 mb-3">
            {(
              [
                ["recibido", `Lo que entró · ${recibidos.length}`],
                ["todo", `Todo lo que falta · ${items.length}`],
              ] as const
            ).map(([id, texto]) => (
              <button
                key={id}
                type="button"
                onClick={() => setModo(id)}
                className={`px-3.5 py-1.5 text-xs rounded-lg ${
                  modo === id ? "bg-white shadow-sm font-semibold" : "text-neutral-600"
                }`}
              >
                {texto}
              </button>
            ))}
          </div>
        )}

        {/* La duda aparece sola la primera vez, así que se contesta sin que haya
            que preguntar: el cartel de precio de la góndola es otra cosa. */}
        <p className="text-xs text-neutral-500 mb-3 leading-relaxed max-w-2xl">
          {modo === "recibido"
            ? "Lo que entró por recepción en los últimos 7 días y todavía no tiene código del envase. La cantidad ya viene puesta: es la que se recibió."
            : "Todos los productos que necesitan que les imprimas el código."}{" "}
          Los stickers llevan el nombre y el código de barras, <b>no el precio</b> — el precio se
          imprime aparte, en el cartelito de góndola.
        </p>
      </div>

      {/* El `key` remonta la lista al cambiar de modo: las cantidades se
          recalculan solas en vez de arrastrar las del modo anterior. */}
      <ConfigurarImpresion key={modo} items={visibles} unidadesIniciales={unidades} />
    </>
  );
}

function ConfigurarImpresion({
  items,
  unidadesIniciales,
}: {
  items: ItemCodigo[];
  unidadesIniciales: (i: ItemCodigo) => number;
}) {
  const [plancha, setPlancha] = useState<Plancha>(PLANCHAS[0]);
  const [desde, setDesde] = useState(1);
  const [cantidades, setCantidades] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.idVariante, unidadesIniciales(i)]))
  );

  const porHoja = plancha.cols * plancha.filas;
  const aImprimir = useMemo(
    () =>
      items.flatMap((i) => Array(Math.max(0, cantidades[i.idVariante] ?? 0)).fill(i) as ItemCodigo[]),
    [items, cantidades]
  );
  // Los casilleros que se saltean al empezar más abajo cuentan como usados.
  const hojas = Math.ceil((aImprimir.length + desde - 1) / porHoja) || 0;
  const porMarca = useMemo(() => agruparPorMarca(items), [items]);

  function poner(id: string, n: number) {
    setCantidades((prev) => ({ ...prev, [id]: Math.min(Math.max(0, n), 99) }));
  }

  return (
    <>
      <div className="print:hidden border border-neutral-200 rounded-xl overflow-hidden bg-white mb-4">
        {porMarca.map(([marca, deLaMarca]) => {
          const totalMarca = deLaMarca.reduce((a, i) => a + (cantidades[i.idVariante] ?? 0), 0);
          return (
            <div key={marca}>
              <div className="flex items-center justify-between gap-2 bg-neutral-50 px-4 py-2 border-b border-neutral-200">
                <span className="text-[11px] uppercase tracking-wider font-bold text-neutral-400">
                  {marca} · {deLaMarca.length} productos
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCantidades((prev) => {
                      const next = { ...prev };
                      // Si ya hay alguno marcado, el botón apaga la marca entera.
                      const apagar = totalMarca > 0;
                      deLaMarca.forEach((i) => (next[i.idVariante] = apagar ? 0 : unidadesIniciales(i)));
                      return next;
                    })
                  }
                  className="text-xs text-accent"
                >
                  {totalMarca > 0 ? "Ninguno" : "Todos"}
                </button>
              </div>
              {deLaMarca.map((i) => (
                <div
                  key={i.idVariante}
                  className="flex items-center gap-3 px-4 py-2 border-b border-neutral-100 last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">
                      {i.producto}
                      {i.variante && <span className="text-neutral-500"> — {i.variante}</span>}
                    </span>
                    <span className="block text-xs text-neutral-400">
                      {i.sku ?? "sin SKU"} ·{" "}
                      <span className="font-mono">
                        {i.codigo ? formatearCodigo(i.codigo) : "se genera al guardar"}
                      </span>
                    </span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => poner(i.idVariante, (cantidades[i.idVariante] ?? 0) - 1)}
                      className="w-7 h-7 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={cantidades[i.idVariante] ?? 0}
                      onChange={(e) => poner(i.idVariante, Number(e.target.value))}
                      aria-label={`Cuántos stickers de ${i.producto}`}
                      className="w-14 text-center rounded-lg border border-neutral-300 px-1 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => poner(i.idVariante, (cantidades[i.idVariante] ?? 0) + 1)}
                      className="w-7 h-7 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="print:hidden rounded-xl bg-neutral-50 border border-neutral-200 p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-neutral-500 mb-1" htmlFor="plancha">
            Plancha de etiquetas
          </label>
          <select
            id="plancha"
            value={plancha.id}
            onChange={(e) => {
              const p = PLANCHAS.find((x) => x.id === e.target.value);
              if (p) {
                setPlancha(p);
                setDesde(1);
              }
            }}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {PLANCHAS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-neutral-500 mb-1" htmlFor="desde">
            Empezar en el casillero
          </label>
          <input
            id="desde"
            type="number"
            min={1}
            max={porHoja}
            value={desde}
            onChange={(e) => setDesde(Math.min(Math.max(1, Number(e.target.value) || 1), porHoja))}
            className="w-24 rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <span className="text-sm text-neutral-600 mr-auto">
          <b className="text-neutral-900">{aImprimir.length}</b> stickers ·{" "}
          <b className="text-neutral-900">{hojas}</b> {hojas === 1 ? "hoja" : "hojas"}
        </span>

        <button
          type="button"
          onClick={() => window.print()}
          disabled={aImprimir.length === 0}
          className="rounded-lg bg-accent text-white px-4 py-2.5 text-sm font-semibold hover:bg-accent-dark disabled:opacity-40"
        >
          🖨️ Imprimir
        </button>
      </div>

      <p className="print:hidden text-xs text-neutral-500 mt-3 leading-relaxed max-w-2xl">
        Al imprimir, poné el tamaño en <b>A4</b> y los márgenes en <b>ninguno</b>, y desactivá
        &ldquo;ajustar al papel&rdquo; — si el navegador achica la página, las etiquetas salen
        corridas y se arruina la plancha entera. Hacé una prueba en papel común y ponela sobre la
        plancha a contraluz antes de gastar la primera.
      </p>

      <HojaDeEtiquetas plancha={plancha} desde={desde} items={aImprimir} />
    </>
  );
}

/**
 * La hoja tal cual sale de la impresora.
 *
 * En pantalla se muestra chica como vista previa; al imprimir, la regla
 * `@page` y las medidas en milímetros hacen que cada casillero caiga justo
 * sobre su etiqueta autoadhesiva.
 */
function HojaDeEtiquetas({
  plancha,
  desde,
  items,
}: {
  plancha: Plancha;
  desde: number;
  items: ItemCodigo[];
}) {
  const porHoja = plancha.cols * plancha.filas;
  // Los casilleros que se saltean van vacíos adelante; el resto se corta en
  // hojas de `porHoja`.
  const casilleros: (ItemCodigo | null)[] = [...Array(desde - 1).fill(null), ...items];
  const hojas: (ItemCodigo | null)[][] = [];
  for (let i = 0; i < casilleros.length; i += porHoja) {
    const hoja = casilleros.slice(i, i + porHoja);
    while (hoja.length < porHoja) hoja.push(null);
    hojas.push(hoja);
  }

  return (
    <div className="hoja-etiquetas">
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden; }
          .hoja-etiquetas, .hoja-etiquetas * { visibility: visible; }
          .hoja-etiquetas { position: absolute; left: 0; top: 0; }
          .etq-hoja { page-break-after: always; }
          .etq-hoja:last-child { page-break-after: auto; }
        }
        @media screen {
          .hoja-etiquetas { margin-top: 28px; }
          .etq-hoja {
            transform: scale(.62); transform-origin: top left;
            margin-bottom: calc(-297mm * .38 + 24px);
            box-shadow: 0 4px 24px rgba(20,26,34,.16);
            border-radius: 2px;
          }
          .etq-casillero { outline: .2mm dashed #e2e2e2; outline-offset: -.1mm; }
        }
      `}</style>

      {hojas.map((hoja, h) => (
        <div
          key={h}
          className="etq-hoja bg-white"
          style={{
            width: "210mm",
            height: "297mm",
            paddingTop: `${plancha.margenY}mm`,
            paddingLeft: `${plancha.margenX}mm`,
            display: "grid",
            gridTemplateColumns: `repeat(${plancha.cols}, ${plancha.ancho}mm)`,
            gridAutoRows: `${plancha.alto}mm`,
            columnGap: `${plancha.sepX}mm`,
            rowGap: `${plancha.sepY}mm`,
          }}
        >
          {hoja.map((item, i) =>
            item ? (
              <Etiqueta key={i} item={item} plancha={plancha} />
            ) : (
              <div key={i} className="etq-casillero" />
            )
          )}
        </div>
      ))}
    </div>
  );
}

function Etiqueta({ item, plancha }: { item: ItemCodigo; plancha: Plancha }) {
  const nombre = nombreParaEtiqueta(item);
  // En las planchas chicas no entra el mismo cuerpo de letra. Y dentro de una
  // misma plancha, un nombre largo tiene que achicarse o se corta a la mitad.
  const escala = plancha.ancho < 50 ? 0.72 : 1;
  const cuerpo = (nombre.length > 40 ? 2.5 : nombre.length > 26 ? 2.85 : 3.2) * escala;
  const chica = plancha.alto < 30;

  return (
    <div
      className="etq-casillero"
      style={{
        padding: `${chica ? 1.4 : 2.4}mm ${chica ? 1.6 : 3}mm`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
        color: "#000",
        fontFamily: "'Arial Narrow', Arial, sans-serif",
      }}
    >
      <div>
        <div
          style={{
            fontSize: `${cuerpo}mm`,
            lineHeight: 1.15,
            fontWeight: 700,
            textTransform: "uppercase",
            display: "-webkit-box",
            WebkitLineClamp: chica ? 1 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {nombre}
        </div>
        {item.variante && !chica && (
          <div style={{ fontSize: `${2.7 * escala}mm`, color: "#333", lineHeight: 1.2 }}>
            {item.variante}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: ".4mm" }}>
        <CodigoDeBarras
          valor={item.codigo ?? ""}
          ancho={`${plancha.ancho * 0.8}mm`}
          alto={`${chica ? 5.5 : 9}mm`}
        />
        <div
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: `${2.6 * escala}mm`,
            letterSpacing: ".3mm",
            fontWeight: 500,
          }}
        >
          {formatearCodigo(item.codigo ?? "")}
        </div>
      </div>

      {!chica && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "2.2mm", color: "#666" }}>
          <span>WiiGo</span>
          <span>{item.sku ?? ""}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function agruparPorMarca(items: ItemCodigo[]): [string, ItemCodigo[]][] {
  const mapa = new Map<string, ItemCodigo[]>();
  for (const i of items) {
    const k = i.marca ?? SIN_MARCA;
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k)!.push(i);
  }
  return [...mapa.entries()].sort((a, b) => {
    // Las marcas inactivas al final: no van a la góndola.
    if (a[0] === SIN_MARCA) return 1;
    if (b[0] === SIN_MARCA) return -1;
    return b[1].length - a[1].length;
  });
}
