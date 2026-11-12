"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PedidoSugerido, PedidoEsperando } from "@/lib/pedidoProveedor";
import { armarPedidoProveedor } from "@/app/(app)/compras/pedir/actions";

// Armar el pedido al proveedor (Alifrut), del lado del equipo del local.
// Vista previa aprobada por Gonzalo el 2026-11-12: paso 1 de 3. El sistema ya
// trae lo que llegó al mínimo; acá se saca o se cambia algo y se manda.

const kg = (gramos: number) => `${(gramos / 1000).toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg`;
const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

function Paso({ valor, texto, onMenos, onMas }: { valor: string; texto?: string; onMenos: () => void; onMas: () => void }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" onClick={onMenos} aria-label="Menos" className="w-8 h-8 rounded-lg border border-neutral-300 bg-white text-lg leading-none">
        −
      </button>
      <span className="min-w-[56px] text-center font-semibold tabular-nums leading-tight">
        {valor}
        {texto && <span className="block text-[10.5px] font-normal text-neutral-500">{texto}</span>}
      </span>
      <button type="button" onClick={onMas} aria-label="Más" className="w-8 h-8 rounded-lg border border-neutral-300 bg-white text-lg leading-none">
        +
      </button>
    </div>
  );
}

export default function PedidoProveedorApp({
  proveedor,
  idLocal,
  sugerido,
  esperando,
  puedeCargar,
}: {
  proveedor: { id: string; nombre: string };
  idLocal: string;
  sugerido: PedidoSugerido;
  esperando: PedidoEsperando[];
  /** Quien maneja Compras: al guardar, sigue directo a cargarlo en el proveedor. */
  puedeCargar: boolean;
}) {
  const router = useRouter();
  const [enviando, startEnvio] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const aPedir = useMemo(() => sugerido.granel.filter((g) => g.pedirG > 0), [sugerido]);
  const aFraccionar = useMemo(
    () => sugerido.granel.flatMap((g) => g.bolsitas.filter((b) => b.delDeposito > 0).map((b) => ({ ...b, deposito: g.enDepositoG }))),
    [sugerido]
  );
  const depositoVacio = sugerido.granel.every((g) => g.enDepositoG <= 0);

  const [fuera, setFuera] = useState<Set<string>>(new Set());
  const [cant, setCant] = useState<Record<string, number>>(() => ({
    ...Object.fromEntries(aPedir.map((g) => [g.idVarianteGranel, g.pedirG])),
    ...Object.fromEntries(sugerido.envasados.map((e) => [e.idVariante, e.pedir])),
  }));
  const alternar = (id: string) =>
    setFuera((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  const cambiar = (id: string, delta: number, minimo: number) => setCant((prev) => ({ ...prev, [id]: Math.max(minimo, (prev[id] ?? 0) + delta) }));

  const granelIncluido = aPedir.filter((g) => !fuera.has(g.idVarianteGranel));
  const envIncluido = sugerido.envasados.filter((e) => !fuera.has(e.idVariante));
  const totalKg = granelIncluido.reduce((a, g) => a + (cant[g.idVarianteGranel] ?? 0), 0);
  const totalUnidades = envIncluido.reduce((a, e) => a + (cant[e.idVariante] ?? 0), 0);
  const productos = granelIncluido.length + envIncluido.length;

  function mandar() {
    setError(null);
    const lineas = [
      ...granelIncluido.map((g) => ({ idVariante: g.idVarianteGranel, cantidad: cant[g.idVarianteGranel] ?? 0 })),
      ...envIncluido.map((e) => ({ idVariante: e.idVariante, cantidad: cant[e.idVariante] ?? 0 })),
    ];
    startEnvio(async () => {
      const r = await armarPedidoProveedor(proveedor.id, idLocal, lineas);
      if (r.error) return setError(r.error);
      if (puedeCargar && r.idOrden) router.push(`/compras/pedir/${r.idOrden}`);
      else setListo(true);
    });
  }

  if (listo) {
    return (
      <div className="max-w-md mx-auto text-center py-14">
        <p className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-700 grid place-items-center text-2xl font-bold mx-auto mb-3">✓</p>
        <h1 className="text-lg font-semibold text-neutral-900">Se lo mandaste a Gonzalo</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Le llega un aviso. Cuando lo cargue en {proveedor.nombre}, el pedido aparece en Recepción esperando que llegue.
        </p>
      </div>
    );
  }

  const nada = aPedir.length === 0 && sugerido.envasados.length === 0 && aFraccionar.length === 0;

  return (
    <div className="max-w-2xl mx-auto pb-28">
      <h1 className="text-xl font-semibold text-neutral-900">Pedido a {proveedor.nombre}</h1>
      <p className="text-sm text-neutral-500 mt-0.5 mb-4">
        Lo que llegó al mínimo, para llenarlo hasta el máximo. Sacá lo que no quieras pedir o cambiá la cantidad.
      </p>

      {esperando.length > 0 && (
        <div className="mb-4 rounded-xl bg-sky-50 text-sky-900 px-4 py-3 text-sm">
          <b>Ya hay {esperando.length === 1 ? "un pedido" : `${esperando.length} pedidos`} esperando que se cargue en {proveedor.nombre}</b>{" "}
          ({esperando.map((p) => `${p.quien}, ${cuando(p.fecha)}`).join(" · ")}). Lo que está ahí no vuelve a aparecer acá.
          {puedeCargar && (
            <span className="block mt-1">
              {esperando.map((p) => (
                <Link key={p.idOrden} href={`/compras/pedir/${p.idOrden}`} className="mr-3 font-semibold text-accent hover:underline">
                  Cargar el de {p.quien} →
                </Link>
              ))}
            </span>
          )}
        </div>
      )}

      {depositoVacio && aPedir.length > 0 && (
        <div className="mb-4 rounded-xl bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          Para el sistema no hay granel en el depósito. Si hay bolsas guardadas, cargalas primero en{" "}
          <Link href="/fraccionar" className="font-semibold underline">
            Fraccionar → Cargar lo que ya está en el depósito
          </Link>
          : si no, este pedido te pide kilos que ya tenés.
        </div>
      )}

      {nada && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center">
          <p className="text-2xl mb-1" aria-hidden="true">
            ✓
          </p>
          <p className="font-semibold text-neutral-900">No hace falta pedir nada</p>
          <p className="text-sm text-neutral-500 mt-1">Ningún producto llegó a su mínimo.</p>
        </div>
      )}

      {aFraccionar.length > 0 && (
        <section className="mb-5">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-neutral-500">Fraccionar primero</h2>
            <Link href="/fraccionar" className="text-sm font-semibold text-accent hover:underline">
              Ir a Fraccionar →
            </Link>
          </div>
          <p className="text-xs text-neutral-500 mb-2">Hay granel en el depósito para estas: no se piden, se embolsan.</p>
          <ul className="flex flex-col gap-2">
            {aFraccionar.map((b) => (
              <li key={b.idVariante} className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-neutral-900">{b.nombre}</span>
                  <span className="block text-xs text-neutral-500">
                    Quedan {b.hay} de {b.maximo} · en el depósito hay {kg(b.deposito)}
                  </span>
                </span>
                <span className="text-right font-semibold tabular-nums shrink-0">
                  {b.delDeposito}
                  <span className="block text-[10.5px] font-normal text-neutral-500">bolsitas</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {aPedir.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2">
            Pedir a granel (kilos) · {granelIncluido.length}
          </h2>
          <ul className="flex flex-col gap-2">
            {aPedir.map((g) => {
              const id = g.idVarianteGranel;
              const afuera = fuera.has(id);
              const paso = g.kgBulto * 1000;
              const valor = cant[id] ?? 0;
              return (
                <li key={id} className={`rounded-xl border border-neutral-200 bg-white px-3 py-2.5 flex items-center gap-3 ${afuera ? "opacity-50" : ""}`}>
                  <input type="checkbox" checked={!afuera} onChange={() => alternar(id)} aria-label={`Pedir ${g.nombreProveedor}`} className="w-[18px] h-[18px] accent-accent shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-neutral-900">{g.nombreProveedor}</span>
                    {g.bolsitas
                      .filter((b) => b.faltan > b.delDeposito)
                      .map((b) => (
                        <span key={b.idVariante} className="block text-xs text-neutral-500">
                          {b.nombre}: quedan {b.hay} de {b.maximo}
                        </span>
                      ))}
                    <span className="flex flex-wrap gap-1 mt-1">
                      {g.bolsitas.some((b) => b.hay <= 0) && <span className="text-[10.5px] font-bold rounded px-1.5 py-0.5 bg-red-50 text-red-700">Sin stock</span>}
                      {g.unidad === "BULTO" && (
                        <span className="text-[10.5px] font-bold rounded px-1.5 py-0.5 bg-amber-50 text-amber-800">Bolsa de {g.kgBulto} kg</span>
                      )}
                      {g.noTenia && (
                        <span className="text-[10.5px] font-bold rounded px-1.5 py-0.5 bg-neutral-100 text-neutral-600">
                          {proveedor.nombre} no tenía el {cuando(g.noTenia).split(",")[0]}
                        </span>
                      )}
                    </span>
                  </span>
                  <Paso
                    valor={kg(valor)}
                    texto={g.unidad === "BULTO" ? `${valor / paso} ${valor / paso === 1 ? "bolsa" : "bolsas"}` : undefined}
                    onMenos={() => cambiar(id, -paso, paso)}
                    onMas={() => cambiar(id, paso, paso)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {sugerido.envasados.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2">Pedir envasados · {envIncluido.length}</h2>
          <ul className="flex flex-col gap-2">
            {sugerido.envasados.map((e) => {
              const id = e.idVariante;
              const afuera = fuera.has(id);
              const valor = cant[id] ?? 0;
              return (
                <li key={id} className={`rounded-xl border border-neutral-200 bg-white px-3 py-2.5 flex items-center gap-3 ${afuera ? "opacity-50" : ""}`}>
                  <input type="checkbox" checked={!afuera} onChange={() => alternar(id)} aria-label={`Pedir ${e.nombre}`} className="w-[18px] h-[18px] accent-accent shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-neutral-900">{e.nombre}</span>
                    <span className="block text-xs text-neutral-500">
                      Quedan {e.hay} · se llena hasta {e.maximo}
                      {e.enCamino > 0 && ` · vienen ${e.enCamino} en camino`}
                    </span>
                    <span className="flex flex-wrap gap-1 mt-1">
                      {e.hay <= 0 && <span className="text-[10.5px] font-bold rounded px-1.5 py-0.5 bg-red-50 text-red-700">Sin stock</span>}
                      {e.porCaja > 1 && (
                        <span className="text-[10.5px] font-bold rounded px-1.5 py-0.5 bg-amber-50 text-amber-800">
                          Caja de {e.porCaja}: queda en {e.hay + valor}
                        </span>
                      )}
                      {e.noTenia && (
                        <span className="text-[10.5px] font-bold rounded px-1.5 py-0.5 bg-neutral-100 text-neutral-600">
                          {proveedor.nombre} no tenía el {cuando(e.noTenia).split(",")[0]}
                        </span>
                      )}
                    </span>
                  </span>
                  <Paso
                    valor={e.porCaja > 1 ? String(valor / e.porCaja) : String(valor)}
                    texto={e.porCaja > 1 ? (valor / e.porCaja === 1 ? "caja" : "cajas") : "unid."}
                    onMenos={() => cambiar(id, -e.porCaja, e.porCaja)}
                    onMas={() => cambiar(id, e.porCaja, e.porCaja)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(aPedir.length > 0 || sugerido.envasados.length > 0) && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-60 bg-white border-t border-neutral-200 px-4 py-3 print:hidden">
          <div className="max-w-2xl mx-auto">
            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
            <p className="text-xs text-neutral-500 mb-2 tabular-nums">
              <b className="text-neutral-900">{productos}</b> productos · <b className="text-neutral-900">{kg(totalKg)}</b> a granel ·{" "}
              <b className="text-neutral-900">{totalUnidades}</b> envasados
            </p>
            <button
              type="button"
              onClick={mandar}
              disabled={enviando || productos === 0}
              className="w-full rounded-xl bg-accent hover:bg-accent-dark text-white py-3 text-sm font-semibold disabled:opacity-50"
            >
              {enviando ? "Guardando..." : puedeCargar ? `Guardar y cargarlo en ${proveedor.nombre}` : "Mandárselo a Gonzalo"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
