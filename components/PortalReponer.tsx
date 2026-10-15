"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  mandarReposicion,
  cancelarEnvio,
  type DatosReponer,
  type GondolaReponer,
  type RenglonReponer,
} from "@/app/portal/reponer/actions";
import type { OrdenPortal } from "@/app/portal/actions";

// Lo que la marca tiene que reponer.
//
// La pantalla no es un formulario: es una orden ya armada que se revisa. La
// marca no calcula nada — entra, mira y manda. Las columnas están para que
// pueda DISCUTIR el número, no de adorno: un número que no se puede auditar
// no se obedece, se ignora.

function pesos(v: number) {
  return `$${Math.round(v).toLocaleString("es-AR")}`;
}

/**
 * Cuántas filas se dejan abiertas de entrada.
 *
 * Es un presupuesto y no una regla fija porque los dos casos extremos piden
 * cosas opuestas. Una semana normal son tres o cuatro productos repartidos en
 * dos góndolas: ahí abrir todo es lo correcto, cerrarlo obliga a buscar.
 * Pero antes de abrir el local está TODO agotado —116 productos— y abrir todo
 * son cien filas que nadie revisa: se scrollea hasta abajo y se manda.
 *
 * Con un presupuesto de filas los dos casos salen bien solos, sin que la
 * marca tenga que configurar nada.
 */
const FILAS_ABIERTAS = 12;

export default function PortalReponer({
  datos,
  envios,
}: {
  datos: DatosReponer;
  envios: OrdenPortal[];
}) {
  const router = useRouter();
  const [solapa, setSolapa] = useState<"FALTA" | "ENVIOS">("FALTA");
  const [cantidades, setCantidades] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ automatica: boolean } | null>(null);
  const [pendiente, empezar] = useTransition();

  const abiertasPorDefecto = useMemo(() => {
    const abiertas = new Set<string>();
    let filas = 0;
    for (const g of datos.gondolas) {
      const faltan = g.renglones.filter((r) => r.sugerido > 0).length;
      if (faltan === 0) continue;
      if (filas > 0 && filas + g.renglones.length > FILAS_ABIERTAS) break;
      abiertas.add(g.nombre);
      filas += g.renglones.length;
    }
    return abiertas;
  }, [datos]);

  const [abiertas, setAbiertas] = useState<Set<string>>(abiertasPorDefecto);

  // Sin una sola venta registrada no se puede hablar de "se dejó de vender":
  // el local todavía no abrió. Mismo dato, otra frase.
  const sinHistoria = useMemo(
    () => datos.gondolas.every((g) => g.renglones.every((r) => r.porSemana === 0)),
    [datos]
  );

  const conFaltante = datos.gondolas.filter((g) => g.renglones.some((r) => r.sugerido > 0));
  const todasAbiertas = conFaltante.length > 0 && conFaltante.every((g) => abiertas.has(g.nombre));

  const sugeridoDe = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of datos.gondolas) for (const r of g.renglones) m.set(r.idVariante, r.sugerido);
    return m;
  }, [datos]);

  const cantidad = (id: string) => cantidades.get(id) ?? sugeridoDe.get(id) ?? 0;

  function tocar(id: string, n: number) {
    setListo(null);
    setCantidades((previo) => new Map(previo).set(id, Math.max(0, Math.round(n) || 0)));
  }

  const aMandar = useMemo(() => {
    const items: { idVariante: string; cantidad: number }[] = [];
    for (const g of datos.gondolas)
      for (const r of g.renglones) {
        const n = cantidad(r.idVariante);
        if (n > 0) items.push({ idVariante: r.idVariante, cantidad: n });
      }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, cantidades]);

  const unidades = aMandar.reduce((a, i) => a + i.cantidad, 0);

  // Cuántas se pasan del tope. Decirlo ANTES de mandar evita la sorpresa de
  // que la orden quede esperando sin que la marca entienda por qué.
  const sobreTope = useMemo(() => {
    let n = 0;
    for (const g of datos.gondolas)
      for (const r of g.renglones) {
        const c = cantidad(r.idVariante);
        if (c > 0 && r.stock + r.enCamino + c > r.tope) n += c;
      }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, cantidades]);

  function mandar() {
    setError(null);
    empezar(async () => {
      const r = await mandarReposicion(aMandar);
      if (r.error) return setError(r.error);
      setListo({ automatica: Boolean(r.automatica) });
      setCantidades(new Map());
      router.refresh();
    });
  }

  return (
    <main className="portal-lienzo">
      <div className="rep-cab">
        <div>
          <h1 className="rep-titulo">
            {solapa === "FALTA" ? "Lo que tenés que reponer" : "Mis envíos"}
          </h1>
          <p className="rep-sub">
            {solapa === "FALTA"
              ? "Se arma solo con lo que vas vendiendo. No hace falta que lo revises todos los días: cuando llegue el día de recepción, mandá lo que diga acá."
              : "Lo que mandaste y lo que se recibió de verdad en el local, producto por producto."}
          </p>
        </div>
        {solapa === "FALTA" && datos.proxima && (
          <div className="rep-proxima">
            <span>Próxima recepción</span>
            <b>{datos.proxima.etiqueta} · {datos.proxima.horario} h</b>
            <small>
              {datos.proxima.faltanDias === 0
                ? "es hoy"
                : datos.proxima.faltanDias === 1
                  ? "falta 1 día"
                  : `faltan ${datos.proxima.faltanDias} días`}
            </small>
          </div>
        )}
      </div>

      <div className="cam-tabs">
        <button
          className={`cam-tab${solapa === "FALTA" ? " activa" : ""}`}
          onClick={() => setSolapa("FALTA")}
        >
          Lo que falta
          {datos.agotados + datos.bajos > 0 && (
            <span className="cam-cont fuerte">{datos.agotados + datos.bajos}</span>
          )}
        </button>
        <button
          className={`cam-tab${solapa === "ENVIOS" ? " activa" : ""}`}
          onClick={() => setSolapa("ENVIOS")}
        >
          Mis envíos
          {envios.length > 0 && <span className="cam-cont">{envios.length}</span>}
        </button>
      </div>

      {solapa === "ENVIOS" && <Envios envios={envios} />}

      {solapa === "FALTA" && (
        <>
          {datos.yaMandado && (
        <div className="rep-aviso">
          {datos.yaMandado.estado === "PROPUESTA" ? (
            <>
              Mandaste un envío de <b>{datos.yaMandado.unidades} unidades</b> que está{" "}
              <b>esperando que WiiGo lo apruebe</b>, porque algo se pasaba del tope acordado. No
              hace falta que lo mandes de nuevo.
            </>
          ) : (
            <>
              Ya tenés un envío de <b>{datos.yaMandado.unidades} unidades</b> mandado y todavía sin
              recibir. Lo que figura abajo ya lo descuenta, así que no vas a mandar dos veces lo
              mismo.
            </>
          )}
          {/* El arrepentimiento llega mirando este aviso, no entrando a Mis
              envíos: acá es donde la marca se acuerda de que mandó algo que
              quería cambiar. */}
          {datos.yaMandado.sePuedeDarDeBaja && (
            <>
              {" "}
              ¿Te falta agregar o sacar algo?{" "}
              <BajaEnvio idOrden={datos.yaMandado.idOrden} compacto />
            </>
          )}
        </div>
      )}

      <div className="rep-numeros">
        {/* La tarjeta se apaga cuando lo que falta ya viene en camino. Con el
            envío mandado la góndola sigue vacía, pero no hay nada que hacer:
            un número en rojo al lado de "0 para mandar" se contradice solo y
            enseña a desconfiar de la pantalla. */}
        <div className={`rep-num ${datos.agotados > datos.agotadosEnCamino ? "agotado" : "espera"}`}>
          <span>{sinHistoria ? "Sin stock en góndola" : "Agotados"}</span>
          <b>{datos.agotados}</b>
          <small>
            {datos.agotados === 0
              ? "Está todo en góndola"
              : datos.agotados === datos.agotadosEnCamino
                ? "Todos vienen en el envío que mandaste"
                : datos.agotadosEnCamino > 0
                  ? `${datos.agotadosEnCamino} ya vienen en camino`
                  : sinHistoria
                    ? "Todavía no hay nada tuyo en el local"
                    : "No se están vendiendo porque no están"}
          </small>
        </div>
        <div className={`rep-num ${datos.bajos > datos.bajosEnCamino ? "bajo" : "espera"}`}>
          <span>Por debajo del mínimo</span>
          <b>{datos.bajos}</b>
          <small>
            {datos.bajos === 0
              ? "Ninguno está en riesgo"
              : datos.bajos === datos.bajosEnCamino
                ? "Todos vienen en el envío que mandaste"
                : "No llegan a la próxima recepción"}
          </small>
        </div>
        <div className="rep-num total">
          <span>Este envío</span>
          <b>{unidades} u.</b>
          <small>{pesos(datos.valorizado)} a precio de venta</small>
        </div>
      </div>

      {datos.gondolas.length === 0 ? (
        <p className="vacio">Todavía no tenés productos con stock objetivo cargado.</p>
      ) : (
        <>
          {conFaltante.length > 1 && (
            <div className="rep-abrir">
              <button
                type="button"
                onClick={() =>
                  setAbiertas(todasAbiertas ? new Set() : new Set(conFaltante.map((g) => g.nombre)))
                }
              >
                {todasAbiertas ? "Cerrar todas" : "Abrir todas"}
              </button>
            </div>
          )}
          {datos.gondolas.map((g) => (
            <Gondola
              key={g.nombre}
              g={g}
              abierta={abiertas.has(g.nombre)}
              alternar={() =>
                setAbiertas((previo) => {
                  const siguiente = new Set(previo);
                  if (siguiente.has(g.nombre)) siguiente.delete(g.nombre);
                  else siguiente.add(g.nombre);
                  return siguiente;
                })
              }
              cantidad={cantidad}
              tocar={tocar}
            />
          ))}
        </>
      )}

      <div className="rep-pie">
        {listo ? (
          <p className="rep-ok">
            ✅ Envío mandado.{" "}
            {listo.automatica
              ? "Entró sin esperar aprobación: ya figura en la recepción de WiiGo."
              : "Queda esperando que WiiGo lo apruebe, porque algo se pasa del tope acordado."}{" "}
            La mercadería entra al stock cuando la reciben en el local y cuentan lo que llegó.
          </p>
        ) : (
          <>
            <div>
              {unidades === 0 ? (
                <p className="rep-nada">No hay nada para mandar. Está todo al día.</p>
              ) : sobreTope > 0 ? (
                <p className="rep-nota">
                  <b>{unidades - sobreTope} de {unidades} unidades</b> entran sin esperar aprobación.
                  Las otras {sobreTope} se pasan del tope acordado, así que esas las revisa WiiGo.
                </p>
              ) : (
                <p className="rep-nota">
                  ✅ Las <b>{unidades} unidades</b> entran sin que esperes aprobación.
                </p>
              )}
              {error && <p className="rep-error">{error}</p>}
            </div>
            <button
              className="boton-portal"
              disabled={unidades === 0 || pendiente}
              onClick={mandar}
            >
              {pendiente ? "Mandando…" : "Mandar este envío"}
            </button>
          </>
        )}
      </div>

          <p className="rep-letra">
            Mandar el envío no mueve el stock: avisa a WiiGo que la mercadería va en camino. Entra a
            la góndola cuando la reciben en el local y cuentan lo que llegó de verdad. Si decía 8 y
            llegaron 6, se reciben 6 y lo vas a ver en Mis envíos.
          </p>
        </>
      )}
    </main>
  );
}

type Filtro = "TODO" | "SEMANA" | "MES" | "RANGO";

const ETIQUETA_FILTRO: Record<Filtro, string> = {
  TODO: "Todo",
  SEMANA: "Esta semana",
  MES: "Este mes",
  RANGO: "Entre fechas",
};

function soloFecha(iso: string) {
  return (iso ?? "").slice(0, 10);
}

function fechaCorta(iso: string | null) {
  if (!iso) return "—";
  const [a, m, d] = soloFecha(iso).split("-");
  return d && m ? `${d}/${m}/${a?.slice(2)}` : iso;
}

/**
 * Lo que la marca mandó y lo que se recibió de verdad.
 *
 * Es la otra mitad de Reponer: acá se manda, acá se controla. En consignación
 * esto no es un historial decorativo — es el único lugar donde la marca puede
 * ver que mandó 8 y entraron 6. Sin eso, la diferencia aparece recién en la
 * liquidación de fin de mes y ahí ya es una discusión.
 *
 * El filtrado es en pantalla y no en el servidor: son como mucho 200 órdenes,
 * y a ese volumen ir y volver por cada clic se siente más lento sin ahorrar
 * nada.
 */
function Envios({ envios }: { envios: OrdenPortal[] }) {
  const [filtro, setFiltro] = useState<Filtro>("TODO");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);

  const visibles = useMemo(() => {
    const hoy = new Date();
    const limite = (dias: number) => {
      const d = new Date(hoy);
      d.setDate(d.getDate() - dias);
      return d.toISOString().slice(0, 10);
    };
    return envios.filter((o) => {
      const f = soloFecha(o.fecha);
      if (filtro === "SEMANA") return f >= limite(7);
      if (filtro === "MES") return f >= limite(30);
      if (filtro === "RANGO") {
        if (desde && f < desde) return false;
        if (hasta && f > hasta) return false;
        return true;
      }
      return true;
    });
  }, [envios, filtro, desde, hasta]);

  // Lo que importa del período: cuánto se mandó y cuánto entró. La diferencia
  // es el número que se discute, así que se muestra solo.
  // Los dados de baja y los rechazados siguen en la lista —queda el registro
  // de que existieron— pero no suman al "mandaste": esa mercadería no salió,
  // y contarla deja una diferencia permanente contra lo que entró.
  const resumen = useMemo(() => {
    let mandadas = 0;
    let recibidas = 0;
    let conDiferencia = 0;
    let cuentan = 0;
    for (const o of visibles) {
      if (o.estado === "CANCELADA" || o.estado === "RECHAZADA") continue;
      cuentan++;
      mandadas += o.totalUnidades;
      recibidas += o.lineas.reduce((a, l) => a + l.recibida, 0);
      if (o.hayDiferencias) conDiferencia++;
    }
    return { mandadas, recibidas, conDiferencia, cuentan };
  }, [visibles]);

  return (
    <>
      <div className="rep-filtros">
        {(["TODO", "SEMANA", "MES", "RANGO"] as Filtro[]).map((f) => (
          <button
            key={f}
            type="button"
            className={filtro === f ? "activo" : undefined}
            onClick={() => setFiltro(f)}
          >
            {ETIQUETA_FILTRO[f]}
          </button>
        ))}
        {filtro === "RANGO" && (
          <span className="rep-rango">
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" />
            <span>a</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta" />
          </span>
        )}
      </div>

      {visibles.length > 0 && (
        <div className="rep-numeros">
          <div className="rep-num total">
            <span>Mandaste</span>
            <b>{resumen.mandadas} u.</b>
            <small>
              en {resumen.cuentan} {resumen.cuentan === 1 ? "envío" : "envíos"}
              {visibles.length > resumen.cuentan
                ? ` · ${visibles.length - resumen.cuentan} sin efecto`
                : ""}
            </small>
          </div>
          <div className="rep-num total">
            <span>Entraron a la góndola</span>
            <b>{resumen.recibidas} u.</b>
            <small>contadas en el local al recibir</small>
          </div>
          <div className={`rep-num ${resumen.conDiferencia > 0 ? "bajo" : "total"}`}>
            <span>Con diferencias</span>
            <b>{resumen.conDiferencia}</b>
            <small>
              {resumen.conDiferencia === 0
                ? "Entró todo lo que mandaste"
                : "Envíos donde no coincidió algo"}
            </small>
          </div>
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="vacio">
          {envios.length === 0
            ? "Todavía no mandaste ningún envío."
            : "No hay envíos en ese período."}
        </p>
      ) : (
        <ul className="rep-envios">
          {visibles.map((o) => (
            <li key={o.idOrden} className="rep-envio">
              <button
                className="rep-envio-cab"
                onClick={() => setAbierta(abierta === o.idOrden ? null : o.idOrden)}
              >
                <span>
                  <b>
                    {abierta === o.idOrden ? "▾" : "▸"} {fechaCorta(o.fecha)} · {o.totalUnidades}{" "}
                    unidades
                  </b>
                  <small>
                    {o.local}
                    {o.recibidaEl ? ` · recibida el ${fechaCorta(o.recibidaEl)}` : ""}
                    {o.recibidaPor ? ` por ${o.recibidaPor}` : ""}
                  </small>
                </span>
                <EstadoEnvio o={o} />
              </button>

              {abierta === o.idOrden && (
                <div className="rep-envio-det">
                  {o.motivoRechazo && <p className="rep-motivo">{o.motivoRechazo}</p>}
                  {o.lineas.length === 0 ? (
                    <p className="rep-nada">
                      Todavía no se recibió. Cuando la reciban en el local vas a ver acá producto por
                      producto lo que entró.
                    </p>
                  ) : (
                    <table className="rep-tabla">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th className="c">Mandaste</th>
                          <th className="c">Entró</th>
                          <th className="c">Diferencia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.lineas.map((l, i) => (
                          <tr key={i}>
                            <td>{l.producto}</td>
                            <td className="c mono">{l.solicitada}</td>
                            <td className="c mono">{l.recibida}</td>
                            <td className="c">
                              {l.diferencia === 0 ? (
                                <span className="tenue">—</span>
                              ) : l.diferencia < 0 ? (
                                <span className="rep-chip agotado">Faltan {Math.abs(l.diferencia)}</span>
                              ) : (
                                <span className="rep-chip bajo">Sobran {l.diferencia}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* Mientras no haya recepción se puede dar de baja. Una vez
                      que entró mercadería no: ya está en la góndola, y el
                      papel es lo único que explica de dónde salió. */}
                  {!o.recibidaEl && (o.estado === "PENDIENTE" || o.estado === "PROPUESTA") && (
                    <BajaEnvio idOrden={o.idOrden} />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Dar de baja un envío mandado.
 *
 * Dos pasos y no un `confirm()` del navegador: el cartel del navegador se
 * cierra sin leer y además no puede explicar POR QUÉ se puede ahora y no se va
 * a poder después. Acá el segundo paso dice qué pasa con la mercadería.
 *
 * Se ofrece en los dos lugares donde la marca se acuerda del envío: el aviso de
 * "ya tenés uno mandado" y la ficha en Mis envíos.
 */
function BajaEnvio({
  idOrden,
  compacto,
}: {
  idOrden: string;
  compacto?: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  function darDeBaja() {
    setError(null);
    empezar(async () => {
      const r = await cancelarEnvio(idOrden);
      if (r.error) {
        setConfirmando(false);
        return setError(r.error);
      }
      router.refresh();
    });
  }

  if (error) return <p className="rep-error">{error}</p>;

  // Compacto va dentro de una frase del aviso, así que el primer paso es un
  // span: un div ahí partiría el párrafo al medio.
  if (!confirmando) {
    const boton = (
      <button type="button" className="rep-baja-link" onClick={() => setConfirmando(true)}>
        Dar de baja este envío
      </button>
    );
    if (compacto) return boton;
    return (
      <div className="rep-baja">
        {boton}
        <small>Mientras no lo reciban en el local lo podés dar de baja y volver a armarlo.</small>
      </div>
    );
  }

  return (
    <div className={`rep-baja confirmar${compacto ? " compacto" : ""}`}>
      <p>
        Se da de baja el envío entero. Si ya lo despachaste, avisale al local antes de que llegue.
        Después lo volvés a armar desde <b>Lo que falta</b>, que vuelve a mostrarte todo.
      </p>
      <div className="rep-baja-botones">
        <button type="button" className="rep-baja-si" onClick={darDeBaja} disabled={pendiente}>
          {pendiente ? "Dando de baja…" : "Sí, darlo de baja"}
        </button>
        <button
          type="button"
          className="rep-baja-no"
          onClick={() => setConfirmando(false)}
          disabled={pendiente}
        >
          Dejarlo como está
        </button>
      </div>
    </div>
  );
}

function EstadoEnvio({ o }: { o: OrdenPortal }) {
  if (o.estado === "PROPUESTA") return <span className="rep-chip bajo">Esperando aprobación</span>;
  if (o.estado === "RECHAZADA") return <span className="rep-chip agotado">Rechazada</span>;
  // Sin este caso un envío dado de baja seguía diciendo "En camino", que es lo
  // contrario de lo que pasó.
  if (o.estado === "CANCELADA") return <span className="rep-chip neutro">Dado de baja</span>;
  if (!o.recibidaEl) return <span className="rep-chip camino">En camino</span>;
  return o.hayDiferencias ? (
    <span className="rep-chip bajo">Llegó con diferencias</span>
  ) : (
    <span className="rep-chip ok">Llegó completa</span>
  );
}

function Gondola({
  g,
  abierta,
  alternar,
  cantidad,
  tocar,
}: {
  g: GondolaReponer;
  abierta: boolean;
  alternar: () => void;
  cantidad: (id: string) => number;
  tocar: (id: string, n: number) => void;
}) {
  // Las góndolas que no necesitan nada se muestran igual, cerradas: sin ellas
  // la lista parece incompleta y no se ve que el sistema miró todo el
  // catálogo, no solo lo que falta.
  const hacenFalta = g.renglones.filter((r) => r.sugerido > 0).length;

  return (
    <section className="rep-gondola">
      <button className="rep-gon-cab" onClick={alternar}>
        <span className="rep-gon-nom">
          {abierta ? "▾" : "▸"} {g.nombre}
        </span>
        <span className="rep-gon-dato">
          {hacenFalta === 0
            ? `${g.renglones.length} productos, ninguno hace falta`
            : `${hacenFalta} de ${g.renglones.length} para reponer`}
        </span>
      </button>

      {abierta && (
        <table className="rep-tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="c">En góndola</th>
              <th className="c">Mín · Objetivo</th>
              <th className="c">Se vende</th>
              <th className="c">Mandar</th>
            </tr>
          </thead>
          <tbody>
            {g.renglones.map((r) => (
              <Fila key={r.idVariante} r={r} valor={cantidad(r.idVariante)} tocar={tocar} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Fila({
  r,
  valor,
  tocar,
}: {
  r: RenglonReponer;
  valor: number;
  tocar: (id: string, n: number) => void;
}) {
  return (
    <tr className={r.estado === "OK" && r.sugerido === 0 ? "ok" : undefined}>
      <td>
        <span className="rep-prod">
          {r.producto}
          {r.variante && r.variante !== "Único" && <span className="rep-var"> · {r.variante}</span>}
        </span>
        {r.estado === "AGOTADO" && <span className="rep-chip agotado">AGOTADO</span>}
        {r.estado === "BAJO" && <span className="rep-chip bajo">BAJO</span>}
        {r.enCamino > 0 && <span className="rep-chip camino">{r.enCamino} en camino</span>}
      </td>
      <td className={`c mono${r.estado === "AGOTADO" ? " rojo" : r.estado === "BAJO" ? " ambar" : ""}`}>
        {r.stock}
      </td>
      <td className="c mono tenue">
        {r.minimo} · {r.objetivo}
      </td>
      <td className="c tenue">{r.porSemana > 0 ? `${r.porSemana} / sem` : "—"}</td>
      <td className="c">
        <div className="rep-cant">
          <button type="button" onClick={() => tocar(r.idVariante, valor - 1)} aria-label="Menos">
            −
          </button>
          <input
            type="number"
            min="0"
            value={valor}
            onChange={(e) => tocar(r.idVariante, Number(e.target.value))}
            aria-label={`Cuántas unidades de ${r.producto}`}
          />
          <button type="button" onClick={() => tocar(r.idVariante, valor + 1)} aria-label="Más">
            +
          </button>
        </div>
      </td>
    </tr>
  );
}
