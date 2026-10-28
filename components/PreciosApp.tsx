"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  calcularPrecio,
  costoPorKg,
  hayQueActualizar,
  margenMinimo,
  MEDIOS,
  PRUEBA_PRECIO,
  type ConfigPrecios,
  type Descuenta,
  type Envase,
  type Medio,
  type ResultadoPrecio,
} from "@/lib/calculoPrecio";
import type { GranelDelModulo, ProductoDelModulo, RubroDelModulo } from "@/lib/datosPrecios";
import {
  guardarConfigPrecios,
  guardarEnvase,
  guardarGranel,
  guardarProductoPrecio,
  guardarRubroPrecio,
  pasarALaVenta,
  traerGastosYVentas,
  type CambiosConfig,
  type CambiosProducto,
} from "@/app/(app)/precios/actions";

// Módulo Precios (lo que compra WiiGo). Todo se recalcula en el momento,
// mientras se escribe, y se guarda solo un instante después. Lo único que
// cambia lo que se cobra en el local es "Pasar a la venta".

type Props = {
  config: ConfigPrecios;
  marcas: { id: string; nombre: string }[];
  rubros: RubroDelModulo[];
  productos: ProductoDelModulo[];
  granel: GranelDelModulo[];
  envases: Envase[];
  proveedores: { id: string; nombre: string }[];
  puedeConfigurar: boolean;
};

type Pestana = "lista" | "costos" | "config";

const pesos = (n: number | null | undefined, dec = 0) =>
  n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
const pct = (n: number | null | undefined, dec = 1) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const nombreMedio = (m: Medio) => MEDIOS.find((x) => x.clave === m)?.nombre ?? m;
// Entiende "14.508,74" (como se escribe acá) y también "14508.74" (como lo
// muestra el casillero): con coma, el punto es de miles; sin coma, el punto
// es decimal salvo que separe miles ("14.508").
const aNumero = (s: string) => {
  const t = s.trim();
  if (!t) return null;
  let normal = t;
  if (t.includes(",")) normal = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, "");
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
};

export default function PreciosApp(props: Props) {
  const router = useRouter();
  const [pestana, setPestana] = useState<Pestana>("lista");
  const [cfg, setCfg] = useState<ConfigPrecios>(props.config);
  const [productos, setProductos] = useState(props.productos);
  const [rubros, setRubros] = useState(props.rubros);
  const [granel, setGranel] = useState(props.granel);
  const [envases, setEnvases] = useState(props.envases);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [filtroRubro, setFiltroRubro] = useState("");
  const [orden, setOrden] = useState<"rubro" | "margen" | "actualizar">("rubro");
  const [aviso, setAviso] = useState<{ texto: string; mal?: boolean } | null>(null);
  const [pasando, setPasando] = useState(false);
  // "Hace 30 días", tomado una sola vez al abrir la pantalla.
  const [hace30] = useState(() => Date.now() - 30 * 86400000);

  // Guardado automático: cada campo espera a que se deje de escribir.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function avisar(texto: string, mal = false) {
    setAviso({ texto, mal });
    window.setTimeout(() => setAviso((a) => (a?.texto === texto ? null : a)), mal ? 6000 : 1800);
  }
  function guardarLuego(clave: string, accion: () => Promise<{ error: string | null }>, espera = 700) {
    const t = timers.current.get(clave);
    if (t) clearTimeout(t);
    timers.current.set(
      clave,
      setTimeout(() => {
        timers.current.delete(clave);
        accion()
          .then((r) => (r.error ? avisar(r.error, true) : avisar("Guardado")))
          .catch(() => avisar("No se pudo guardar. Revisá la conexión.", true));
      }, espera)
    );
  }

  const granelPorId = useMemo(() => new Map(granel.map((g) => [g.id, g])), [granel]);
  const envasePorId = useMemo(() => new Map(envases.map((e) => [e.id, e])), [envases]);
  const rubroPorId = useMemo(() => new Map(rubros.map((r) => [r.id, r])), [rubros]);

  // El rubro de cada producto va con lo último que se escribió en el rubro.
  const conRubro = (p: ProductoDelModulo): ProductoDelModulo => {
    const r = p.idSubcategoria ? rubroPorId.get(p.idSubcategoria) : undefined;
    return { ...p, rubro: r ? { margen: r.margen, descuentoEfectivo: r.descuentoEfectivo } : null };
  };
  const calculados = useMemo(
    () => productos.map((p) => ({ p, r: calcularPrecio(conRubro(p), cfg, granelPorId, envasePorId) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productos, rubros, cfg, granelPorId, envasePorId]
  );
  const minimo = margenMinimo(cfg);
  const paraActualizar = calculados.filter(({ p, r }) => r.ok && (hayQueActualizar(r.publico, p.precioHoy, cfg.tolerancia) || (p.precioHoy != null && r.efectivo !== (p.efectivoHoy ?? p.precioHoy) && hayQueActualizar(r.efectivo, p.efectivoHoy ?? p.precioHoy, cfg.tolerancia))));
  const okCalc = calculados.filter((c) => c.r.ok) as { p: ProductoDelModulo; r: Extract<ResultadoPrecio, { ok: true }> }[];
  const promedio = okCalc.length ? okCalc.reduce((t, c) => t + c.r.enEscenario.margen, 0) / okCalc.length : null;
  const bajoMinimo = okCalc.filter((c) => c.r.enEscenario.margen < minimo).length;
  const subieron = granel.filter((g) => g.costoAnterior != null && g.costo > g.costoAnterior && new Date(g.actualizadoEl).getTime() > hace30).length;

  // ---------- Cambios ----------
  function cambiarProducto(id: string, local: Partial<ProductoDelModulo>, servidor: CambiosProducto) {
    setProductos((ps) => ps.map((p) => (p.id === id ? { ...p, ...local } : p)));
    guardarLuego(`p:${id}:${Object.keys(servidor).join(",")}`, () => guardarProductoPrecio(id, servidor));
  }
  function cambiarRubro(id: string, campo: "margen" | "descuentoEfectivo", texto: string) {
    const valor = aNumero(texto);
    setRubros((rs) => rs.map((r) => (r.id === id ? { ...r, [campo]: valor } : r)));
    guardarLuego(`r:${id}:${campo}`, () => guardarRubroPrecio(id, { [campo]: valor }));
  }
  function cambiarConfig(local: Partial<ConfigPrecios>, servidor: CambiosConfig) {
    setCfg((c) => ({ ...c, ...local }));
    if (!props.puedeConfigurar) return avisar("No tenés permiso para cambiar la Configuración: el cambio no se guarda.", true);
    guardarLuego(`c:${Object.keys(servidor).join(",")}`, () => guardarConfigPrecios(servidor));
  }
  function cambiarGranel(id: string, cambios: Partial<GranelDelModulo>) {
    const nuevo = { ...granelPorId.get(id)!, ...cambios };
    setGranel((gs) => gs.map((g) => (g.id === id ? nuevo : g)));
    guardarLuego(`g:${id}`, () =>
      guardarGranel(id, { nombre: nuevo.nombre, idProveedor: nuevo.idProveedor, costo: nuevo.costo, unidad: nuevo.unidad, kgBulto: nuevo.kgBulto }),
      900
    );
  }
  function cambiarEnvase(id: string, cambios: Partial<Envase>) {
    const nuevo = { ...envasePorId.get(id)!, ...cambios };
    setEnvases((es) => es.map((e) => (e.id === id ? nuevo : e)));
    guardarLuego(`e:${id}`, () => guardarEnvase(id, { nombre: nuevo.nombre, costo: nuevo.costo }), 900);
  }

  // ---------- Exportar ----------
  async function exportar() {
    const XLSX = await import("xlsx");
    const filas = calculados.map(({ p, r }) => ({
      Producto: p.nombre,
      Rubro: p.idSubcategoria ? rubroPorId.get(p.idSubcategoria)?.nombre ?? "" : "",
      "Costo neto": r.costo ? Math.round(r.costo.total * 100) / 100 : "",
      "Margen %": Math.round(r.margen * 1000) / 10,
      "Precio al público": r.ok ? r.publico : "",
      "Precio efectivo": r.ok ? r.efectivo : "",
      "Hoy en venta": p.precioHoy ?? "",
      [`Margen real ${nombreMedio(cfg.escenario)} %`]: r.ok ? Math.round(r.enEscenario.margen * 1000) / 10 : "",
      "Margen real efectivo %": r.ok ? Math.round(r.enEfectivo.margen * 1000) / 10 : "",
      "Precio competencia": p.competencia ?? "",
      Error: r.ok ? "" : r.error,
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Precios");
    XLSX.writeFile(libro, `precios-wiigo-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="precios">
      <header className="pr-cab">
        <div>
          <div>
            <h1>Precios</h1>
            <p>
              {props.marcas.map((m) => m.nombre).join(" · ")} · calculado para {nombreMedio(cfg.escenario).toLowerCase()} · redondeo a {pesos(cfg.redondeo)}
            </p>
          </div>
          <div className="pr-acciones">
            <button type="button" className="pr-btn" onClick={exportar}>
              Exportar a Excel
            </button>
            <button type="button" className="pr-btn prim" disabled={paraActualizar.length === 0} onClick={() => setPasando(true)}>
              Pasar a la venta{paraActualizar.length ? ` (${paraActualizar.length})` : ""}
            </button>
          </div>
        </div>
      </header>

      <div className="pr-pagina">
        <section className="pr-kpis" aria-label="Resumen">
          <div className={`pr-kpi ${paraActualizar.length ? "ojo" : "ok"}`}>
            <span>Precios para actualizar</span>
            <b>{paraActualizar.length}</b>
            <small>
              de {productos.length} · difieren más de {cfg.tolerancia.toLocaleString("es-AR")} %
            </small>
          </div>
          <div className="pr-kpi ok">
            <span>Margen real promedio</span>
            <b>{pct(promedio)}</b>
            <small>pagando con {nombreMedio(cfg.escenario).toLowerCase()}</small>
          </div>
          <div className={`pr-kpi ${bajoMinimo ? "mal" : "ok"}`}>
            <span>Debajo del mínimo</span>
            <b>{bajoMinimo}</b>
            <small>mínimo {pct(minimo)}</small>
          </div>
          <div className="pr-kpi azul">
            <span>Costos que subieron</span>
            <b>{subieron}</b>
            <small>en los últimos 30 días</small>
          </div>
        </section>

        <nav className="pr-tabs" role="tablist" aria-label="Partes del módulo">
          {(
            [
              ["lista", "Lista de precios"],
              ["costos", "Costos de compra"],
              ["config", "Configuración"],
            ] as [Pestana, string][]
          ).map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={pestana === k} onClick={() => setPestana(k)}>
              {t}
            </button>
          ))}
        </nav>

        {pestana === "lista" && (
          <Lista
            calculados={calculados}
            cfg={cfg}
            minimo={minimo}
            rubros={rubros}
            granel={granel}
            envases={envases}
            abierto={abierto}
            setAbierto={setAbierto}
            buscar={buscar}
            setBuscar={setBuscar}
            filtroRubro={filtroRubro}
            setFiltroRubro={setFiltroRubro}
            orden={orden}
            setOrden={setOrden}
            cambiarProducto={cambiarProducto}
            cambiarRubro={cambiarRubro}
          />
        )}
        {pestana === "costos" && (
          <Costos
            granel={granel}
            setGranel={setGranel}
            envases={envases}
            setEnvases={setEnvases}
            proveedores={props.proveedores}
            productos={productos}
            cfg={cfg}
            cambiarGranel={cambiarGranel}
            cambiarEnvase={cambiarEnvase}
            cambiarConfig={cambiarConfig}
            avisar={avisar}
          />
        )}
        {pestana === "config" && <Configuracion cfg={cfg} minimo={minimo} puedeConfigurar={props.puedeConfigurar} cambiarConfig={cambiarConfig} avisar={avisar} />}
      </div>

      {pasando && (
        <PasarALaVenta
          items={paraActualizar.map(({ p, r }) => ({ p, r: r as Extract<ResultadoPrecio, { ok: true }> }))}
          onCerrar={() => setPasando(false)}
          onListo={(n) => {
            setPasando(false);
            avisar(n === 1 ? "Listo: 1 precio pasado a la venta." : `Listo: ${n} precios pasados a la venta.`);
            router.refresh();
          }}
          onError={(e) => avisar(e, true)}
        />
      )}

      {aviso && (
        <div className={`pr-toast${aviso.mal ? " mal" : ""}`} role="status">
          {aviso.texto}
        </div>
      )}
    </div>
  );
}

// ---------- Lista ----------

type Calculado = { p: ProductoDelModulo; r: ResultadoPrecio };
const tono = (m: number, minimo: number) => (m < minimo ? "mal" : m < minimo + 0.05 ? "ojo" : "ok");

function Margen({ m, minimo }: { m: number; minimo: number }) {
  const t = tono(m, minimo);
  return (
    <span className="pr-mg">
      <span className={`n c-${t}`}>{pct(m)}</span>
      <span className="pr-barra">
        <i className={`b-${t}`} style={{ width: `${Math.max(4, Math.min(100, (m / 0.6) * 100))}%` }} />
      </span>
    </span>
  );
}

function Lista(props: {
  calculados: Calculado[];
  cfg: ConfigPrecios;
  minimo: number;
  rubros: RubroDelModulo[];
  granel: GranelDelModulo[];
  envases: Envase[];
  abierto: string | null;
  setAbierto: (id: string | null) => void;
  buscar: string;
  setBuscar: (s: string) => void;
  filtroRubro: string;
  setFiltroRubro: (s: string) => void;
  orden: "rubro" | "margen" | "actualizar";
  setOrden: (o: "rubro" | "margen" | "actualizar") => void;
  cambiarProducto: (id: string, local: Partial<ProductoDelModulo>, servidor: CambiosProducto) => void;
  cambiarRubro: (id: string, campo: "margen" | "descuentoEfectivo", texto: string) => void;
}) {
  const { cfg, minimo } = props;
  const q = props.buscar.trim().toLowerCase();
  let filas = props.calculados.filter(({ p }) => (!q || p.nombre.toLowerCase().includes(q)) && (!props.filtroRubro || p.idSubcategoria === props.filtroRubro));
  const margenDe = (c: Calculado) => (c.r.ok ? c.r.enEscenario.margen : -9);
  if (props.orden === "margen") filas = [...filas].sort((a, b) => margenDe(a) - margenDe(b));
  if (props.orden === "actualizar")
    filas = [...filas].sort((a, b) => Number(b.r.ok && hayQueActualizar(b.r.publico, b.p.precioHoy, cfg.tolerancia)) - Number(a.r.ok && hayQueActualizar(a.r.publico, a.p.precioHoy, cfg.tolerancia)));

  const rubroPorId = new Map(props.rubros.map((r) => [r.id, r]));
  const grupos: { rubro: RubroDelModulo | null; titulo: string; filas: Calculado[] }[] = [];
  if (props.orden === "rubro") {
    // Por nombre de rubro, y lo que no tiene rubro al final.
    const ids = [...new Set(filas.map((c) => c.p.idSubcategoria ?? ""))].sort((a, b) => {
      const na = rubroPorId.get(a)?.nombre;
      const nb = rubroPorId.get(b)?.nombre;
      if (!na || !nb) return na ? -1 : nb ? 1 : 0;
      return na.localeCompare(nb, "es");
    });
    for (const id of ids) grupos.push({ rubro: rubroPorId.get(id) ?? null, titulo: rubroPorId.get(id)?.nombre ?? "Sin rubro", filas: filas.filter((c) => (c.p.idSubcategoria ?? "") === id) });
  } else {
    grupos.push({ rubro: null, titulo: props.orden === "margen" ? "Del margen más bajo al más alto" : "Primero los que hay que actualizar", filas });
  }

  return (
    <section className="pr-tarjeta">
      <div className="pr-filtros">
        <input value={props.buscar} onChange={(e) => props.setBuscar(e.target.value)} placeholder="Buscar producto" aria-label="Buscar producto" />
        <select value={props.filtroRubro} onChange={(e) => props.setFiltroRubro(e.target.value)} aria-label="Rubro">
          <option value="">Todos los rubros</option>
          {props.rubros.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
        <select value={props.orden} onChange={(e) => props.setOrden(e.target.value as "rubro" | "margen" | "actualizar")} aria-label="Ordenar">
          <option value="rubro">Por rubro</option>
          <option value="actualizar">Primero los que hay que actualizar</option>
          <option value="margen">Por margen real (menor primero)</option>
        </select>
        <span className="info">Margen mínimo {pct(minimo)}</span>
      </div>
      <div className="pr-leyenda">
        <span>
          <i className="b-ok" />
          Margen sano
        </span>
        <span>
          <i className="b-ojo" />
          Cerca del mínimo
        </span>
        <span>
          <i className="b-mal" />
          Debajo del mínimo
        </span>
      </div>
      <div className="pr-env">
        <table className="pr-tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Costo</th>
              <th>Margen</th>
              <th>Al público</th>
              <th>Hoy en venta</th>
              <th>Efectivo</th>
              <th>Real {nombreMedio(cfg.escenario).split(" ")[0].toLowerCase()}</th>
              <th>Real efectivo</th>
              <th>Competencia</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => [
              <tr key={`g-${g.titulo}`} className="grupo">
                <td colSpan={3}>
                  <span className="pr-gn">{g.titulo}</span>
                  <span className="pr-gm">
                    {g.filas.length} {g.filas.length === 1 ? "producto" : "productos"}
                  </span>
                </td>
                <td colSpan={6}>
                  {g.rubro && (
                    <span className="pr-gctrl">
                      <label>
                        Margen del rubro{" "}
                        <input
                          className="pr-in"
                          inputMode="decimal"
                          defaultValue={g.rubro.margen ?? ""}
                          placeholder={String(cfg.margenDefecto)}
                          onChange={(e) => props.cambiarRubro(g.rubro!.id, "margen", e.target.value)}
                          aria-label={`Margen del rubro ${g.titulo}`}
                        />{" "}
                        %
                      </label>
                      <label>
                        Desc. efectivo{" "}
                        <input
                          className="pr-in"
                          inputMode="decimal"
                          defaultValue={g.rubro.descuentoEfectivo ?? ""}
                          placeholder={String(cfg.descuentoEfectivo)}
                          onChange={(e) => props.cambiarRubro(g.rubro!.id, "descuentoEfectivo", e.target.value)}
                          aria-label={`Descuento por efectivo del rubro ${g.titulo}`}
                        />{" "}
                        %
                      </label>
                    </span>
                  )}
                </td>
              </tr>,
              ...g.filas.flatMap((c) => {
                const { p, r } = c;
                const abierto = props.abierto === p.id;
                const g2 = p.idGranel ? props.granel.find((x) => x.id === p.idGranel) : null;
                const sub = g2 ? `${p.gramos ?? "?"} g de ${g2.nombre.toLowerCase()}${p.idEnvase ? " + bolsita" : ""}` : p.idEnvase ? "por unidad + envase" : "viene envasado";
                const dif = r.ok && p.precioHoy ? r.publico - p.precioHoy : 0;
                const filasProd = [
                  <tr key={p.id} className={`fila${abierto ? " abierta" : ""}`} onClick={() => props.setAbierto(abierto ? null : p.id)}>
                    <td className="pr-prod">
                      <b>{p.nombre}</b>
                      <small>{sub}</small>
                    </td>
                    <td className="n pr-tenue">{r.costo ? pesos(r.costo.total) : "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        className="pr-in"
                        inputMode="decimal"
                        defaultValue={p.margen ?? ""}
                        placeholder={String(Math.round(r.margen * 100))}
                        onChange={(e) => {
                          const v = aNumero(e.target.value);
                          props.cambiarProducto(p.id, { margen: v }, { margen: v });
                        }}
                        aria-label={`Margen de ${p.nombre}`}
                      />{" "}
                      %
                    </td>
                    <td>{r.ok ? <span className="pr-precio">{pesos(r.publico)}</span> : <span className="pr-err">{r.error.length > 30 ? "Revisar" : r.error}</span>}</td>
                    <td>
                      <span className="pr-hoy">{pesos(p.precioHoy)}</span>
                      {dif !== 0 && <span className={`pr-delta ${dif > 0 ? "sube" : "baja"}`}>{`${dif > 0 ? "+" : "−"}${pesos(Math.abs(dif))}`}</span>}
                    </td>
                    <td className="n">
                      {r.ok ? pesos(r.efectivo) : "—"}
                      {r.ok && p.precioHoy != null && r.efectivo !== (p.efectivoHoy ?? p.precioHoy) && (
                        <small className="pr-hoy-ef">hoy {pesos(p.efectivoHoy ?? p.precioHoy)}</small>
                      )}
                    </td>
                    <td>{r.ok ? <Margen m={r.enEscenario.margen} minimo={minimo} /> : "—"}</td>
                    <td>{r.ok ? <Margen m={r.enEfectivo.margen} minimo={minimo} /> : "—"}</td>
                    <td>
                      {r.ok && p.competencia ? (
                        <span className={`pr-comp ${r.publico > p.competencia ? "caro" : "barato"}`}>
                          {r.publico > p.competencia ? "+" : ""}
                          {pct(r.publico / p.competencia - 1, 0)}
                        </span>
                      ) : (
                        <span className="pr-tenue">—</span>
                      )}
                    </td>
                  </tr>,
                ];
                if (abierto)
                  filasProd.push(
                    <tr key={`${p.id}-det`} className="detalle">
                      <td colSpan={9}>
                        <Detalle c={c} cfg={cfg} minimo={minimo} granel={props.granel} envases={props.envases} cambiarProducto={props.cambiarProducto} />
                      </td>
                    </tr>
                  );
                return filasProd;
              }),
            ])}
          </tbody>
        </table>
      </div>
      {props.calculados.length === 0 && <p className="pr-tenue" style={{ padding: "16px 0" }}>Todavía no hay productos de marcas propias.</p>}
    </section>
  );
}

function Detalle({
  c,
  cfg,
  minimo,
  granel,
  envases,
  cambiarProducto,
}: {
  c: Calculado;
  cfg: ConfigPrecios;
  minimo: number;
  granel: GranelDelModulo[];
  envases: Envase[];
  cambiarProducto: (id: string, local: Partial<ProductoDelModulo>, servidor: CambiosProducto) => void;
}) {
  const { p, r } = c;
  const esGranel = Boolean(p.idGranel);
  const g = p.idGranel ? granel.find((x) => x.id === p.idGranel) : null;
  const porKg = g ? costoPorKg(g) : null;
  const max = r.ok ? Math.max(...MEDIOS.map((m) => r.porMedio[m.clave].ganancia), r.enEfectivo.ganancia, 1) : 1;
  const filaMedio = (t: string, x: { ganancia: number; margen: number }) => (
    <div className="pr-medio" key={t}>
      <span>{t}</span>
      <span className="b">
        <i className={`b-${tono(x.margen, minimo)}`} style={{ width: `${Math.max(0, (x.ganancia / max) * 100)}%` }} />
      </span>
      <span className="g n">{pesos(x.ganancia, 2)}</span>
      <span className={`p n c-${tono(x.margen, minimo)}`}>{pct(x.margen)}</span>
    </div>
  );

  return (
    <div className="pr-det">
      <div className="pr-caja">
        <h3>Cómo se llega al precio</h3>
        {r.costo ? (
          <ul className="pr-pasos">
            {esGranel && porKg != null ? (
              <>
                <li>
                  <span>
                    {p.gramos} g a {pesos(porKg, 2)} el kg
                  </span>
                  <span className="n">{pesos(r.costo.mercaderia, 2)}</span>
                </li>
                <li>
                  <span>Merma de fraccionado ({cfg.merma.toLocaleString("es-AR")} %)</span>
                  <span className="n">{pesos(r.costo.merma, 2)}</span>
                </li>
              </>
            ) : (
              <li>
                <span>Costo neto del proveedor</span>
                <span className="n">{pesos(r.costo.mercaderia, 2)}</span>
              </li>
            )}
            {r.costo.envase > 0 && (
              <li>
                <span>Bolsita / envase</span>
                <span className="n">{pesos(r.costo.envase, 2)}</span>
              </li>
            )}
            <li className="sep">
              <span>Costo neto (sin IVA de la compra)</span>
              <span className="n">{pesos(r.costo.total, 2)}</span>
            </li>
            <li>
              <span>Margen {r.origenMargen === "producto" ? "del producto" : r.origenMargen === "rubro" ? "del rubro" : "por defecto"}</span>
              <span className="n">{pct(r.margen, 0)}</span>
            </li>
            {r.ok && (
              <>
                <li>
                  <span>Divisor</span>
                  <span className="n">{r.divisor.toFixed(6).replace(".", ",")}</span>
                </li>
                <li>
                  <span>Precio neto</span>
                  <span className="n">{pesos(r.neto, 2)}</span>
                </li>
                <li>
                  <span>Con IVA {(r.iva * 100).toLocaleString("es-AR")} %</span>
                  <span className="n">{pesos(r.conIva, 2)}</span>
                </li>
                <li className="sep grande">
                  <span>Al público</span>
                  <span className="n">{pesos(r.publico)}</span>
                </li>
                <li>
                  <span>En efectivo (−{(r.descuentoEfectivo * 100).toLocaleString("es-AR")} %)</span>
                  <span className="n">{pesos(r.efectivo)}</span>
                </li>
              </>
            )}
          </ul>
        ) : (
          <p className="pr-nota mal">{!r.ok ? r.error : ""}</p>
        )}
        {!r.ok && r.costo && <p className="pr-nota mal">{r.error}</p>}
      </div>

      <div className="pr-caja">
        <h3>Cuánto ganás según cómo paga</h3>
        {r.ok ? (
          <>
            {MEDIOS.map((m) => filaMedio(m.clave === cfg.escenario ? `${m.nombre.split(" ")[0]} · base` : m.nombre.split(" ")[0], r.porMedio[m.clave]))}
            {filaMedio(`Efectivo a ${pesos(r.efectivo)}`, r.enEfectivo)}
            <p className={`pr-nota ${r.descuentoMaximoEfectivo >= r.descuentoEfectivo ? "ok" : "mal"}`}>
              Podés hacer hasta <b>{pct(Math.max(0, r.descuentoMaximoEfectivo))}</b> de descuento en efectivo y seguir arriba del mínimo ({pct(minimo)}).
              {r.descuentoMaximoEfectivo < r.descuentoEfectivo && " El descuento que tiene hoy lo deja abajo."}
            </p>
            {r.enEscenario.margen < minimo && <p className="pr-nota mal">Con {nombreMedio(cfg.escenario).toLowerCase()} ganás menos que el margen mínimo.</p>}
          </>
        ) : (
          <p className="pr-tenue">Completá los datos del producto para ver la cuenta.</p>
        )}
      </div>

      <div className="pr-caja">
        <h3>Datos del producto</h3>
        <div className="pr-campos">
          <div className="ancho" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, color: "var(--tinta-2)" }}>Se compra</span>
            <span className="pr-seg">
              <button
                type="button"
                aria-pressed={esGranel}
                disabled={granel.length === 0}
                title={granel.length === 0 ? "Primero cargá lo que viene a granel en Costos de compra" : ""}
                onClick={() => !esGranel && granel[0] && cambiarProducto(p.id, { idGranel: granel[0].id }, { idGranel: granel[0].id })}
              >
                A granel
              </button>
              <button type="button" aria-pressed={!esGranel} onClick={() => esGranel && cambiarProducto(p.id, { idGranel: null }, { idGranel: null })}>
                Envasado
              </button>
            </span>
          </div>
          {esGranel ? (
            <>
              <label>
                De qué granel
                <select value={p.idGranel ?? ""} onChange={(e) => cambiarProducto(p.id, { idGranel: e.target.value }, { idGranel: e.target.value })}>
                  {granel.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Gramos de la bolsita
                <input
                  inputMode="numeric"
                  defaultValue={p.gramos ?? ""}
                  onChange={(e) => {
                    const v = aNumero(e.target.value);
                    cambiarProducto(p.id, { gramos: v }, { gramos: v });
                  }}
                />
              </label>
            </>
          ) : (
            <label className="ancho">
              Costo neto por unidad (sin IVA)
              <input
                inputMode="decimal"
                defaultValue={p.costoUnidad ?? ""}
                onChange={(e) => {
                  const v = aNumero(e.target.value);
                  if (v && v > 0) cambiarProducto(p.id, { costoUnidad: v }, { costo: v });
                }}
              />
            </label>
          )}
          <label>
            Bolsita / envase
            <select
              value={p.idEnvase ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                cambiarProducto(p.id, { idEnvase: v, costoExtra: v ? envases.find((x) => x.id === v)?.costo ?? 0 : 0 }, { idEnvase: v });
              }}
            >
              <option value="">Sin envase (ya viene envasado)</option>
              {envases.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nombre} · {pesos(x.costo)}
                </option>
              ))}
            </select>
          </label>
          <label>
            IVA de venta
            <select
              value={String(p.iva ?? cfg.ivaGeneral)}
              onChange={(e) => {
                const v = Number(e.target.value);
                cambiarProducto(p.id, { iva: v }, { iva: v });
              }}
            >
              <option value="21">21 %</option>
              <option value="10.5">10,5 %</option>
            </select>
          </label>
          <label>
            Desc. efectivo (%)
            <input
              inputMode="decimal"
              defaultValue={p.descuentoEfectivo ?? ""}
              placeholder="del rubro"
              onChange={(e) => {
                const v = aNumero(e.target.value);
                cambiarProducto(p.id, { descuentoEfectivo: v }, { descuentoEfectivo: v });
              }}
            />
          </label>
          <label>
            Precio competencia ($)
            <input
              inputMode="numeric"
              defaultValue={p.competencia ?? ""}
              placeholder="opcional"
              onChange={(e) => {
                const v = aNumero(e.target.value);
                cambiarProducto(p.id, { competencia: v }, { competencia: v });
              }}
            />
          </label>
        </div>
        <p className="pr-tenue" style={{ fontSize: 12, marginTop: 9 }}>
          Costo actualizado el {fecha(g?.actualizadoEl ?? p.costoActualizadoEl)}
          {g && g.costoAnterior != null && g.costo !== g.costoAnterior && (
            <span className="pr-sube">
              {" "}
              · {g.costo > g.costoAnterior ? "subió" : "bajó"} {pct(g.costo / g.costoAnterior - 1)}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

// ---------- Costos de compra ----------

function Costos(props: {
  granel: GranelDelModulo[];
  setGranel: React.Dispatch<React.SetStateAction<GranelDelModulo[]>>;
  envases: Envase[];
  setEnvases: React.Dispatch<React.SetStateAction<Envase[]>>;
  proveedores: { id: string; nombre: string }[];
  productos: ProductoDelModulo[];
  cfg: ConfigPrecios;
  cambiarGranel: (id: string, cambios: Partial<GranelDelModulo>) => void;
  cambiarEnvase: (id: string, cambios: Partial<Envase>) => void;
  cambiarConfig: (local: Partial<ConfigPrecios>, servidor: CambiosConfig) => void;
  avisar: (t: string, mal?: boolean) => void;
}) {
  const [nuevo, setNuevo] = useState({ nombre: "", costo: "", unidad: "KG" as "KG" | "BULTO", kgBulto: "", idProveedor: "" });
  const [nuevoEnv, setNuevoEnv] = useState({ nombre: "", costo: "" });
  const [creando, setCreando] = useState(false);

  async function crearGranel() {
    setCreando(true);
    const r = await guardarGranel(null, { nombre: nuevo.nombre, idProveedor: nuevo.idProveedor || null, costo: nuevo.costo, unidad: nuevo.unidad, kgBulto: nuevo.kgBulto });
    setCreando(false);
    if (r.error || !r.id) return props.avisar(r.error ?? "No se pudo crear.", true);
    props.setGranel((gs) => [
      ...gs,
      {
        id: r.id!,
        nombre: nuevo.nombre.trim(),
        costo: aNumero(nuevo.costo) ?? 0,
        unidad: nuevo.unidad,
        kgBulto: nuevo.unidad === "BULTO" ? aNumero(nuevo.kgBulto) : null,
        idProveedor: nuevo.idProveedor || null,
        costoAnterior: null,
        actualizadoEl: new Date().toISOString(),
      },
    ]);
    setNuevo({ nombre: "", costo: "", unidad: "KG", kgBulto: "", idProveedor: "" });
    props.avisar("Agregado");
  }
  async function crearEnvase() {
    setCreando(true);
    const r = await guardarEnvase(null, nuevoEnv);
    setCreando(false);
    if (r.error || !r.id) return props.avisar(r.error ?? "No se pudo crear.", true);
    props.setEnvases((es) => [...es, { id: r.id!, nombre: nuevoEnv.nombre.trim(), costo: aNumero(nuevoEnv.costo) ?? 0 }]);
    setNuevoEnv({ nombre: "", costo: "" });
    props.avisar("Agregada");
  }

  return (
    <div className="pr-grid">
      <section className="pr-tarjeta pr-ancho">
        <h2>Lo que se compra a granel</h2>
        <p className="baj">
          El costo de la lista del proveedor, sin IVA. Si viene por bolsa (por ejemplo, avena en bolsa de 3 kg), poné el precio de la bolsa y cuántos kg trae: el
          sistema saca el costo por kg. Un cambio acá recalcula todos los tamaños que salen de él (100 g, 250 g…).
        </p>
        <div className="pr-env">
          <table className="pr-costos">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Proveedor</th>
                <th style={{ textAlign: "right" }}>Costo neto</th>
                <th>Viene</th>
                <th style={{ textAlign: "right" }}>Kg de la bolsa</th>
                <th style={{ textAlign: "right" }}>Por kg</th>
                <th>Tamaños</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {props.granel.map((g) => {
                const porKg = costoPorKg(g);
                const usos = props.productos.filter((p) => p.idGranel === g.id).length;
                return (
                  <tr key={g.id}>
                    <td>
                      <input defaultValue={g.nombre} onChange={(e) => e.target.value.trim() && props.cambiarGranel(g.id, { nombre: e.target.value })} aria-label="Nombre" />
                    </td>
                    <td>
                      <select value={g.idProveedor ?? ""} onChange={(e) => props.cambiarGranel(g.id, { idProveedor: e.target.value || null })} aria-label="Proveedor">
                        <option value="">—</option>
                        {props.proveedores.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ width: 130 }}>
                      <input
                        className="n"
                        inputMode="decimal"
                        defaultValue={g.costo}
                        onChange={(e) => {
                          const v = aNumero(e.target.value);
                          if (v && v > 0) props.cambiarGranel(g.id, { costo: v });
                        }}
                        aria-label="Costo neto"
                      />
                    </td>
                    <td style={{ width: 120 }}>
                      <select value={g.unidad} onChange={(e) => props.cambiarGranel(g.id, { unidad: e.target.value as "KG" | "BULTO", kgBulto: e.target.value === "BULTO" ? g.kgBulto ?? 1 : null })} aria-label="Viene">
                        <option value="KG">por kg</option>
                        <option value="BULTO">por bolsa</option>
                      </select>
                    </td>
                    <td style={{ width: 110 }}>
                      {g.unidad === "BULTO" ? (
                        <input
                          className="n"
                          inputMode="decimal"
                          defaultValue={g.kgBulto ?? ""}
                          onChange={(e) => {
                            const v = aNumero(e.target.value);
                            if (v && v > 0) props.cambiarGranel(g.id, { kgBulto: v });
                          }}
                          aria-label="Kg de la bolsa"
                        />
                      ) : (
                        <span className="pr-tenue">—</span>
                      )}
                    </td>
                    <td className="n" style={{ textAlign: "right" }}>
                      {pesos(porKg, 2)}
                    </td>
                    <td className="pr-tenue">{usos}</td>
                    <td>
                      {fecha(g.actualizadoEl)}
                      {g.costoAnterior != null && g.costo !== g.costoAnterior && (
                        <span className="pr-sube">
                          {" "}
                          {g.costo > g.costoAnterior ? "▲" : "▼"} {pct(Math.abs(g.costo / g.costoAnterior - 1))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td>
                  <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nuevo: ej. Castañas de cajú" aria-label="Nombre del nuevo" />
                </td>
                <td>
                  <select value={nuevo.idProveedor} onChange={(e) => setNuevo({ ...nuevo, idProveedor: e.target.value })} aria-label="Proveedor del nuevo">
                    <option value="">—</option>
                    {props.proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input className="n" inputMode="decimal" value={nuevo.costo} onChange={(e) => setNuevo({ ...nuevo, costo: e.target.value })} placeholder="Costo" aria-label="Costo del nuevo" />
                </td>
                <td>
                  <select value={nuevo.unidad} onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value as "KG" | "BULTO" })} aria-label="Viene">
                    <option value="KG">por kg</option>
                    <option value="BULTO">por bolsa</option>
                  </select>
                </td>
                <td>
                  {nuevo.unidad === "BULTO" && (
                    <input className="n" inputMode="decimal" value={nuevo.kgBulto} onChange={(e) => setNuevo({ ...nuevo, kgBulto: e.target.value })} placeholder="kg" aria-label="Kg de la bolsa nueva" />
                  )}
                </td>
                <td colSpan={3}>
                  <button type="button" className="pr-btn chico prim" disabled={creando || !nuevo.nombre.trim() || !nuevo.costo} onClick={crearGranel}>
                    Agregar
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="baj" style={{ marginTop: 10, marginBottom: 0 }}>
          Para que un producto salga de un granel, abrilo en la Lista de precios y en «Se compra» elegí «A granel».
        </p>
      </section>

      <section className="pr-tarjeta">
        <h2>Bolsitas y etiquetas</h2>
        <p className="baj">Lo que cuesta envasar cada bolsita. Cambiás el precio una vez y se recalcula todo lo que la usa.</p>
        <table className="pr-costos" style={{ minWidth: 0 }}>
          <tbody>
            {props.envases.map((e) => (
              <tr key={e.id}>
                <td>
                  <input defaultValue={e.nombre} onChange={(ev) => ev.target.value.trim() && props.cambiarEnvase(e.id, { nombre: ev.target.value })} aria-label="Nombre de la bolsita" />
                </td>
                <td style={{ width: 120 }}>
                  <input
                    className="n"
                    inputMode="decimal"
                    defaultValue={e.costo}
                    onChange={(ev) => {
                      const v = aNumero(ev.target.value);
                      if (v != null && v >= 0) props.cambiarEnvase(e.id, { costo: v });
                    }}
                    aria-label="Costo de la bolsita"
                  />
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <input value={nuevoEnv.nombre} onChange={(e) => setNuevoEnv({ ...nuevoEnv, nombre: e.target.value })} placeholder="Nueva: ej. Frasco 500 cc" aria-label="Nombre de la nueva bolsita" />
              </td>
              <td>
                <input className="n" inputMode="decimal" value={nuevoEnv.costo} onChange={(e) => setNuevoEnv({ ...nuevoEnv, costo: e.target.value })} placeholder="Costo" aria-label="Costo de la nueva" />
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <button type="button" className="pr-btn chico" disabled={creando || !nuevoEnv.nombre.trim() || nuevoEnv.costo === ""} onClick={crearEnvase}>
            Agregar bolsita
          </button>
        </div>
      </section>

      <section className="pr-tarjeta">
        <h2>Merma de fraccionado</h2>
        <p className="baj">Lo que se pierde al fraccionar: polvo, rotos y el poquito de más que siempre se pone en la balanza. Se suma al costo de lo que viene a granel.</p>
        <div className="pr-fila">
          <span>
            Merma (%)<small>Entre 2 % y 4 % es lo habitual hasta medirlo de verdad</small>
          </span>
          <input
            type="number"
            step="0.5"
            defaultValue={props.cfg.merma}
            onChange={(e) => {
              const v = aNumero(e.target.value);
              if (v != null && v >= 0) props.cambiarConfig({ merma: v }, { merma: v });
            }}
          />
        </div>
      </section>
    </div>
  );
}

// ---------- Configuración ----------

function Configuracion({
  cfg,
  minimo,
  puedeConfigurar,
  cambiarConfig,
  avisar,
}: {
  cfg: ConfigPrecios;
  minimo: number;
  puedeConfigurar: boolean;
  cambiarConfig: (local: Partial<ConfigPrecios>, servidor: CambiosConfig) => void;
  avisar: (t: string, mal?: boolean) => void;
}) {
  const [trayendo, setTrayendo] = useState(false);
  const [clave, setClave] = useState(0); // para refrescar los casilleros al traer datos

  const numeroFila = (k: keyof CambiosConfig & keyof ConfigPrecios, titulo: string, sub: string, paso = "0.01") => (
    <div className="pr-fila">
      <span>
        {titulo}
        {sub && <small>{sub}</small>}
      </span>
      <input
        type="number"
        step={paso}
        defaultValue={cfg[k] as number}
        disabled={!puedeConfigurar}
        onChange={(e) => {
          const v = aNumero(e.target.value);
          if (v != null) cambiarConfig({ [k]: v } as Partial<ConfigPrecios>, { [k]: v } as CambiosConfig);
        }}
      />
    </div>
  );
  const comision = (m: Medio) => {
    const clave = m === "qr" ? "comisionQr" : m === "debito" ? "comisionDebito" : "comisionCredito";
    return (
      <input
        type="number"
        step="0.01"
        defaultValue={cfg.comisiones[m]}
        disabled={m === "efectivo" || !puedeConfigurar}
        onChange={(e) => {
          const v = aNumero(e.target.value);
          if (v != null && m !== "efectivo") cambiarConfig({ comisiones: { ...cfg.comisiones, [m]: v } }, { [clave]: v } as CambiosConfig);
        }}
        aria-label={`Comisión ${nombreMedio(m)}`}
      />
    );
  };
  function tildar(m: Medio, k: keyof Descuenta, valor: boolean) {
    const descuenta = { ...cfg.descuenta, [m]: { ...cfg.descuenta[m], [k]: valor } };
    cambiarConfig({ descuenta }, { descuenta });
  }
  async function traer() {
    setTrayendo(true);
    const r = await traerGastosYVentas();
    setTrayendo(false);
    if (r.error) return avisar(r.error, true);
    cambiarConfig({ gastosFijos: r.gastos ?? 0, ventas: r.ventas ?? 0 }, {});
    setClave((n) => n + 1);
    avisar(`Listo: promedio de ${r.meses?.length ?? 0} ${r.meses?.length === 1 ? "mes" : "meses"} del Estado de Resultados.`);
  }

  // La prueba de Gonzalo, con sus números fijos.
  const prueba = calcularPrecio(PRUEBA_PRECIO.producto, PRUEBA_PRECIO.cfg, new Map(), new Map());
  const ok = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const e = PRUEBA_PRECIO.esperado;

  return (
    <div className="pr-grid">
      {!puedeConfigurar && <p className="pr-aviso ojo pr-ancho">Para cambiar estos números hace falta el permiso de editar la Configuración.</p>}
      <section className="pr-tarjeta">
        <h2>Impuestos</h2>
        <p className="baj">Son los mismos de la pantalla Configuración: cambiarlos acá los cambia en Rentabilidad y el resultado del mes.</p>
        <div className="pr-conf">
          {numeroFila("ivaGeneral", "IVA general (%)", "Cada producto puede tener el suyo (21 % o 10,5 %)", "0.5")}
          {numeroFila("iibb", "Ingresos Brutos (%)", "Sobre el precio sin IVA")}
          {numeroFila("cheque", "Impuesto a los débitos y créditos (%)", "Sobre el total cobrado")}
          {numeroFila("sircreb", "SIRCREB (%)", "Sobre el total cobrado")}
          <div className="pr-fila">
            <span>
              ¿El SIRCREB se descuenta de Ingresos Brutos?
              <small>{cfg.sircrebDescontable ? "Sí: es un adelanto de IIBB, no se suma al precio" : "No: se suma como costo"}</small>
            </span>
            <button
              type="button"
              className="pr-sw"
              role="switch"
              aria-checked={cfg.sircrebDescontable}
              disabled={!puedeConfigurar}
              onClick={() => cambiarConfig({ sircrebDescontable: !cfg.sircrebDescontable }, { sircrebDescontable: !cfg.sircrebDescontable })}
              aria-label="SIRCREB descontable de Ingresos Brutos"
            />
          </div>
        </div>
      </section>

      <section className="pr-tarjeta pr-ancho">
        <h2>Medios de pago</h2>
        <p className="baj">Comisión sin IVA (la misma de Configuración). Tildá qué se resta en cada medio: cambia la ganancia que ves, no el precio de lista.</p>
        <div className="pr-env">
          <table className="pr-medios">
            <thead>
              <tr>
                <th>Medio</th>
                <th>Comisión %</th>
                <th>IVA</th>
                <th>IIBB</th>
                <th>Comisión</th>
                <th>Cheque</th>
                <th>SIRCREB</th>
              </tr>
            </thead>
            <tbody>
              {MEDIOS.map((m) => (
                <tr key={m.clave}>
                  <td>{m.nombre}</td>
                  <td>{comision(m.clave)}</td>
                  {(["iva", "iibb", "com", "cheque", "sircreb"] as (keyof Descuenta)[]).map((k) => (
                    <td key={k}>
                      <input
                        type="checkbox"
                        checked={cfg.descuenta[m.clave][k]}
                        disabled={!puedeConfigurar || (k === "sircreb" && cfg.sircrebDescontable)}
                        onChange={(ev) => tildar(m.clave, k, ev.target.checked)}
                        aria-label={`${m.nombre}: restar ${k}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="nota">
                <td colSpan={7}>
                  El precio de lista siempre lleva IVA e IIBB, porque es el que cobra la caja. Con el SIRCREB descontable de IIBB, no se resta en ningún medio.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10 }}>
          <span style={{ fontWeight: 600 }}>El precio de lista se calcula para</span>
          <div className="pr-radio">
            {MEDIOS.map((m) => (
              <button key={m.clave} type="button" aria-pressed={cfg.escenario === m.clave} disabled={!puedeConfigurar} onClick={() => cambiarConfig({ escenario: m.clave }, { escenario: m.clave })}>
                {m.nombre}
              </button>
            ))}
          </div>
          <p className="baj" style={{ marginTop: 6, marginBottom: 0 }}>
            El peor caso es tarjeta de crédito: así ningún medio te deja abajo.
          </p>
        </div>
      </section>

      <section className="pr-tarjeta" key={`margen-${clave}`}>
        <h2>Margen</h2>
        <p className="baj">El margen mínimo es lo que necesitás para cubrir los gastos fijos, más un colchón.</p>
        <div className="pr-conf">
          {numeroFila("margenDefecto", "Margen por defecto (%)", "Si el producto y su rubro no tienen uno propio", "1")}
          {numeroFila("gastosFijos", "Gastos fijos por mes ($)", "Alquiler, sueldos, servicios…", "1000")}
          {numeroFila("ventas", "Ventas por mes con IVA ($)", "", "1000")}
          {numeroFila("colchon", "Colchón (%)", "", "1")}
          <div className="pr-fila">
            <span>
              Margen mínimo<small>Gastos fijos ÷ ventas sin IVA + colchón. Sin datos: 10 %</small>
            </span>
            <b className="n" style={{ textAlign: "right", fontSize: 16 }}>
              {pct(minimo)}
            </b>
          </div>
        </div>
        <button type="button" className="pr-btn chico" style={{ marginTop: 10 }} disabled={trayendo || !puedeConfigurar} onClick={traer}>
          {trayendo ? "Calculando…" : "Traer gastos y ventas del Estado de Resultados (últimos 3 meses)"}
        </button>
      </section>

      <section className="pr-tarjeta">
        <h2>Redondeo, efectivo y avisos</h2>
        <p className="baj">Los precios se redondean siempre hacia arriba.</p>
        <div className="pr-conf">
          {numeroFila("redondeo", "Redondear a múltiplos de ($)", "Es el mismo redondeo de todo el sistema", "10")}
          {numeroFila("descuentoEfectivo", "Descuento por efectivo (%)", "Cada rubro o producto puede tener el suyo", "1")}
          {numeroFila("tolerancia", "Avisar si el precio de hoy difiere más de (%)", "Para no cambiar la góndola por diferencias chicas", "0.5")}
        </div>
      </section>

      <section className="pr-tarjeta pr-ancho">
        <h2>Prueba de la fórmula</h2>
        <p className="baj">
          Tus números: costo $1.150, margen 35 %, crédito 6,49 %, QR 0,8 %, cheque 0,6 %, SIRCREB descontable y redondeo a $50. Usa esos valores fijos, aparte de la
          configuración: si alguno sale en rojo, la cuenta está mal.
        </p>
        {prueba.ok && (
          <div className="pr-prueba">
            {[
              ["Precio neto", prueba.neto, e.neto, 2],
              ["Con IVA", prueba.conIva, e.conIva, 2],
              ["Al público", prueba.publico, e.publico, 0],
              ["Ganancia con crédito", prueba.porMedio.credito.ganancia, e.credito, 2],
              ["Ganancia con QR", prueba.porMedio.qr.ganancia, e.qr, 2],
              ["Ganancia en efectivo", prueba.porMedio.efectivo.ganancia, e.efectivo, 2],
            ].map(([t, v, esperado, dec]) => (
              <div key={t as string} className={ok(v as number, esperado as number) ? "ok" : "mal"}>
                <span>{t as string}</span>
                <b>
                  {pesos(v as number, dec as number)} {ok(v as number, esperado as number) ? "✓" : "✗"}
                </b>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- Pasar a la venta ----------

function PasarALaVenta({
  items,
  onCerrar,
  onListo,
  onError,
}: {
  items: { p: ProductoDelModulo; r: Extract<ResultadoPrecio, { ok: true }> }[];
  onCerrar: () => void;
  onListo: (n: number) => void;
  onError: (e: string) => void;
}) {
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(items.map((i) => i.p.id)));
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    const r = await pasarALaVenta([...elegidos]);
    setEnviando(false);
    if (r.error) return onError(r.error);
    onListo(r.cambiados ?? 0);
  }

  return (
    <div className="pr-fondo" role="dialog" aria-modal="true" aria-labelledby="pasar-titulo" onClick={onCerrar}>
      <div className="pr-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="pasar-titulo">Pasar a la venta</h2>
          <p>
            Cambia el precio de tarjeta y el de efectivo en todo el sistema: caja, tótem, pantalla asesora y pedidos. Queda en el historial y se crea la tarea de
            cambiar el cartel de góndola.
          </p>
        </header>
        <div className="cuerpo">
          <table className="pr-cambios">
            <tbody>
              {items.map(({ p, r }) => (
                <tr key={p.id}>
                  <td style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={elegidos.has(p.id)}
                      onChange={(e) => {
                        const n = new Set(elegidos);
                        if (e.target.checked) n.add(p.id);
                        else n.delete(p.id);
                        setElegidos(n);
                      }}
                      aria-label={`Pasar ${p.nombre}`}
                    />
                  </td>
                  <td>{p.nombre}</td>
                  <td className="n">
                    {pesos(p.precioHoy)} → <b>{pesos(r.publico)}</b>
                  </td>
                  <td className="n pr-tenue">
                    efectivo {pesos(p.efectivoHoy ?? p.precioHoy)} → {pesos(r.efectivo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer>
          <span className="pr-tenue" style={{ marginRight: "auto", fontSize: 13 }}>
            {elegidos.size} de {items.length}
          </span>
          <button type="button" className="pr-btn" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="button" className="pr-btn prim" disabled={enviando || elegidos.size === 0} onClick={confirmar}>
            {enviando ? "Pasando…" : `Pasar ${elegidos.size} a la venta`}
          </button>
        </footer>
      </div>
    </div>
  );
}
