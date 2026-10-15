"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  pedirCambioPrecios,
  pedirCambioFoto,
  pedirFicha,
  pedirCambioTexto,
  pedirPromo,
  pedirProductoNuevo,
  subirFotoParaAlta,
  pedirBaja,
  cancelarSolicitud,
  type ProductoPropio,
  type SolicitudPropia,
} from "@/app/portal/cambios/actions";
import {
  GRUPO_DE_TIPO,
  ETIQUETA_GRUPO,
  ETIQUETA_RANURA,
  EXPLICA_RANURA,
  type GrupoBandeja,
  type PoliticaDescuentos,
  type RanuraFoto,
  type TipoSolicitud,
} from "@/lib/solicitudesMarca";
import {
  precioParaMargen,
  redondearPrecio,
  simularMargen,
  type CondicionesMarca,
  type MargenSimulado,
  type TasasGenerales,
} from "@/lib/margenMarca";
import { revisarFoto, LADO_MINIMO, type Regla } from "@/lib/fotoProducto";

// Pedir cambios, desde el lado de la marca.
//
// La pantalla está armada alrededor de una sola idea: **nada de lo que se
// toque acá cambia la góndola por sí solo**. Todo lo que se manda queda
// esperando aprobación, y eso se dice en pantalla en vez de darlo por
// entendido — es lo que hace que se pueda dar acceso a un tercero sin miedo.

function pesos(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `$${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fechaHora(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hoyISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

// El icono adelante para que el estado se lea sin leer: el reloj es lo único
// sobre lo que la marca todavía puede hacer algo.
const ESTADO_TEXTO: Record<string, { rotulo: string; clase: string; icono: string }> = {
  PENDIENTE: { rotulo: "Esperando respuesta", clase: "esperando", icono: "⏳" },
  APROBADA: { rotulo: "Aprobado", clase: "ok", icono: "✓" },
  APLICADA: { rotulo: "Ya está activo", clase: "ok", icono: "✓" },
  RECHAZADA: { rotulo: "No aprobado", clase: "no", icono: "✕" },
  CANCELADA: { rotulo: "Lo cancelaste", clase: "gris", icono: "⊘" },
};

type Formulario =
  | "PRECIO" | "EFECTIVO" | "FOTO" | "FICHA" | "NOMBRE" | "DESCRIPCION" | "DESCUENTO" | "BAJA" | null;

export default function PortalCambios({
  productos,
  solicitudes,
  politica,
  subcategorias = [],
  tasas,
  condiciones,
  redondeo,
}: {
  productos: ProductoPropio[];
  solicitudes: SolicitudPropia[];
  politica: PoliticaDescuentos;
  /** Las de la marca, para que al dar de alta elija una en vez de que WiiGo la adivine. */
  subcategorias?: { id: string; nombre: string }[];
  /** Para mostrarle el reparto mientras define el precio del producto nuevo. */
  tasas: TasasGenerales;
  condiciones: CondicionesMarca;
  /** Múltiplo al que se redondea un precio calculado. 0 = sin redondeo. */
  redondeo: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"PEDIR" | "MIOS">("PEDIR");
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);

  // El alta se abre llegando con ?nuevo=1 desde "Añadir nuevo producto", que
  // vive en Mis productos. Se lee acá y no con useSearchParams para no
  // arrastrar el <Suspense> que ese hook exige.
  //
  // Ojo: el link ya existía y no abría nada — nadie leía el parámetro, así
  // que caía en esta pantalla y la marca tenía que encontrar el botón sola.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("nuevo") === "1") {
      setNuevoAbierto(true);
      // Se saca de la URL para que recargar no lo vuelva a abrir.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const pendientes = solicitudes.filter((s) => s.estado === "PENDIENTE").length;

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    // También por subcategoría: ahora que se ve en la fila, buscar "proteínas"
    // y que no traiga nada sería desconcertante.
    return productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) || (p.subcategoria ?? "").toLowerCase().includes(q)
    );
  }, [productos, busqueda]);

  return (
    <main className="portal-lienzo">
      <div className="cam-cab">
        <div>
          <h1 className="cam-titulo">Cambios y altas</h1>
          <p className="cam-sub">
            Cambiá precios, fotos y fichas, y cargá productos nuevos. Lo que mandes lo revisa administración
            de WiiGo: nada cambia en la góndola hasta que esté aprobado.
          </p>
        </div>
        {/* El botón de alta se fue a Mis productos, que es donde la marca lo
            busca. Acá no se repite: dos puertas para lo mismo hacen dudar de
            si son lo mismo. El formulario sigue viviendo en esta pantalla y
            se abre solo cuando se llega con ?nuevo=1. */}
      </div>

      <div className="cam-tabs">
        <button className={`cam-tab${tab === "PEDIR" ? " activa" : ""}`} onClick={() => setTab("PEDIR")}>
          Mis productos
          {productos.length > 0 && <span className="cam-cont">{productos.length}</span>}
        </button>
        {/* "Mis solicitudes" y no "mis pedidos": en WiiGo un pedido es una
            orden de reposición de mercadería, y la marca leería otra cosa. */}
        <button className={`cam-tab${tab === "MIOS" ? " activa" : ""}`} onClick={() => setTab("MIOS")}>
          Mis solicitudes
          {pendientes > 0 && <span className="cam-cont fuerte">{pendientes}</span>}
        </button>
      </div>

      {nuevoAbierto && (
        <FormProductoNuevo
          subcategorias={subcategorias}
          tasas={tasas}
          marca={condiciones}
          onListo={() => { setNuevoAbierto(false); router.refresh(); }}
          onCerrar={() => setNuevoAbierto(false)}
        />
      )}

      {tab === "PEDIR" ? (
        <>
          <input
            className="cam-buscar"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar un producto tuyo"
          />

          {visibles.length === 0 ? (
            <p className="vacio">
              {productos.length === 0
                ? "Todavía no tenés productos cargados. Empezá con “Añadir nuevo producto”, en Mis productos."
                : "Ningún producto coincide con esa búsqueda."}
            </p>
          ) : (
            <ul className="cam-lista">
              {visibles.map((p) => (
                <FilaProducto
                  key={p.idProducto}
                  p={p}
                  politica={politica}
                  condiciones={condiciones}
                  tasas={tasas}
                  redondeo={redondeo}
                  abierto={abierto === p.idProducto}
                  onAbrir={() => setAbierto(abierto === p.idProducto ? null : p.idProducto)}
                  onListo={() => { setAbierto(null); router.refresh(); }}
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        <MisSolicitudes solicitudes={solicitudes} onListo={() => router.refresh()} />
      )}
    </main>
  );
}

const ORDEN_GRUPOS: GrupoBandeja[] = ["PRECIOS", "DESCUENTOS", "PRODUCTOS", "CONTENIDO"];

/**
 * Lo que la marca mandó: filtros por tipo, y adentro lo que espera arriba.
 *
 * Era una sola lista por fecha: con veinte solicitudes, encontrar si el
 * cambio de precio de la semana pasada se aprobó era leerlas todas. Los
 * filtros usan el mismo criterio que la bandeja de WiiGo —precios,
 * descuentos, altas y bajas, contenido— así las dos puntas hablan el mismo
 * idioma.
 *
 * El estado no es otro filtro sino la división de adentro, siempre a la
 * vista: lo que espera es lo único sobre lo que la marca todavía puede hacer
 * algo (cancelarlo), y esconderlo detrás de un botón que hay que acordarse de
 * tocar es justo lo que no queremos. Con dos filas de filtros además había
 * que entender que se cruzan entre sí.
 */
function MisSolicitudes({
  solicitudes,
  onListo,
}: {
  solicitudes: SolicitudPropia[];
  onListo: () => void;
}) {
  const [filtro, setFiltro] = useState<GrupoBandeja | "TODAS">("TODAS");

  // Solo los grupos que tienen algo: un botón "Descuentos 0" es ruido.
  const conteos = ORDEN_GRUPOS.map((g) => ({
    grupo: g,
    cuantas: solicitudes.filter((s) => GRUPO_DE_TIPO[s.tipo] === g).length,
  })).filter((x) => x.cuantas > 0);

  const visibles =
    filtro === "TODAS" ? solicitudes : solicitudes.filter((s) => GRUPO_DE_TIPO[s.tipo] === filtro);

  const enEspera = visibles.filter((s) => s.estado === "PENDIENTE");
  const resueltas = visibles.filter((s) => s.estado !== "PENDIENTE");

  if (solicitudes.length === 0) {
    return <p className="vacio">Todavía no mandaste ningún cambio.</p>;
  }

  return (
    <>
      {conteos.length > 1 && (
        <div className="cam-filtros">
          <button aria-pressed={filtro === "TODAS"} onClick={() => setFiltro("TODAS")}>
            Todas <span className="n">{solicitudes.length}</span>
          </button>
          {conteos.map(({ grupo, cuantas }) => (
            <button
              key={grupo}
              aria-pressed={filtro === grupo}
              onClick={() => setFiltro(grupo)}
            >
              {ETIQUETA_GRUPO[grupo]} <span className="n">{cuantas}</span>
            </button>
          ))}
        </div>
      )}

      {enEspera.length > 0 && (
        <section className="cam-grupo" key="espera">
          <h3>
            <i aria-hidden="true">⏳</i> Esperando respuesta
            <span className="cuantas">{enEspera.length}</span>
          </h3>
          <ul className="cam-hist">
            {enEspera.map((s) => (
              <FilaSolicitud key={s.idSolicitud} s={s} onListo={onListo} />
            ))}
          </ul>
        </section>
      )}

      {resueltas.length > 0 && (
        <section className="cam-grupo" key="resueltas">
          <h3>
            <i aria-hidden="true">✓</i> Ya resueltas
            <span className="cuantas">{resueltas.length}</span>
          </h3>
          <ul className="cam-hist">
            {resueltas.map((s) => (
              <FilaSolicitud key={s.idSolicitud} s={s} onListo={onListo} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ---------- Un producto y sus acciones ----------

function FilaProducto({
  p,
  politica,
  condiciones,
  tasas,
  redondeo,
  abierto,
  onAbrir,
  onListo,
}: {
  p: ProductoPropio;
  politica: PoliticaDescuentos;
  condiciones: CondicionesMarca;
  tasas: TasasGenerales;
  redondeo: number;
  abierto: boolean;
  onAbrir: () => void;
  onListo: () => void;
}) {
  const [form, setForm] = useState<Formulario>(null);

  function esperando(tipo: TipoSolicitud) {
    return p.esperando.includes(tipo);
  }

  return (
    <li className={`cam-prod${abierto ? " abierto" : ""}`}>
      <button className="cam-prod-cab" onClick={onAbrir}>
        <span className="cam-prod-nom">
          {p.nombre}
          {/* La góndola donde va. Sin esto, con 72 productos de nombres
              parecidos no hay forma de saber cuál es cuál sin abrirlo. */}
          <span className="cam-prod-sub">{p.subcategoria ?? "Sin subcategoría"}</span>
        </span>
        <span className="cam-prod-datos">
          <span className="mono">{pesos(p.precio)}</span>
          <span className="cam-stock">{p.stock} en góndola</span>
          {p.esperando.length > 0 && <span className="cam-espera">{p.esperando.length} esperando</span>}
        </span>
      </button>

      {abierto && (
        <div className="cam-panel">
          <div className="cam-opciones">
            {/* Uno solo, no dos. Los dos precios son una sola decisión: lo
                que la marca cuida es la diferencia entre ellos, y con botones
                separados cambiaba uno y se olvidaba del otro. */}
            <Opcion activa={form === "PRECIO"} bloqueada={esperando("PRECIO")} onClick={() => setForm(form === "PRECIO" ? null : "PRECIO")}>
              Precios
            </Opcion>
            <Opcion activa={form === "FOTO"} bloqueada={esperando("FOTO")} onClick={() => setForm(form === "FOTO" ? null : "FOTO")}>
              Foto
            </Opcion>
            <Opcion activa={form === "FICHA"} bloqueada={esperando("FICHA")} onClick={() => setForm(form === "FICHA" ? null : "FICHA")}>
              Info nutricional
            </Opcion>
            <Opcion activa={form === "DESCUENTO"} bloqueada={esperando("DESCUENTO")} onClick={() => setForm(form === "DESCUENTO" ? null : "DESCUENTO")}>
              Proponer promo
            </Opcion>
            <Opcion activa={form === "DESCRIPCION"} bloqueada={esperando("DESCRIPCION")} onClick={() => setForm(form === "DESCRIPCION" ? null : "DESCRIPCION")}>
              Descripción
            </Opcion>
            <Opcion activa={form === "NOMBRE"} bloqueada={esperando("NOMBRE")} onClick={() => setForm(form === "NOMBRE" ? null : "NOMBRE")}>
              Nombre
            </Opcion>
            <Opcion activa={form === "BAJA"} bloqueada={esperando("BAJA_PRODUCTO")} onClick={() => setForm(form === "BAJA" ? null : "BAJA")}>
              Dar de baja
            </Opcion>
          </div>

          {p.esperando.length > 0 && (
            <p className="cam-nota">
              Lo que ya mandaste para este producto está esperando respuesta. Podés cancelarlo desde “Mis
            solicitudes”.
            </p>
          )}

          {form === "PRECIO" && (
            <FormPrecios
              p={p}
              politica={politica}
              condiciones={condiciones}
              tasas={tasas}
              redondeo={redondeo}
              onListo={onListo}
            />
          )}
          {form === "FOTO" && <FormFoto p={p} onListo={onListo} />}
          {form === "FICHA" && <FormFicha p={p} onListo={onListo} />}
          {form === "DESCUENTO" && <FormPromo p={p} politica={politica} onListo={onListo} />}
          {form === "DESCRIPCION" && <FormTexto p={p} tipo="DESCRIPCION" onListo={onListo} />}
          {form === "NOMBRE" && <FormTexto p={p} tipo="NOMBRE" onListo={onListo} />}
          {form === "BAJA" && <FormBaja p={p} onListo={onListo} />}
        </div>
      )}
    </li>
  );
}

function Opcion({
  children,
  activa,
  bloqueada,
  onClick,
}: {
  children: React.ReactNode;
  activa: boolean;
  bloqueada: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`cam-op${activa ? " activa" : ""}`}
      disabled={bloqueada}
      onClick={onClick}
      title={bloqueada ? "Ya mandaste un pedido de este tipo y todavía está esperando respuesta" : undefined}
    >
      {children}
      {bloqueada && <span className="cam-reloj">⏳</span>}
    </button>
  );
}

/** Envoltura común: mensaje de error, aviso y botón. Todos los formularios se comportan igual. */
function Envio({
  children,
  onEnviar,
  texto,
  deshabilitado,
  pie,
}: {
  children: React.ReactNode;
  onEnviar: () => Promise<{ error: string | null; aviso?: string }>;
  texto: string;
  deshabilitado?: boolean;
  pie?: React.ReactNode;
}) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  return (
    <div className="cam-form">
      {children}
      {pie}
      {error && <p className="cam-error">{error}</p>}
      {aviso && <p className="cam-aviso">⚠ {aviso}</p>}
      <button
        className="cam-btn primario"
        disabled={pendiente || deshabilitado}
        onClick={() => {
          setError(null);
          setAviso(null);
          startTransition(async () => {
            const r = await onEnviar();
            if (r.error) setError(r.error);
            else if (r.aviso) setAviso(r.aviso);
          });
        }}
      >
        {pendiente ? "Mandando..." : texto}
      </button>
    </div>
  );
}

type ModoPrecio = "PESOS" | "PORC" | "GANAR";

/**
 * Lo que le queda con un precio, desglosado.
 *
 * Sin la línea del costo: ya está arriba en la franja, y repetirla una vez
 * por columna es ruido. Lo que importa acá es el camino desde lo que paga el
 * cliente hasta lo que entra.
 */
function ColumnaGana({
  m,
  titulo,
  principal = false,
}: {
  m: MargenSimulado;
  titulo: string;
  principal?: boolean;
}) {
  const bajas: [string, number][] = [
    ["Comisión WiiGo", m.comisionWiigo],
    ["IVA de esa comisión", m.ivaComision],
    ["Mercado Pago", m.comisionMp],
    ["Impuestos bancarios", m.impCreditos + m.impDebitos],
  ];

  return (
    <div className={`cam-gana-col${principal ? " principal" : ""}`}>
      <p className="tit">{titulo}</p>
      <p className="paga">
        El cliente paga <b>{pesos(m.precio)}</b>
      </p>
      <ul>
        {bajas
          .filter(([, v]) => v > 0)
          .map(([t, v]) => (
            <li key={t}>
              <span>− {t}</span>
              <b>{pesos(v)}</b>
            </li>
          ))}
      </ul>
      <p className="transf">
        Te transferimos <b>{pesos(m.leTransferimos)}</b>
      </p>
      {m.leQueda !== null && (
        <p className="final">
          Ganás <b>{pesos(m.leQueda)}</b>
          {m.porcentaje !== null && <em>· {m.porcentaje.toFixed(1)}%</em>}
        </p>
      )}
    </div>
  );
}

/**
 * Escribir en pesos o en porcentaje.
 *
 * Una lista se actualiza pensando "subo todo un 12%", no calculadora en mano
 * producto por producto; pero a veces el precio es uno puntual y redondo. Los
 * dos modos escriben el mismo valor: el porcentaje es una forma de tipear, no
 * otro dato que haya que guardar.
 */
function Modo({
  valor,
  onCambiar,
  conGanar = false,
}: {
  valor: ModoPrecio;
  onCambiar: (m: ModoPrecio) => void;
  /** El tercer modo solo existe con costo cargado: sin él no hay cuenta. */
  conGanar?: boolean;
}) {
  return (
    <span className="cam-modo">
      <button
        type="button"
        className={valor === "PESOS" ? "activo" : undefined}
        onClick={() => onCambiar("PESOS")}
        title="Escribo el precio"
      >
        $
      </button>
      <button
        type="button"
        className={valor === "PORC" ? "activo" : undefined}
        onClick={() => onCambiar("PORC")}
        title="Escribo el aumento"
      >
        %
      </button>
      {conGanar && (
        <button
          type="button"
          className={valor === "GANAR" ? "activo" : undefined}
          onClick={() => onCambiar("GANAR")}
          title="Escribo cuánto quiero ganar"
        >
          ★
        </button>
      )}
    </span>
  );
}

/**
 * Los dos precios, atados por el descuento.
 *
 * Antes eran dos formularios y dos botones. El problema no era la cantidad de
 * clics: era que cambiar la góndola y olvidarse del efectivo le movía el
 * descuento a la marca sin que lo decidiera —de 14% a 21,7% en el caso que lo
 * destapó— y ese descuento lo absorbe casi entero ella.
 *
 * Los tres campos son el mismo número visto de tres formas, así que se tocan
 * los tres y los otros dos se acomodan. El porcentaje es editable y no un
 * cartel porque ES la variable que la marca cuida; los pesos son la
 * consecuencia.
 */
function FormPrecios({
  p,
  politica,
  condiciones,
  tasas,
  redondeo,
  onListo,
}: {
  p: ProductoPropio;
  politica: PoliticaDescuentos;
  condiciones: CondicionesMarca;
  tasas: TasasGenerales;
  redondeo: number;
  onListo: () => void;
}) {
  const offDeHoy =
    p.precio && p.precioEfectivo !== null ? ((p.precio - p.precioEfectivo) / p.precio) * 100 : null;

  const [gondola, setGondola] = useState(p.precio ? String(p.precio) : "");
  const [efectivo, setEfectivo] = useState(p.precioEfectivo !== null ? String(p.precioEfectivo) : "");
  // El descuento arranca en el que ya tenía: lo normal es cambiar el precio y
  // mantenerlo, no rediseñar la promoción.
  const [off, setOff] = useState(offDeHoy !== null ? offDeHoy.toFixed(1) : "");

  // En pesos o en porcentaje, para cada uno.
  //
  // Una lista de precios se actualiza pensando "subo todo un 12%", no
  // calculadora en mano producto por producto. Pero a veces el precio es uno
  // puntual y redondo. Los dos modos escriben el MISMO campo de abajo: el
  // porcentaje es una forma de tipear, no otro dato.
  const [modoGondola, setModoGondola] = useState<ModoPrecio>("PESOS");
  const [modoEfectivo, setModoEfectivo] = useState<ModoPrecio>("PESOS");
  const [aumento, setAumento] = useState("");
  const [ganar, setGanar] = useState("");
  /** El precio exacto antes de redondear, solo para mostrar de dónde salió. */
  const [precioCrudo, setPrecioCrudo] = useState<number | null>(null);

  const nGondola = Number(gondola);
  const nEfectivo = Number(efectivo);
  const nOff = Number(off);

  const gondolaValida = Number.isFinite(nGondola) && nGondola > 0;
  const usaEfectivo = efectivo.trim() !== "";

  const redondear = (n: number) => Math.round(n * 100) / 100;

  /**
   * El efectivo también se redondea al múltiplo, y el descuento se recalcula
   * contra el precio YA redondeado. Si no, la pantalla diría 14% y los
   * precios que se guardan darían 13,8%: el número que la marca mira no
   * sería el que termina en la góndola.
   */
  function ponerEfectivoDesde(precioGondola: number, descuento: number) {
    const bruto = precioGondola * (1 - descuento / 100);
    const final = redondearPrecio(bruto, redondeo);
    setEfectivo(String(final));
    setOff((((precioGondola - final) / precioGondola) * 100).toFixed(1));
  }

  // Mover uno mueve los otros. El que se tocó manda; los demás se recalculan.
  function tocarGondola(v: string) {
    setGondola(v);
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(nOff) || off.trim() === "") return;
    ponerEfectivoDesde(n, nOff);
  }

  function tocarEfectivo(v: string) {
    setEfectivo(v);
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || !gondolaValida) return;
    setOff(((nGondola - n) / nGondola * 100).toFixed(1));
  }

  function tocarOff(v: string) {
    setOff(v);
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n >= 100 || !gondolaValida) return;
    ponerEfectivoDesde(nGondola, n);
  }

  /** "Subime todo un 12%" — se escribe el porcentaje y cae el precio. */
  function tocarAumento(v: string) {
    setAumento(v);
    const n = Number(v);
    if (!Number.isFinite(n) || !p.precio) return;
    tocarGondola(String(redondearPrecio(p.precio * (1 + n / 100), redondeo)));
  }

  /**
   * "Quiero ganar 30%" — la cuenta al revés, y el único modo que necesita el
   * costo. El precio que sale se redondea para arriba: con centavos no hay
   * cartel de góndola posible.
   */
  function tocarGanar(v: string) {
    setGanar(v);
    const n = Number(v);
    if (p.costo === null) return;
    const crudo = precioParaMargen({ margenDeseado: n, costo: p.costo, marca: condiciones, tasas });
    if (crudo === null) return;
    setPrecioCrudo(crudo);
    tocarGondola(String(redondearPrecio(crudo, redondeo)));
  }

  // Lo que le queda HOY, para la franja de arriba.
  const hoyTarjeta =
    p.precio && p.costo !== null
      ? simularMargen({ precio: p.precio, costo: p.costo, marca: condiciones, tasas }).find(
          (m) => m.medio === "CREDITO"
        )
      : null;

  // Lo que de verdad le queda con el precio puesto. Es el mismo cálculo que
  // la liquidación que le paga — no una aproximación para la pantalla.
  const conTarjeta =
    gondolaValida && p.costo !== null
      ? simularMargen({ precio: nGondola, costo: p.costo, marca: condiciones, tasas }).find(
          (m) => m.medio === "CREDITO"
        )
      : null;
  const conEfectivo =
    usaEfectivo && nEfectivo > 0 && p.costo !== null
      ? simularMargen({ precio: nEfectivo, costo: p.costo, marca: condiciones, tasas }).find(
          (m) => m.medio === "EFECTIVO"
        )
      : null;

  const variacion = gondolaValida && p.precio ? ((nGondola - p.precio) / p.precio) * 100 : null;
  const ahorro = gondolaValida && usaEfectivo && nEfectivo > 0 ? nGondola - nEfectivo : null;
  const efectivoMalo = usaEfectivo && (!Number.isFinite(nEfectivo) || nEfectivo <= 0 || nEfectivo > nGondola);
  const sinCambio =
    gondolaValida &&
    nGondola === p.precio &&
    ((!usaEfectivo && p.precioEfectivo === null) || nEfectivo === p.precioEfectivo);

  return (
    <Envio
      texto="Mandar los dos precios"
      deshabilitado={!gondolaValida || efectivoMalo || sinCambio}
      onEnviar={async () => {
        const r = await pedirCambioPrecios(
          p.idProducto,
          nGondola,
          usaEfectivo && nEfectivo > 0 ? nEfectivo : null
        );
        if (!r.error) onListo();
        return r;
      }}
      pie={
        <p className="cam-nota">
          Si los aprueban, los dos entran juntos a las {politica.horaAplicacion} con el local cerrado —
          nunca a mitad del día, para que el cartel de góndola y la caja digan siempre lo mismo.
        </p>
      }
    >
      {/* El costo arriba de todo: nadie elige un precio mirando el precio.
          Si no lo cargó, se le dice dónde — sin costo no hay forma de
          mostrarle lo que gana, y el tercer modo no existe. */}
      {p.costo !== null ? (
        <div className="cam-costo">
          <span>
            <small>Tu costo</small>
            <b>{pesos(p.costo)}</b>
          </span>
          <i>→</i>
          <span>
            <small>Góndola hoy</small>
            <b>{pesos(p.precio)}</b>
          </span>
          <i>→</i>
          <span>
            <small>Te queda hoy</small>
            <b className="bien">{hoyTarjeta?.leQueda !== null && hoyTarjeta ? pesos(hoyTarjeta.leQueda) : "—"}</b>
            {hoyTarjeta?.porcentaje !== null && hoyTarjeta && (
              <em>· {hoyTarjeta.porcentaje!.toFixed(1)}%</em>
            )}
          </span>
          <small className="aparte">Esto lo ven solo vos y WiiGo.</small>
        </div>
      ) : (
        <p className="cam-nota">
          Todavía no cargaste tu costo, así que no podemos mostrarte cuánto ganás con cada precio.
          Se carga en <b>Mis productos</b>.
        </p>
      )}

      <div className="cam-campos">
        <label className="cam-campo">
          <span>Góndola — hoy</span>
          <input className="mono" value={pesos(p.precio)} disabled />
        </label>
        <label className="cam-campo">
          <span>
            {modoGondola === "PESOS"
              ? "Góndola — nuevo"
              : modoGondola === "PORC"
                ? "Aumento"
                : "Quiero ganar"}
            <Modo valor={modoGondola} onCambiar={setModoGondola} conGanar={p.costo !== null} />
          </span>
          {modoGondola === "PESOS" ? (
            <input
              type="number"
              step="0.01"
              value={gondola}
              onChange={(e) => tocarGondola(e.target.value)}
              placeholder="0,00"
              autoFocus
            />
          ) : modoGondola === "PORC" ? (
            <input
              type="number"
              step="0.1"
              value={aumento}
              onChange={(e) => tocarAumento(e.target.value)}
              placeholder="0,0"
              autoFocus
            />
          ) : (
            <input
              type="number"
              step="0.1"
              min="0"
              max="99"
              value={ganar}
              onChange={(e) => tocarGanar(e.target.value)}
              placeholder="30"
              autoFocus
            />
          )}
        </label>
      </div>

      {modoGondola !== "PESOS" && gondolaValida && (
        <p className="cam-var">
          Queda en <b>{pesos(nGondola)}</b>
          {modoGondola === "GANAR" && precioCrudo !== null && redondeo > 0 && (
            <> · la cuenta daba {pesos(precioCrudo)} y se redondeó para arriba al próximo {pesos(redondeo)}</>
          )}
        </p>
      )}
      {variacion !== null && variacion !== 0 && (
        <p className={`cam-var${Math.abs(variacion) >= politica.variacionPrecioAlerta ? " fuerte" : ""}`}>
          {variacion > 0 ? "+" : ""}
          {variacion.toFixed(1)}% · es el precio con tarjeta o QR
          {Math.abs(variacion) >= politica.variacionPrecioAlerta &&
            " — es un salto grande, revisá que no te haya quedado un cero de más."}
        </p>
      )}

      <div className="cam-precios-efectivo">
        <div className="cam-campos">
          <label className="cam-campo">
            <span>Efectivo — hoy</span>
            <input className="mono" value={p.precioEfectivo !== null ? pesos(p.precioEfectivo) : "sin cargar"} disabled />
          </label>
          <label className="cam-campo">
            <span>
              Efectivo — nuevo
              <Modo valor={modoEfectivo} onCambiar={setModoEfectivo} />
            </span>
            {/* El % del efectivo es el descuento sobre la góndola, no un
                aumento sobre el efectivo de ayer: es el número que se negocia
                y el que va impreso en el cartel. Dos porcentajes distintos
                para el mismo campo serían imposibles de distinguir. */}
            {modoEfectivo === "PESOS" ? (
              <input
                type="number"
                step="0.01"
                value={efectivo}
                onChange={(e) => tocarEfectivo(e.target.value)}
                placeholder="0,00"
              />
            ) : (
              <input
                type="number"
                step="0.1"
                min="0"
                max="99"
                value={off}
                onChange={(e) => tocarOff(e.target.value)}
                placeholder="0,0"
              />
            )}
          </label>
        </div>

        <div className="cam-off">
          <span>Descuento por pagar en efectivo</span>
          <b className="numero">{off === "" ? "—" : `${Number(off).toFixed(1)}%`}</b>
          {ahorro !== null && ahorro > 0 && (
            <span className="ahorro">
              · el cliente ahorra <b>{pesos(ahorro)}</b>
            </span>
          )}
          {usaEfectivo && nEfectivo > 0 && <span className="ahorro">· paga {pesos(nEfectivo)}</span>}
        </div>

        <p className="cam-nota">
          {offDeHoy !== null
            ? `Es el mismo ${offDeHoy.toFixed(1)}% que tenías. Al mover la góndola, el efectivo se acomoda solo para mantenerlo.`
            : "Todavía no tenés precio en efectivo. Si cargás uno, el descuento queda fijo y se mantiene cuando cambies la góndola."}{" "}
          Podés escribir en pesos o en porcentaje, y lo otro se calcula solo.
        </p>

        {efectivoMalo && (
          <p className="cam-var fuerte">El efectivo no puede ser mayor al precio de góndola.</p>
        )}

        {/* Lo que gana con estos precios, por medio de pago. No es "precio
            menos costo": de lo que paga el cliente salen la comisión, su IVA,
            Mercado Pago y los impuestos. Mostrarle un margen ingenuo se le
            caería en la primera liquidación. */}
        {conTarjeta && (
          <div className="cam-gana">
            <ColumnaGana m={conTarjeta} titulo="Con tarjeta o QR" principal />
            {conEfectivo && (
              <ColumnaGana m={conEfectivo} titulo={`En efectivo · −${Number(off || 0).toFixed(1)}%`} />
            )}
          </div>
        )}

        {/* El aviso que evita la sorpresa: un descuento de efectivo más
            grande que las comisiones que ahorra le deja MENOS, no más. */}
        {conTarjeta?.leQueda != null && conEfectivo?.leQueda != null && conEfectivo.leQueda < conTarjeta.leQueda && (
          <p className="cam-var fuerte">
            En efectivo te queda {pesos(conTarjeta.leQueda - conEfectivo.leQueda)} menos por unidad: el
            descuento es más grande que las comisiones que te ahorrás. No está mal —el efectivo vende
            más— pero conviene saberlo antes.
          </p>
        )}
      </div>
    </Envio>
  );
}

/**
 * La información nutricional, tal como está impresa en el envase.
 *
 * Los números van por 100 g y no por porción: es la única forma de que el
 * cliente pueda comparar dos productos en la pantalla del local. Casi todas
 * las etiquetas traen las dos columnas, y copiar la equivocada es el error más
 * común — por eso el formulario lo dice en cada campo y el servidor lo frena
 * si los macros suman más de 100 g.
 */
function FormFicha({ p, onListo }: { p: ProductoPropio; onListo: () => void }) {
  const [f, setF] = useState(() => ({
    kcal_100g: p.ficha.kcal_100g?.toString() ?? "",
    proteinas: p.ficha.proteinas?.toString() ?? "",
    carbohidratos: p.ficha.carbohidratos?.toString() ?? "",
    grasas: p.ficha.grasas?.toString() ?? "",
    fibra: p.ficha.fibra?.toString() ?? "",
    sodio: p.ficha.sodio?.toString() ?? "",
    porcion: p.ficha.porcion ?? "",
    ingredientes: p.ficha.ingredientes ?? "",
    micronutrientes: p.ficha.micronutrientes ?? "",
    origen: p.ficha.origen ?? "",
  }));

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value }));
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

  const suma =
    (n(f.proteinas) ?? 0) + (n(f.carbohidratos) ?? 0) + (n(f.grasas) ?? 0) + (n(f.fibra) ?? 0);
  const algo = Object.values(f).some((v) => v.trim() !== "");

  const NUMS: [keyof typeof f, string][] = [
    ["kcal_100g", "Calorías (kcal)"],
    ["proteinas", "Proteínas (g)"],
    ["carbohidratos", "Carbohidratos (g)"],
    ["grasas", "Grasas (g)"],
    ["fibra", "Fibra (g)"],
    ["sodio", "Sodio (mg)"],
  ];

  return (
    <Envio
      texto="Mandar la información nutricional"
      deshabilitado={!algo || suma > 100}
      onEnviar={async () => {
        const r = await pedirFicha(p.idProducto, {
          kcal_100g: n(f.kcal_100g),
          proteinas: n(f.proteinas),
          carbohidratos: n(f.carbohidratos),
          grasas: n(f.grasas),
          fibra: n(f.fibra),
          sodio: n(f.sodio),
          porcion: f.porcion || null,
          ingredientes: f.ingredientes || null,
          micronutrientes: f.micronutrientes || null,
          origen: f.origen || null,
        });
        if (!r.error) onListo();
        return r;
      }}
      pie={
        <p className="cam-nota">
          Todo <strong>cada 100 g o 100 ml</strong>, como en la etiqueta. Si tu envase trae las dos
          columnas, copiá la de 100 — la de porción va aparte, en “Porción sugerida”. Lo que no sepas,
          dejalo vacío: se puede completar después.
        </p>
      }
    >
      <div className="cam-nutri">
        {NUMS.map(([k, label]) => (
          <label className="cam-campo" key={k}>
            <span>{label}</span>
            <input type="number" step="0.1" min="0" value={f[k]} onChange={set(k)} placeholder="—" />
          </label>
        ))}
      </div>

      {suma > 100 && (
        <p className="cam-var fuerte">
          Proteínas, carbohidratos, grasas y fibra suman {suma.toFixed(1)} g cada 100 g. ¿No copiaste
          los valores por porción?
        </p>
      )}

      <div className="cam-campos">
        <label className="cam-campo">
          <span>Porción sugerida</span>
          <input value={f.porcion} onChange={set("porcion")} placeholder="30 g (un puñado)" />
        </label>
        <label className="cam-campo">
          <span>Origen</span>
          <input value={f.origen} onChange={set("origen")} placeholder="Mendoza, Argentina" />
        </label>
      </div>

      <label className="cam-campo ancho">
        <span>Ingredientes</span>
        <textarea
          rows={3}
          value={f.ingredientes}
          onChange={set("ingredientes")}
          placeholder="Como figura en el envase, separados por coma."
        />
      </label>

      <label className="cam-campo ancho">
        <span>Micronutrientes</span>
        <textarea
          rows={2}
          value={f.micronutrientes}
          onChange={set("micronutrientes")}
          placeholder="Vitamina B6, Zinc, Magnesio…"
        />
      </label>
    </Envio>
  );
}

/** La foto del producto. Se sube al mandarla para que se pueda ver antes de aprobar. */
function FormFoto({ p, onListo }: { p: ProductoPropio; onListo: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [reglas, setReglas] = useState<Regla[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisando, setRevisando] = useState(false);
  // Arranca en la primera que falte, y si están las tres, en el frente. Así
  // el caso más común —completar lo que falta— no pide elegir nada.
  const [ranura, setRanura] = useState<RanuraFoto>(
    p.fotos.find((f) => !f.url)?.ranura ?? "principal"
  );

  // Mismo criterio que en el alta: lo que no cumple el estándar no llega a
  // mandarse, y lo que cumple sale ya cuadrado y en WebP.
  async function elegir(f: File | null) {
    setError(null);
    setReglas(null);
    setArchivo(null);
    setVista((v) => {
      if (v) URL.revokeObjectURL(v);
      return null;
    });
    if (!f) return;

    setRevisando(true);
    const r = await revisarFoto(f);
    setRevisando(false);
    setReglas(r.reglas);
    if (r.error || !r.archivo) {
      setError(r.error ?? "No pudimos preparar esa foto.");
      return;
    }
    setArchivo(r.archivo);
    setVista(r.vista);
  }

  return (
    <Envio
      texto={`Mandar la foto: ${ETIQUETA_RANURA[ranura].toLowerCase()}`}
      deshabilitado={!archivo || revisando}
      onEnviar={async () => {
        if (!archivo) return { error: "Elegí una foto." };
        const fd = new FormData();
        fd.set("archivo", archivo);
        fd.set("ranura", ranura);
        const r = await pedirCambioFoto(p.idProducto, fd);
        if (!r.error) onListo();
        return r;
      }}
      pie={<ElEstandar />}
    >
      {/* Las tres a la vez. Antes se mostraba solo la principal y la marca
          creía que las otras dos no habían entrado — y no tenía forma de
          corregir el dorso sin pisar el frente. */}
      <div className="cam-fotos">
        {p.fotos.map((f) => (
          <button
            type="button"
            key={f.ranura}
            className={`cam-foto elegible${ranura === f.ranura ? " activa" : ""}`}
            onClick={() => setRanura(f.ranura)}
            title={EXPLICA_RANURA[f.ranura]}
          >
            <span>{ETIQUETA_RANURA[f.ranura]}</span>
            {f.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.url} alt="" />
            ) : (
              <div className="cam-foto-vacia">falta</div>
            )}
          </button>
        ))}
        <div className="cam-foto nueva">
          <span>La nueva</span>
          {vista ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={vista} alt="" />
          ) : (
            <div className="cam-foto-vacia">{revisando ? "revisando…" : "elegí una"}</div>
          )}
        </div>
      </div>
      <p className="cam-var">
        Vas a reemplazar <b>{ETIQUETA_RANURA[ranura].toLowerCase()}</b>. {EXPLICA_RANURA[ranura]}{" "}
        Tocá otra de arriba para cambiar cuál.
      </p>
      <input
        type="file"
        accept="image/*"
        disabled={revisando}
        onChange={(e) => elegir(e.target.files?.[0] ?? null)}
      />
      {reglas && <ReglasFoto reglas={reglas} />}
      {error && <p className="cam-var fuerte">{error}</p>}
      {vista && <ComoSeVe url={vista} nombre={p.nombre} precio={p.precio ?? null} />}
    </Envio>
  );
}

/**
 * El estándar de fotos, adentro del formulario.
 *
 * Estaba como una nota al pie con "fondo claro y sin texto encima", que es
 * una sugerencia: la cumple el que ya la iba a cumplir. Dicho en reglas
 * numerables, y con el validador atrás que las aplica, pasa a ser el
 * estándar de verdad.
 */
function ElEstandar() {
  return (
    <div className="cam-estandar">
      <b>Cómo tiene que ser la foto</b>
      <ul>
        <li>Cuadrada, de {LADO_MINIMO}×{LADO_MINIMO} px para arriba</li>
        <li>Fondo blanco liso — sin mesa, sin mano, sin tela</li>
        <li>El producto entero y centrado, sin tocar los bordes</li>
        <li>El envase de frente, derecho, como se ve en la góndola</li>
        <li>Sin logos, textos, precios ni marcas de agua encima</li>
      </ul>
      <small>
        La revisamos al elegirla y te avisamos acá mismo si algo no da. La dejamos cuadrada nosotros,
        no hace falta que la recortes.
      </small>
    </div>
  );
}

/** Qué cumplió y qué no la foto que acaba de elegir. */
function ReglasFoto({ reglas }: { reglas: Regla[] }) {
  return (
    <ul className="cam-reglas">
      {reglas.map((r) => (
        <li key={r.id} className={r.ok ? "ok" : "no"}>
          <i aria-hidden="true">{r.ok ? "✓" : "✕"}</i>
          {r.texto}
        </li>
      ))}
    </ul>
  );
}

/**
 * La foto en el lugar donde se va a ver.
 *
 * Es lo que más corrige de todo esto: nadie lee el reglamento, pero cualquiera
 * ve que su foto quedó torcida o chica cuando la mira en la tarjeta del tótem
 * en vez de en un recuadro de formulario.
 */
function ComoSeVe({
  url,
  nombre,
  precio,
}: {
  url: string;
  nombre?: string;
  precio?: number | null;
}) {
  return (
    <div className="cam-comoseve">
      <span className="t">Así se va a ver en el tótem</span>
      <div className="cam-totem">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" />
        <div className="pie">
          <b>{nombre?.trim() || "Nombre del producto"}</b>
          <span className="mono">{precio ? pesos(precio) : "$ —"}</span>
        </div>
      </div>
    </div>
  );
}

function FormPromo({ p, politica, onListo }: { p: ProductoPropio; politica: PoliticaDescuentos; onListo: () => void }) {
  const [porcentaje, setPorcentaje] = useState("");
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const pct = Number(porcentaje);
  const valido = Number.isFinite(pct) && pct > 0 && pct < 100;
  const precioPromo = valido && p.precio ? p.precio * (1 - pct / 100) : null;

  return (
    <Envio
      texto="Proponer la promo"
      deshabilitado={!valido}
      onEnviar={async () => {
        const r = await pedirPromo(p.idProducto, pct, desde, hasta);
        if (!r.error) onListo();
        return r;
      }}
      pie={
        <p className="cam-nota">
          Hasta {politica.maxSinConsulta}% lo resuelve administración. Más que eso pasa al dueño, así que puede
          tardar un poco más. Las promos duran hasta {politica.duracionMaxDias} días y el mismo producto no puede
          repetir antes de {politica.diasEntrePromos}.
        </p>
      }
    >
      <div className="cam-campos">
        <label className="cam-campo">
          <span>Descuento</span>
          <input
            type="number"
            step="1"
            value={porcentaje}
            onChange={(e) => setPorcentaje(e.target.value)}
            placeholder="%"
            autoFocus
          />
        </label>
        <label className="cam-campo">
          <span>Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="cam-campo">
          <span>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>
      {precioPromo !== null && (
        <p className="cam-var">
          Queda en <b className="mono">{pesos(Math.round(precioPromo * 100) / 100)}</b> (hoy {pesos(p.precio)})
        </p>
      )}
    </Envio>
  );
}

function FormTexto({
  p,
  tipo,
  onListo,
}: {
  p: ProductoPropio;
  tipo: "NOMBRE" | "DESCRIPCION";
  onListo: () => void;
}) {
  const actual = tipo === "NOMBRE" ? p.nombre : p.descripcion ?? "";
  const [texto, setTexto] = useState(actual);
  const largo = texto.trim().length;

  return (
    <Envio
      texto={tipo === "NOMBRE" ? "Mandar el nombre nuevo" : "Mandar la descripción"}
      deshabilitado={!texto.trim() || texto.trim() === actual.trim()}
      onEnviar={async () => {
        const r = await pedirCambioTexto(p.idProducto, tipo, texto);
        if (!r.error) onListo();
        return r;
      }}
      pie={
        <p className="cam-nota">
          {tipo === "NOMBRE"
            ? "El nombre se ve en el tótem, en el ticket y en las pantallas del local."
            : "La descripción se ve en el tótem y en las pantallas asesoras. Máximo 280 caracteres: más largo se corta en pantalla."}
        </p>
      }
    >
      <label className="cam-campo ancho">
        <span>{tipo === "NOMBRE" ? "Nombre" : "Descripción"}</span>
        {tipo === "NOMBRE" ? (
          <input value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
        ) : (
          <textarea rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
        )}
      </label>
      {tipo === "DESCRIPCION" && (
        <p className={`cam-var${largo > 280 ? " fuerte" : ""}`}>{largo} de 280 caracteres</p>
      )}
    </Envio>
  );
}

function FormBaja({ p, onListo }: { p: ProductoPropio; onListo: () => void }) {
  return (
    <Envio
      texto="Pedir la baja"
      onEnviar={async () => {
        const r = await pedirBaja(p.idProducto);
        if (!r.error) onListo();
        return r;
      }}
    >
      <p className="cam-nota">
        {p.stock > 0
          ? `Todavía hay ${p.stock} unidades en góndola. Primero hay que retirar la mercadería: el pedido se va a frenar hasta que el stock quede en cero.`
          : "El producto deja de venderse y sale del tótem. Las ventas viejas y las liquidaciones no cambian."}
      </p>
    </Envio>
  );
}

// ---------- Producto nuevo ----------

type VarianteForm = { nombre: string; codigoBarras: string; precio: string };

/**
 * Cuánto texto entra en cada campo.
 *
 * No es capricho: lo que se escribe acá se muestra en el tótem y en el
 * Asesor, que son pantallas con un ancho fijo. Una descripción de mil
 * caracteres no se lee mejor, se desborda o se corta a la mitad de una
 * palabra. El límite obliga a decir lo importante.
 */
const LARGOS = {
  nombre: 80,
  descripcion: 280,
  porcion: 60,
  origen: 60,
  ingredientes: 400,
  micronutrientes: 200,
} as const;

/**
 * Una sección del alta, con su título.
 *
 * Los campos sueltos uno abajo del otro se leen como una lista larga sin
 * principio ni fin; agrupados en bloques con encabezado se ve de un vistazo
 * cuántas cosas hay y de qué va cada una. Es el mismo criterio que usa el
 * formulario de WiiGo del lado de adentro.
 */
function Bloque({
  icono,
  titulo,
  desc,
  children,
}: {
  icono: string;
  titulo: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="cam-bloque">
      <h3>
        <span aria-hidden="true">{icono}</span>
        {titulo}
      </h3>
      {desc && <p className="d">{desc}</p>}
      {children}
    </section>
  );
}

/**
 * Un campo de texto con su contador.
 *
 * El contador aparece recién cuando queda poco: mostrarlo desde el carácter
 * uno distrae de escribir, y lo que importa es avisar antes de que se pase,
 * no llevar la cuenta todo el tiempo.
 */
function CampoTexto({
  etiqueta,
  valor,
  onChange,
  max,
  filas = 3,
  placeholder,
  ayuda,
  obligatorio,
  mostrarFalta,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  max: number;
  filas?: number;
  placeholder?: string;
  ayuda?: string;
  obligatorio?: boolean;
  mostrarFalta?: boolean;
}) {
  const usados = valor.length;
  const quedan = max - usados;
  const falta = Boolean(obligatorio && mostrarFalta && valor.trim() === "");

  return (
    <label className="cam-campo ancho">
      <span>
        {etiqueta}
        {obligatorio && " *"}
        {quedan <= max * 0.2 && (
          <span className={`cam-contador${quedan <= 0 ? " lleno" : ""}`}>
            {quedan >= 0 ? `quedan ${quedan}` : `${-quedan} de más`}
          </span>
        )}
      </span>
      {filas === 1 ? (
        <input
          className={falta ? "falta" : undefined}
          value={valor}
          maxLength={max}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <textarea
          className={falta ? "falta" : undefined}
          rows={filas}
          value={valor}
          maxLength={max}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {falta ? <small className="cam-falta">⚠ Esto hace falta para poder mandarlo</small> : null}
      {ayuda && !falta && <small className="cam-ay">{ayuda}</small>}
    </label>
  );
}

/**
 * El alta que pide la marca, con los mismos tres pasos que el formulario de
 * WiiGo.
 *
 * Era un formulario plano de cuatro campos y el resto lo completaba WiiGo a
 * mano: subcategoría, precio de contado, código del envase, sabores, ficha.
 * Con una marca que entra con setenta productos eso son setenta cargas
 * dobles.
 *
 * En el paso del precio va el reparto en vivo. Antes la marca ponía un precio
 * a ciegas y recién descubría cuánto le quedaba cuando el producto ya estaba
 * publicado — y si no le gustaba, pedía un cambio de precio. Verlo mientras
 * lo escribe es verlo cuando todavía lo puede decidir.
 *
 * El IVA no se pregunta: WiiGo le factura al cliente final con factura A y la
 * alícuota la define WiiGo, no la marca.
 */
function FormProductoNuevo({
  subcategorias,
  tasas,
  marca,
  onListo,
  onCerrar,
}: {
  subcategorias: { id: string; nombre: string }[];
  tasas: TasasGenerales;
  marca: CondicionesMarca;
  onListo: () => void;
  onCerrar: () => void;
}) {
  const [paso, setPaso] = useState(1);

  // ----- paso 1 -----
  const [nombre, setNombre] = useState("");
  const [nombreEn, setNombreEn] = useState("");
  const [nombrePt, setNombrePt] = useState("");
  const [idSubcategoria, setIdSubcategoria] = useState("");
  const [subNueva, setSubNueva] = useState("");
  const [descripcion, setDescripcion] = useState("");
  // Hasta tres. La primera es la que se ve en la góndola y en el tótem; las
  // otras dos aparecen en la ficha del Asesor cuando el cliente la abre —
  // sirven para la etiqueta de atrás, el producto abierto, el tamaño real.
  const [fotos, setFotos] = useState<string[]>([]);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [errorFoto, setErrorFoto] = useState<string | null>(null);
  // Lo que cumplió la última foto elegida, para mostrarlo tildado en vez de
  // dejar que la marca adivine si hizo bien.
  const [reglasFoto, setReglasFoto] = useState<Regla[] | null>(null);
  const MAX_FOTOS = 3;

  // ----- paso 2 -----
  const [costo, setCosto] = useState("");
  const [precio, setPrecio] = useState("");
  const [precioEfectivo, setPrecioEfectivo] = useState("");
  const [offEfectivo, setOffEfectivo] = useState("");
  const [traeCodigo, setTraeCodigo] = useState(false);
  const [codigoBarras, setCodigoBarras] = useState("");
  const [tieneVariantes, setTieneVariantes] = useState(false);
  const [variantes, setVariantes] = useState<VarianteForm[]>([]);

  // ----- paso 3 -----
  const [ficha, setFicha] = useState<Record<string, string>>({});
  const campoFicha = (k: string) => ficha[k] ?? "";
  const ponerFicha = (k: string, v: string) => setFicha((p) => ({ ...p, [k]: v }));
  const num = (k: string) => {
    const n = Number(ficha[k]);
    return ficha[k] && Number.isFinite(n) ? n : null;
  };

  const nPrecio = Number(precio);
  const nCosto = Number(costo);
  const nEfectivo = Number(precioEfectivo);
  const valido = nombre.trim() !== "" && nPrecio > 0 && nCosto > 0;
  const efectivoMalo = nEfectivo > 0 && nPrecio > 0 && nEfectivo >= nPrecio;

  // Lo que falta, por paso. Se marca en rojo recién cuando el que carga pasó
  // de largo —no mientras escribe— y el número del paso lleva el aviso para
  // que no haya que recorrerlos buscando qué quedó vacío.
  const [intento, setIntento] = useState(false);
  const faltaEnPaso = {
    1: nombre.trim() === "",
    2: !(nCosto > 0) || !(nPrecio > 0) || efectivoMalo,
    3: false,
  } as Record<number, boolean>;
  const marcar = (n: number) => intento && faltaEnPaso[n];
  const malo = (cond: boolean) => (intento && cond ? "falta" : undefined);

  function siguiente() {
    if (faltaEnPaso[paso]) {
      setIntento(true);
      return;
    }
    setIntento(false);
    setPaso(paso + 1);
  }

  async function elegirFoto(archivos: FileList | null) {
    if (!archivos || archivos.length === 0) return;
    setErrorFoto(null);
    setSubiendoFoto(true);

    // De a una y en orden, no todas juntas: así el que las elige ve cuál
    // quedó primera, que es la que va a la góndola.
    //
    // Se revisa ANTES de subir: una foto que no cumple no llega al bucket, y
    // la que cumple se sube ya cuadrada y en WebP, así todas las de la
    // góndola salen iguales venga de donde venga (ver lib/fotoProducto.ts).
    const nuevas: string[] = [];
    for (const archivo of Array.from(archivos).slice(0, MAX_FOTOS - fotos.length)) {
      const revision = await revisarFoto(archivo);
      setReglasFoto(revision.reglas);
      if (revision.error || !revision.archivo) {
        setErrorFoto(revision.error ?? "No pudimos preparar esa foto.");
        if (revision.vista) URL.revokeObjectURL(revision.vista);
        break;
      }
      if (revision.vista) URL.revokeObjectURL(revision.vista);

      const fd = new FormData();
      fd.set("archivo", revision.archivo);
      const r = await subirFotoParaAlta(fd);
      if (r.error) {
        setErrorFoto(r.error);
        break;
      }
      if (r.url) nuevas.push(r.url);
    }

    setSubiendoFoto(false);
    if (nuevas.length) setFotos((p) => [...p, ...nuevas].slice(0, MAX_FOTOS));
  }

  /** El precio de contado se define contra el de lista: si el de lista
      cambia, el otro lo sigue. */
  function cambiarPrecio(v: string) {
    setPrecio(v);
    const p = Number(v) || 0;
    const o = Number(offEfectivo) || 0;
    if (o > 0 && p > 0) setPrecioEfectivo(String(Math.round(p * (1 - o / 100))));
  }
  function cambiarOff(v: string) {
    setOffEfectivo(v);
    const p = Number(precio) || 0;
    const o = Number(v) || 0;
    setPrecioEfectivo(o > 0 && p > 0 ? String(Math.round(p * (1 - o / 100))) : "");
  }
  function cambiarEfectivo(v: string) {
    setPrecioEfectivo(v);
    const p = Number(precio) || 0;
    const e = Number(v) || 0;
    setOffEfectivo(p > 0 && e > 0 ? String(Math.round(((p - e) / p) * 10) / 10) : "");
  }

  return (
    // Ventana y no un bloque dentro de la página: con tres pasos, inline
    // empujaba la lista de productos hacia abajo y quedaba el formulario
    // flotando arriba de setenta renglones que no tienen nada que ver.
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="cam-nuevo" onClick={(e) => e.stopPropagation()}>
        <div className="cam-nuevo-cab">
          <h2>Producto nuevo</h2>
          <button className="cam-cerrar" onClick={onCerrar} aria-label="Cerrar">
            Cerrar
          </button>
        </div>

        <div className="cam-pasos">
        {[
          { n: 1, t: "El producto", d: "Nombre, foto, subcategoría" },
          { n: 2, t: "Precio y códigos", d: "Tu costo, precios, sabores" },
          { n: 3, t: "Ficha del asesor", d: "Opcional" },
        ].map((p) => (
          <button
            key={p.n}
            className={`cam-paso${p.n < paso ? " hecho" : ""}${marcar(p.n) ? " falta" : ""}`}
            aria-current={p.n === paso}
            onClick={() => setPaso(p.n)}
          >
            <b>{marcar(p.n) ? "!" : p.n}</b>
            <span>
              {p.t}
              <small>{marcar(p.n) ? "Falta completar algo" : p.d}</small>
            </span>
          </button>
        ))}
      </div>

      {/* Qué falta y dónde, en vez de un botón apagado sin explicación. Se
          muestra al intentar avanzar, y siempre en el último paso: ahí el
          botón de mandar está a la vista y no se puede tocar. */}
      {(intento || paso === 3) && !valido && (
        <p className="cam-falta-global">
          ⚠ Falta completar{" "}
          {[
            nombre.trim() === "" && "el nombre (paso 1)",
            !(nCosto > 0) && "tu costo (paso 2)",
            !(nPrecio > 0) && "el precio de góndola (paso 2)",
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </p>
      )}

      <Envio
        texto="Mandar el producto"
        deshabilitado={!valido || efectivoMalo}
        onEnviar={async () => {
          const r = await pedirProductoNuevo({
            nombre,
            nombreEn,
            nombrePt,
            precio: nPrecio,
            costo: nCosto,
            descripcion,
            idSubcategoria: idSubcategoria || null,
            subcategoriaNueva: subNueva,
            precioEfectivo: nEfectivo > 0 ? nEfectivo : null,
            codigoBarras: traeCodigo ? codigoBarras : "",
            variantes: tieneVariantes
              ? variantes
                  .filter((v) => v.nombre.trim())
                  .map((v) => ({
                    nombre: v.nombre,
                    codigoBarras: v.codigoBarras,
                    precio: v.precio ? Number(v.precio) : null,
                  }))
              : [],
            imagen: fotos[0] ?? null,
            fotosExtra: fotos.slice(1),
            ficha: {
              kcal_100g: num("kcal_100g"),
              proteinas: num("proteinas"),
              carbohidratos: num("carbohidratos"),
              grasas: num("grasas"),
              fibra: num("fibra"),
              sodio: num("sodio"),
              porcion: campoFicha("porcion") || null,
              ingredientes: campoFicha("ingredientes") || null,
              micronutrientes: campoFicha("micronutrientes") || null,
              origen: campoFicha("origen") || null,
            },
          });
          if (!r.error) onListo();
          return r;
        }}
        pie={
          <p className="cam-nota">
            Al aprobarse queda esperando mercadería: recién se puede vender cuando entre el stock. El costo
            es tuyo y no lo ve nadie del lado del cliente — sirve para que veas tu ganancia real.
          </p>
        }
      >
        {/* ===================== 1 ===================== */}
        {paso === 1 && (
          <>
            <Bloque icono="📦" titulo="Qué es" desc="Como va a figurar en la góndola y en el tótem.">
            <CampoTexto
              etiqueta="Nombre"
              obligatorio
              mostrarFalta={intento}
              valor={nombre}
              onChange={setNombre}
              max={LARGOS.nombre}
              filas={1}
              placeholder="Como va a figurar en la góndola y en el tótem"
            />
            <div className="cam-campos">
              <label className="cam-campo">
                <span>Nombre en inglés</span>
                <input value={nombreEn} onChange={(e) => setNombreEn(e.target.value)} placeholder="Opcional" />
              </label>
              <label className="cam-campo">
                <span>Nombre en portugués</span>
                <input value={nombrePt} onChange={(e) => setNombrePt(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
            <small className="cam-ay">El tótem está en tres idiomas. Sin esto se muestra el español.</small>

            <div className="cam-campos">
              <label className="cam-campo">
                <span>Subcategoría</span>
                <select value={idSubcategoria} onChange={(e) => setIdSubcategoria(e.target.value)}>
                  <option value="">Elegí una…</option>
                  {subcategorias.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cam-campo">
                <span>O proponé una nueva</span>
                <input
                  value={subNueva}
                  onChange={(e) => setSubNueva(e.target.value)}
                  placeholder="Ej.: Pre-entrenos"
                  disabled={idSubcategoria !== ""}
                />
              </label>
            </div>

            <CampoTexto
              etiqueta="Descripción"
              valor={descripcion}
              onChange={setDescripcion}
              max={LARGOS.descripcion}
              placeholder="Qué es, para qué sirve, sabor, tamaño…"
              ayuda="Se lee en el tótem: dos o tres renglones se leen, diez no."
            />
            </Bloque>

            <Bloque
              icono="📷"
              titulo="Las fotos"
              desc="Sin foto el producto sale con un cuadro gris en el catálogo y en el tótem."
            >
            <div className="cam-campo ancho">
              <span>Hasta {MAX_FOTOS} fotos</span>
              <div className="cam-fotos">
                {fotos.map((url, i) => (
                  <div className="cam-foto" key={url}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" />
                    <button
                      type="button"
                      className="quitar-foto"
                      onClick={() => setFotos((p) => p.filter((_, j) => j !== i))}
                      aria-label="Quitar esta foto"
                    >
                      ×
                    </button>
                    {i === 0 && <span className="principal">Góndola</span>}
                  </div>
                ))}

                {fotos.length < MAX_FOTOS && (
                  <label className="cam-foto-add">
                    <b>+</b>
                    {subiendoFoto ? "Subiendo…" : fotos.length === 0 ? "Subir foto" : "Otra"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      disabled={subiendoFoto}
                      onChange={(e) => {
                        elegirFoto(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
              <small className="cam-ay">
                {fotos.length === 0
                  ? "La primera que subas es la de la góndola y el tótem. Las otras dos son opcionales."
                  : "La primera es la que se ve en la góndola y en el tótem. Las otras aparecen en la ficha cuando el cliente la abre: la etiqueta de atrás, el producto abierto."}
              </small>
              {reglasFoto && <ReglasFoto reglas={reglasFoto} />}
              {errorFoto && <p className="cam-var fuerte">{errorFoto}</p>}
              {fotos[0] && (
                <ComoSeVe url={fotos[0]} nombre={nombre} precio={nPrecio > 0 ? nPrecio : null} />
              )}
              <ElEstandar />
            </div>
            </Bloque>
          </>
        )}

        {/* ===================== 2 ===================== */}
        {paso === 2 && (
          <>
            <Bloque
              icono="💲"
              titulo="Precio y tu costo"
              desc="Mientras lo escribís, abajo ves cuánto te queda de cada venta."
            >
            {/* El costo primero: es lo que la marca sabe sin pensar, y es
                contra lo que mira si el precio le cierra. */}
            <label className="cam-campo ancho">
              <span>Tu costo *</span>
              <input
                className={malo(!(nCosto > 0))}
                type="number"
                step="0.01"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
                placeholder="0,00"
                autoFocus
              />
              {malo(!(nCosto > 0)) ? (
                <small className="cam-falta">⚠ Sin tu costo no podemos mostrarte cuánto ganás</small>
              ) : (
                <small className="cam-ay">
                  Lo que te sale a vos una unidad, sin IVA. Solo lo vemos WiiGo y vos.
                </small>
              )}
            </label>

            <div className="cam-campos">
              <label className="cam-campo">
                <span>Precio de góndola *</span>
                <input
                  className={malo(!(nPrecio > 0))}
                  type="number"
                  step="0.01"
                  value={precio}
                  onChange={(e) => cambiarPrecio(e.target.value)}
                  placeholder="0,00"
                />
                {malo(!(nPrecio > 0)) ? (
                  <small className="cam-falta">⚠ Esto hace falta</small>
                ) : (
                  <small className="cam-ay">Lo que paga el cliente con tarjeta o QR</small>
                )}
              </label>
              <label className="cam-campo">
                <span>Precio en efectivo</span>
                <input
                  type="number"
                  step="0.01"
                  value={precioEfectivo}
                  onChange={(e) => cambiarEfectivo(e.target.value)}
                  placeholder="Vacío = lo mismo"
                />
                <small className="cam-ay">
                  <input
                    className="cam-off"
                    type="number"
                    step="0.1"
                    value={offEfectivo}
                    onChange={(e) => cambiarOff(e.target.value)}
                    placeholder="0"
                    aria-label="Porcentaje menos en efectivo"
                  />{" "}
                  % menos que el de góndola
                </small>
              </label>
            </div>

            {efectivoMalo && (
              <p className="cam-var fuerte">El precio en efectivo tiene que ser menor que el de góndola.</p>
            )}

            <RepartoAlta
              precio={nPrecio}
              efectivo={nEfectivo > 0 ? nEfectivo : nPrecio}
              costo={nCosto}
              marca={marca}
              tasas={tasas}
            />
            </Bloque>

            <Bloque icono="🏷️" titulo="Código de barras" desc="Lo que lee el tótem cuando el cliente escanea.">
            <div className="cam-campo ancho">
              <span>¿El envase ya lo trae impreso?</span>
              <div className="cam-siono">
                <button type="button" aria-pressed={traeCodigo} onClick={() => setTraeCodigo(true)}>
                  Sí, lo trae
                </button>
                <button type="button" aria-pressed={!traeCodigo} onClick={() => setTraeCodigo(false)}>
                  No tiene
                </button>
              </div>
              {traeCodigo ? (
                <input
                  className="cam-cb"
                  value={codigoBarras}
                  onChange={(e) => setCodigoBarras(e.target.value)}
                  placeholder="7790000000000"
                  inputMode="numeric"
                />
              ) : (
                <div className="nota-ocre" style={{ marginTop: 10 }}>
                  WiiGo le genera uno y lo imprime en sticker al aprobarlo.
                </div>
              )}
            </div>
            </Bloque>

            <Bloque icono="🎯" titulo="Sabores o tamaños" desc="Dejalo en «es uno solo» si no tiene variantes.">
            <div className="cam-campo ancho">
              <span>¿Tiene varios?</span>
              <div className="cam-siono">
                <button
                  type="button"
                  aria-pressed={tieneVariantes}
                  onClick={() => {
                    setTieneVariantes(true);
                    if (variantes.length === 0)
                      setVariantes([
                        { nombre: "", codigoBarras: "", precio: "" },
                        { nombre: "", codigoBarras: "", precio: "" },
                      ]);
                  }}
                >
                  Sí, varios
                </button>
                <button type="button" aria-pressed={!tieneVariantes} onClick={() => setTieneVariantes(false)}>
                  Es uno solo
                </button>
              </div>

              {tieneVariantes && (
                <>
                  <table className="cam-variantes">
                    <thead>
                      <tr>
                        <th>Sabor o tamaño</th>
                        <th>Código de barras</th>
                        <th>Precio propio</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {variantes.map((v, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              value={v.nombre}
                              onChange={(e) =>
                                setVariantes((p) =>
                                  p.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x))
                                )
                              }
                              placeholder="Frutos rojos"
                            />
                          </td>
                          <td>
                            <input
                              value={v.codigoBarras}
                              onChange={(e) =>
                                setVariantes((p) =>
                                  p.map((x, j) => (j === i ? { ...x, codigoBarras: e.target.value } : x))
                                )
                              }
                              placeholder="7790…"
                              inputMode="numeric"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              value={v.precio}
                              onChange={(e) =>
                                setVariantes((p) =>
                                  p.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x))
                                )
                              }
                              placeholder="igual"
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="cam-quitar"
                              onClick={() => setVariantes((p) => p.filter((_, j) => j !== i))}
                              aria-label="Quitar"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    type="button"
                    className="cam-mas"
                    onClick={() => setVariantes((p) => [...p, { nombre: "", codigoBarras: "", precio: "" }])}
                  >
                    + Agregar un sabor
                  </button>
                </>
              )}
            </div>
            </Bloque>
          </>
        )}

        {/* ===================== 3 ===================== */}
        {paso === 3 && (
          <>
            <div className="nota-ocre">
              Todo esto es <b>opcional</b>, pero es lo que el Asesor le muestra al cliente antes de decidir.
              Un producto con ficha se vende más que uno sin ficha.
            </div>

            <Bloque
              icono="🥗"
              titulo="Información nutricional"
              desc="Como figura en el envase, por cada 100 g."
            >
            <div className="cam-campos">
              <label className="cam-campo">
                <span>Porción</span>
                <input
                  value={campoFicha("porcion")}
                  maxLength={LARGOS.porcion}
                  onChange={(e) => ponerFicha("porcion", e.target.value)}
                  placeholder="1 scoop (5 g)"
                />
              </label>
              <label className="cam-campo">
                <span>Origen</span>
                <input
                  value={campoFicha("origen")}
                  maxLength={LARGOS.origen}
                  onChange={(e) => ponerFicha("origen", e.target.value)}
                  placeholder="Industria argentina"
                />
              </label>
            </div>

            <div className="cam-campo ancho">
              <span>Información nutricional</span>
              <div className="cam-nutri">
                {[
                  ["kcal_100g", "Calorías", "kcal"],
                  ["proteinas", "Proteínas", "g"],
                  ["carbohidratos", "Carbohidratos", "g"],
                  ["grasas", "Grasas", "g"],
                  ["fibra", "Fibra", "g"],
                  ["sodio", "Sodio", "mg"],
                ].map(([clave, rotulo, unidad]) => (
                  <label key={clave}>
                    <span>{rotulo}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={campoFicha(clave)}
                      onChange={(e) => ponerFicha(clave, e.target.value)}
                      placeholder="0"
                    />
                    <i>{unidad}</i>
                  </label>
                ))}
              </div>
              <small className="cam-ay">Por cada 100 g, como figura en el envase.</small>
            </div>

            <CampoTexto
              etiqueta="Ingredientes"
              valor={campoFicha("ingredientes")}
              onChange={(v) => ponerFicha("ingredientes", v)}
              max={LARGOS.ingredientes}
              filas={2}
              ayuda="Como figuran en el envase."
            />
            <CampoTexto
              etiqueta="Vitaminas y minerales"
              valor={campoFicha("micronutrientes")}
              onChange={(v) => ponerFicha("micronutrientes", v)}
              max={LARGOS.micronutrientes}
              filas={2}
            />
            </Bloque>
          </>
        )}

        <div className="cam-pasos-pie">
          {paso > 1 && (
            <button type="button" className="cam-mas" onClick={() => setPaso(paso - 1)}>
              ← Atrás
            </button>
          )}
          <span className="hueco" />
          {paso < 3 && (
            <button type="button" className="cam-siguiente" onClick={siguiente}>
              Siguiente →
            </button>
          )}
        </div>
        </Envio>
      </div>
    </div>
  );
}

/**
 * El reparto del precio mientras la marca lo escribe.
 *
 * El mismo panel que ve WiiGo del lado de adentro y que la marca ya ve en Mis
 * productos, pero acá sirve para otra cosa: para decidir el precio, no para
 * mirar el que ya está puesto. Si con ese precio le queda poco, se entera
 * antes de mandarlo y no después de que esté publicado.
 */
function RepartoAlta({
  precio,
  efectivo,
  costo,
  marca,
  tasas,
}: {
  precio: number;
  efectivo: number;
  costo: number;
  marca: CondicionesMarca;
  tasas: TasasGenerales;
}) {
  if (!(precio > 0 && costo > 0)) {
    return (
      <div className="nota-gris" style={{ marginTop: 13 }}>
        Poné tu costo y el precio de góndola, y acá te mostramos cuánto te queda de cada venta.
      </div>
    );
  }

  const conCredito = simularMargen({ precio, costo, marca, tasas }).find((m) => m.medio === "CREDITO");
  const conEfectivo = simularMargen({ precio: efectivo, costo, marca, tasas }).find(
    (m) => m.medio === "EFECTIVO"
  );
  if (!conCredito || !conEfectivo) return null;

  const qC = conCredito.leQueda ?? 0;
  const qE = conEfectivo.leQueda ?? 0;

  return (
    <div className="cam-reparto">
      <p className="et">A dónde va cada peso que paga el cliente</p>
      <div className="cam-reparto-duo">
        <ColumnaAlta m={conCredito} costo={costo} corto="Crédito" gana={qC >= qE} />
        <ColumnaAlta m={conEfectivo} costo={costo} corto="Efectivo" gana={qE > qC} />
      </div>

      {/* El desglose, igual que en Mis productos. Sin esto, la dona dice
          cuánto le queda pero no por qué: de los $6.000 que paga el cliente,
          dónde se fueron los otros $3.019. */}
      <table className="cam-reparto-tabla">
        <thead>
          <tr>
            <th>Cada peso va a</th>
            <th>Crédito</th>
            <th>Efectivo</th>
          </tr>
        </thead>
        <tbody>
          {partesDe(conCredito, costo).map((x, i) => {
            const y = partesDe(conEfectivo, costo)[i];
            const esQueda = i === 4;
            return (
              <tr key={x.k} className={esQueda ? "queda" : ""}>
                <td>
                  <span className="k">
                    <i className="llave" style={{ background: x.c }} />
                    {x.k}
                  </span>
                </td>
                <td>{pesos(x.v)}</td>
                <td>{pesos(y.v)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="cam-reparto-pie">
        {/* `pesos()` ya trae el signo: ponerle otro daba "$$3.137,00". */}
        Por cada unidad te quedan <b>{pesos(qE)}</b> en efectivo y <b>{pesos(qC)}</b> con crédito. De ahí
        todavía salen tus impuestos y tus gastos, que WiiGo no calcula.
      </p>
    </div>
  );
}

/**
 * Los cinco pedazos del precio, y suman el precio exacto.
 *
 * Una sola función para la dona y para la tabla: si cada una armara su lista,
 * el día que cambie un concepto el dibujo y el detalle dirían cosas distintas.
 * Sin pedazo de IVA, igual que en Mis productos: WiiGo le factura a ELLA la
 * comisión y cuánto IVA le toca depende de cómo facture.
 */
function partesDe(m: MargenSimulado, costo: number) {
  return [
    { k: "Costo mercadería", c: "#8a9a78", v: costo },
    { k: "Comisión WiiGo + IVA", c: "#536243", v: m.comisionWiigo + m.ivaComision },
    { k: "Otros costos", c: "#bd8f3e", v: m.comisionMp + m.impCreditos + m.impDebitos },
    { k: "SIRCREB", c: "#b4bcc6", v: m.sircreb },
    { k: "Te queda a vos", c: "#4c8459", v: m.leQueda ?? 0 },
  ];
}

function ColumnaAlta({
  m,
  costo,
  corto,
  gana,
}: {
  m: MargenSimulado;
  costo: number;
  corto: string;
  gana: boolean;
}) {
  const queda = m.leQueda ?? 0;
  const partes = partesDe(m, costo);

  const R = 38;
  const C = 2 * Math.PI * R;
  const HUECO = C * (2.2 / 360);
  const total = partes.reduce((a, p) => a + Math.max(p.v, 0), 0);
  let acum = 0;

  return (
    <div className={gana ? "gana" : undefined}>
      <span className="cam-sello">{corto}</span>
      <div className="cam-dona">
        <svg viewBox="0 0 102 102" width="102" height="102" aria-hidden="true">
          <circle cx="51" cy="51" r={R} fill="none" stroke="#eef0e9" strokeWidth="13" />
          <g transform="rotate(-90 51 51)">
            {partes.map((p, i) => {
              const por = total > 0 ? Math.max(p.v, 0) / total : 0;
              const largo = Math.max(por * C - HUECO, 0.1);
              const off = -(acum * C + HUECO / 2);
              acum += por;
              return (
                <circle
                  key={i}
                  cx="51"
                  cy="51"
                  r={R}
                  fill="none"
                  stroke={p.c}
                  strokeWidth="13"
                  strokeLinecap="round"
                  strokeDasharray={`${largo} ${C - largo}`}
                  strokeDashoffset={off}
                />
              );
            })}
          </g>
        </svg>
        <div className="centro">
          <b>${Math.round(queda).toLocaleString("es-AR")}</b>
          <span>te queda</span>
        </div>
      </div>
      <p className="cam-reparto-cobra">el cliente paga {pesos(m.precio)}</p>
    </div>
  );
}

// ---------- Historial ----------

function FilaSolicitud({ s, onListo }: { s: SolicitudPropia; onListo: () => void }) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const estado = ESTADO_TEXTO[s.estado] ?? { rotulo: s.estado, clase: "gris" };

  const precioNuevo = typeof s.datos.precio === "number" ? (s.datos.precio as number) : null;
  const precioAntes = typeof s.datosAnteriores.precio === "number" ? (s.datosAnteriores.precio as number) : null;

  return (
    <li className={`cam-sol ${estado.clase}`}>
      <div className="cam-sol-cab">
        <span className="cam-sol-tipo">{s.tipoEtiqueta}</span>
        <span className={`cam-estado ${estado.clase}`}>
          <i aria-hidden="true">{estado.icono}</i>
          {estado.rotulo}
        </span>
      </div>
      {s.producto && <p className="cam-sol-prod">{s.producto}</p>}

      {precioNuevo !== null && (
        <p className="cam-sol-detalle mono">
          {precioAntes !== null ? `${pesos(precioAntes)} → ` : ""}
          <b>{pesos(precioNuevo)}</b>
        </p>
      )}

      {s.estado === "PENDIENTE" && s.escalada && (
        <p className="cam-nota">Se sale de la política habitual, así que lo mira el dueño. Puede tardar un poco más.</p>
      )}
      {(s.estado === "APROBADA" || s.estado === "APLICADA") && s.vigenciaDesde && (
        <p className="cam-nota">
          {s.estado === "APLICADA" ? "Activo desde el" : "Entra en vigencia el"} {fechaHora(s.vigenciaDesde)}
        </p>
      )}
      {s.estado === "RECHAZADA" && s.motivo && <p className="cam-motivo">{s.motivo}</p>}

      <div className="cam-sol-pie">
        <span className="cam-cuando">Mandado el {fechaHora(s.solicitadaEl)}</span>
        {s.estado === "PENDIENTE" && (
          <button
            className="cam-btn plano"
            disabled={pendiente}
            onClick={() =>
              startTransition(async () => {
                const r = await cancelarSolicitud(s.idSolicitud);
                if (r.error) setError(r.error);
                else onListo();
              })
            }
          >
            {pendiente ? "..." : "Cancelar"}
          </button>
        )}
      </div>
      {error && <p className="cam-error">{error}</p>}
    </li>
  );
}
