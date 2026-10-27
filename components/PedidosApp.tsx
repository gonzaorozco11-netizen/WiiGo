"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { marcarItemArmado, marcarListo, avisarFalta, cerrarPedido, type PedidoEquipo } from "@/app/(app)/pedidos/actions";
import { DIAS_GUARDADO, linkWhatsApp, mensajePedidoListo } from "@/lib/pedidosProfesional";

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const cuando = (iso: string) => new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Los pedidos que arman las profesionales para sus pacientes. Tres pasos:
// Nuevo (se arma tildando cada producto) → Listo para retirar (se le avisa al
// paciente por WhatsApp) → Entregado (se cierra solo al cobrarlo en la caja).
export default function PedidosApp({
  disponible,
  activos,
  cerrados,
  puedeCobrar,
}: {
  disponible: boolean;
  activos: PedidoEquipo[];
  cerrados: PedidoEquipo[];
  puedeCobrar: boolean;
}) {
  const router = useRouter();

  // Se actualiza sola cada minuto: si llega un pedido mientras está abierta,
  // aparece sin tener que tocar nada.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60000);
    return () => clearInterval(t);
  }, [router]);

  if (!disponible) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-extrabold text-neutral-900 mb-2">Pedidos</h1>
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          Para usar Pedidos falta correr <b>sql/profesionales-pedidos.sql</b> en Supabase.
        </p>
      </div>
    );
  }

  const nuevos = activos.filter((p) => p.estado === "NUEVO");
  const listos = activos.filter((p) => p.estado === "LISTO");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900">Pedidos</h1>
        <p className="text-sm text-neutral-500">Los arman las profesionales para sus pacientes. Vos los preparás, le avisás al paciente y lo cobrás cuando viene.</p>
      </div>

      <Columna titulo="Para armar" vacio="No hay pedidos nuevos." cantidad={nuevos.length} rojo>
        {nuevos.map((p) => (
          <TarjetaPedido key={p.idPedido} pedido={p} puedeCobrar={puedeCobrar} />
        ))}
      </Columna>

      <Columna titulo="Listos, esperando al paciente" vacio="Ninguno esperando." cantidad={listos.length}>
        {listos.map((p) => (
          <TarjetaPedido key={p.idPedido} pedido={p} puedeCobrar={puedeCobrar} />
        ))}
      </Columna>

      {cerrados.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-neutral-500 uppercase tracking-wide mb-2">Últimos cerrados</h2>
          <ul className="bg-white border border-neutral-200 rounded-2xl divide-y divide-neutral-100">
            {cerrados.map((p) => (
              <li key={p.idPedido} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="font-mono text-neutral-400">N.º {p.numero}</span>
                <span className="font-semibold text-neutral-800">
                  {p.paraProfesional ? p.profesional.nombre : `${p.paciente.nombre} ${p.paciente.apellido}`}
                </span>
                <span className="text-neutral-500">{p.paraProfesional ? "para ella, con su saldo" : `de ${p.profesional.nombre}`}</span>
                <span
                  className={`ml-auto text-xs font-bold rounded-full px-2 py-0.5 ${
                    p.estado === "ENTREGADO" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  {p.estado === "ENTREGADO" ? "Entregado y pagado" : p.estado === "DEVUELTO" ? "No lo retiró" : "Cancelado"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Columna({ titulo, vacio, cantidad, rojo = false, children }: { titulo: string; vacio: string; cantidad: number; rojo?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-500 uppercase tracking-wide mb-2">
        {titulo}
        {cantidad > 0 && (
          <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${rojo ? "bg-red-600 text-white" : "bg-neutral-200 text-neutral-700"}`}>{cantidad}</span>
        )}
      </h2>
      {cantidad === 0 ? <p className="text-sm text-neutral-400">{vacio}</p> : <div className="flex flex-col gap-3">{children}</div>}
    </section>
  );
}

function TarjetaPedido({ pedido, puedeCobrar }: { pedido: PedidoEquipo; puedeCobrar: boolean }) {
  const router = useRouter();
  const [armados, setArmados] = useState<Set<string>>(() => new Set(pedido.items.filter((i) => i.armado).map((i) => i.idItem)));
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escribiendoFalta, setEscribiendoFalta] = useState(false);
  const [falta, setFalta] = useState("");

  const esNuevo = pedido.estado === "NUEVO";
  const todoArmado = pedido.items.every((i) => armados.has(i.idItem));
  const nombrePaciente = `${pedido.paciente.nombre} ${pedido.paciente.apellido}`;

  function tildar(idItem: string, valor: boolean) {
    const n = new Set(armados);
    if (valor) n.add(idItem);
    else n.delete(idItem);
    setArmados(n);
    marcarItemArmado(idItem, valor).then((r) => r.error && setError(r.error));
  }

  function mensaje(guardarHasta: string) {
    return mensajePedidoListo({
      paciente: pedido.paciente.nombre,
      profesional: pedido.profesional.nombre,
      direccion: pedido.direccion,
      guardarHasta: new Date(guardarHasta),
      totalEfectivo: pedido.totalEfectivo,
      totalLista: pedido.totalLista,
      creado: pedido.creado,
      paraProfesional: pedido.paraProfesional,
    });
  }

  function listo() {
    setError(null);
    setTrabajando(true);
    // La ventana se abre antes de esperar al servidor: si se abre después, el
    // navegador la toma como ventana emergente y la bloquea.
    const ventana = pedido.paciente.telefono ? window.open("", "_blank") : null;
    marcarListo(pedido.idPedido)
      .then((r) => {
        if (r.error || !r.guardarHasta) {
          ventana?.close();
          return setError(r.error ?? "No se pudo marcar.");
        }
        if (ventana) ventana.location.href = linkWhatsApp(pedido.paciente.telefono, mensaje(r.guardarHasta));
        router.refresh();
      })
      .finally(() => setTrabajando(false));
  }

  function mandarFalta() {
    setError(null);
    setTrabajando(true);
    avisarFalta(pedido.idPedido, falta)
      .then((r) => {
        if (r.error) return setError(r.error);
        setEscribiendoFalta(false);
        setFalta("");
        router.refresh();
      })
      .finally(() => setTrabajando(false));
  }

  function cerrar(estado: "CANCELADO" | "DEVUELTO") {
    const pregunta = estado === "DEVUELTO" ? `¿${pedido.paciente.nombre} no lo vino a buscar? Devolvé los productos a la góndola.` : "¿Cancelar este pedido?";
    if (!confirm(pregunta)) return;
    setTrabajando(true);
    cerrarPedido(pedido.idPedido, estado)
      .then((r) => (r.error ? setError(r.error) : router.refresh()))
      .finally(() => setTrabajando(false));
  }

  return (
    <article className={`bg-white border rounded-2xl overflow-hidden ${pedido.vencido ? "border-red-300" : "border-neutral-200"}`}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-100">
        {pedido.profesional.foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pedido.profesional.foto} alt="" className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <span className="w-10 h-10 rounded-full bg-neutral-100" />
        )}
        <div className="min-w-0 flex-1">
          {pedido.paraProfesional ? (
            <p className="text-[15px] font-bold text-neutral-900">
              Pedido de {pedido.profesional.nombre} para ella
              <span className="ml-2 align-[2px] text-[11px] font-extrabold tracking-wide text-orange-900 bg-orange-100 rounded-full px-2 py-0.5">
                PAGA CON SU SALDO
              </span>
            </p>
          ) : (
            <p className="text-[15px] font-bold text-neutral-900">
              Pedido de {pedido.profesional.nombre} para {nombrePaciente}
            </p>
          )}
          <p className="text-xs text-neutral-500">
            N.º {pedido.numero} · DNI {pedido.paciente.dni} · {pedido.items.length} {pedido.items.length === 1 ? "producto" : "productos"} · llegó {cuando(pedido.creado)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums">{pesos(pedido.totalLista)}</p>
          {pedido.totalEfectivo !== pedido.totalLista && <p className="text-xs text-neutral-500 tabular-nums">efectivo {pesos(pedido.totalEfectivo)}</p>}
        </div>
      </div>

      {pedido.paraProfesional && (
        <p className="px-4 py-2 text-sm text-amber-900 bg-amber-50 border-b border-amber-100">
          Al cobrarlo, la caja ya trae su DNI y su saldo marcado: ella pone su PIN y paga lo que falte. Cuando se cobra, pasa solo a Entregado y pagado.
        </p>
      )}
      {pedido.notaFalta && esNuevo && (
        <p className="px-4 py-2 text-sm text-amber-800 bg-amber-50 border-b border-amber-100">Le avisaste a la profesional que falta: {pedido.notaFalta}</p>
      )}
      {pedido.vencido && (
        <p className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">
          Ya pasaron los {DIAS_GUARDADO} días y no lo vino a buscar. Devolvé los productos a la góndola.
        </p>
      )}

      <ul className="px-4 py-1.5 divide-y divide-neutral-100">
        {pedido.items.map((i) => (
          <li key={i.idItem}>
            <label className={`flex items-center gap-3 py-2 text-sm ${esNuevo ? "cursor-pointer" : ""}`}>
              {esNuevo ? (
                <input type="checkbox" checked={armados.has(i.idItem)} onChange={(e) => tildar(i.idItem, e.target.checked)} className="w-5 h-5 accent-emerald-600" />
              ) : (
                <span className="w-5 text-emerald-600 font-bold">✓</span>
              )}
              <span className={`flex-1 ${esNuevo && armados.has(i.idItem) ? "line-through text-neutral-400" : "text-neutral-800"}`}>{i.nombre}</span>
              <span className="font-mono text-sm font-bold">×{i.cantidad}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-neutral-100 bg-neutral-50">
        {esNuevo ? (
          <>
            <button
              type="button"
              onClick={listo}
              disabled={!todoArmado || trabajando}
              className="bg-accent text-white text-sm font-bold rounded-lg px-4 py-2 disabled:opacity-40"
              title={todoArmado ? "" : "Tildá cada producto a medida que lo ponés en la bolsa"}
            >
              Listo para retirar{pedido.paciente.telefono ? " y avisarle" : ""}
            </button>
            {!escribiendoFalta ? (
              <button type="button" onClick={() => setEscribiendoFalta(true)} className="text-sm font-semibold border border-neutral-300 rounded-lg px-3 py-2 bg-white">
                Falta algo
              </button>
            ) : (
              <div className="flex flex-wrap gap-2 items-center w-full">
                <input
                  value={falta}
                  onChange={(e) => setFalta(e.target.value)}
                  placeholder="Ej: no hay creatina de 150 g, solo de 300 g"
                  className="flex-1 min-w-[220px] border border-neutral-300 rounded-lg px-3 py-1.5 text-sm bg-white"
                />
                <button type="button" onClick={mandarFalta} disabled={trabajando} className="text-sm font-bold bg-neutral-800 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">
                  Avisarle a la profesional
                </button>
                <button type="button" onClick={() => setEscribiendoFalta(false)} className="text-sm text-neutral-500">
                  Cancelar
                </button>
              </div>
            )}
            {!todoArmado && <span className="text-xs text-neutral-500">Tildá cada producto a medida que lo ponés en la bolsa.</span>}
            <button type="button" onClick={() => cerrar("CANCELADO")} className="ml-auto text-xs text-neutral-400 hover:text-neutral-700">
              Cancelar pedido
            </button>
          </>
        ) : (
          <>
            {pedido.paciente.telefono && pedido.guardarHasta && (
              <a
                href={linkWhatsApp(pedido.paciente.telefono, mensaje(pedido.guardarHasta))}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#25a35a] text-white text-sm font-bold rounded-lg px-3 py-2"
              >
                Avisarle de nuevo por WhatsApp
              </a>
            )}
            {puedeCobrar && (
              <Link href={`/pos?pedido=${pedido.idPedido}`} className="bg-accent text-white text-sm font-bold rounded-lg px-4 py-2">
                Cobrar
              </Link>
            )}
            <span className="text-xs text-neutral-500">
              {pedido.guardarHasta && !pedido.vencido && `Se guarda hasta el ${cuando(pedido.guardarHasta)}. `}
              {pedido.preciosVigentes ? "Todavía vale el precio del pedido." : "Ya pasaron 24 h: se cobra el precio del día."}
            </span>
            <button type="button" onClick={() => cerrar("DEVUELTO")} className="ml-auto text-xs text-neutral-400 hover:text-neutral-700">
              No lo vino a buscar
            </button>
          </>
        )}
        {error && <span className="w-full text-sm text-red-600">{error}</span>}
      </div>
    </article>
  );
}
