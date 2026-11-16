"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  aceptarPedidoOnline,
  cancelarPedidoOnline,
  confirmarTransferencia,
  entregarPedidoOnline,
  marcarFaltaOnline,
  marcarItemOnline,
  marcarListoOnline,
  verificarPalabraOnline,
  type ItemEquipo,
  type PedidoOnlineEquipo,
} from "@/app/(app)/pedidos-online/actions";
import { dispararAvisosDeVenta } from "@/lib/dispararAvisos";

// La pantalla del equipo para la tienda online (maqueta aprobada por Gonzalo
// el 2026-11-16, versión 6): «más simple, con no tanta letra»; las columnas
// son los pasos y cada una tiene su color —1 Nuevos naranja (llegó, atender),
// 2 Armando azul (lo están juntando), 3 Listos verde—. Las tarjetas son
// chiquitas: se tocan y se abre una ventana con todo lo de adentro.

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const corto = (nombre: string) => {
  const p = nombre.trim().split(/\s+/);
  return p[0] + (p[1] ? ` ${p[1].charAt(0)}.` : "");
};
const hayDe = (i: ItemEquipo) => (i.hay == null ? i.cantidad : i.hay);

// Los colores de cada etapa. Con estilo en línea porque se arman por paso.
const ETAPA = {
  1: { titulo: "Nuevos", fuerte: "#ea580c", suave: "#fff4ec", borde: "#fed7aa" },
  2: { titulo: "Armando", fuerte: "#2563eb", suave: "#eff5ff", borde: "#bfdbfe" },
  3: { titulo: "Listos para entregar", fuerte: "#047857", suave: "#ecfdf5", borde: "#a7f3d0" },
} as const;
const pasoDe = (p: PedidoOnlineEquipo): 1 | 2 | 3 => (p.estado === "NUEVO" ? 1 : p.estado === "ARMANDO" ? 2 : 3);

const MOTIVOS = ["Sin stock", "El cliente lo pidió", "No llegó la transferencia", "Otro motivo"];

function PagoPill({ p }: { p: PedidoOnlineEquipo }) {
  const clase = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap";
  if (p.devolver > 0 && !p.devuelto) return <span className={`${clase} bg-amber-50 text-amber-800 border border-amber-200`}>Devolver {pesos(p.devolver)}</span>;
  if (p.pago === "TRANSFERENCIA")
    return p.pagoOk ? (
      <span className={`${clase} bg-emerald-50 text-emerald-700`}>✓ Pagado</span>
    ) : (
      <span className={`${clase} bg-amber-50 text-amber-800 border border-amber-200`}>Falta la transferencia</span>
    );
  return <span className={`${clase} bg-neutral-100 text-neutral-700`}>Paga al retirar</span>;
}

type Modal = {
  tipo: "ver" | "entregar" | "cancelar";
  id: string;
  falta?: string | null;
  motivo?: string | null;
  devolvi?: boolean;
  /** Al entregar: la palabra secreta que dice el cliente y si el servidor dijo que es correcta. */
  palabra?: string;
  verificada?: boolean | null;
  intentos?: number;
} | null;

export default function PedidosOnlineApp({
  disponible,
  activos,
  cerradosHoy,
  puedeCobrar,
}: {
  disponible: boolean;
  activos: PedidoOnlineEquipo[];
  cerradosHoy: PedidoOnlineEquipo[];
  puedeCobrar: boolean;
}) {
  const router = useRouter();
  const [pedidos, setPedidos] = useState(activos);
  const [modal, setModal] = useState<Modal>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [recien, setRecien] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");

  // Lo que viene del servidor manda (después de cada acción se recarga).
  const [delServidor, setDelServidor] = useState(activos);
  if (delServidor !== activos) {
    setDelServidor(activos);
    setPedidos(activos);
  }
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 2600);
    return () => clearTimeout(t);
  }, [aviso]);

  const abierto = modal ? pedidos.find((p) => p.idPedido === modal.id) ?? null : null;
  const nuevos = pedidos.filter((p) => p.estado === "NUEVO");
  const porPaso = useMemo(() => ({ 1: pedidos.filter((p) => pasoDe(p) === 1), 2: pedidos.filter((p) => pasoDe(p) === 2), 3: pedidos.filter((p) => pasoDe(p) === 3) }), [pedidos]);

  async function hacer(accion: () => Promise<{ error: string | null }>, ok: string, despues?: () => void) {
    setOcupado(true);
    try {
      const r = await accion();
      if (r.error) setAviso(r.error);
      else {
        setAviso(ok);
        despues?.();
      }
    } finally {
      setOcupado(false);
      router.refresh();
    }
  }

  // Cambios en un producto: se ven al toque y se guardan atrás.
  function cambiarItem(idPedido: string, idItem: string, cambio: Partial<ItemEquipo>) {
    setPedidos((lista) => lista.map((p) => (p.idPedido !== idPedido ? p : { ...p, items: p.items.map((i) => (i.idItem === idItem ? { ...i, ...cambio } : i)) })));
  }
  function tildar(p: PedidoOnlineEquipo, i: ItemEquipo) {
    const armado = !i.armado;
    cambiarItem(p.idPedido, i.idItem, { armado, hay: armado ? null : i.hay });
    setModal((m) => (m ? { ...m, falta: null } : m));
    marcarItemOnline(i.idItem, armado).then((r) => r.error && setAviso(r.error));
  }
  function faltan(p: PedidoOnlineEquipo, i: ItemEquipo, hay: number | null) {
    cambiarItem(p.idPedido, i.idItem, { hay, armado: false });
    setModal((m) => (m ? { ...m, falta: null } : m));
    marcarFaltaOnline(i.idItem, hay).then((r) => (r.error ? setAviso(r.error) : hay != null && setAviso("Anotado: el total bajó. Ese producto sale en el próximo conteo para contarlo.")));
  }

  // Viene a retirar: primero el DNI, después (en la ventana) la palabra secreta.
  function buscarDni(e: React.FormEvent) {
    e.preventDefault();
    const v = codigo.replace(/\D/g, "");
    if (v.length < 6) return setAviso("Escribí el DNI, sin puntos.");
    const suyos = pedidos.filter((x) => x.dni.replace(/\D/g, "") === v);
    const listo = suyos.find((x) => x.estado === "LISTO");
    if (!listo) return setAviso(suyos.length ? `El pedido #${suyos[0].numero} todavía no está listo.` : "No hay ningún pedido abierto con ese DNI.");
    setCodigo("");
    setModal({ tipo: "entregar", id: listo.idPedido });
  }

  if (!disponible) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-1">Los pedidos online todavía no están habilitados</p>
        <p className="text-sm text-neutral-500">Falta correr sql/tienda-pedidos.sql en Supabase.</p>
      </div>
    );
  }

  const totalItems = (p: PedidoOnlineEquipo) => p.items.reduce((t, i) => t + hayDe(i), 0);

  return (
    <div className="max-w-6xl">
      {nuevos.length > 0 && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-2xl bg-red-600 px-4 py-3 text-white">
          <span aria-hidden="true">🔔</span>
          <b className="text-[17px]">{nuevos.length === 1 ? `Pedido nuevo #${nuevos[0].numero}` : `${nuevos.length} pedidos nuevos`}</b>
          <button type="button" onClick={() => setModal({ tipo: "ver", id: nuevos[0].idPedido })} className="ml-auto rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-red-700">
            Atender
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-neutral-900">Pedidos online</h1>
        <form onSubmit={buscarDni} className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white py-2 pl-3.5 pr-2">
          <label htmlFor="codigo-retiro" className="text-[13px] font-extrabold text-neutral-500">
            Retira
          </label>
          <input
            id="codigo-retiro"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="DNI"
            inputMode="numeric"
            maxLength={11}
            autoComplete="off"
            className="h-10 w-36 rounded-lg border border-neutral-200 px-3 font-mono text-[17px] font-bold tracking-wider"
          />
          <button className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-extrabold text-white">Buscar</button>
        </form>
      </div>

      {/* Las columnas son los pasos: todo pedido nuevo entra en el 1 y con su botón pasa al 2 y al 3. */}
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_22px_minmax(0,1fr)_22px_minmax(0,1fr)]">
        {([1, 2, 3] as const).map((paso) => {
          const e = ETAPA[paso];
          const lista = porPaso[paso];
          return [
            <section key={paso} className="overflow-hidden rounded-[20px] border-[1.5px]" style={{ background: e.suave, borderColor: e.borde }}>
              <h2 className="flex items-center gap-2 px-3.5 py-2.5 text-[15px] font-extrabold uppercase tracking-wide text-white" style={{ background: e.fuerte }}>
                <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[13px]" style={{ color: e.fuerte }}>
                  {paso}
                </span>
                {e.titulo}
                <span className="ml-auto rounded-full bg-white/25 px-2.5 text-[13px] leading-[22px]">{lista.length}</span>
              </h2>
              <div className="grid gap-2.5 p-2.5">
                {lista.length === 0 && (
                  <div className="rounded-2xl border-2 border-dashed bg-white/50 p-5 text-center text-sm opacity-70" style={{ borderColor: e.borde, color: e.fuerte }}>
                    Nada por acá
                  </div>
                )}
                {lista.map((p) => (
                  <button
                    key={p.idPedido}
                    type="button"
                    onClick={() => {
                      setRecien(null);
                      setModal({ tipo: "ver", id: p.idPedido });
                    }}
                    className={`grid w-full gap-1.5 rounded-2xl border bg-white px-3 py-2.5 text-left hover:shadow-sm ${p.idPedido === recien ? "animate-pulse motion-reduce:animate-none" : ""}`}
                    style={{ borderColor: p.estado === "NUEVO" ? "#fca5a5" : e.borde, boxShadow: p.estado === "NUEVO" ? "0 0 0 3px #fee2e2" : undefined }}
                  >
                    <span className="flex items-baseline gap-1.5 text-[15px]">
                      <b className="text-base">#{p.numero}</b> {corto(p.nombre)}
                      <b className="ml-auto text-base tabular-nums">{pesos(p.totalLista)}</b>
                    </span>
                    <span className="flex items-center gap-2">
                      <PagoPill p={p} />
                      <span className="ml-auto text-[12.5px] font-semibold text-neutral-500">
                        {totalItems(p)} {totalItems(p) === 1 ? "producto" : "productos"} · {hora(p.creado)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>,
            paso < 3 ? (
              <span key={`f${paso}`} aria-hidden="true" className="mt-2.5 hidden text-center text-xl font-extrabold text-stone-400 lg:block">
                →
              </span>
            ) : null,
          ];
        })}
      </div>

      <details className="mt-5 rounded-2xl border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 font-extrabold">Entregados y cancelados hoy · {cerradosHoy.length}</summary>
        {cerradosHoy.map((c) => (
          <div key={c.idPedido} className="flex flex-wrap gap-2.5 border-t border-neutral-100 px-4 py-2 text-sm">
            <b>#{c.numero}</b>
            <span>{c.nombre}</span>
            <span className="text-neutral-500">
              {c.estado === "ENTREGADO" ? `Entregado ${c.entregadoAt ? hora(c.entregadoAt) : ""}` : `Cancelado${c.motivo ? ` · ${c.motivo}` : ""}`}
              {c.devolver > 0 ? ` · devolver ${pesos(c.devolver)}` : ""}
            </span>
            <b className="ml-auto tabular-nums">{pesos(c.totalLista)}</b>
          </div>
        ))}
      </details>

      {abierto && modal?.tipo === "ver" && (
        <Ventana
          p={abierto}
          falta={modal.falta ?? null}
          ocupado={ocupado}
          onCerrar={() => setModal(null)}
          onTildar={(i) => tildar(abierto, i)}
          onFalta={(i) => (i.cantidad === 1 ? faltan(abierto, i, 0) : setModal({ ...modal, falta: modal.falta === i.idItem ? null : i.idItem }))}
          onHay={(i, n) => faltan(abierto, i, n)}
          onDeshacer={(i) => faltan(abierto, i, null)}
          onTransferencia={() => hacer(() => confirmarTransferencia(abierto.idPedido), "Transferencia confirmada. Ya lo podés aceptar.")}
          onAceptar={() =>
            hacer(() => aceptarPedidoOnline(abierto.idPedido), "Pasó al paso 2: tildá los productos a medida que los juntás", () => setRecien(abierto.idPedido))
          }
          onListo={() =>
            hacer(() => marcarListoOnline(abierto.idPedido), "Pasó al paso 3: al cliente le llega el mail con su código", () => {
              setRecien(abierto.idPedido);
              setModal(null);
            })
          }
          onEntregar={() => setModal({ tipo: "entregar", id: abierto.idPedido })}
          onCancelar={(motivo) => setModal({ tipo: "cancelar", id: abierto.idPedido, motivo: motivo ?? null })}
        />
      )}

      {abierto && modal?.tipo === "entregar" && (
        <Fondo onCerrar={() => setModal(null)}>
          <h3 className="text-[21px] font-bold">Entregar #{abierto.numero}</h3>
          {/* Como Mercado Libre (Gonzalo, 16/11): DNI y palabra secreta. La tablet no la
              conoce: la escribe el operativo y el servidor dice si es correcta. */}
          {modal.verificada ? (
            <div className="grid gap-0.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
              <b className="text-[22px] text-emerald-700">✓ Palabra correcta</b>
              <span className="text-neutral-600">{abierto.nombre} · DNI {abierto.dni}</span>
            </div>
          ) : (
            <form
              className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!modal.palabra?.trim()) return;
                setOcupado(true);
                try {
                  const r = await verificarPalabraOnline(abierto.idPedido, modal.palabra);
                  if (r.error) setAviso(r.error);
                  else setModal({ ...modal, verificada: r.ok, intentos: (modal.intentos ?? 0) + 1 });
                } finally {
                  setOcupado(false);
                }
              }}
            >
              <label htmlFor="palabra-retiro" className="text-center text-xs font-extrabold uppercase tracking-widest text-amber-800">
                Pedile la palabra secreta
              </label>
              <span className="text-center text-sm text-neutral-600">{abierto.nombre} · DNI {abierto.dni}</span>
              <div className="flex gap-2">
                <input
                  id="palabra-retiro"
                  autoFocus
                  value={modal.palabra ?? ""}
                  onChange={(e) => setModal({ ...modal, palabra: e.target.value, verificada: null })}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="h-12 min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-3 text-center text-[20px] font-bold uppercase tracking-wider"
                />
                <button disabled={ocupado || !modal.palabra?.trim()} className="rounded-xl bg-neutral-900 px-4 font-extrabold text-white disabled:opacity-45">
                  Verificar
                </button>
              </div>
              {modal.verificada === false && (
                <p role="alert" className="text-center font-bold text-red-700">
                  ✗ No es esa palabra. {(modal.intentos ?? 0) >= 3 ? "Si no la sabe, que la busque en su mail o en «Mis pedidos» de la tienda." : "Pedile que la repita."}
                </p>
              )}
            </form>
          )}
          {modal.verificada && abierto.original > abierto.totalLista && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
              Faltó algo: el total quedó en <b>{pesos(abierto.totalLista)}</b>
              {abierto.pago === "TRANSFERENCIA" ? ` (pagó ${pesos(abierto.original)})` : ""}
            </div>
          )}
          {!modal.verificada ? (
            <div className="flex justify-end">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border-[1.5px] border-neutral-200 bg-white px-4 py-2.5 font-extrabold">
                Volver
              </button>
            </div>
          ) : abierto.pago === "AL_RETIRAR" ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border border-neutral-200 p-2.5">
                  <small className="block text-xs text-neutral-500">En efectivo</small>
                  <b className="text-[19px]">{pesos(abierto.totalEfectivo)}</b>
                </div>
                <div className="rounded-xl border border-neutral-200 p-2.5">
                  <small className="block text-xs text-neutral-500">Tarjeta o QR</small>
                  <b className="text-[19px]">{pesos(abierto.totalLista)}</b>
                </div>
              </div>
              <p className="text-sm text-neutral-500">Se cobra en la caja: el pedido entra con los productos y el DNI ya puestos.</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setModal(null)} className="rounded-xl border-[1.5px] border-neutral-200 bg-white px-4 py-2.5 font-extrabold">
                  Volver
                </button>
                {puedeCobrar ? (
                  <Link href={`/pos?online=${abierto.idPedido}`} className="rounded-xl bg-neutral-900 px-4 py-2.5 font-extrabold text-white">
                    Cobrar en la caja →
                  </Link>
                ) : (
                  <span className="rounded-xl bg-neutral-100 px-4 py-2.5 text-sm font-bold text-neutral-500">Lo cobra quien tiene la caja</span>
                )}
              </div>
            </>
          ) : (
            <>
              {abierto.devolver > 0 && !abierto.devuelto ? (
                <button
                  type="button"
                  aria-pressed={!!modal.devolvi}
                  onClick={() => setModal({ ...modal, devolvi: !modal.devolvi })}
                  className={`w-full rounded-xl border-[1.5px] p-2.5 text-center font-bold ${modal.devolvi ? "border-neutral-900 shadow-[inset_0_0_0_1px_#171717]" : "border-neutral-200"}`}
                >
                  {modal.devolvi ? "✓ " : ""}Ya le devolví {pesos(abierto.devolver)} por transferencia
                </button>
              ) : (
                <span className="justify-self-start rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">✓ Pagado</span>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setModal(null)} className="rounded-xl border-[1.5px] border-neutral-200 bg-white px-4 py-2.5 font-extrabold">
                  Volver
                </button>
                <button
                  type="button"
                  disabled={ocupado || (abierto.devolver > 0 && !abierto.devuelto && !modal.devolvi)}
                  onClick={async () => {
                    setOcupado(true);
                    try {
                      const r = await entregarPedidoOnline(abierto.idPedido, !!modal.devolvi);
                      if (r.error) setAviso(r.error);
                      else {
                        if (r.idVenta) dispararAvisosDeVenta(r.idVenta);
                        setModal(null);
                        setAviso("Entregado. El cliente sumó sus puntos y le llegó el mail.");
                      }
                    } finally {
                      setOcupado(false);
                      router.refresh();
                    }
                  }}
                  className="rounded-xl bg-neutral-900 px-4 py-2.5 font-extrabold text-white disabled:opacity-45"
                >
                  {ocupado ? "Entregando…" : "Entregar"}
                </button>
              </div>
            </>
          )}
        </Fondo>
      )}

      {abierto && modal?.tipo === "cancelar" && (
        <Fondo onCerrar={() => setModal(null)}>
          <h3 className="text-[21px] font-bold">Cancelar #{abierto.numero}</h3>
          {abierto.pago === "TRANSFERENCIA" && abierto.pagoOk && (
            <span className="justify-self-start rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800">
              Ya pagó: hay que devolverle {pesos(abierto.original)}
            </span>
          )}
          {MOTIVOS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={modal.motivo === m}
              onClick={() => setModal({ ...modal, motivo: m })}
              className={`w-full rounded-xl border-[1.5px] p-2.5 font-bold ${modal.motivo === m ? "border-neutral-900 shadow-[inset_0_0_0_1px_#171717]" : "border-neutral-200"}`}
            >
              {m}
            </button>
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModal({ tipo: "ver", id: abierto.idPedido })} className="rounded-xl border-[1.5px] border-neutral-200 bg-white px-4 py-2.5 font-extrabold">
              Volver
            </button>
            <button
              type="button"
              disabled={!modal.motivo || ocupado}
              onClick={() => hacer(() => cancelarPedidoOnline(abierto.idPedido, modal.motivo ?? ""), "Pedido cancelado: al cliente le llegó el mail", () => setModal(null))}
              className="rounded-xl bg-red-700 px-4 py-2.5 font-extrabold text-white disabled:opacity-45"
            >
              Cancelar pedido
            </button>
          </div>
        </Fondo>
      )}

      {aviso && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[80] max-w-[90vw] -translate-x-1/2 rounded-xl bg-neutral-900 px-4 py-2.5 text-center font-bold text-white">
          {aviso}
        </div>
      )}
    </div>
  );
}

function Fondo({ children, onCerrar }: { children: React.ReactNode; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/45 p-4" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div role="dialog" aria-modal="true" className="grid w-full max-w-[520px] gap-3 rounded-[20px] bg-white p-5">
        {children}
      </div>
    </div>
  );
}

function Ventana({
  p,
  falta,
  ocupado,
  onCerrar,
  onTildar,
  onFalta,
  onHay,
  onDeshacer,
  onTransferencia,
  onAceptar,
  onListo,
  onEntregar,
  onCancelar,
}: {
  p: PedidoOnlineEquipo;
  falta: string | null;
  ocupado: boolean;
  onCerrar: () => void;
  onTildar: (i: ItemEquipo) => void;
  onFalta: (i: ItemEquipo) => void;
  onHay: (i: ItemEquipo, n: number) => void;
  onDeshacer: (i: ItemEquipo) => void;
  onTransferencia: () => void;
  onAceptar: () => void;
  onListo: () => void;
  onEntregar: () => void;
  onCancelar: (motivo?: string) => void;
}) {
  const paso = pasoDe(p);
  const e = ETAPA[paso];
  const marcable = p.estado === "ARMANDO";
  const total = p.items.reduce((t, i) => t + hayDe(i) * i.precioLista, 0);
  const efectivo = p.items.reduce((t, i) => t + hayDe(i) * i.precioEfectivo, 0);
  const original = p.items.reduce((t, i) => t + i.cantidad * i.precioLista, 0);
  const dif = original - total;
  const nada = p.items.every((i) => i.hay === 0);
  const faltanTildar = p.items.filter((i) => !i.armado && i.hay == null).length;
  const devolver = p.pago === "TRANSFERENCIA" && p.pagoOk ? dif : 0;

  let accion: React.ReactNode = null;
  const grande = "w-full rounded-xl px-4 py-3.5 text-base font-extrabold disabled:opacity-45";
  if (p.estado === "NUEVO")
    accion =
      p.pago === "TRANSFERENCIA" && !p.pagoOk ? (
        <button type="button" disabled={ocupado} onClick={onTransferencia} className={`${grande} bg-amber-500 text-[#2a1406]`}>
          Llegó la transferencia
        </button>
      ) : (
        <button type="button" disabled={ocupado} onClick={onAceptar} className={`${grande} bg-orange-600 text-white`}>
          Aceptar
        </button>
      );
  if (marcable)
    accion = nada ? (
      <button type="button" onClick={() => onCancelar("Sin stock")} className={`${grande} bg-red-700 text-white`}>
        No hay nada: cancelar pedido
      </button>
    ) : (
      <button type="button" disabled={ocupado || faltanTildar > 0} onClick={onListo} className={`${grande} bg-emerald-700 text-white`}>
        {faltanTildar > 0 ? "Tildá los productos" : "Listo"}
      </button>
    );
  if (p.estado === "LISTO")
    accion = (
      <button type="button" onClick={onEntregar} className={`${grande} bg-neutral-900 text-white`}>
        Entregar (DNI y palabra secreta)
      </button>
    );

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/45 p-4" onClick={(ev) => ev.target === ev.currentTarget && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label={`Pedido #${p.numero}`} className="max-h-[88vh] w-full max-w-[560px] overflow-auto rounded-[20px] bg-white pb-3">
        <div className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-extrabold uppercase tracking-wider text-white" style={{ background: e.fuerte }}>
          <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-white text-xs" style={{ color: e.fuerte }}>
            {paso}
          </span>
          {e.titulo}
        </div>
        <div className="flex items-center gap-2 px-4 pb-1 pt-3">
          <span className="text-base">
            <b className="text-[19px]">#{p.numero}</b> {p.nombre}
          </span>
          <b className="ml-auto text-[19px] tabular-nums">{pesos(total)}</b>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="grid h-8 w-8 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-red-700">
            ✕
          </button>
        </div>
        <div className="flex items-center gap-2 px-4 pb-2">
          <PagoPill p={{ ...p, devolver: p.estado === "LISTO" ? p.devolver : devolver }} />
          {p.pago === "AL_RETIRAR" && <span className="text-[12.5px] font-semibold text-neutral-500">efectivo {pesos(efectivo)}</span>}
          <span className="ml-auto text-[12.5px] font-bold text-neutral-400">{hora(p.creado)}</span>
        </div>

        <div className="grid gap-0.5 border-t border-neutral-100 px-4 py-1.5">
          {p.items.map((i) => {
            const falto = i.hay != null;
            const cant = !falto ? `${i.cantidad}×` : i.hay === 0 ? `${i.cantidad}×` : `${i.hay} de ${i.cantidad}`;
            const nombre = `${i.nombre}${i.variante ? ` — ${i.variante}` : ""}`;
            const texto = (
              <span className="block">
                <b className={falto ? "text-amber-800" : ""}>{cant}</b> {falto && i.hay === 0 ? <s className="text-neutral-400">{nombre}</s> : nombre}
                {falto && (
                  <span className="ml-1.5 inline-block rounded-full bg-amber-50 px-2 align-[1px] text-[11.5px] font-extrabold text-amber-800">
                    {i.hay === 0 ? "No había" : `Faltó ${i.cantidad - (i.hay ?? 0)}`}
                  </span>
                )}
                {i.ubicacion && <span className="mt-px block text-xs font-bold text-orange-600">{i.ubicacion}</span>}
              </span>
            );
            if (!marcable)
              return (
                <div key={i.idItem} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 py-1.5 text-[15px]">
                  <span />
                  {texto}
                </div>
              );
            return (
              <div key={i.idItem}>
                <div className="flex items-start gap-1.5">
                  <button
                    type="button"
                    onClick={() => (falto ? onDeshacer(i) : onTildar(i))}
                    className={`grid flex-1 grid-cols-[22px_minmax(0,1fr)] items-start gap-2 py-1.5 text-left text-[15px] ${i.armado && !falto ? "text-neutral-400 line-through" : ""}`}
                  >
                    <span
                      className={`mt-px grid h-5 w-5 place-items-center rounded-md border-2 text-[13px] font-extrabold ${
                        falto ? "border-amber-200 bg-amber-50 text-amber-800" : i.armado ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-300"
                      }`}
                    >
                      {falto ? "!" : i.armado ? "✓" : ""}
                    </span>
                    {texto}
                  </button>
                  {(falto || !i.armado) && (
                    <button
                      type="button"
                      onClick={() => (falto ? onDeshacer(i) : onFalta(i))}
                      className="mt-1 shrink-0 rounded-full border-[1.5px] border-neutral-200 bg-white px-3 py-1 text-[12.5px] font-bold text-neutral-500 hover:border-amber-200 hover:text-amber-800"
                    >
                      {falto ? "Deshacer" : "Falta"}
                    </button>
                  )}
                </div>
                {falta === i.idItem && (
                  <div className="mb-1.5 ml-[30px] flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[13px] font-bold text-amber-800">
                    <span className="w-full">¿Cuántos encontraste?</span>
                    {Array.from({ length: i.cantidad }, (_, k) => (
                      <button key={k} type="button" onClick={() => onHay(i, k)} className="rounded-xl border-[1.5px] border-neutral-200 bg-white px-3.5 py-1.5 text-[15px] font-extrabold text-neutral-900">
                        {k === 0 ? "Ninguno" : k}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {dif > 0 && !nada && (
          <div className="mx-4 mt-1 grid gap-0.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
            <div>
              Total nuevo <b>{pesos(total)}</b> <s className="ml-1 text-neutral-400">{pesos(original)}</s>
            </div>
            {devolver > 0 ? (
              p.devuelto ? (
                <div className="font-bold text-emerald-700">✓ Ya se le devolvieron {pesos(devolver)}</div>
              ) : (
                <div>
                  Ya pagó: hay que <b>devolverle {pesos(devolver)}</b> por transferencia
                </div>
              )
            ) : (
              <div>Al retirar se le cobra el total nuevo</div>
            )}
            <small className="text-xs text-neutral-500">Al cliente le llega un mail con lo que faltó{devolver > 0 ? " y la devolución" : " y el total nuevo"}.</small>
          </div>
        )}

        <div className="mt-2 border-t border-neutral-100 px-3 pt-2.5">{accion}</div>
        {!(nada && marcable) && (
          <button type="button" onClick={() => onCancelar()} className="mx-auto mt-1.5 block p-1 text-[13px] text-neutral-500 underline">
            Cancelar pedido
          </button>
        )}
      </div>
    </div>
  );
}
