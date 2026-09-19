"use client";

import { useState } from "react";
import { importarFotosDeProducto, type ResultadoFoto } from "@/app/(app)/productos/fotos/actions";

// Importar fotos de producto desde URLs.
//
// Va de a un producto por vez y a propósito: bajar y convertir 200 imágenes
// tarda varios minutos. Si fuera una sola llamada, un corte de conexión o un
// timeout dejaría el trabajo por la mitad sin saber dónde. Así se ve el
// avance, se puede cerrar y volver, y reintentar solo lo que falló.

type Fila = { nombre: string; urls: string[] };

const EJEMPLO = `WHEY PROTEIN 2lbs DOY PACK - STAR NUTRITION|https://…/foto1.webp|https://…/foto2.webp
COLLAGEN WHEY PROTEIN 2 LB - STAR NUTRITION|https://…/foto1.webp`;

export default function ImportarFotosApp() {
  const [texto, setTexto] = useState("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [resultados, setResultados] = useState<ResultadoFoto[]>([]);
  const [corriendo, setCorriendo] = useState(false);
  const [indice, setIndice] = useState(0);

  function parsear() {
    const parsed = texto
      .trim()
      .split(/\r?\n/)
      .map((l) => {
        const partes = l.split("|").map((p) => p.trim());
        const nombre = partes[0];
        const urls = partes.slice(1).filter((u) => u.startsWith("http"));
        return nombre && urls.length ? { nombre, urls } : null;
      })
      .filter((f): f is Fila => f !== null);
    setFilas(parsed);
    setResultados([]);
    setIndice(0);
  }

  async function importar() {
    setCorriendo(true);
    setResultados([]);
    // En serie y no en paralelo: son 200 descargas contra el servidor de otro
    // y cada una pasa por sharp. Todas juntas sería una ráfaga que el otro
    // lado puede cortar, y además satura la memoria del servidor.
    for (let i = 0; i < filas.length; i++) {
      setIndice(i + 1);
      const r = await importarFotosDeProducto(filas[i].nombre, filas[i].urls);
      setResultados((prev) => [...prev, r]);
    }
    setCorriendo(false);
  }

  async function reintentarFallidos() {
    const fallidos = resultados.filter((r) => !r.ok).map((r) => r.producto);
    const aRehacer = filas.filter((f) => fallidos.includes(f.nombre));
    if (aRehacer.length === 0) return;
    setCorriendo(true);
    for (let i = 0; i < aRehacer.length; i++) {
      setIndice(i + 1);
      const r = await importarFotosDeProducto(aRehacer[i].nombre, aRehacer[i].urls);
      setResultados((prev) => [...prev.filter((x) => x.producto !== r.producto), r]);
    }
    setCorriendo(false);
  }

  const ok = resultados.filter((r) => r.ok).length;
  const fallaron = resultados.filter((r) => !r.ok).length;
  const totalFotos = resultados.reduce((a, r) => a + r.fotos, 0);
  const pesos = resultados.flatMap((r) => r.pesos);
  const pesoProm = pesos.length ? Math.round(pesos.reduce((a, p) => a + p, 0) / pesos.length) : 0;
  const pesoMax = pesos.length ? Math.max(...pesos) : 0;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Importar fotos</h1>
      <p className="text-sm text-neutral-500 mb-5 max-w-2xl">
        Pegá una lista de productos con las URLs de sus fotos. Se bajan, se recortan a{" "}
        <b className="text-neutral-700">1000 × 1000</b> con fondo blanco y se guardan en WebP bajo{" "}
        <b className="text-neutral-700">150 KB</b> — el mismo formato para todas las marcas, así el tótem no se
        pone lento.
      </p>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 mb-4">
        <label className="block text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
          Una línea por producto — nombre y hasta 3 URLs, separados por |
        </label>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={8}
          placeholder={EJEMPLO}
          className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="text-[11px] text-neutral-400 mt-1.5">
          El nombre tiene que coincidir <b>exacto</b> con el del producto en el catálogo.
        </p>

        <div className="flex gap-2 mt-3 flex-wrap">
          <button
            onClick={parsear}
            disabled={corriendo || !texto.trim()}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Revisar la lista
          </button>
          {filas.length > 0 && (
            <button
              onClick={importar}
              disabled={corriendo}
              className="rounded-lg bg-accent hover:bg-accent-dark px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {corriendo
                ? `Importando ${indice} de ${filas.length}…`
                : `Importar ${filas.length} ${filas.length === 1 ? "producto" : "productos"}`}
            </button>
          )}
        </div>
      </div>

      {filas.length > 0 && resultados.length === 0 && !corriendo && (
        <div className="rounded-xl border border-accent/30 bg-accent-tint px-4 py-3 mb-4 text-sm text-accent">
          <b>
            {filas.length} {filas.length === 1 ? "producto" : "productos"} ·{" "}
            {filas.reduce((a, f) => a + Math.min(f.urls.length, 3), 0)} fotos.
          </b>{" "}
          Va de a uno y tarda unos segundos cada uno — no cierres la pestaña.
        </div>
      )}

      {resultados.length > 0 && (
        <>
          <div className="grid sm:grid-cols-3 gap-2.5 mb-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-emerald-700">Listos</p>
              <p className="text-2xl font-extrabold text-emerald-700 tabular-nums">{ok}</p>
              <p className="text-xs text-emerald-700/70">{totalFotos} fotos subidas</p>
            </div>
            <div
              className={`rounded-xl border px-4 py-3 ${
                fallaron > 0 ? "border-red-200 bg-red-50" : "border-neutral-200 bg-neutral-50"
              }`}
            >
              <p
                className={`text-[10.5px] font-bold uppercase tracking-wide ${
                  fallaron > 0 ? "text-red-700" : "text-neutral-500"
                }`}
              >
                Fallaron
              </p>
              <p className={`text-2xl font-extrabold tabular-nums ${fallaron > 0 ? "text-red-700" : "text-neutral-400"}`}>
                {fallaron}
              </p>
              {fallaron > 0 && !corriendo && (
                <button onClick={reintentarFallidos} className="text-xs font-semibold text-red-700 underline">
                  Reintentar solo esos
                </button>
              )}
            </div>
            {/* El peso es el control de calidad: si el promedio se dispara,
                el tótem lo va a sufrir. */}
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-neutral-500">Peso por foto</p>
              <p className="text-2xl font-extrabold text-neutral-900 tabular-nums">{pesoProm} KB</p>
              <p className="text-xs text-neutral-400">la más pesada, {pesoMax} KB</p>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            {resultados.map((r) => (
              <div
                key={r.producto}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-100 last:border-0 flex-wrap"
              >
                <span className={r.ok ? "text-emerald-600" : "text-red-600"}>{r.ok ? "✓" : "✕"}</span>
                <span className="flex-1 min-w-[200px] text-[13px] text-neutral-800">{r.producto}</span>
                {r.error && <span className="text-[11px] text-red-600">{r.error}</span>}
                <span className="text-[11px] text-neutral-400 tabular-nums whitespace-nowrap">
                  {r.fotos > 0 ? `${r.fotos} ${r.fotos === 1 ? "foto" : "fotos"} · ${r.pesos.join(" / ")} KB` : "—"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 mt-4 text-[13px] text-neutral-600">
        <p className="font-semibold text-neutral-800 mb-1">Lo que les pedís a las marcas</p>
        <p>
          Fotos cuadradas, mínimo 1000 × 1000 px, fondo blanco, producto centrado. JPG o PNG en la mejor calidad
          que tengan — hasta 3 por producto: frente, dorso con la tabla nutricional, y una de uso.
        </p>
        <p className="mt-1.5 text-neutral-500">
          Que las manden grandes y sin comprimir: la conversión la hace esta pantalla. Pedirles WebP no funciona,
          mandan lo que sale del celular.
        </p>
      </div>
    </div>
  );
}
