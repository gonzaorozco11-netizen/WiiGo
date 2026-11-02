"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ETIQUETA_ESTADO, type EstadoPedido } from "@/lib/pedidosProfesional";

export type PedidoConItems = {
  idPedido: string;
  numero: number;
  paciente: string;
  clavePaciente: string;
  estado: EstadoPedido;
  creado: string;
  notaFalta: string | null;
  items: { nombre: string; cantidad: number; precio: number }[];
  total: number;
};

type Filtro = "todos" | "curso" | "entregados" | "otros";

const FILTROS: { clave: Filtro; label: string; estados: EstadoPedido[] | null }[] = [
  { clave: "todos", label: "Todos", estados: null },
  { clave: "curso", label: "En curso", estados: ["NUEVO", "LISTO"] },
  { clave: "entregados", label: "Entregados", estados: ["ENTREGADO"] },
  { clave: "otros", label: "Cancelados o no retirados", estados: ["CANCELADO", "DEVUELTO"] },
];

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function MisPedidos({ pedidos, disponible }: { pedidos: PedidoConItems[]; disponible: boolean }) {
  const [vista, setVista] = useState<"pedido" | "paciente">("pedido");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const estados = FILTROS.find((f) => f.clave === filtro)?.estados;
    const q = sinTildes(busca.trim());
    return pedidos.filter((p) => (!estados || estados.includes(p.estado)) && (!q || sinTildes(`${p.paciente} ${p.numero}`).includes(q)));
  }, [pedidos, filtro, busca]);

  // Por paciente: todo lo que llevó, sumado. Solo cuenta lo entregado
  // (lo que de verdad retiró y pagó); lo demás se muestra aparte.
  const porPaciente = useMemo(() => {
    const grupos = new Map<string, { paciente: string; pedidos: PedidoConItems[] }>();
    for (const p of filtrados) {
      const g = grupos.get(p.clavePaciente) ?? { paciente: p.paciente, pedidos: [] };
      g.pedidos.push(p);
      grupos.set(p.clavePaciente, g);
    }
    return [...grupos.values()]
      .map((g) => {
        const llevo = new Map<string, number>();
        for (const p of g.pedidos.filter((x) => x.estado === "ENTREGADO")) for (const i of p.items) llevo.set(i.nombre, (llevo.get(i.nombre) ?? 0) + i.cantidad);
        return {
          ...g,
          llevo: [...llevo.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")),
          ultimo: g.pedidos[0]?.creado ?? "",
          gastado: g.pedidos.filter((x) => x.estado === "ENTREGADO").reduce((t, x) => t + x.total, 0),
        };
      })
      .sort((a, b) => b.ultimo.localeCompare(a.ultimo));
  }, [filtrados]);

  if (!disponible) return <p className="vacio">Todavía no se pueden ver los pedidos: WiiGo tiene que terminar de prepararlo.</p>;

  return (
    <div className="mp">
      <div className="mp-cab">
        <div>
          <h1>Mis pedidos</h1>
          <p>Los pedidos que armaste y qué llevó cada paciente.</p>
        </div>
        <Link className="boton" href="/mi-espacio/pedidos">
          + Armar un pedido
        </Link>
      </div>

      {pedidos.length === 0 ? (
        <section className="tarjeta">
          <p className="vacio">Todavía no armaste ningún pedido. Cuando armes uno, lo vas a seguir desde acá.</p>
        </section>
      ) : (
        <>
          <div className="mp-controles">
            <div className="mp-vista" role="tablist" aria-label="Cómo verlos">
              <button type="button" role="tab" aria-selected={vista === "pedido"} onClick={() => setVista("pedido")}>
                Por pedido
              </button>
              <button type="button" role="tab" aria-selected={vista === "paciente"} onClick={() => setVista("paciente")}>
                Por paciente
              </button>
            </div>
            <input className="mp-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar paciente o N.º de pedido" aria-label="Buscar" />
          </div>
          <div className="mp-filtros">
            {FILTROS.map((f) => (
              <button key={f.clave} type="button" aria-pressed={filtro === f.clave} onClick={() => setFiltro(f.clave)}>
                {f.label}
              </button>
            ))}
          </div>

          {filtrados.length === 0 ? (
            <p className="vacio">No hay pedidos con ese filtro.</p>
          ) : vista === "pedido" ? (
            <div className="mp-lista">
              {filtrados.map((p) => (
                <details key={p.idPedido} className="mp-pedido">
                  <summary>
                    <span className="mp-num mono">N.º {p.numero}</span>
                    <span className="mp-quien">
                      <b>{p.paciente}</b>
                      <small>
                        {fecha(p.creado)} · {p.items.reduce((t, i) => t + i.cantidad, 0)} productos
                      </small>
                      {p.notaFalta && p.estado === "NUEVO" && <span className="falta-nota">Falta: {p.notaFalta}</span>}
                    </span>
                    <span className={`estado-ped ${p.estado.toLowerCase()}`}>{ETIQUETA_ESTADO[p.estado]}</span>
                    <span className="mp-total mono">{pesos(p.total)}</span>
                  </summary>
                  <ul className="mp-items">
                    {p.items.map((i, k) => (
                      <li key={k}>
                        <span className="mono">{i.cantidad} ×</span>
                        <span>{i.nombre}</span>
                        <span className="mono">{pesos(i.precio * i.cantidad)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ) : (
            <div className="mp-lista">
              {porPaciente.map((g) => (
                <details key={g.paciente + g.ultimo} className="mp-pedido mp-pac">
                  <summary>
                    <span className="mp-quien">
                      <b>{g.paciente}</b>
                      <small>
                        {g.pedidos.length} {g.pedidos.length === 1 ? "pedido" : "pedidos"} · el último el {fecha(g.ultimo)}
                      </small>
                    </span>
                    <span className="mp-total mono">{pesos(g.gastado)}</span>
                  </summary>
                  {g.llevo.length > 0 ? (
                    <>
                      <p className="mp-sub">Lo que llevó</p>
                      <ul className="mp-items">
                        {g.llevo.map(([nombre, cantidad]) => (
                          <li key={nombre}>
                            <span className="mono">{cantidad} ×</span>
                            <span>{nombre}</span>
                            <span />
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="mp-sub">Todavía no retiró ningún pedido.</p>
                  )}
                  <p className="mp-sub">Sus pedidos</p>
                  <ul className="mp-items">
                    {g.pedidos.map((p) => (
                      <li key={p.idPedido}>
                        <span className="mono">N.º {p.numero}</span>
                        <span>
                          {fecha(p.creado)} · <span className={`estado-ped ${p.estado.toLowerCase()}`}>{ETIQUETA_ESTADO[p.estado]}</span>
                        </span>
                        <span className="mono">{pesos(p.total)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
          <p className="nota mp-nota">Acá están los pedidos que armaste vos. Lo que tus pacientes compran solos en el local no se muestra: es de ellos.</p>
        </>
      )}
    </div>
  );
}
