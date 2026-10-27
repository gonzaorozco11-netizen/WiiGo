"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { enviarPedido } from "../actions";
import { ETIQUETA_ESTADO, HORAS_PRECIO_FIJO, type EstadoPedido } from "@/lib/pedidosProfesional";

export type ProductoCatalogo = {
  idVariante: string;
  nombre: string;
  marca: string;
  idMarca: string;
  imagen: string | null;
  precioLista: number;
  precioEfectivo: number;
  hayStock: boolean;
  objetivos: string[];
  porcentajeCliente: number;
  porcentajeProfesional: number;
  descuentoCliente: boolean;
  participa: boolean;
};

export type PedidoHecho = {
  idPedido: string;
  numero: number;
  paciente: string;
  estado: EstadoPedido;
  creado: string;
  notaFalta: string | null;
  total: number;
};

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const pct = (n: number) => `${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;

export default function ArmarPedido({
  catalogo,
  objetivos,
  objetivosPropios,
  locales,
  pedidos,
  disponible,
}: {
  catalogo: ProductoCatalogo[];
  objetivos: { id: string; nombre: string }[];
  objetivosPropios: string[];
  locales: { id: string; nombre: string; direccion: string | null }[];
  pedidos: PedidoHecho[];
  disponible: boolean;
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [objetivo, setObjetivo] = useState<string | null>(null);
  const [marca, setMarca] = useState("");
  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [paciente, setPaciente] = useState({ nombre: "", apellido: "", dni: "", telefono: "" });
  const [acepta, setAcepta] = useState(false);
  const [idLocal, setIdLocal] = useState(locales[0]?.id ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<string | null>(null);

  const porId = useMemo(() => new Map(catalogo.map((p) => [p.idVariante, p])), [catalogo]);
  const marcas = useMemo(() => [...new Set(catalogo.map((p) => p.marca))].sort((a, b) => a.localeCompare(b, "es")), [catalogo]);
  // Primero los objetivos que trabaja ella: son los que más va a usar.
  const chips = useMemo(
    () => [...objetivos].sort((a, b) => Number(objetivosPropios.includes(b.id)) - Number(objetivosPropios.includes(a.id))).slice(0, 8),
    [objetivos, objetivosPropios]
  );

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return catalogo.filter(
      (p) =>
        (!q || p.nombre.toLowerCase().includes(q) || p.marca.toLowerCase().includes(q)) &&
        (!objetivo || p.objetivos.includes(objetivo)) &&
        (!marca || p.marca === marca)
    );
  }, [catalogo, busqueda, objetivo, marca]);

  const lineas = Object.entries(carrito)
    .map(([id, cantidad]) => ({ p: porId.get(id), cantidad }))
    .filter((l): l is { p: ProductoCatalogo; cantidad: number } => Boolean(l.p));
  const subtotalLista = lineas.reduce((t, l) => t + l.p.precioLista * l.cantidad, 0);
  const subtotalEfectivo = lineas.reduce((t, l) => t + l.p.precioEfectivo * l.cantidad, 0);
  const descuento = (medio: "lista" | "efectivo") =>
    lineas.reduce((t, l) => {
      if (!l.p.participa || !l.p.descuentoCliente) return t;
      const precio = medio === "lista" ? l.p.precioLista : l.p.precioEfectivo;
      return t + Math.round(precio * l.cantidad * (l.p.porcentajeCliente / 100));
    }, 0);
  const suma = lineas.reduce((t, l) => (l.p.participa ? t + Math.round(l.p.precioLista * l.cantidad * (l.p.porcentajeProfesional / 100)) : t), 0);

  function cambiar(id: string, delta: number) {
    setCarrito((c) => {
      const n = (c[id] ?? 0) + delta;
      if (n <= 0) {
        const { [id]: _fuera, ...resto } = c;
        return resto;
      }
      return { ...c, [id]: Math.min(n, 20) };
    });
  }

  function enviar() {
    setError(null);
    setEnviando(true);
    enviarPedido({
      items: lineas.map((l) => ({ idVariante: l.p.idVariante, cantidad: l.cantidad })),
      paciente,
      acepta,
      idLocal,
    })
      .then((r) => {
        if (r.error) return setError(r.error);
        setEnviado(`Listo, mandaste el pedido N.º ${r.numero} al local. Le van a avisar a ${paciente.nombre} por WhatsApp cuando esté listo.`);
        setCarrito({});
        setPaciente({ nombre: "", apellido: "", dni: "", telefono: "" });
        setAcepta(false);
        router.refresh();
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
      .catch(() => setError("No se pudo mandar. Revisá tu conexión y probá de nuevo."))
      .finally(() => setEnviando(false));
  }

  if (!disponible) {
    return (
      <section className="tarjeta">
        <h2>Pedidos</h2>
        <p className="vacio">Todavía no se pueden armar pedidos: WiiGo tiene que terminar de prepararlo.</p>
      </section>
    );
  }

  return (
    <div className="pedidos-esp">
      <div className="ficha-cab">
        <h1>Armale el pedido a tu paciente</h1>
        <p>Elegí los productos con tu paciente al lado y mandalo al local. Lo arman, le avisan por WhatsApp y lo paga cuando lo retira.</p>
      </div>
      {enviado && (
        <p className="aviso-ok" role="status">
          {enviado}
        </p>
      )}

      <div className="arma">
        <section className="catalogo">
          <label className="busca">
            <span className="sr-only">Buscar</span>
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar en todo WiiGo: creatina, almendras, sin TACC…" />
          </label>
          <div className="opciones envolver">
            <button type="button" aria-pressed={objetivo === null} onClick={() => setObjetivo(null)}>
              Todo
            </button>
            {chips.map((o) => (
              <button key={o.id} type="button" aria-pressed={objetivo === o.id} onClick={() => setObjetivo(objetivo === o.id ? null : o.id)}>
                {o.nombre}
              </button>
            ))}
            <select value={marca} onChange={(e) => setMarca(e.target.value)} aria-label="Marca">
              <option value="">Todas las marcas</option>
              {marcas.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          {visibles.length === 0 ? (
            <p className="vacio">No hay productos con ese filtro.</p>
          ) : (
            <div className="grilla-prod">
              {visibles.map((p) => {
                const enCarrito = carrito[p.idVariante] ?? 0;
                return (
                  <article key={p.idVariante} className="card-prod">
                    {p.imagen ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imagen} alt="" loading="lazy" />
                    ) : (
                      <span className="sin-img" />
                    )}
                    <span className="cp-marca">{p.marca}</span>
                    <b>{p.nombre}</b>
                    <p className="cp-precio">
                      <span className="mono">{pesos(p.precioLista)}</span>
                      {p.precioEfectivo !== p.precioLista && <small>efectivo {pesos(p.precioEfectivo)}</small>}
                    </p>
                    {p.participa ? (
                      <span className="cp-suma">
                        Vos {pct(p.porcentajeProfesional)} · paciente {pct(p.porcentajeCliente)}
                      </span>
                    ) : (
                      <span className="cp-suma no">Esta marca no participa: no suma</span>
                    )}
                    {!p.hayStock ? (
                      <span className="cp-boton sin">Sin stock</span>
                    ) : enCarrito > 0 ? (
                      <span className="cp-cant">
                        <button type="button" onClick={() => cambiar(p.idVariante, -1)} aria-label="Uno menos">
                          −
                        </button>
                        <b className="mono">{enCarrito}</b>
                        <button type="button" onClick={() => cambiar(p.idVariante, 1)} aria-label="Uno más">
                          +
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="cp-boton" onClick={() => cambiar(p.idVariante, 1)}>
                        + Agregar
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="tarjeta aside-pedido">
          <h2>El pedido</h2>
          {lineas.length === 0 ? (
            <p className="vacio">Tocá «Agregar» en los productos que le recomendás.</p>
          ) : (
            <>
              <ul className="items">
                {lineas.map((l) => (
                  <li key={l.p.idVariante}>
                    <span>{l.p.nombre}</span>
                    <span className="mono">×{l.cantidad}</span>
                    <span className="mono">{pesos(l.p.precioLista * l.cantidad)}</span>
                  </li>
                ))}
              </ul>
              <dl className="totales">
                <dt>Con tarjeta o Mercado Pago</dt>
                <dd className="mono">{pesos(subtotalLista - descuento("lista"))}</dd>
                {subtotalEfectivo !== subtotalLista && (
                  <>
                    <dt>En efectivo</dt>
                    <dd className="mono">{pesos(subtotalEfectivo - descuento("efectivo"))}</dd>
                  </>
                )}
              </dl>
              {descuento("lista") > 0 && <p className="nota">Ya tiene el descuento de tu código ({pesos(descuento("lista"))}).</p>}
              {suma > 0 && <p className="sumas">Cuando lo pague, vos sumás cerca de {pesos(suma)} de saldo.</p>}
              <p className="nota">Estos precios se respetan {HORAS_PRECIO_FIJO} h. Después se cobra el precio del día.</p>
            </>
          )}

          <div className="campos una">
            <p className="rotulo-form">¿Para quién es?</p>
            <label className="campo">
              <span>Nombre</span>
              <input value={paciente.nombre} onChange={(e) => setPaciente({ ...paciente, nombre: e.target.value })} />
            </label>
            <label className="campo">
              <span>Apellido</span>
              <input value={paciente.apellido} onChange={(e) => setPaciente({ ...paciente, apellido: e.target.value })} />
            </label>
            <label className="campo">
              <span>DNI</span>
              <input value={paciente.dni} inputMode="numeric" onChange={(e) => setPaciente({ ...paciente, dni: e.target.value })} />
            </label>
            <label className="campo">
              <span>WhatsApp</span>
              <input value={paciente.telefono} inputMode="tel" placeholder="261 555-0123" onChange={(e) => setPaciente({ ...paciente, telefono: e.target.value })} />
            </label>
            {locales.length > 1 && (
              <label className="campo">
                <span>¿En qué local lo retira?</span>
                <select value={idLocal} onChange={(e) => setIdLocal(e.target.value)}>
                  {locales.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="nota">Si ya es cliente de WiiGo lo encontramos por el DNI. Nada de diagnósticos: solo sus datos.</p>
          <label className="acepta">
            <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
            <span>
              {paciente.nombre || "Mi paciente"} acepta sumarse a WiiGo Club y que le avisen por WhatsApp cuando su pedido esté listo.
            </span>
          </label>
          {error && <p className="error">{error}</p>}
          <button type="button" className="boton" disabled={enviando || lineas.length === 0} onClick={enviar}>
            {enviando ? "Mandando..." : "Enviar pedido al local"}
          </button>
        </aside>
      </div>

      {pedidos.length > 0 && (
        <section className="tarjeta">
          <h2>Tus últimos pedidos</h2>
          <div className="tabla-env">
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Paciente</th>
                  <th>Cómo va</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.idPedido}>
                    <td className="mono">{p.numero}</td>
                    <td>
                      {p.paciente}
                      {p.notaFalta && p.estado === "NUEVO" && <span className="falta-nota">Falta: {p.notaFalta}</span>}
                    </td>
                    <td>
                      <span className={`estado-ped ${p.estado.toLowerCase()}`}>{ETIQUETA_ESTADO[p.estado]}</span>
                    </td>
                    <td className="num">{pesos(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
