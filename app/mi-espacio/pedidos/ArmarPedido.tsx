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
  idSubcategoria: string | null;
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

export type MarcaCatalogo = { id: string; nombre: string; logo: string | null };
export type RubroCatalogo = { id: string; idMarca: string; nombre: string };

export type PedidoHecho = {
  idPedido: string;
  numero: number;
  paciente: string;
  estado: EstadoPedido;
  creado: string;
  notaFalta: string | null;
  total: number;
};

// Un pedido para ella, que paga con su saldo. El saldo de cada marca paga
// solo productos de esa marca (lib/canjesProfesionales.ts).
export type ParaMi = {
  saldos: { idMarca: string; nombreMarca: string; saldo: number }[];
  tieneDni: boolean;
  tienePin: boolean;
};

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const pct = (n: number) => `${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
// Los productos de una marca que no tienen rubro.
const OTROS = "otros";

export default function ArmarPedido({
  catalogo,
  marcas,
  rubros,
  objetivos,
  objetivosPropios,
  locales,
  pedidos,
  disponible,
  paraMi,
}: {
  catalogo: ProductoCatalogo[];
  marcas: MarcaCatalogo[];
  rubros: RubroCatalogo[];
  objetivos: { id: string; nombre: string }[];
  objetivosPropios: string[];
  locales: { id: string; nombre: string; direccion: string | null }[];
  pedidos: PedidoHecho[];
  disponible: boolean;
  paraMi: ParaMi | null;
}) {
  const router = useRouter();
  // Como en la pantalla asesora: al elegir una marca se abre su primer rubro.
  const primerRubro = (idMarca: string) =>
    rubros.find((r) => r.idMarca === idMarca)?.id ?? (catalogo.some((p) => p.idMarca === idMarca && !p.idSubcategoria) ? OTROS : null);
  const [marca, setMarca] = useState(() => marcas[0]?.id ?? "");
  const [rubro, setRubro] = useState<string | null>(() => (marcas[0] ? primerRubro(marcas[0].id) : null));
  const [filtroObjetivos, setFiltroObjetivos] = useState<Set<string>>(() => new Set());
  const [busqueda, setBusqueda] = useState("");
  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [paciente, setPaciente] = useState({ nombre: "", apellido: "", dni: "", telefono: "" });
  const [acepta, setAcepta] = useState(false);
  const [idLocal, setIdLocal] = useState(locales[0]?.id ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<string | null>(null);

  const porId = useMemo(() => new Map(catalogo.map((p) => [p.idVariante, p])), [catalogo]);
  const marcaActual = marcas.find((m) => m.id === marca) ?? null;
  // En el riel, los objetivos que trabaja ella.
  const susObjetivos = useMemo(() => objetivos.filter((o) => objetivosPropios.includes(o.id)), [objetivos, objetivosPropios]);
  const cuantosDeMarca = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of catalogo) m.set(p.idMarca, (m.get(p.idMarca) ?? 0) + 1);
    return m;
  }, [catalogo]);
  const rubrosDeMarca = useMemo(
    () => rubros.filter((r) => r.idMarca === marca).map((r) => ({ ...r, cantidad: catalogo.filter((p) => p.idSubcategoria === r.id).length })),
    [rubros, catalogo, marca]
  );
  const sinRubro = useMemo(() => catalogo.filter((p) => p.idMarca === marca && !p.idSubcategoria).length, [catalogo, marca]);

  // Escribiendo, se busca en todas las marcas; si no, la marca y el rubro elegidos.
  const q = busqueda.trim().toLowerCase();
  const visibles = useMemo(() => {
    if (q) return catalogo.filter((p) => p.nombre.toLowerCase().includes(q) || p.marca.toLowerCase().includes(q));
    return catalogo.filter(
      (p) =>
        p.idMarca === marca &&
        (!rubro || (rubro === OTROS ? !p.idSubcategoria : p.idSubcategoria === rubro)) &&
        (filtroObjetivos.size === 0 || p.objetivos.some((o) => filtroObjetivos.has(o)))
    );
  }, [catalogo, q, marca, rubro, filtroObjetivos]);

  const titulo = q ? `«${busqueda.trim()}»` : rubro === OTROS ? "Otros" : (rubrosDeMarca.find((r) => r.id === rubro)?.nombre ?? `Todo ${marcaActual?.nombre ?? ""}`);

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
  const unidades = lineas.reduce((t, l) => t + l.cantidad, 0);

  // Con su saldo: cuánto cubre de cada marca. Es una cuenta para que se haga
  // una idea; la de verdad la hace la caja al cobrarlo.
  const saldoPorMarca = new Map((paraMi?.saldos ?? []).map((s) => [s.idMarca, s]));
  const usoSaldo = (precio: "lista" | "efectivo") => {
    const porMarca = new Map<string, number>();
    for (const l of lineas) porMarca.set(l.p.idMarca, (porMarca.get(l.p.idMarca) ?? 0) + (precio === "lista" ? l.p.precioLista : l.p.precioEfectivo) * l.cantidad);
    return (paraMi?.saldos ?? []).map((s) => ({ ...s, usa: Math.min(s.saldo, porMarca.get(s.idMarca) ?? 0) }));
  };
  const usoEfectivo = usoSaldo("efectivo");
  const cubreEfectivo = usoEfectivo.reduce((t, s) => t + s.usa, 0);
  const cubreLista = usoSaldo("lista").reduce((t, s) => t + s.usa, 0);

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

  function elegirMarca(id: string) {
    setMarca(id);
    setRubro(primerRubro(id));
    setBusqueda("");
  }
  function elegirRubro(id: string | null) {
    setRubro(id);
    setBusqueda("");
  }
  function alternarObjetivo(id: string) {
    const n = new Set(filtroObjetivos);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setFiltroObjetivos(n);
  }

  function enviar() {
    setError(null);
    setEnviando(true);
    enviarPedido({
      items: lineas.map((l) => ({ idVariante: l.p.idVariante, cantidad: l.cantidad })),
      paciente,
      acepta,
      idLocal,
      paraMi: Boolean(paraMi),
    })
      .then((r) => {
        if (r.error) return setError(r.error);
        setEnviado(
          paraMi
            ? `Listo, mandaste tu pedido N.º ${r.numero} al local. Te avisamos por WhatsApp cuando esté listo para retirar.`
            : `Listo, mandaste el pedido N.º ${r.numero} al local. Le van a avisar a ${paciente.nombre} por WhatsApp cuando esté listo.`
        );
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

  const elegirLocal =
    locales.length > 1 ? (
      <label className="campo">
        <span>¿En qué local lo {paraMi ? "retirás" : "retira"}?</span>
        <select value={idLocal} onChange={(e) => setIdLocal(e.target.value)}>
          {locales.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nombre}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <div className="pedidos-esp">
      <div className="ficha-cab">
        {paraMi && <span className="modo-propio">Para vos · con tu saldo</span>}
        <h1>{paraMi ? "Tu pedido con saldo" : "Armale el pedido a tu paciente"}</h1>
        <p>
          {paraMi
            ? "Elegí lo que querés llevarte. El local lo arma y te avisa; al retirarlo se descuenta de tu saldo y pagás solo lo que falte."
            : "Elegí los productos con tu paciente al lado y mandalo al local. Lo arman, le avisan por WhatsApp y lo paga cuando lo retira."}
        </p>
      </div>
      {enviado && (
        <p className="aviso-ok" role="status">
          {enviado}
        </p>
      )}

      <div className="arma">
        {/* El catálogo con el formato de la pantalla asesora: las marcas
            arriba, los rubros en la barra oscura del costado, los productos
            a la derecha. */}
        <section className="cat" aria-label="Productos">
          <div className="tira" role="group" aria-label="Marcas">
            {marcas.map((m) => (
              <button key={m.id} type="button" className="disco" aria-pressed={!q && m.id === marca} onClick={() => elegirMarca(m.id)}>
                <span className="circ">
                  {m.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.logo} alt="" />
                  ) : (
                    m.nombre.charAt(0)
                  )}
                </span>
                <b>{m.nombre}</b>
                <small>{cuantosDeMarca.get(m.id) ?? 0}</small>
              </button>
            ))}
          </div>

          <div className="cuerpo">
            <nav className="riel" aria-label="Rubros y objetivos">
              <div className="riel-int">
                <div className="grupo">
                  <p>Rubro</p>
                  <div>
                    <button type="button" className="op" aria-pressed={!q && rubro === null} onClick={() => elegirRubro(null)}>
                      <span>Todo {marcaActual?.nombre}</span>
                      <small>{cuantosDeMarca.get(marca) ?? 0}</small>
                    </button>
                    {rubrosDeMarca.map((r) => (
                      <button key={r.id} type="button" className="op" aria-pressed={!q && rubro === r.id} onClick={() => elegirRubro(r.id)}>
                        <span>{r.nombre}</span>
                        <small>{r.cantidad}</small>
                      </button>
                    ))}
                    {sinRubro > 0 && (
                      <button type="button" className="op" aria-pressed={!q && rubro === OTROS} onClick={() => elegirRubro(OTROS)}>
                        <span>Otros</span>
                        <small>{sinRubro}</small>
                      </button>
                    )}
                  </div>
                </div>
                {susObjetivos.length > 0 && (
                  <div className="grupo">
                    <p>Tus objetivos</p>
                    <div>
                      {susObjetivos.map((o) => (
                        <button key={o.id} type="button" className="op" aria-pressed={filtroObjetivos.has(o.id)} onClick={() => alternarObjetivo(o.id)}>
                          <i className="casilla" aria-hidden="true" />
                          <span>{o.nombre}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </nav>

            <div className="vitrina">
              <label>
                <span className="sr-only">Buscar</span>
                <input className="busca-todo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar en todo WiiGo: creatina, almendras, sin TACC…" />
              </label>
              <div className="vitrina-cab">
                <div>
                  <p className="ceja">{q ? "Búsqueda en todas las marcas" : marcaActual?.nombre}</p>
                  <h2>{titulo}</h2>
                </div>
                <span className="cuenta">
                  {visibles.length} {visibles.length === 1 ? "producto" : "productos"}
                </span>
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
                          <span className="sin-img">{p.nombre.charAt(0)}</span>
                        )}
                        {q && <span className="cp-marca">{p.marca}</span>}
                        <b>{p.nombre}</b>
                        <p className="cp-precio">
                          <span className="mono">{pesos(p.precioLista)}</span>
                          {p.precioEfectivo !== p.precioLista && <small>efectivo {pesos(p.precioEfectivo)}</small>}
                        </p>
                        {paraMi ? (
                          saldoPorMarca.has(p.idMarca) ? (
                            <span className="cp-suma saldo">Podés usar tu saldo</span>
                          ) : (
                            <span className="cp-suma no">Sin saldo de esta marca</span>
                          )
                        ) : p.participa ? (
                          <span className="cp-suma">
                            Vos {pct(p.porcentajeProfesional)} · paciente {pct(p.porcentajeCliente)} la 1.ª vez
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
            </div>
          </div>
        </section>

        {paraMi ? (
          <aside className="tarjeta aside-pedido" id="el-pedido">
            <h2>Tu pedido</h2>
            {lineas.length === 0 ? (
              <p className="vacio">Tocá «Agregar» en lo que querés llevarte.</p>
            ) : (
              <ul className="items">
                {lineas.map((l) => (
                  <li key={l.p.idVariante}>
                    <span>{l.p.nombre}</span>
                    <span className="mono">×{l.cantidad}</span>
                    <span className="mono">{pesos(l.p.precioEfectivo * l.cantidad)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="saldo-box">
              <p className="t">Tu saldo</p>
              {paraMi.saldos.length === 0 ? (
                <p className="nota">Todavía no tenés saldo. Igual podés pedir y pagarlo al retirarlo.</p>
              ) : (
                usoEfectivo.map((s) => (
                  <div key={s.idMarca} className="saldo-fila">
                    <span>{s.nombreMarca}</span>
                    <b className="mono">{pesos(s.saldo)}</b>
                    {lineas.length > 0 && <small>{s.usa > 0 ? `Usás ${pesos(s.usa)} en este pedido` : "No tenés productos de esta marca en el pedido"}</small>}
                  </div>
                ))
              )}
              <p className="nota">El saldo de cada marca paga solo productos de esa marca.</p>
            </div>
            {lineas.length > 0 && (
              <>
                <dl className="totales">
                  <dt>Total en efectivo</dt>
                  <dd className="mono">{pesos(subtotalEfectivo)}</dd>
                  <dt>Lo cubre tu saldo</dt>
                  <dd className="mono">−{pesos(cubreEfectivo)}</dd>
                  <dt className="fuerte">Pagás al retirarlo</dt>
                  <dd className="mono fuerte">{pesos(Math.max(subtotalEfectivo - cubreEfectivo, 0))}</dd>
                </dl>
                {subtotalEfectivo !== subtotalLista && (
                  <p className="nota">Con tarjeta o Mercado Pago, lo que falta sale {pesos(Math.max(subtotalLista - cubreLista, 0))}.</p>
                )}
                <p className="nota">Estos precios se respetan {HORAS_PRECIO_FIJO} h. Después se cobra el precio del día.</p>
              </>
            )}
            {elegirLocal}
            {!paraMi.tienePin && paraMi.saldos.length > 0 && (
              <p className="estado-revision">Para usar tu saldo en la caja necesitás tu PIN. Pedíselo a WiiGo antes de ir a retirarlo.</p>
            )}
            <p className="nota">Lo arman en el local y te avisamos por WhatsApp. Al retirarlo ponés tu PIN en la caja y se descuenta de tu saldo.</p>
            {error && <p className="error">{error}</p>}
            <button type="button" className="boton" disabled={enviando || lineas.length === 0 || !paraMi.tieneDni} onClick={enviar}>
              {enviando ? "Mandando..." : "Enviar pedido al local"}
            </button>
            {!paraMi.tieneDni && <p className="nota">Para pedir con tu saldo, WiiGo tiene que tener cargado tu DNI. Escribinos y lo cargamos.</p>}
          </aside>
        ) : (
          <aside className="tarjeta aside-pedido" id="el-pedido">
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
                {descuento("lista") > 0 && (
                  <p className="nota">
                    Incluye el descuento de bienvenida de tu código ({pesos(descuento("lista"))}): es para su primera compra. Si ya compró antes con tu código,
                    en la caja se cobra sin ese descuento.
                  </p>
                )}
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
              {elegirLocal}
            </div>
            <p className="nota">Si ya es cliente de WiiGo lo encontramos por el DNI. Nada de diagnósticos: solo sus datos.</p>
            <label className="acepta">
              <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
              <span>{paciente.nombre || "Mi paciente"} acepta sumarse a WiiGo Club y que le avisen por WhatsApp cuando su pedido esté listo.</span>
            </label>
            {error && <p className="error">{error}</p>}
            <button type="button" className="boton" disabled={enviando || lineas.length === 0} onClick={enviar}>
              {enviando ? "Mandando..." : "Enviar pedido al local"}
            </button>
          </aside>
        )}
      </div>

      {/* En el celular el pedido queda debajo de todo el catálogo: esta barra
          dice cuánto lleva y lleva hasta ahí. */}
      {lineas.length > 0 && (
        <div className="barra-pedido">
          <span>
            {unidades} {unidades === 1 ? "producto" : "productos"} · <b className="mono">{pesos(paraMi ? subtotalEfectivo : subtotalLista)}</b>
          </span>
          <a href="#el-pedido">Ver el pedido ↓</a>
        </div>
      )}

      {pedidos.length > 0 && (
        <section className="tarjeta">
          <h2>Tus últimos pedidos</h2>
          <div className="tabla-env">
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Para</th>
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
