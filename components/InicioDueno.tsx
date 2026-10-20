import Link from "next/link";
import type { InicioDueno as Datos } from "@/lib/inicioDueno";
import type { KpiTablero } from "@/lib/tablero";

// El negocio de un vistazo en el inicio del Dueño. Misma lectura que el
// portal de cada marca, pero del local entero: el mes con su proyección, los
// números del día, las ventas por día, por hora y por día de la semana, las
// marcas y los productos que más facturan.
//
// Los gráficos son SVG armados en el servidor: no hay nada que tocar, y así
// no suman JavaScript al navegador.

const AZUL = "#2563eb";
const GRIS = "#9aa0ab";
const LINEA = "#e5e7eb";
// Un color por marca, en el orden de la tabla (la que más vende, primero).
const COLORES = ["#2563eb", "#8f9a6e", "#e08a2c", "#b0478f", "#1f9a8a", "#6b7280", "#c2410c", "#4f46e5"];
const INICIAL_DIA = ["", "L", "M", "M", "J", "V", "S", "D"];
const NOMBRE_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
function corto(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return pesos(v);
}
/** Un paso de eje "redondo" (100k, 200k, 500k, 1M...) para unas 4 líneas. */
function pasoEje(max: number) {
  const crudo = max / 4;
  const pot = 10 ** Math.floor(Math.log10(Math.max(crudo, 1)));
  return [1, 2, 2.5, 5, 10].map((f) => f * pot).find((p) => p >= crudo) ?? pot * 10;
}

const tarjeta = "bg-white border border-neutral-200 rounded-xl";
const eyebrow = "text-[10.5px] font-bold uppercase tracking-wider text-neutral-400";

export default function InicioDueno({ datos, turno }: { datos: Datos; turno: KpiTablero | undefined }) {
  const colorDe = new Map(datos.marcas.map((m, i) => [m.idMarca, COLORES[i % COLORES.length]]));
  const variacionMes =
    datos.vendidoMesAnteriorTramo > 0 ? Math.round((datos.vendidoMes / datos.vendidoMesAnteriorTramo - 1) * 100) : null;

  return (
    <div className="space-y-4">
      {/* ---------- El mes ---------- */}
      <section className={`${tarjeta} p-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-end`}>
        <div>
          <p className={eyebrow}>Vendido en {datos.mesNombre}</p>
          <p className="tipo-titulo text-4xl md:text-[44px] font-bold tabular-nums leading-none mt-2 mb-3 text-neutral-900">
            {pesos(datos.vendidoMes)}
          </p>
          {datos.proyeccion !== null ? (
            <p className="text-sm text-neutral-500">
              Al ritmo actual cerrás el mes en{" "}
              <b className="text-neutral-900 tabular-nums">{pesos(datos.proyeccion)}</b>
            </p>
          ) : (
            <p className="text-sm text-neutral-500">La proyección del mes aparece a partir del día 5.</p>
          )}
          {variacionMes !== null && (
            <p className="text-sm text-neutral-500 mt-1">
              <span
                className={`inline-block text-xs font-bold rounded-full px-2 py-0.5 mr-1 ${
                  variacionMes >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}
              >
                {variacionMes >= 0 ? "+" : ""}
                {variacionMes}%
              </span>
              contra los primeros {datos.diaDeHoy} días de {datos.mesAnteriorNombre}
            </p>
          )}
          <div className="flex gap-4 text-xs text-neutral-500 mt-2">
            <span className="flex items-center gap-1.5">
              <i className="inline-block w-2.5 h-[3px] rounded" style={{ background: AZUL }} />
              {cap(datos.mesNombre)}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block w-2.5 h-[3px] rounded" style={{ background: GRIS }} />
              {cap(datos.mesAnteriorNombre)}
            </span>
          </div>
        </div>
        <CurvaMes datos={datos} />
      </section>

      {/* ---------- Números ---------- */}
      <section className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        <Kpi etiqueta="Vendido hoy" valor={pesos(datos.hoy.vendido)} pie={`${datos.hoy.tickets} ${datos.hoy.tickets === 1 ? "ticket" : "tickets"} hasta ahora`} />
        <Kpi etiqueta="Ticket promedio" valor={datos.ticketsMes ? pesos(datos.ticketPromedio) : "—"} pie={`en ${datos.mesNombre}`} />
        <Kpi etiqueta="Unidades" valor={datos.unidadesMes.toLocaleString("es-AR")} pie={`vendidas en ${datos.mesNombre}`} />
        <Kpi etiqueta="Comisión de marcas" valor={pesos(datos.comisionMarcas)} pie="lo que gana WiiGo en el mes" />
        <div className={`${tarjeta} p-3.5`}>
          <p className={eyebrow}>Cómo pagan</p>
          <p className="text-xl font-bold mt-0.5 tabular-nums text-neutral-900">
            {datos.parteEfectivo === null ? "—" : `${Math.round(datos.parteEfectivo * 100)}%`}
          </p>
          <p className="text-[11.5px] text-neutral-400">en efectivo, el resto QR</p>
          {datos.parteEfectivo !== null && (
            <div className="flex h-1.5 rounded-full overflow-hidden mt-2 bg-neutral-100">
              <span style={{ width: `${datos.parteEfectivo * 100}%`, background: "#0f7a4a" }} />
              <span style={{ width: `${(1 - datos.parteEfectivo) * 100}%`, background: AZUL }} />
            </div>
          )}
        </div>
        {turno ? (
          <Kpi etiqueta={turno.etiqueta} valor={turno.valor} pie={turno.pie} tono={turno.tono} />
        ) : (
          <Kpi etiqueta="Tickets" valor={String(datos.ticketsMes)} pie={`en ${datos.mesNombre}`} />
        )}
      </section>

      {/* ---------- Ventas por día ---------- */}
      <section className={`${tarjeta} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <h2 className="font-semibold text-neutral-900">Ventas por día</h2>
            <p className="text-xs text-neutral-500">
              {cap(datos.mesNombre)}, día por día.{datos.promedioDiario !== null && " La línea punteada es el promedio diario."}
            </p>
          </div>
          {datos.mejorDia && (
            <p className="text-xs text-neutral-500">
              Mejor día:{" "}
              <b className="text-neutral-900 tabular-nums">
                {NOMBRE_DIA[datos.mejorDia.diaSemana]} {datos.mejorDia.dia}, {pesos(datos.mejorDia.vendido)}
              </b>
            </p>
          )}
        </div>
        <BarrasDias datos={datos} />
      </section>

      {/* ---------- Horas y días de la semana ---------- */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className={`${tarjeta} p-5`}>
          <h2 className="font-semibold text-neutral-900">A qué hora se vende</h2>
          <p className="text-xs text-neutral-500 mb-3">Ventas por hora, últimas 8 semanas</p>
          <Barras
            datos={datos.porHora.map((h) => ({ etiqueta: String(h.hora), valor: h.vendido }))}
            resaltar={datos.horaPico === null ? null : String(datos.horaPico)}
            nombre="Ventas por hora del día"
          />
          <p className="text-xs text-neutral-500 mt-2">
            {datos.horaPico === null ? (
              "Todavía no hay ventas para mostrar."
            ) : (
              <>
                Tu pico es a las <b className="text-neutral-900">{datos.horaPico} h</b>. Antes de esa hora conviene
                tener la góndola repuesta y la caja con cambio.
              </>
            )}
          </p>
        </div>
        <div className={`${tarjeta} p-5`}>
          <h2 className="font-semibold text-neutral-900">Qué día se vende</h2>
          <p className="text-xs text-neutral-500 mb-3">Ventas por día de la semana, últimas 8 semanas</p>
          <Barras
            datos={datos.porDiaSemana.map((d) => ({ etiqueta: d.etiqueta, valor: d.vendido }))}
            resaltar={datos.diaSemanaPico}
            nombre="Ventas por día de la semana"
          />
          <p className="text-xs text-neutral-500 mt-2">
            {datos.diaSemanaPico === null ? (
              "Todavía no hay ventas para mostrar."
            ) : (
              <>
                Tu mejor día es el <b className="text-neutral-900">{nombreCompleto(datos.diaSemanaPico)}</b>.
              </>
            )}
          </p>
        </div>
      </section>

      {/* ---------- Ventas por marca ---------- */}
      <section className={`${tarjeta} p-5`}>
        <h2 className="font-semibold text-neutral-900">Ventas por marca</h2>
        <p className="text-xs text-neutral-500 mb-3">
          {cap(datos.mesNombre)} hasta hoy. Tocá &ldquo;Ver&rdquo; para abrir la situación de la marca.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
                <th className="text-left font-bold pb-2 pr-3">Marca</th>
                <th className="text-right font-bold pb-2 px-2">Hoy</th>
                <th className="text-right font-bold pb-2 px-2">En el mes</th>
                <th className="text-left font-bold pb-2 px-2">Del total</th>
                <th className="text-right font-bold pb-2 px-2">Unidades</th>
                <th className="text-right font-bold pb-2 px-2">Ticket prom.</th>
                <th className="text-right font-bold pb-2 px-2 whitespace-nowrap">vs {datos.mesAnteriorNombre.slice(0, 4)}.</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {datos.marcas.map((m) => {
                const color = colorDe.get(m.idMarca) ?? GRIS;
                const href = m.propia ? "/rentabilidad" : `/situacion-marca?marca=${m.idMarca}`;
                if (m.vendido === 0) {
                  return (
                    <tr key={m.idMarca} className="border-b border-neutral-100 last:border-0 text-neutral-400">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="flex items-center gap-2.5">
                          <span className="w-2.5 h-2.5 rounded-[3px] shrink-0 opacity-40" style={{ background: color }} />
                          {m.nombre}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums">$0</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">$0</td>
                      <td className="py-2.5 px-2" colSpan={4}>
                        {m.sinProductos ? "Todavía sin productos cargados" : "Sin ventas este mes"}
                      </td>
                      <td className="py-2.5 text-right">
                        <Link href={href} className="text-xs font-semibold text-accent hover:underline">
                          Ver
                        </Link>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={m.idMarca} className="border-b border-neutral-100 last:border-0">
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <span className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: color }} />
                        <span className="font-medium text-neutral-900">{m.nombre}</span>
                        {m.propia && (
                          <span className="text-[10.5px] font-bold text-[#7d8a5c] border border-[#a9b498] rounded-full px-1.5">
                            propia
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{pesos(m.hoy)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums font-semibold text-neutral-900">{pesos(m.vendido)}</td>
                    <td className="py-2.5 px-2">
                      <span className="flex items-center gap-2 min-w-[120px]">
                        <span className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                          <span className="block h-full rounded-full" style={{ width: `${m.parte * 100}%`, background: color }} />
                        </span>
                        <span className="w-9 text-right text-xs text-neutral-500 tabular-nums">{Math.round(m.parte * 100)}%</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{m.unidades}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{m.ticketPromedio === null ? "—" : pesos(m.ticketPromedio)}</td>
                    <td
                      className={`py-2.5 px-2 text-right tabular-nums ${
                        m.variacion === null ? "text-neutral-400" : m.variacion >= 0 ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {m.variacion === null ? "—" : `${m.variacion >= 0 ? "+" : ""}${m.variacion}%`}
                    </td>
                    <td className="py-2.5 text-right">
                      <Link href={href} className="text-xs font-semibold text-accent hover:underline">
                        Ver
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Productos que más facturan ---------- */}
      <section className={`${tarjeta} p-5`}>
        <h2 className="font-semibold text-neutral-900">Productos que más facturan</h2>
        <p className="text-xs text-neutral-500 mb-2">{cap(datos.mesNombre)} hasta hoy, de todas las marcas</p>
        {datos.productos.length === 0 ? (
          <p className="text-sm text-neutral-400 py-4">Todavía no hay ventas este mes.</p>
        ) : (
          <ol>
            {datos.productos.map((p, i) => {
              const color = colorDe.get(p.idMarca) ?? GRIS;
              return (
                <li key={`${p.nombre}-${i}`} className="grid grid-cols-[28px_minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center py-2.5 border-b border-neutral-100 last:border-0">
                  <span className="text-xs text-neutral-400 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-sm font-medium text-neutral-900 truncate" title={p.nombre}>
                    {p.nombre}
                  </span>
                  <span className="row-span-2 text-right">
                    <b className="block text-sm tabular-nums text-neutral-900">{pesos(p.vendido)}</b>
                    <span className="text-xs text-neutral-500 tabular-nums">{p.unidades} u.</span>
                  </span>
                  <span className="col-start-2 flex items-center gap-2 text-xs text-neutral-500">
                    <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: color }} />
                    {p.marca}
                    <span className="flex-1 max-w-[220px] h-1 rounded-full bg-neutral-100 overflow-hidden">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${(p.vendido / datos.productos[0].vendido) * 100}%`, background: color }}
                      />
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nombreCompleto(etiqueta: string) {
  const i = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].indexOf(etiqueta);
  return i >= 0 ? NOMBRE_DIA[i + 1] : etiqueta;
}

function Kpi({ etiqueta, valor, pie, tono }: { etiqueta: string; valor: string; pie: string; tono?: "rojo" | "verde" }) {
  return (
    <div className={`${tarjeta} p-3.5`}>
      <p className={eyebrow}>{etiqueta}</p>
      <p
        className={`text-xl font-bold mt-0.5 tabular-nums ${
          tono === "rojo" ? "text-red-600" : tono === "verde" ? "text-emerald-700" : "text-neutral-900"
        }`}
      >
        {valor}
      </p>
      <p className="text-[11.5px] text-neutral-400">{pie}</p>
    </div>
  );
}

/** La venta acumulada del mes contra la del mes anterior, con la proyección. */
function CurvaMes({ datos }: { datos: Datos }) {
  const W = 420, H = 150, L = 6, R = 6, T = 10, B = 22;
  const dias = datos.diasDelMes;
  const actual = datos.acumuladoMes;
  const anterior = datos.acumuladoMesAnterior;
  const max = Math.max(anterior[anterior.length - 1] ?? 0, datos.proyeccion ?? 0, actual[actual.length - 1] ?? 0, 1) * 1.05;
  const X = (d: number) => L + ((d - 1) / Math.max(dias - 1, 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - v / max) * (H - T - B);
  const puntos = (xs: number[]) => xs.map((v, i) => `${X(i + 1)},${Y(v)}`).join(" ");
  const ultimo = actual[actual.length - 1] ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Venta acumulada del mes contra el mes anterior">
      <line x1={L} x2={W - R} y1={Y(max / 2)} y2={Y(max / 2)} stroke={LINEA} />
      <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke={LINEA} />
      {anterior.length > 1 && <polyline points={puntos(anterior)} fill="none" stroke={GRIS} strokeWidth={2} strokeDasharray="4 4" />}
      {actual.length > 0 && (
        <>
          <path
            d={`M${X(1)},${Y(0)} ${actual.map((v, i) => `L${X(i + 1)},${Y(v)}`).join(" ")} L${X(actual.length)},${Y(0)} Z`}
            fill={AZUL}
            fillOpacity={0.1}
          />
          <polyline points={puntos(actual)} fill="none" stroke={AZUL} strokeWidth={2.5} />
          {datos.proyeccion !== null && (
            <line x1={X(actual.length)} y1={Y(ultimo)} x2={X(dias)} y2={Y(datos.proyeccion)} stroke={AZUL} strokeWidth={1.5} strokeDasharray="2 4" />
          )}
          <circle cx={X(actual.length)} cy={Y(ultimo)} r={5} fill={AZUL} stroke="#fff" strokeWidth={2} />
        </>
      )}
      <text x={L} y={H - 6} fontSize={11} fill={GRIS}>1</text>
      <text x={X(actual.length)} y={H - 6} fontSize={11} fill={GRIS} textAnchor="middle">hoy</text>
      <text x={W - R} y={H - 6} fontSize={11} fill={GRIS} textAnchor="end">{dias}</text>
    </svg>
  );
}

/** Una barra por cada día del mes, con número e inicial del día. */
function BarrasDias({ datos }: { datos: Datos }) {
  const W = 860, H = 236, L = 52, R = 8, T = 14, B = 42;
  const valores = datos.porDia.map((d) => d.vendido ?? 0);
  const paso = pasoEje(Math.max(...valores, 1) * 1.08);
  const max = Math.ceil((Math.max(...valores, 1) * 1.08) / paso) * paso;
  const ancho = (W - L - R) / datos.porDia.length;
  const barra = ancho * 0.62;
  const Y = (v: number) => T + (1 - v / max) * (H - T - B);
  const lineas: number[] = [];
  for (let v = 0; v <= max; v += paso) lineas.push(v);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto min-w-[560px]" role="img" aria-label="Ventas de cada día del mes">
        {lineas.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke={LINEA} />
            <text x={L - 8} y={Y(v) + 4} fontSize={11} fill={GRIS} textAnchor="end">
              {v === 0 ? "0" : corto(v)}
            </text>
          </g>
        ))}
        {datos.porDia.map((d) => {
          const x = L + (d.dia - 1) * ancho + (ancho - barra) / 2;
          const esHoy = d.dia === datos.diaDeHoy;
          const apagado = d.vendido === null || d.diaSemana === 7;
          const estilo = esHoy ? { fill: AZUL, fontWeight: 700 } : apagado ? { fill: GRIS, opacity: 0.6 } : { fill: GRIS };
          return (
            <g key={d.dia}>
              {d.vendido !== null && d.vendido > 0 ? (
                <rect
                  x={x}
                  y={Y(d.vendido)}
                  width={barra}
                  height={Y(0) - Y(d.vendido)}
                  rx={2.5}
                  fill={AZUL}
                  fillOpacity={esHoy ? 1 : d.diaSemana === 6 ? 0.75 : 0.45}
                >
                  <title>{`${d.dia}: ${pesos(d.vendido)}`}</title>
                </rect>
              ) : (
                <rect x={x} y={Y(0) - 2} width={barra} height={2} rx={1} fill={LINEA} />
              )}
              <text x={x + barra / 2} y={H - 22} fontSize={11} textAnchor="middle" style={estilo}>
                {d.dia}
              </text>
              <text x={x + barra / 2} y={H - 7} fontSize={9} textAnchor="middle" style={estilo}>
                {INICIAL_DIA[d.diaSemana]}
              </text>
            </g>
          );
        })}
        {datos.promedioDiario !== null && (
          <>
            <line x1={L} x2={W - R} y1={Y(datos.promedioDiario)} y2={Y(datos.promedioDiario)} stroke="#15181f" strokeOpacity={0.45} strokeDasharray="5 4" />
            <text x={W - R} y={Y(datos.promedioDiario) - 6} fontSize={11} fill={GRIS} textAnchor="end">
              promedio {pesos(datos.promedioDiario)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

/** Barras simples con etiqueta abajo y el valor arriba de la más alta. */
function Barras({ datos, resaltar, nombre }: { datos: { etiqueta: string; valor: number }[]; resaltar: string | null; nombre: string }) {
  const W = 420, H = 200, L = 4, R = 4, T = 22, B = 24;
  const max = Math.max(...datos.map((d) => d.valor), 1);
  const ancho = (W - L - R) / Math.max(datos.length, 1);
  const barra = ancho * 0.62;
  const Y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={nombre}>
      <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke={LINEA} />
      {datos.map((d, i) => {
        const x = L + i * ancho + (ancho - barra) / 2;
        const top = d.etiqueta === resaltar;
        return (
          <g key={d.etiqueta}>
            {d.valor > 0 && (
              <rect x={x} y={Y(d.valor)} width={barra} height={Y(0) - Y(d.valor)} rx={3} fill={AZUL} fillOpacity={top ? 1 : 0.35}>
                <title>{`${d.etiqueta}: ${pesos(d.valor)}`}</title>
              </rect>
            )}
            <text
              x={x + barra / 2}
              y={H - 7}
              fontSize={11}
              textAnchor="middle"
              style={top ? { fill: AZUL, fontWeight: 700 } : { fill: GRIS, opacity: d.valor === 0 ? 0.5 : 1 }}
            >
              {d.etiqueta}
            </text>
            {top && (
              <text x={x + barra / 2} y={Y(d.valor) - 6} fontSize={11} textAnchor="middle" style={{ fill: "#15181f", fontWeight: 700 }}>
                {corto(d.valor)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
