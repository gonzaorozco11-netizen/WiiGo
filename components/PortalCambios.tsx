"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  pedirCambioPrecio,
  pedirPrecioEfectivo,
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
import type { PoliticaDescuentos, TipoSolicitud } from "@/lib/solicitudesMarca";
import {
  simularMargen,
  type CondicionesMarca,
  type MargenSimulado,
  type TasasGenerales,
} from "@/lib/margenMarca";

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

const ESTADO_TEXTO: Record<string, { rotulo: string; clase: string }> = {
  PENDIENTE: { rotulo: "Esperando respuesta", clase: "esperando" },
  APROBADA: { rotulo: "Aprobado", clase: "ok" },
  APLICADA: { rotulo: "Ya está activo", clase: "ok" },
  RECHAZADA: { rotulo: "No aprobado", clase: "no" },
  CANCELADA: { rotulo: "Lo cancelaste", clase: "gris" },
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
}: {
  productos: ProductoPropio[];
  solicitudes: SolicitudPropia[];
  politica: PoliticaDescuentos;
  /** Las de la marca, para que al dar de alta elija una en vez de que WiiGo la adivine. */
  subcategorias?: { id: string; nombre: string }[];
  /** Para mostrarle el reparto mientras define el precio del producto nuevo. */
  tasas: TasasGenerales;
  condiciones: CondicionesMarca;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"PEDIR" | "MIOS">("PEDIR");
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);

  const pendientes = solicitudes.filter((s) => s.estado === "PENDIENTE").length;

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) => p.nombre.toLowerCase().includes(q));
  }, [productos, busqueda]);

  return (
    <main className="portal-lienzo">
      <div className="cam-cab">
        <div>
          <h1 className="cam-titulo">Pedir un cambio</h1>
          <p className="cam-sub">
            Lo que mandes lo revisa administración de WiiGo. Nada cambia en la góndola hasta que esté aprobado.
          </p>
        </div>
        <button className="cam-btn primario" onClick={() => setNuevoAbierto(true)}>
          + Producto nuevo
        </button>
      </div>

      <div className="cam-tabs">
        <button className={`cam-tab${tab === "PEDIR" ? " activa" : ""}`} onClick={() => setTab("PEDIR")}>
          Mis productos
          {productos.length > 0 && <span className="cam-cont">{productos.length}</span>}
        </button>
        <button className={`cam-tab${tab === "MIOS" ? " activa" : ""}`} onClick={() => setTab("MIOS")}>
          Lo que mandé
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
                ? "Todavía no tenés productos cargados. Empezá con “Producto nuevo”."
                : "Ningún producto coincide con esa búsqueda."}
            </p>
          ) : (
            <ul className="cam-lista">
              {visibles.map((p) => (
                <FilaProducto
                  key={p.idProducto}
                  p={p}
                  politica={politica}
                  abierto={abierto === p.idProducto}
                  onAbrir={() => setAbierto(abierto === p.idProducto ? null : p.idProducto)}
                  onListo={() => { setAbierto(null); router.refresh(); }}
                />
              ))}
            </ul>
          )}
        </>
      ) : solicitudes.length === 0 ? (
        <p className="vacio">Todavía no mandaste ningún cambio.</p>
      ) : (
        <ul className="cam-hist">
          {solicitudes.map((s) => (
            <FilaSolicitud key={s.idSolicitud} s={s} onListo={() => router.refresh()} />
          ))}
        </ul>
      )}
    </main>
  );
}

// ---------- Un producto y sus acciones ----------

function FilaProducto({
  p,
  politica,
  abierto,
  onAbrir,
  onListo,
}: {
  p: ProductoPropio;
  politica: PoliticaDescuentos;
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
        <span className="cam-prod-nom">{p.nombre}</span>
        <span className="cam-prod-datos">
          <span className="mono">{pesos(p.precio)}</span>
          <span className="cam-stock">{p.stock} en góndola</span>
          {p.esperando.length > 0 && <span className="cam-espera">{p.esperando.length} esperando</span>}
        </span>
      </button>

      {abierto && (
        <div className="cam-panel">
          <div className="cam-opciones">
            <Opcion activa={form === "PRECIO"} bloqueada={esperando("PRECIO")} onClick={() => setForm(form === "PRECIO" ? null : "PRECIO")}>
              Cambiar precio
            </Opcion>
            <Opcion activa={form === "EFECTIVO"} bloqueada={esperando("PRECIO_EFECTIVO")} onClick={() => setForm(form === "EFECTIVO" ? null : "EFECTIVO")}>
              Precio en efectivo
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
              Lo que ya mandaste para este producto está esperando respuesta. Podés cancelarlo desde “Lo que mandé”.
            </p>
          )}

          {form === "PRECIO" && <FormPrecio p={p} politica={politica} onListo={onListo} />}
          {form === "EFECTIVO" && <FormEfectivo p={p} onListo={onListo} />}
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

function FormPrecio({ p, politica, onListo }: { p: ProductoPropio; politica: PoliticaDescuentos; onListo: () => void }) {
  const [precio, setPrecio] = useState("");
  const valor = Number(precio);
  const valido = Number.isFinite(valor) && valor > 0;
  const variacion = valido && p.precio ? ((valor - p.precio) / p.precio) * 100 : null;

  return (
    <Envio
      texto="Mandar el cambio de precio"
      deshabilitado={!valido}
      onEnviar={async () => {
        const r = await pedirCambioPrecio(p.idProducto, valor);
        if (!r.error) onListo();
        return r;
      }}
      pie={
        <p className="cam-nota">
          Si lo aprueban, el precio entra a las {politica.horaAplicacion} con el local cerrado — nunca a mitad del
          día, para que el cartel de góndola y la caja digan siempre lo mismo.
        </p>
      }
    >
      <div className="cam-campos">
        <label className="cam-campo">
          <span>Precio de hoy</span>
          <input className="mono" value={pesos(p.precio)} disabled />
        </label>
        <label className="cam-campo">
          <span>Precio nuevo</span>
          <input
            type="number"
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="0,00"
            autoFocus
          />
        </label>
      </div>
      {variacion !== null && (
        <p className={`cam-var${Math.abs(variacion) >= politica.variacionPrecioAlerta ? " fuerte" : ""}`}>
          {variacion > 0 ? "+" : ""}
          {variacion.toFixed(1)}%
          {Math.abs(variacion) >= politica.variacionPrecioAlerta &&
            " — es un salto grande, revisá que no te haya quedado un cero de más."}
        </p>
      )}
    </Envio>
  );
}

/**
 * El precio pagando en efectivo.
 *
 * Es de la marca y no de WiiGo porque el descuento lo absorbe casi entero
 * ella. Por eso el formulario muestra en pesos cuánto ahorra el cliente: es el
 * número que va impreso en el cartel de góndola y el que decide la compra.
 */
function FormEfectivo({ p, onListo }: { p: ProductoPropio; onListo: () => void }) {
  const [precio, setPrecio] = useState("");
  const valor = Number(precio);
  const valido = Number.isFinite(valor) && valor > 0 && (!p.precio || valor <= p.precio);
  const ahorro = valido && p.precio ? p.precio - valor : null;
  const off = ahorro !== null && p.precio ? (ahorro / p.precio) * 100 : null;

  return (
    <Envio
      texto="Mandar el precio en efectivo"
      deshabilitado={!valido}
      onEnviar={async () => {
        const r = await pedirPrecioEfectivo(p.idProducto, valor);
        if (!r.error) onListo();
        return r;
      }}
      pie={
        <p className="cam-nota">
          Es lo que paga el cliente en efectivo. Va impreso en el cartel de góndola al lado del precio de
          lista, así que es lo que decide la compra. Este descuento lo absorbe la marca, por eso lo elegís vos.
        </p>
      }
    >
      <div className="cam-campos">
        <label className="cam-campo">
          <span>Con tarjeta o QR</span>
          <input className="mono" value={pesos(p.precio)} disabled />
        </label>
        <label className="cam-campo">
          <span>{p.precioEfectivo !== null ? "Efectivo de hoy" : "En efectivo"}</span>
          {p.precioEfectivo !== null ? (
            <input className="mono" value={pesos(p.precioEfectivo)} disabled />
          ) : (
            <input className="mono" value="sin cargar" disabled />
          )}
        </label>
        <label className="cam-campo">
          <span>Efectivo nuevo</span>
          <input
            type="number"
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="0,00"
            autoFocus
          />
        </label>
      </div>
      {precio !== "" && !valido && p.precio && valor > p.precio && (
        <p className="cam-var fuerte">
          No puede ser mayor al precio de lista — el cartel prometería un ahorro que no existe.
        </p>
      )}
      {ahorro !== null && ahorro > 0 && (
        <p className={`cam-var${off !== null && off >= 30 ? " fuerte" : ""}`}>
          El cliente ahorra {pesos(ahorro)} ({off?.toFixed(1)}% menos)
          {off !== null && off >= 30 && " — es mucho, revisá que no te haya quedado un cero de más."}
        </p>
      )}
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

  return (
    <Envio
      texto="Mandar la foto"
      deshabilitado={!archivo}
      onEnviar={async () => {
        if (!archivo) return { error: "Elegí una foto." };
        const fd = new FormData();
        fd.set("archivo", archivo);
        const r = await pedirCambioFoto(p.idProducto, fd);
        if (!r.error) onListo();
        return r;
      }}
      pie={
        <p className="cam-nota">
          Es la foto que ve el cliente en la pantalla del local y en el tótem. Que sea del producto solo,
          sobre fondo claro y sin texto encima — las que tienen precios o logos pegados quedan viejas
          enseguida.
        </p>
      }
    >
      <div className="cam-fotos">
        <div className="cam-foto">
          <span>La de hoy</span>
          {p.imagen ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imagen} alt="" />
          ) : (
            <div className="cam-foto-vacia">sin foto</div>
          )}
        </div>
        <div className="cam-foto">
          <span>La nueva</span>
          {vista ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={vista} alt="" />
          ) : (
            <div className="cam-foto-vacia">elegí una</div>
          )}
        </div>
      </div>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setArchivo(f);
          setVista(f ? URL.createObjectURL(f) : null);
        }}
      />
    </Envio>
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
  const [foto, setFoto] = useState<string | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [errorFoto, setErrorFoto] = useState<string | null>(null);

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

  async function elegirFoto(archivo: File | null) {
    if (!archivo) return;
    setErrorFoto(null);
    setSubiendoFoto(true);
    const fd = new FormData();
    fd.set("archivo", archivo);
    const r = await subirFotoParaAlta(fd);
    setSubiendoFoto(false);
    if (r.error) setErrorFoto(r.error);
    else setFoto(r.url ?? null);
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
    <div className="cam-nuevo">
      <div className="cam-nuevo-cab">
        <h2>Producto nuevo</h2>
        <button className="cam-cerrar" onClick={onCerrar}>
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
            className={`cam-paso${p.n < paso ? " hecho" : ""}`}
            aria-current={p.n === paso}
            onClick={() => setPaso(p.n)}
          >
            <b>{p.n}</b>
            <span>
              {p.t}
              <small>{p.d}</small>
            </span>
          </button>
        ))}
      </div>

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
            imagen: foto,
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
            <label className="cam-campo ancho">
              <span>Nombre *</span>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Como va a figurar en la góndola y en el tótem"
                autoFocus
              />
            </label>
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

            <label className="cam-campo ancho">
              <span>Descripción</span>
              <textarea
                rows={3}
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Qué es, para qué sirve, sabor, tamaño…"
              />
            </label>

            <div className="cam-campo ancho">
              <span>Foto del producto</span>
              {foto ? (
                <div className="cam-foto-ok">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={foto} alt="" />
                  <div>
                    <b>Foto lista</b>
                    <button type="button" className="cam-mas" onClick={() => setFoto(null)}>
                      Cambiarla
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={subiendoFoto}
                    onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)}
                  />
                  <small className="cam-ay">
                    {subiendoFoto
                      ? "Subiendo…"
                      : "Cuadrada, mínimo 800×800, fondo blanco o neutro. Sin foto sale con un cuadro gris."}
                  </small>
                </>
              )}
              {errorFoto && <p className="cam-var fuerte">{errorFoto}</p>}
            </div>
          </>
        )}

        {/* ===================== 2 ===================== */}
        {paso === 2 && (
          <>
            {/* El costo primero: es lo que la marca sabe sin pensar, y es
                contra lo que mira si el precio le cierra. */}
            <label className="cam-campo ancho">
              <span>Tu costo *</span>
              <input
                type="number"
                step="0.01"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
                placeholder="0,00"
                autoFocus
              />
              <small className="cam-ay">
                Lo que te sale a vos una unidad, sin IVA. Solo lo vemos WiiGo y vos.
              </small>
            </label>

            <div className="cam-campos">
              <label className="cam-campo">
                <span>Precio de góndola *</span>
                <input
                  type="number"
                  step="0.01"
                  value={precio}
                  onChange={(e) => cambiarPrecio(e.target.value)}
                  placeholder="0,00"
                />
                <small className="cam-ay">Lo que paga el cliente con tarjeta o QR</small>
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

            <div className="cam-campo ancho">
              <span>¿El envase ya trae código de barras?</span>
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

            <div className="cam-campo ancho">
              <span>¿Tiene sabores o tamaños?</span>
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
          </>
        )}

        {/* ===================== 3 ===================== */}
        {paso === 3 && (
          <>
            <div className="nota-ocre">
              Todo esto es <b>opcional</b>, pero es lo que el Asesor le muestra al cliente antes de decidir.
              Un producto con ficha se vende más que uno sin ficha.
            </div>

            <div className="cam-campos">
              <label className="cam-campo">
                <span>Porción</span>
                <input
                  value={campoFicha("porcion")}
                  onChange={(e) => ponerFicha("porcion", e.target.value)}
                  placeholder="1 scoop (5 g)"
                />
              </label>
              <label className="cam-campo">
                <span>Origen</span>
                <input
                  value={campoFicha("origen")}
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

            <label className="cam-campo ancho">
              <span>Ingredientes</span>
              <textarea
                rows={2}
                value={campoFicha("ingredientes")}
                onChange={(e) => ponerFicha("ingredientes", e.target.value)}
              />
            </label>
            <label className="cam-campo ancho">
              <span>Vitaminas y minerales</span>
              <textarea
                rows={2}
                value={campoFicha("micronutrientes")}
                onChange={(e) => ponerFicha("micronutrientes", e.target.value)}
              />
            </label>
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
            <button type="button" className="cam-siguiente" onClick={() => setPaso(paso + 1)}>
              Siguiente →
            </button>
          )}
        </div>
      </Envio>
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
      <p className="cam-reparto-pie">
        {/* `pesos()` ya trae el signo: ponerle otro daba "$$3.137,00". */}
        Por cada unidad te quedan <b>{pesos(qE)}</b> en efectivo y <b>{pesos(qC)}</b> con crédito. De ahí
        todavía salen tus impuestos y tus gastos, que WiiGo no calcula.
      </p>
    </div>
  );
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
  const partes = [
    { c: "#8a9a78", v: costo },
    { c: "#536243", v: m.comisionWiigo + m.ivaComision },
    { c: "#bd8f3e", v: m.comisionMp + m.impCreditos + m.impDebitos },
    { c: "#b4bcc6", v: m.sircreb },
    { c: "#4c8459", v: queda },
  ];

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
        <span className={`cam-estado ${estado.clase}`}>{estado.rotulo}</span>
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
