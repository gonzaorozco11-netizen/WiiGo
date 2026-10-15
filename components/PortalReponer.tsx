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
import { urlFotoDiferenciaMarca, type OrdenPortal } from "@/app/portal/actions";
import { finalDelRenglon, motivo } from "@/lib/recepcionDiferencias";

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
  // RECO y AMANO son dos vistas del MISMO envío, no dos envíos. Comparten el
  // carrito, el total y el botón: con dos pedidos separados la marca manda
  // dos cajas el mismo día al mismo local, y el local recibe dos órdenes de
  // la misma marca sin saber por qué.
  const [solapa, setSolapa] = useState<"RECO" | "AMANO" | "ENVIOS">("RECO");
  const [cantidades, setCantidades] = useState<Map<string, number>>(new Map());
  /**
   * El envío armado a mano, aparte del de la sugerencia.
   *
   * No comparten carrito y no es un detalle: Recomendado precarga la
   * sugerencia en los 116 agotados, así que con un carrito común "quiero
   * mandar 3 productos" mandaba 580 unidades. Son dos borradores; se manda el
   * de la solapa en la que estás.
   */
  const [manual, setManual] = useState<Map<string, number>>(new Map());
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

  /** Cada renglón por su id, para mirar stock, tope y precio desde cualquier lado. */
  const porId = useMemo(() => {
    const m = new Map<string, RenglonReponer & { gondola: string }>();
    for (const g of datos.gondolas)
      for (const r of g.renglones) m.set(r.idVariante, { ...r, gondola: g.nombre });
    return m;
  }, [datos]);

  function tocarManual(id: string, n: number) {
    setListo(null);
    setManual((previo) => new Map(previo).set(id, Math.max(0, Math.round(n) || 0)));
  }

  const recoAMandar = useMemo(() => {
    const items: { idVariante: string; cantidad: number }[] = [];
    for (const g of datos.gondolas)
      for (const r of g.renglones) {
        const n = cantidad(r.idVariante);
        if (n > 0) items.push({ idVariante: r.idVariante, cantidad: n });
      }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, cantidades]);

  const manualAMandar = useMemo(
    () =>
      [...manual.entries()]
        .filter(([, n]) => n > 0)
        .map(([idVariante, cantidad]) => ({ idVariante, cantidad })),
    [manual]
  );

  // Se manda el borrador de la solapa en la que estás, y el botón lo dice.
  const aMandar = solapa === "AMANO" ? manualAMandar : recoAMandar;
  const unidades = aMandar.reduce((a, i) => a + i.cantidad, 0);
  const valorizado = aMandar.reduce(
    (a, i) => a + i.cantidad * (porId.get(i.idVariante)?.precio ?? 0),
    0
  );

  // Cuántas se pasan del tope. Decirlo ANTES de mandar evita la sorpresa de
  // que la orden quede esperando sin que la marca entienda por qué.
  const sobreTope = useMemo(() => {
    let n = 0;
    for (const i of aMandar) {
      const r = porId.get(i.idVariante);
      if (r && r.stock + r.enCamino + i.cantidad > r.tope) n += i.cantidad;
    }
    return n;
  }, [aMandar, porId]);

  function mandar() {
    setError(null);
    const enviar = aMandar;
    const desdeManual = solapa === "AMANO";
    empezar(async () => {
      const r = await mandarReposicion(enviar);
      if (r.error) return setError(r.error);
      setListo({ automatica: Boolean(r.automatica) });
      if (desdeManual) setManual(new Map());
      else setCantidades(new Map());
      router.refresh();
    });
  }

  return (
    <main className="portal-lienzo">
      <div className="rep-cab">
        <div>
          <h1 className="rep-titulo">
            {solapa === "RECO"
              ? "Lo que tenés que reponer"
              : solapa === "AMANO"
                ? "Agregar a mano"
                : "Mis envíos"}
          </h1>
          <p className="rep-sub">
            {solapa === "RECO"
              ? "Se arma solo con lo que vas vendiendo. No hace falta que lo revises todos los días: cuando llegue el día de recepción, mandá lo que diga acá."
              : solapa === "AMANO"
                ? "Buscá cualquier producto tuyo y poné cuánto mandar. Sirve para lo que el sistema no te va a pedir: una promo, un sabor nuevo, algo que sabés que se va a vender esta semana."
                : "Lo que mandaste y lo que se recibió de verdad en el local, producto por producto."}
          </p>
        </div>
        {solapa !== "ENVIOS" && datos.proxima && (
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
          className={`cam-tab${solapa === "RECO" ? " activa" : ""}`}
          onClick={() => setSolapa("RECO")}
        >
          Recomendado
          {datos.agotados + datos.bajos > 0 && (
            <span className="cam-cont fuerte">{datos.agotados + datos.bajos}</span>
          )}
        </button>
        <button
          className={`cam-tab${solapa === "AMANO" ? " activa" : ""}`}
          onClick={() => setSolapa("AMANO")}
        >
          A mano
          {manualAMandar.length > 0 && <span className="cam-cont">{manualAMandar.length}</span>}
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

      {solapa !== "ENVIOS" && (
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

      {solapa === "RECO" && (
      <div className="rep-numeros">
        {/* La tarjeta se apaga cuando lo que falta ya viene en camino. Con el
            envío mandado la góndola sigue vacía, pero no hay nada que hacer:
            un número en rojo al lado de "0 para mandar" se contradice solo y
            enseña a desconfiar de la pantalla. */}
        <div className={`rep-num ${datos.agotados > datos.agotadosEnCamino ? "agotado" : "espera"}`}>
          <span>{sinHistoria ? "Sin stock en góndola" : "Agotados"}</span>
          <b>{datos.agotados}</b>
          {/* "Ya los mandaste" y no "ya vienen en camino" ni "despachados":
              lo único que el sistema sabe es que la marca apretó mandar. Si
              el repartidor salió o no, no lo sabe nadie acá — y "vienen en
              camino" además es decir dos veces lo mismo. */}
          <small>
            {datos.agotados === 0
              ? "Está todo en góndola"
              : datos.agotados === datos.agotadosEnCamino
                ? "Ya los mandaste a todos"
                : datos.agotadosEnCamino > 0
                  ? `${datos.agotadosEnCamino} ya los mandaste`
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
                ? "Ya los mandaste a todos"
                : datos.bajosEnCamino > 0
                  ? `${datos.bajosEnCamino} ya los mandaste`
                  : "No llegan a la próxima recepción"}
          </small>
        </div>
        <div className="rep-num total">
          <span>Este envío</span>
          <b>{unidades} u.</b>
          {/* Calculado con lo que hay puesto AHORA y no con el valorizado que
              trajo el servidor: ese es el de la sugerencia y se quedaba
              viejo apenas la marca tocaba una cantidad. */}
          <small>{pesos(valorizado)} a precio de venta</small>
        </div>
      </div>
      )}

      {solapa === "RECO" &&
        (datos.gondolas.length === 0 ? (
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
        ))}

      {solapa === "AMANO" && (
        <AMano porId={porId} manual={manual} tocarManual={tocarManual} />
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
                <p className="rep-nada">
                  {solapa === "AMANO"
                    ? "Todavía no agregaste nada."
                    : "No hay nada para mandar. Está todo al día."}
                </p>
              ) : (
                <>
                  <p className="rep-nota">
                    Mandás <b>{unidades} unidades</b> de {aMandar.length}{" "}
                    {aMandar.length === 1 ? "producto" : "productos"}
                    {valorizado > 0 && (
                      <span className="tenue"> · {pesos(valorizado)} a precio de venta</span>
                    )}
                  </p>
                  {sobreTope > 0 ? (
                    <p className="rep-nota ojo">
                      <b>
                        {unidades - sobreTope} de {unidades} unidades
                      </b>{" "}
                      entran solas. Las otras {sobreTope} se pasan del tope, así que{" "}
                      <b>el envío entero</b> espera aprobación.
                    </p>
                  ) : (
                    <p className="rep-nota">
                      ✅ Entran sin que esperes aprobación: ninguno se pasa del tope acordado.
                    </p>
                  )}
                </>
              )}
              {error && <p className="rep-error">{error}</p>}
            </div>
            {/* El botón dice QUÉ sale, no "mandar este envío": en A mano es
                lo que confirma que no se está yendo la lista entera. */}
            <button
              className="boton-portal"
              disabled={unidades === 0 || pendiente}
              onClick={mandar}
            >
              {pendiente
                ? "Mandando…"
                : solapa === "AMANO"
                  ? `Mandar ${aMandar.length} ${aMandar.length === 1 ? "producto" : "productos"}`
                  : "Mandar este envío"}
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
                          <th>En qué quedó</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.lineas.map((l, i) => (
                          <tr key={i}>
                            <td>{l.producto}</td>
                            <td className="c mono">{l.solicitada}</td>
                            <td className="c mono">{l.recibida}</td>
                            <td>
                              <Final l={l} />
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
 * En qué quedó un renglón, dicho entero.
 *
 * Antes la columna decía «Faltan 6» o «Sobran 4» y nada más, que es
 * exactamente lo que generaba la llamada:
 *
 *   «Faltan 6» se lee como «no lo mandaste». Y la marca tiene razón en
 *   discutirlo: lo mandó, estaba dañado y volvió con su propio repartidor el
 *   mismo día. Son dos cosas distintas y se veían igual.
 *
 *   «Sobran 4» no dice si esas 4 quedaron en consignación —y se liquidan
 *   cuando se vendan— o si las tiene que ir a buscar. Es su plata.
 *
 * Los casos los decide `finalDelRenglon`, que es la misma función que usa el
 * lado de adentro: si cada pantalla los dedujera sola, la que se olvide uno
 * muestra un guión donde tendría que decir algo.
 */
function Final({
  l,
}: {
  l: {
    solicitada: number;
    recibida: number;
    diferencia: number;
    motivoFaltante: string | null;
    resolucion: string | null;
    devueltoEl: string | null;
    idDetalleRecepcion: string | null;
    tieneFoto: boolean;
  };
}) {
  const final = finalDelRenglon({
    solicitada: l.solicitada,
    recibida: l.recibida,
    resolucion: l.resolucion,
  });

  const foto = l.tieneFoto && l.idDetalleRecepcion ? <VerFoto id={l.idDetalleRecepcion} /> : null;

  if (final === "COMPLETO") return <span className="rep-chip ok">Entró completo</span>;

  if (final === "FALTO") {
    const m = motivo(l.motivoFaltante);
    return (
      <>
        <span className="rep-chip agotado">Faltaron {l.solicitada - l.recibida}</span>
        {/* Tres cosas y no una: QUÉ pasó, DÓNDE quedó la mercadería y la
            prueba. Antes solo se mostraba la consecuencia —"volvieron con tu
            repartidor"— y el motivo que la operativa eligió de una lista no
            aparecía en ninguna pantalla de la marca: leía que su mercadería
            se había vuelto sin saber nunca por qué. */}
        {m ? (
          <>
            <b className="rep-final-motivo">{m.etiqueta}</b>
            <small className="rep-final-nota">{m.destino}</small>
          </>
        ) : (
          // Recepciones viejas, de antes de que se pudiera cargar el motivo:
          // se dice que no se sabe en vez de inventar una causa.
          <small className="rep-final-nota">
            No quedó anotado por qué. Si las mandaste, avisanos.
          </small>
        )}
        {foto}
      </>
    );
  }

  // De acá para abajo sobró. Las tres salidas son muy distintas para su plata.
  if (final === "SOBRO_SE_QUEDA") {
    return (
      <>
        <span className="rep-chip ok">Sobraron {l.diferencia} y se quedaron</span>
        <small className="rep-final-nota">
          Están en góndola en consignación. Se te liquidan cuando se vendan.
        </small>
        {foto}
      </>
    );
  }

  if (final === "SOBRO_A_DEVOLVER") {
    return (
      <>
        <span className="rep-chip bajo">Sobraron {l.diferencia}, a devolver</span>
        <small className="rep-final-nota">
          {l.devueltoEl
            ? `Ya se te entregaron el ${fechaCorta(l.devueltoEl)}.`
            : "Están apartadas para que las retires. Pedilas cuando pase tu repartidor."}
        </small>
        {foto}
      </>
    );
  }

  return (
    <>
      <span className="rep-chip bajo">Sobraron {l.diferencia}</span>
      <small className="rep-final-nota">
        Entraron a la góndola igual. WiiGo está decidiendo si se quedan o si las retirás.
      </small>
      {foto}
    </>
  );
}

/**
 * La prueba de lo que no cerró.
 *
 * «Faltó 1» es una afirmación; la foto de la caja aplastada es un hecho. Sin
 * esto la marca tiene que decidir si cree, y esa decisión termina en una
 * llamada.
 *
 * El link se pide al apretar y no al cargar la pantalla: el bucket es privado
 * y la URL firmada vence, así que una guardada de antemano llegaría muerta.
 * Y se manda el id del renglón, no el path — con el path, cualquiera que lo
 * viera en el HTML podría pedir la foto de otra marca.
 */
function VerFoto({ id }: { id: string }) {
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function abrir() {
    setError(null);
    setAbriendo(true);
    const r = await urlFotoDiferenciaMarca(id);
    setAbriendo(false);
    if (r.error || !r.url) return setError(r.error ?? "No se pudo abrir la foto.");
    window.open(r.url, "_blank", "noopener");
  }

  if (error) return <small className="rep-final-nota rojo">{error}</small>;

  return (
    <button type="button" className="rep-ver-foto" onClick={abrir} disabled={abriendo}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2 5.5h2.5l1-1.5h5l1 1.5H14v8H2z" />
        <circle cx="8" cy="9" r="2.4" />
      </svg>
      {abriendo ? "Abriendo…" : "Ver la foto"}
    </button>
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
        Después lo volvés a armar desde <b>Recomendado</b>, que vuelve a mostrarte todo.
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

type RenglonConGondola = RenglonReponer & { gondola: string };

/**
 * Armar un envío desde cero: buscar, agregar, mandar.
 *
 * Tres pasos y nada más. Arranca vacío y manda solo lo que se agregó acá —
 * la lista de Recomendado no se toca.
 *
 * Lo único que avisa es lo que la marca no puede saber sola: que de ese
 * producto ya mandó algo que todavía está en camino, y si con lo que está
 * por agregar se pasa del tope acordado. Todo lo demás —el mínimo, el
 * objetivo, la velocidad de venta— es para decidir CUÁNTO reponer, y para eso
 * está Recomendado: acá la marca ya sabe qué quiere mandar y viene a
 * buscarlo.
 */
function AMano({
  porId,
  manual,
  tocarManual,
}: {
  porId: Map<string, RenglonConGondola>;
  manual: Map<string, number>;
  tocarManual: (id: string, n: number) => void;
}) {
  const [busca, setBusca] = useState("");

  const q = busca.trim().toLowerCase();
  // Busca TODO, pida o no la sugerencia.
  //
  // Primero esto escondía lo que ya estaba en Recomendado, para que no se
  // pudiera mandar dos veces. Esa regla funciona con un Recomendado de tres o
  // cuatro productos y se rompe sola con uno de 116: buscar "prote" devolvía
  // un resultado de cuarenta y cuatro, y armar un envío chico a mano —que es
  // justo para lo que existe esta solapa— se volvía imposible.
  //
  // El doble envío se evita avisando, no escondiendo: cada producto que ya
  // está en Recomendado lo dice en su propia fila, con la cantidad.
  const coinciden = q
    ? [...porId.values()].filter((r) =>
        `${r.producto} ${r.variante} ${r.gondola}`.toLowerCase().includes(q)
      )
    : [];

  const puestos = [...manual.entries()]
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ r: porId.get(id), n }))
    .filter((x): x is { r: RenglonConGondola; n: number } => Boolean(x.r));
  const unidades = puestos.reduce((a, x) => a + x.n, 0);

  return (
    <>
      <div className="rep-buscar">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="7" cy="7" r="4.6" />
          <path d="M10.4 10.4 14 14" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar un producto tuyo…"
          aria-label="Buscar un producto tuyo"
        />
      </div>

      {q !== "" && (
        <section className="rep-bloque">
          <p className="rep-bloque-cab">
            <span>
              {coinciden.length === 0
                ? "Ninguno con ese nombre"
                : `${coinciden.length} ${coinciden.length === 1 ? "producto" : "productos"}`}
            </span>
          </p>
          {coinciden.length > 0 ? (
            <ul className="rep-lista">
              {coinciden.map((r) => (
                <ItemAMano
                  key={r.idVariante}
                  r={r}
                  n={manual.get(r.idVariante) ?? 0}
                  tocar={tocarManual}
                />
              ))}
            </ul>
          ) : (
            <p className="rep-yaesta">No encontramos ningún producto tuyo con ese nombre.</p>
          )}
        </section>
      )}

      {puestos.length === 0 ? (
        q === "" && (
          <p className="vacio">
            Buscá cualquier producto tuyo y poné cuántas unidades mandar. Este envío sale solo con lo
            que agregues acá — la lista de Recomendado no se toca.
          </p>
        )
      ) : (
        <section className="rep-bloque envio">
          <p className="rep-bloque-cab">
            <span>Tu envío a mano</span>
            <span>
              {puestos.length} {puestos.length === 1 ? "producto" : "productos"} · {unidades} unidades
            </span>
          </p>
          <ul className="rep-lista">
            {puestos.map(({ r, n }) => (
              <ItemAMano key={r.idVariante} r={r} n={n} tocar={tocarManual} conQuitar />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Un producto en la lista de a mano, con su contador.
 *
 * El aviso del tope cuenta LO QUE YA VA EN CAMINO, no solo el tope: el número
 * acordado en abstracto no le dice nada a nadie, "de este ya mandaste 6" sí.
 * Es justamente el dato que la marca no tiene forma de recordar una semana
 * después de haberlo mandado.
 *
 * Avisa, no traba. La marca puede tener una razón que el sistema no conoce —un
 * fin de semana largo, una promo—; lo que tiene que pasar es que sepa la
 * consecuencia antes, no que no pueda.
 */
function ItemAMano({
  r,
  n,
  tocar,
  conQuitar = false,
}: {
  r: RenglonConGondola;
  n: number;
  tocar: (id: string, cantidad: number) => void;
  conQuitar?: boolean;
}) {
  const sinObjetivo = r.minimo === 0 && r.objetivo === 0;
  const seLePasa = n > 0 && r.stock + r.enCamino + n > r.tope;

  return (
    <>
      <li className={seLePasa ? "conaviso" : undefined}>
        <span className="nom">
          {r.producto}
          {r.variante && r.variante !== "Único" && ` · ${r.variante}`}
          {/* Dos datos y no cinco: de qué góndola es y cuánto hay. El mínimo,
              el objetivo y la velocidad son para decidir CUÁNTO reponer, y
              para eso está Recomendado — acá la marca ya sabe qué quiere
              mandar y viene a buscarlo. */}
          <small>
            {r.gondola} · {r.stock} en góndola
          </small>
          {sinObjetivo && <span className="rep-chip neutro">sin objetivo cargado</span>}
          {/* Lo ÚNICO que la marca no puede recordar sola: que de ese
              producto ya mandó algo y todavía no llegó. Lo que esté en el
              otro borrador no se avisa acá — todavía no salió de su casa, y
              un chip más por fila sobre 44 resultados es ruido. */}
          {r.enCamino > 0 && <span className="rep-chip camino">{r.enCamino} en camino</span>}
        </span>
        <div className={`rep-cant${seLePasa ? " ojo" : n > 0 ? " puesto" : ""}`}>
          <button type="button" onClick={() => tocar(r.idVariante, n - 1)} aria-label="Menos">
            −
          </button>
          <input
            type="number"
            min="0"
            value={n}
            onChange={(e) => tocar(r.idVariante, Number(e.target.value))}
            aria-label={`Cuántas unidades de ${r.producto}`}
          />
          <button type="button" onClick={() => tocar(r.idVariante, n + 1)} aria-label="Más">
            +
          </button>
        </div>
        {conQuitar && (
          <button type="button" className="rep-quitar" onClick={() => tocar(r.idVariante, 0)}>
            Quitar
          </button>
        )}
      </li>
      {seLePasa && (
        <li className="rep-aviso-item">
          <p>
            {r.enCamino > 0 ? (
              <>
                <b>De este ya mandaste {r.enCamino} que están en camino</b>
                {r.stock > 0 ? `, y hay ${r.stock} en góndola` : ""}. Con {n} más
              </>
            ) : (
              <>
                Hay {r.stock} en góndola. Con {n} más
              </>
            )}{" "}
            serían <b>{r.stock + r.enCamino + n}</b>, y el tope acordado es <b>{r.tope}</b>. Se puede
            mandar igual, pero <b>el envío entero</b> queda esperando que WiiGo lo apruebe.
          </p>
        </li>
      )}
    </>
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
              <Fila
                key={r.idVariante}
                r={r}
                valor={cantidad(r.idVariante)}
                tocar={tocar}
                // También acá: sin objetivo la fila se ve igual a una que
                // está al día, cuando en realidad el sistema no tiene con
                // qué calcularla y nunca la va a pedir.
                sinObjetivo={r.minimo === 0 && r.objetivo === 0}
              />
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
  sinObjetivo = false,
}: {
  r: RenglonReponer;
  valor: number;
  tocar: (id: string, n: number) => void;
  sinObjetivo?: boolean;
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
        {sinObjetivo && <span className="rep-chip neutro">SIN OBJETIVO</span>}
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
