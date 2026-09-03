"use client";

import { useEffect, useRef } from "react";
import type { ResumenPortal, VentaDelDia, OrdenPortal, PagoPortal, LiquidacionPortal } from "@/app/portal/actions";

// Tablero del portal de marcas.
//
// Es un componente de cliente por una sola razón: las animaciones de entrada.
// Todos los datos ya vienen calculados del servidor — acá no se consulta nada
// ni se decide qué puede ver la marca, eso se resolvió antes.

function pesos(v: number) {
  return v.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function fechaCorta(iso: string | null) {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function nombreMes(iso: string) {
  return MESES[Number(iso.slice(5, 7)) - 1] ?? "";
}

/**
 * Gráfico de ventas del mes: área con la serie de este mes y una línea
 * punteada con la del anterior, de referencia.
 *
 * Se dibuja a mano en SVG en vez de traer una librería de gráficos: son dos
 * series y así el bundle no crece ni un kilobyte.
 */
function GraficoMes({ serie, serieAnterior }: { serie: number[]; serieAnterior: number[] }) {
  const ANCHO = 480;
  const ALTO = 150;
  const maximo = Math.max(1, ...serie, ...serieAnterior);

  function puntos(datos: number[]) {
    if (datos.length === 0) return "";
    // Acumulado: lo que importa es cómo viene creciendo el mes, no el ruido
    // diario. Es también lo que hace legible la comparación entre meses.
    let suma = 0;
    const acumulado = datos.map((d) => (suma += d));
    const tope = Math.max(1, acumulado[acumulado.length - 1], serieAnterior.reduce((a, b) => a + b, 0));
    const paso = datos.length > 1 ? ANCHO / (datos.length - 1) : ANCHO;
    return acumulado
      .map((v, i) => `${(i * paso).toFixed(1)},${(ALTO - 18 - (v / tope) * (ALTO - 34)).toFixed(1)}`)
      .join(" L");
  }

  const camino = puntos(serie);
  const caminoPrevio = puntos(serieAnterior);
  if (!camino) return <p className="vacio">Todavía no hay ventas este mes.</p>;

  const ultimo = camino.split(" L").pop()!.split(",");

  return (
    <>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} width="100%" height={ALTO} role="img" aria-label="Ventas acumuladas del mes">
        <defs>
          <linearGradient id="g-area-portal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a8b49a" stopOpacity=".55" />
            <stop offset="100%" stopColor="#a8b49a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {caminoPrevio && (
          <path d={`M${caminoPrevio}`} fill="none" stroke="#d2d9c8" strokeWidth="1.5" strokeDasharray="3 4" />
        )}
        <path className="area-mes" d={`M${camino} L${ANCHO},${ALTO} L0,${ALTO} Z`} fill="url(#g-area-portal)" />
        <path
          className="linea-mes"
          d={`M${camino}`}
          fill="none"
          stroke="#6d8058"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle className="punta-mes" cx={ultimo[0]} cy={ultimo[1]} r="4.5" fill="#6d8058" />
        <circle className="punta-mes" cx={ultimo[0]} cy={ultimo[1]} r="9.5" fill="#6d8058" opacity=".18" />
      </svg>
      <div className="leyenda">
        <span><i className="llave" style={{ background: "#6d8058" }} /> Este mes</span>
        <span><i className="llave" style={{ background: "#d2d9c8" }} /> Mes anterior</span>
      </div>
    </>
  );
}

function Donut({ porcentaje }: { porcentaje: number }) {
  const CIRC = 301; // 2·π·48
  const trozo = Math.max(0, Math.min(100, porcentaje)) * (CIRC / 100);
  return (
    <svg viewBox="0 0 120 120" width="122" height="122" role="img" aria-label="Medios de pago">
      <circle cx="60" cy="60" r="48" fill="none" stroke="#eef1ea" strokeWidth="16" />
      <circle
        className="arco"
        cx="60" cy="60" r="48" fill="none" stroke="#6d8058" strokeWidth="16"
        strokeDasharray={`${trozo.toFixed(1)} ${CIRC}`}
        strokeLinecap="round" transform="rotate(-90 60 60)"
      />
      <text x="60" y="63" textAnchor="middle" fill="#2a2f26" fontSize="19" fontWeight="600">
        {Math.round(porcentaje)}%
      </text>
    </svg>
  );
}

export default function PortalTablero({
  resumen,
  ventasHoy,
  ordenes,
  pagos,
  liquidaciones,
  puedeVerMas,
}: {
  resumen: ResumenPortal;
  ventasHoy: VentaDelDia[];
  ordenes: OrdenPortal[];
  pagos: { pagos: PagoPortal[]; total: number };
  liquidaciones: LiquidacionPortal[];
  puedeVerMas: boolean;
}) {
  const raiz = useRef<HTMLDivElement>(null);

  // Cada bloque arranca su animación cuando entra en pantalla, no todos al
  // cargar: así, mientras se baja, siempre hay algo construyéndose.
  useEffect(() => {
    const nodo = raiz.current;
    if (!nodo) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    nodo.classList.add("js-anim");

    const linea = nodo.querySelector<SVGPathElement>(".linea-mes");
    let largo = 0;
    if (linea && typeof linea.getTotalLength === "function") {
      largo = linea.getTotalLength();
      linea.style.strokeDasharray = String(largo);
      linea.style.strokeDashoffset = String(largo);
    }

    const arcos = Array.from(nodo.querySelectorAll<SVGCircleElement>(".arco"));
    const dashFinal = new Map<SVGCircleElement, string>();
    arcos.forEach((c) => {
      const d = c.getAttribute("stroke-dasharray") ?? "";
      dashFinal.set(c, d);
      c.setAttribute("stroke-dasharray", `0 ${d.split(" ")[1] ?? "301"}`);
    });

    const HIJOS = ".nov, .venta, .pago, .orden, .liq li";
    const obs = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((e) => {
          if (!e.isIntersecting) return;
          const b = e.target as HTMLElement;
          b.classList.add("en-vista");

          b.querySelectorAll<HTMLElement>(HIJOS).forEach((h, i) => {
            h.style.transitionDelay = `${i * 70}ms`;
          });
          const l = b.querySelector<SVGPathElement>(".linea-mes");
          if (l) l.style.strokeDashoffset = "0";
          b.querySelectorAll<SVGCircleElement>(".arco").forEach((c, i) => {
            setTimeout(() => c.setAttribute("stroke-dasharray", dashFinal.get(c) ?? ""), 120 + i * 260);
          });

          obs.unobserve(b);
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -40px 0px" }
    );

    nodo.querySelectorAll(".novedades, .hero, .kpi, .modulo, .upsell").forEach((b) => obs.observe(b));
    return () => obs.disconnect();
  }, []);

  const variacion =
    resumen.mesAnteriorBruto > 0
      ? ((resumen.mes.bruto - resumen.mesAnteriorBruto) / resumen.mesAnteriorBruto) * 100
      : null;
  const principal = resumen.porMedioPago[0];
  const totalHoy = ventasHoy.filter((v) => !v.anulada).reduce((a, v) => a + v.monto, 0);

  return (
    <div className="portal-lienzo" ref={raiz}>
      {/* ===== HERO ===== */}
      <section className="hero">
        <div>
          <p className="rotulo">Vendido en {nombreMes(resumen.hastaISO)}</p>
          <p className="cifra-xl mono">${pesos(resumen.mes.bruto)}</p>
          {variacion !== null && (
            <span className={`delta ${variacion >= 0 ? "sube" : "baja"}`}>
              {variacion >= 0 ? "↑" : "↓"} {Math.abs(variacion).toFixed(1)}% vs. el mes pasado
            </span>
          )}
          <p className="pie" style={{ color: "var(--texto-3)" }}>
            {resumen.mes.unidades} unidades · {resumen.mes.operaciones} pedidos
          </p>
          <p className="pie" style={{ fontSize: 12, color: "var(--texto-3)" }}>
            “Vendido” es el precio final que pagó el cliente, con IVA incluido — la base sobre la que se calcula
            la comisión.
          </p>
        </div>
        <div>
          <GraficoMes serie={resumen.serieMes} serieAnterior={resumen.serieMesAnterior} />
        </div>
      </section>

      {/* ===== KPIs ===== */}
      <section className="kpis">
        <div className="kpi destacado">
          <p className="et">Te queda a cobrar</p>
          <p className="cifra mono">${pesos(resumen.mes.neto)}</p>
          <p className="sub">Después de ${pesos(resumen.mes.royalty)} de comisión</p>
        </div>
        <div className="kpi">
          <p className="et">Vendido hoy</p>
          <p className="cifra mono">${pesos(resumen.hoy.bruto)}</p>
          <p className="sub">
            {resumen.hoy.operaciones} pedido{resumen.hoy.operaciones === 1 ? "" : "s"} · {resumen.hoy.unidades} unidades
          </p>
        </div>
        <div className="kpi">
          <p className="et">Ticket promedio</p>
          <p className="cifra mono">${pesos(resumen.ticketPromedio)}</p>
          <p className="sub">{resumen.mes.operaciones} pedidos en el mes</p>
        </div>
        <div className="kpi">
          <p className="et">Unidades vendidas</p>
          <p className="cifra mono">{resumen.mes.unidades}</p>
          <p className="sub">en el mes</p>
        </div>
      </section>

      {/* ===== VENTAS DE HOY ===== */}
      <section className="modulo">
        <div className="ventas-cab">
          <div>
            <h2>Ventas de hoy</h2>
            <p className="desc">Se actualiza sola con cada venta</p>
          </div>
          <span className="ventas-total">
            {ventasHoy.filter((v) => !v.anulada).length} movimientos · <b className="mono">${pesos(totalHoy)}</b>
          </span>
        </div>

        {ventasHoy.length === 0 ? (
          <p className="vacio">Todavía no se vendió nada tuyo hoy.</p>
        ) : (
          <>
            {ventasHoy.map((v, i) => (
              <div key={i} className={`venta${v.anulada ? " anulada" : ""}`} style={i === 0 ? { borderTop: 0, paddingTop: 0 } : undefined}>
                <span className="hora mono">{v.hora}</span>
                <span>
                  <span className="prod">{v.producto}</span>
                  <span className="cant">
                    {" "}· {v.cantidad} × ${pesos(v.precioUnitario)}
                    {v.anulada ? " — anulada" : ""}
                  </span>
                </span>
                <span className="medio">{v.medio}</span>
                <span className="imp mono">${pesos(v.monto)}</span>
              </div>
            ))}
            <p className="aviso-privacidad">
              Se muestran solo tus productos. Si el cliente se llevó además algo de otra marca, eso no aparece acá.
              Las ventas anuladas quedan a la vista, tachadas, y no suman al total.
            </p>
          </>
        )}
      </section>

      <div className="fila-2">
        {/* ===== MEDIOS DE PAGO ===== */}
        <section className="modulo">
          <div className="modulo-cab">
            <h2>Cómo te pagan</h2>
            <p className="desc">Sobre lo vendido este mes</p>
          </div>
          {resumen.porMedioPago.length === 0 ? (
            <p className="vacio">Todavía no hay ventas este mes.</p>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
              <Donut porcentaje={principal?.porcentaje ?? 0} />
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 12, flex: 1, minWidth: 160 }}>
                {resumen.porMedioPago.map((m, i) => (
                  <li key={m.medio} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <i className="llave" style={{ background: i === 0 ? "#6d8058" : i === 1 ? "#a8b49a" : "#eef1ea" }} />
                      {m.medio}
                    </span>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      ${pesos(m.monto)} · {m.porcentaje.toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ===== PAGOS A WIIGO ===== */}
        <section className="modulo">
          <div className="modulo-cab">
            <h2>Tus pagos a WiiGo</h2>
            <p className="desc">Fees, abonos y cargos de tu cuenta</p>
          </div>
          {pagos.pagos.length === 0 ? (
            <p className="vacio">No tenés pagos pendientes.</p>
          ) : (
            <>
              <ul className="pagos">
                {pagos.pagos.map((p, i) => (
                  <li key={i} className={`pago${p.vencido ? " vencido" : ""}`}>
                    <span className="fecha">
                      <span className="d">{p.fecha ? p.fecha.slice(8, 10) : "—"}</span>
                      <span className="m">{p.fecha ? nombreMes(p.fecha) : ""}</span>
                    </span>
                    <span>
                      <span className="t">{p.concepto}</span>
                      <span className="d2">{p.vencido ? "Vencido" : "A vencer"}</span>
                    </span>
                    <span className="imp mono">${pesos(p.importe)}</span>
                  </li>
                ))}
              </ul>
              <div className="total-pagos">
                <span className="l">Total</span>
                <span className="v mono">${pesos(pagos.total)}</span>
              </div>
            </>
          )}
        </section>
      </div>

      {/* ===== REPOSICIÓN ===== */}
      <section className="modulo">
        <div className="modulo-cab">
          <h2>Reposición y recepciones</h2>
          <p className="desc">Lo que se te pidió y lo que se recibió en el local</p>
        </div>
        {ordenes.length === 0 ? (
          <p className="vacio">Todavía no hay órdenes de reposición.</p>
        ) : (
          <ul className="ordenes">
            {ordenes.map((o) => (
              <li key={o.idOrden} className="orden">
                <div className="orden-cab">
                  <span>
                    <span className="n">Orden del {fechaCorta(o.fecha)} · {o.local}</span>
                    <span className="d">
                      {o.totalUnidades} unidades
                      {o.recibidaEl ? ` · recibida el ${fechaCorta(o.recibidaEl)}` : ""}
                      {o.recibidaPor ? ` por ${o.recibidaPor}` : ""}
                    </span>
                  </span>
                  {o.recibidaEl ? (
                    <span className={`pill ${o.hayDiferencias ? "critico" : "ok"}`}>
                      {o.hayDiferencias ? "Llegó con diferencias" : "Llegó completa"}
                    </span>
                  ) : (
                    <span className="pill aviso">Pendiente de envío</span>
                  )}
                </div>
                {o.lineas.length > 0 && (
                  <div className="orden-detalle">
                    <div className="encabezado-item">
                      <span>Producto</span><span>Pedido</span><span>Recibido</span><span>Estado</span>
                    </div>
                    {o.lineas.map((l, i) => (
                      <div key={i} className="linea-item">
                        <span className="p">{l.producto}</span>
                        <span className="c mono">{l.solicitada}</span>
                        <span className="c mono">{l.recibida}</span>
                        <span className="r">
                          {l.diferencia === 0 ? (
                            <span className="pill ok">Completo</span>
                          ) : l.diferencia < 0 ? (
                            <span className="pill critico">Faltan {Math.abs(l.diferencia)}</span>
                          ) : (
                            <span className="pill aviso">Sobran {l.diferencia}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== LIQUIDACIONES ===== */}
      <section className="modulo">
        <div className="modulo-cab">
          <h2>Tus liquidaciones</h2>
          <p className="desc">Lo cobrado y lo que viene</p>
        </div>
        <ul className="liq">
          <li>
            <span className="dot pend" />
            <span>
              <span className="t">Mes en curso</span>
              <span className="d">Provisorio: cambia con cada venta hasta que se cierre</span>
            </span>
            <span className="m mono" style={{ color: "var(--ocre)" }}>${pesos(resumen.mes.neto)}</span>
          </li>
          {liquidaciones.map((l, i) => (
            <li key={i}>
              <span className={`dot ${l.estado === "PAGADA" ? "ok" : "pend"}`} />
              <span>
                <span className="t">{fechaCorta(l.periodo.split(" al ")[0])} al {fechaCorta(l.periodo.split(" al ")[1])}</span>
                <span className="d">
                  {l.estado === "PAGADA" ? `Pagada el ${fechaCorta(l.fechaPago)}` : "Cerrada, pendiente de pago"}
                </span>
              </span>
              <span className="m mono">${pesos(l.neto)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ===== UPSELL ===== */}
      {!puedeVerMas && (
        <section className="upsell">
          <h2>Con el plan Metal ves más</h2>
          <p>
            Qué hacer cada semana, el ranking de tus productos, cuáles dejaron de rotar y el aviso cuando algo
            está por agotarse — antes de quedarte sin stock en góndola.
          </p>
          <div className="items">
            <span>Para hacer esta semana</span>
            <span>Ranking de productos</span>
            <span>Alertas de stock</span>
            <span>Objetivo del mes</span>
          </div>
        </section>
      )}
    </div>
  );
}
