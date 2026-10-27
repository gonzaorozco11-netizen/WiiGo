"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  enviarDatos,
  enviarFotoPerfil,
  enviarFotoGaleria,
  cambiarVisibilidadFoto,
  enviarLista,
  enviarObjetivos,
  enviarRedes,
  guardarContacto,
} from "../actions";
import {
  leerObjetivos,
  limpiarNombre,
  mismoNombre,
  ordenarPorAnio,
  type CampoDatos,
  type TipoCambio,
  type ItemFormacion,
  type ItemTrayectoria,
  type ItemVideo,
  type ItemFortaleza,
  type ValorObjetivos,
} from "@/lib/cambiosProfesional";
import { REDES, leerRedes, linkDeRed, textoDeRed, type ClaveRed, type Redes } from "@/lib/redesProfesional";

export type DatosFicha = {
  nombre: string;
  foto: string | null;
  telefono: string;
  email: string;
  campos: Record<CampoDatos, string | number | null>;
  galeria: { idFoto: string; url: string; titulo: string | null; publico: boolean }[];
  formacion: ItemFormacion[];
  trayectoria: ItemTrayectoria[];
  videos: ItemVideo[];
  fortalezas: ItemFortaleza[];
  objetivos: string[];
  catalogoFortalezas: { id: string; nombre: string }[];
  catalogoObjetivos: { id: string; nombre: string }[];
  redes: Redes;
  // Falso mientras no se corra sql/profesionales-redes.sql.
  redesDisponible: boolean;
};

export type Pendiente = {
  idCambio: string;
  tipo: TipoCambio;
  valor: unknown;
  estado: "PENDIENTE" | "CORREGIR";
  nota: string | null;
};

type Seccion = "sobre" | "historia" | "turnos" | "fotos" | "formacion" | "recorrido" | "ayuda" | "redes" | "videos" | "contacto";

const SECCIONES: { clave: Seccion; label: string; tipos: TipoCambio[]; campos?: CampoDatos[] }[] = [
  { clave: "sobre", label: "Sobre mí", tipos: ["DATOS"], campos: ["titulo", "especialidad", "matricula", "ciudad", "bio"] },
  { clave: "historia", label: "Mi historia", tipos: ["DATOS"], campos: ["biografia_completa"] },
  { clave: "turnos", label: "Atención y precios", tipos: ["DATOS"], campos: ["tipo_atencion", "precio_presencial", "precio_online"] },
  { clave: "fotos", label: "Fotos", tipos: ["FOTO_PERFIL", "FOTO"] },
  { clave: "formacion", label: "Formación", tipos: ["FORMACION"] },
  { clave: "recorrido", label: "Recorrido", tipos: ["TRAYECTORIA"] },
  { clave: "ayuda", label: "En qué ayudo", tipos: ["OBJETIVOS", "FORTALEZAS"] },
  { clave: "redes", label: "Redes", tipos: ["REDES"] },
  { clave: "videos", label: "Videos", tipos: ["VIDEOS"] },
  { clave: "contacto", label: "Contacto", tipos: [] },
];

const AVISO_ENVIADO = "Listo, lo mandaste a revisar. Cuando WiiGo lo apruebe, sale en la pantalla del local.";

export default function FichaEditor({ datos, pendientes, seccionInicial }: { datos: DatosFicha; pendientes: Pendiente[]; seccionInicial?: string }) {
  const router = useRouter();
  const [seccion, setSeccion] = useState<Seccion>(() => SECCIONES.find((s) => s.clave === seccionInicial)?.clave ?? "sobre");
  const [aviso, setAviso] = useState<string | null>(null);

  const pendienteDe = (tipo: TipoCambio) => pendientes.find((p) => p.tipo === tipo) ?? null;
  const datosPendientes = (pendienteDe("DATOS")?.valor as Partial<Record<CampoDatos, string | number | null>>) ?? {};

  function tienePendiente(s: (typeof SECCIONES)[number]) {
    return pendientes.some((p) => {
      if (!s.tipos.includes(p.tipo)) return false;
      if (p.tipo !== "DATOS" || !s.campos) return true;
      return s.campos.some((c) => c in ((p.valor as Record<string, unknown>) ?? {}));
    });
  }

  function listo(mensaje = AVISO_ENVIADO) {
    setAviso(mensaje);
    router.refresh();
    window.setTimeout(() => setAviso(null), 6000);
  }

  // Lo que se ve en cada campo: lo que mandó y espera aprobación, o lo que ya está.
  const valorInicial = (c: CampoDatos) => {
    const v = c in datosPendientes ? datosPendientes[c] : datos.campos[c];
    return v === null || v === undefined ? "" : String(v);
  };

  return (
    <div className="ficha-editor">
      <div className="ficha-cab">
        <h1>Mi ficha</h1>
        <p>Lo que cargás acá sale en la pantalla del local cuando WiiGo lo aprueba. Mientras tanto se sigue viendo lo que estaba.</p>
      </div>

      <nav className="tabs-ficha" aria-label="Partes de tu ficha">
        {SECCIONES.map((s) => (
          <button key={s.clave} type="button" aria-pressed={seccion === s.clave} onClick={() => setSeccion(s.clave)}>
            {s.label}
            {tienePendiente(s) && <i className="punto-pend" aria-label="esperando aprobación" />}
          </button>
        ))}
      </nav>

      {aviso && (
        <p className="aviso-ok" role="status">
          {aviso}
        </p>
      )}

      {seccion === "sobre" && (
        <SeccionDatos
          key="sobre"
          titulo="Sobre mí"
          ayuda="Cómo te presenta la pantalla del local. La presentación son dos o tres líneas sobre cómo trabajás."
          campos={[
            { campo: "titulo", label: "Título", placeholder: "Lic. en Nutrición" },
            { campo: "especialidad", label: "Especialidad", placeholder: "Nutrición deportiva" },
            { campo: "matricula", label: "Matrícula", placeholder: "MN 1234 · MP 5678" },
            { campo: "ciudad", label: "Ciudad", placeholder: "Mendoza" },
            { campo: "bio", label: "Presentación corta", largo: 320 },
          ]}
          valorInicial={valorInicial}
          pendiente={pendienteDe("DATOS")}
          camposSeccion={["titulo", "especialidad", "matricula", "ciudad", "bio"]}
          onListo={listo}
        />
      )}

      {seccion === "historia" && (
        <SeccionDatos
          key="historia"
          titulo="Mi historia"
          ayuda="Se lee en «Conóceme», en la pantalla del local. Contá cómo empezaste y qué te mueve, como se lo contarías a un paciente nuevo."
          campos={[{ campo: "biografia_completa", label: "Tu historia", largo: 1500, alto: true }]}
          ideas={["¿Cómo empezaste?", "¿Qué te apasiona de tu trabajo?", "¿Cómo es una primera consulta con vos?"]}
          valorInicial={valorInicial}
          pendiente={pendienteDe("DATOS")}
          camposSeccion={["biografia_completa"]}
          onListo={listo}
        />
      )}

      {seccion === "turnos" && (
        <SeccionTurnos valorInicial={valorInicial} pendiente={pendienteDe("DATOS")} onListo={listo} />
      )}

      {seccion === "fotos" && (
        <SeccionFotos
          foto={datos.foto}
          galeria={datos.galeria}
          pendientes={pendientes.filter((p) => p.tipo === "FOTO" || p.tipo === "FOTO_PERFIL")}
          onListo={listo}
          onCambioDirecto={() => listo("Listo, guardado.")}
        />
      )}

      {seccion === "formacion" && (
        <SeccionLinea
          key="formacion"
          tipo="FORMACION"
          inicial={(pendienteDe("FORMACION")?.valor as ItemFormacion[]) ?? datos.formacion}
          pendiente={pendienteDe("FORMACION")}
          onListo={listo}
        />
      )}

      {seccion === "recorrido" && (
        <SeccionLinea
          key="recorrido"
          tipo="TRAYECTORIA"
          inicial={(pendienteDe("TRAYECTORIA")?.valor as ItemTrayectoria[]) ?? datos.trayectoria}
          pendiente={pendienteDe("TRAYECTORIA")}
          onListo={listo}
        />
      )}

      {seccion === "ayuda" && (
        <SeccionAyuda
          catalogoObjetivos={datos.catalogoObjetivos}
          catalogoFortalezas={datos.catalogoFortalezas}
          objetivos={pendienteDe("OBJETIVOS") ? leerObjetivos(pendienteDe("OBJETIVOS")?.valor) : { ids: datos.objetivos, nuevos: [] }}
          fortalezas={(pendienteDe("FORTALEZAS")?.valor as ItemFortaleza[]) ?? datos.fortalezas}
          pendienteObjetivos={pendienteDe("OBJETIVOS")}
          pendienteFortalezas={pendienteDe("FORTALEZAS")}
          onListo={listo}
        />
      )}

      {seccion === "redes" && (
        <SeccionRedes
          nombre={datos.nombre}
          redes={pendienteDe("REDES") ? leerRedes(pendienteDe("REDES")?.valor) : datos.redes}
          disponible={datos.redesDisponible}
          pendiente={pendienteDe("REDES")}
          onListo={listo}
        />
      )}

      {seccion === "videos" && (
        <SeccionLista
          key="videos"
          tipo="VIDEOS"
          titulo="Videos"
          ayuda="Links de Instagram, YouTube, TikTok o Vimeo donde se te vea contando lo que hacés."
          columnas={[
            { clave: "titulo", label: "De qué se trata", placeholder: "Qué comer antes de entrenar", ancho: 2 },
            { clave: "url", label: "Link", placeholder: "https://www.instagram.com/p/...", ancho: 3 },
          ]}
          inicial={(pendienteDe("VIDEOS")?.valor as Record<string, unknown>[]) ?? datos.videos}
          pendiente={pendienteDe("VIDEOS")}
          onListo={listo}
        />
      )}

      {seccion === "contacto" && <SeccionContacto telefono={datos.telefono} email={datos.email} onListo={() => listo("Listo, guardado.")} />}
    </div>
  );
}

// ---------- Piezas ----------

function EstadoRevision({ pendiente }: { pendiente: Pendiente | null }) {
  if (!pendiente) return null;
  if (pendiente.estado === "CORREGIR") {
    return (
      <p className="estado-revision corregir">
        <b>WiiGo te pidió un cambio:</b> {pendiente.nota || "revisalo y volvé a mandarlo."}
      </p>
    );
  }
  return <p className="estado-revision">Esto que ves está esperando que WiiGo lo apruebe. Si lo cambiás, se reemplaza.</p>;
}

function useEnvio() {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function enviar(accion: () => Promise<{ error: string | null }>, onListo: () => void) {
    setError(null);
    setEnviando(true);
    try {
      const r = await accion();
      if (r.error) setError(r.error);
      else onListo();
    } catch {
      setError("No se pudo mandar. Revisá tu conexión y probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }
  return { enviando, error, enviar };
}

type CampoForm = { campo: CampoDatos; label: string; placeholder?: string; largo?: number; alto?: boolean };

function SeccionDatos({
  titulo,
  ayuda,
  campos,
  ideas,
  valorInicial,
  pendiente,
  camposSeccion,
  onListo,
}: {
  titulo: string;
  ayuda: string;
  campos: CampoForm[];
  ideas?: string[];
  valorInicial: (c: CampoDatos) => string;
  pendiente: Pendiente | null;
  camposSeccion: CampoDatos[];
  onListo: () => void;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(campos.map((c) => [c.campo, valorInicial(c.campo)])));
  const { enviando, error, enviar } = useEnvio();
  const tocaEsta = pendiente && camposSeccion.some((c) => c in ((pendiente.valor as Record<string, unknown>) ?? {}));

  return (
    <section className="tarjeta seccion-ficha">
      <h2>{titulo}</h2>
      <p className="ayuda">{ayuda}</p>
      <EstadoRevision pendiente={tocaEsta ? pendiente : null} />
      <div className="campos">
        {campos.map((c) => (
          <label key={c.campo} className={c.largo ? "campo ancho" : "campo"}>
            <span>{c.label}</span>
            {c.largo ? (
              <textarea
                value={valores[c.campo]}
                maxLength={c.largo}
                rows={c.alto ? 9 : 3}
                onChange={(e) => setValores({ ...valores, [c.campo]: e.target.value })}
              />
            ) : (
              <input value={valores[c.campo]} placeholder={c.placeholder} maxLength={120} onChange={(e) => setValores({ ...valores, [c.campo]: e.target.value })} />
            )}
            {c.largo && (
              <small className="mono">
                {valores[c.campo].length} / {c.largo}
              </small>
            )}
          </label>
        ))}
      </div>
      {ideas && (
        <div className="ideas">
          {ideas.map((i) => (
            <span key={i}>{i}</span>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <button type="button" className="boton" disabled={enviando} onClick={() => enviar(() => enviarDatos(valores), onListo)}>
        {enviando ? "Mandando..." : "Enviar a revisión"}
      </button>
    </section>
  );
}

function SeccionTurnos({ valorInicial, pendiente, onListo }: { valorInicial: (c: CampoDatos) => string; pendiente: Pendiente | null; onListo: () => void }) {
  const [tipo, setTipo] = useState(valorInicial("tipo_atencion"));
  const [presencial, setPresencial] = useState(valorInicial("precio_presencial"));
  const [online, setOnline] = useState(valorInicial("precio_online"));
  const { enviando, error, enviar } = useEnvio();
  const tocaEsta = pendiente && ["tipo_atencion", "precio_presencial", "precio_online"].some((c) => c in ((pendiente.valor as Record<string, unknown>) ?? {}));

  return (
    <section className="tarjeta seccion-ficha">
      <h2>Atención y precios</h2>
      <p className="ayuda">Cómo atendés y cuánto sale la consulta. Si no querés mostrar el precio, dejalo vacío y no aparece en la pantalla.</p>
      <EstadoRevision pendiente={tocaEsta ? pendiente : null} />
      <div className="campo">
        <span>Atendés</span>
        <div className="opciones">
          {[
            { valor: "Presencial", label: "Presencial" },
            { valor: "Virtual", label: "Online" },
            { valor: "Presencial y virtual", label: "Las dos" },
          ].map((o) => (
            <button key={o.valor} type="button" aria-pressed={tipo === o.valor} onClick={() => setTipo(o.valor)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="campos">
        <label className="campo">
          <span>Precio presencial ($)</span>
          <input value={presencial} inputMode="numeric" placeholder="Sin mostrar" onChange={(e) => setPresencial(e.target.value)} />
        </label>
        <label className="campo">
          <span>Precio online ($)</span>
          <input value={online} inputMode="numeric" placeholder="Sin mostrar" onChange={(e) => setOnline(e.target.value)} />
        </label>
      </div>
      <p className="ayuda">El link para sacar turno lo maneja WiiGo. Si querés cambiarlo, escribinos.</p>
      {error && <p className="error">{error}</p>}
      <button
        type="button"
        className="boton"
        disabled={enviando}
        onClick={() => enviar(() => enviarDatos({ tipo_atencion: tipo, precio_presencial: presencial, precio_online: online }), onListo)}
      >
        {enviando ? "Mandando..." : "Enviar a revisión"}
      </button>
    </section>
  );
}

function SeccionFotos({
  foto,
  galeria,
  pendientes,
  onListo,
  onCambioDirecto,
}: {
  foto: string | null;
  galeria: DatosFicha["galeria"];
  pendientes: Pendiente[];
  onListo: () => void;
  onCambioDirecto: () => void;
}) {
  const perfil = pendientes.find((p) => p.tipo === "FOTO_PERFIL") ?? null;
  const nuevas = pendientes.filter((p) => p.tipo === "FOTO");
  const inputPerfil = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [tituloFoto, setTituloFoto] = useState("");
  const perfilEnvio = useEnvio();
  const galeriaEnvio = useEnvio();
  const visibilidad = useEnvio();

  function subirPerfil(f: File | undefined) {
    if (!f) return;
    const fd = new FormData();
    fd.append("archivo", f);
    perfilEnvio.enviar(() => enviarFotoPerfil(fd), onListo);
  }

  function subirGaleria() {
    if (!archivo) return;
    const fd = new FormData();
    fd.append("archivo", archivo);
    fd.append("titulo", tituloFoto);
    galeriaEnvio.enviar(() => enviarFotoGaleria(fd), () => {
      setArchivo(null);
      setTituloFoto("");
      onListo();
    });
  }

  const urlPerfil = (perfil?.valor as { url?: string } | undefined)?.url ?? foto;

  return (
    <section className="tarjeta seccion-ficha">
      <h2>Fotos</h2>
      <p className="ayuda">Las que mejor funcionan: vos atendiendo, midiendo o dando una charla, con buena luz. Sin caras de pacientes que no hayan dado permiso.</p>

      <div className="perfil-fila">
        <div className="perfil-foto">
          {urlPerfil ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urlPerfil} alt="Tu foto de perfil" />
          ) : (
            <span>Sin foto</span>
          )}
          {perfil && <em className="espera">{perfil.estado === "CORREGIR" ? "Para corregir" : "Esperando aprobación"}</em>}
        </div>
        <div className="perfil-texto">
          <b>Tu foto de perfil</b>
          <p className="ayuda">Una foto tuya de frente, sola, con fondo claro.</p>
          {perfil?.estado === "CORREGIR" && perfil.nota && <p className="estado-revision corregir">{perfil.nota}</p>}
          <input ref={inputPerfil} type="file" accept="image/*" hidden onChange={(e) => subirPerfil(e.target.files?.[0])} />
          <button type="button" className="boton claro" disabled={perfilEnvio.enviando} onClick={() => inputPerfil.current?.click()}>
            {perfilEnvio.enviando ? "Subiendo..." : "Cambiar foto"}
          </button>
          {perfilEnvio.error && <p className="error">{perfilEnvio.error}</p>}
        </div>
      </div>

      <div className="grilla-fotos">
        {galeria.map((g) => (
          <figure key={g.idFoto} className={g.publico ? "foto-g" : "foto-g apagada"}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={g.url} alt={g.titulo ?? ""} />
            <figcaption>
              <span>{g.titulo ?? "Sin título"}</span>
              <button
                type="button"
                className="interruptor"
                role="switch"
                aria-checked={g.publico}
                aria-label={g.publico ? "Se ve en la pantalla. Tocá para ocultarla" : "Oculta. Tocá para mostrarla"}
                disabled={visibilidad.enviando}
                onClick={() => visibilidad.enviar(() => cambiarVisibilidadFoto(g.idFoto, !g.publico), onCambioDirecto)}
              />
            </figcaption>
          </figure>
        ))}
        {nuevas.map((n) => {
          const v = n.valor as { url: string; titulo: string | null };
          return (
            <figure key={n.idCambio} className="foto-g nueva">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.url} alt={v.titulo ?? ""} />
              <em className="espera">{n.estado === "CORREGIR" ? `Para corregir: ${n.nota ?? ""}` : "Esperando aprobación"}</em>
              <figcaption>
                <span>{v.titulo ?? "Sin título"}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>
      {visibilidad.error && <p className="error">{visibilidad.error}</p>}

      <div className="subir-foto">
        <b>Sumar una foto</b>
        <div className="campos">
          <label className="campo">
            <span>Foto</span>
            <input type="file" accept="image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </label>
          <label className="campo">
            <span>Qué se ve (opcional)</span>
            <input value={tituloFoto} maxLength={80} placeholder="En el consultorio" onChange={(e) => setTituloFoto(e.target.value)} />
          </label>
        </div>
        {galeriaEnvio.error && <p className="error">{galeriaEnvio.error}</p>}
        <button type="button" className="boton" disabled={!archivo || galeriaEnvio.enviando} onClick={subirGaleria}>
          {galeriaEnvio.enviando ? "Subiendo..." : "Enviar a revisión"}
        </button>
      </div>
    </section>
  );
}

type Columna = { clave: string; label: string; placeholder: string; ancho: number; numero?: boolean };

function SeccionLista({
  tipo,
  titulo,
  ayuda,
  columnas,
  inicial,
  pendiente,
  onListo,
}: {
  tipo: "FORMACION" | "TRAYECTORIA" | "VIDEOS";
  titulo: string;
  ayuda: string;
  columnas: Columna[];
  inicial: Record<string, unknown>[];
  pendiente: Pendiente | null;
  onListo: () => void;
}) {
  const vacia = () => Object.fromEntries(columnas.map((c) => [c.clave, ""]));
  const [filas, setFilas] = useState<Record<string, string>[]>(() => {
    const desde = inicial.map((i) => Object.fromEntries(columnas.map((c) => [c.clave, i[c.clave] == null ? "" : String(i[c.clave])])));
    return desde.length > 0 ? desde : [vacia()];
  });
  const { enviando, error, enviar } = useEnvio();
  const plantilla = columnas.map((c) => `${c.ancho}fr`).join(" ") + " 34px";

  function cambiar(i: number, clave: string, valor: string) {
    setFilas(filas.map((f, j) => (j === i ? { ...f, [clave]: valor } : f)));
  }

  return (
    <section className="tarjeta seccion-ficha">
      <h2>{titulo}</h2>
      <p className="ayuda">{ayuda}</p>
      <EstadoRevision pendiente={pendiente} />
      <div className="lista">
        {filas.map((f, i) => (
          <div key={i} className="fila-lista" style={{ gridTemplateColumns: plantilla }}>
            {columnas.map((c) => (
              <label key={c.clave} className="campo">
                <span>{c.label}</span>
                <input
                  value={f[c.clave]}
                  placeholder={c.placeholder}
                  inputMode={c.numero ? "numeric" : undefined}
                  maxLength={c.numero ? 4 : 300}
                  onChange={(e) => cambiar(i, c.clave, e.target.value)}
                />
              </label>
            ))}
            <button type="button" className="quitar" aria-label="Quitar" onClick={() => setFilas(filas.length > 1 ? filas.filter((_, j) => j !== i) : [vacia()])}>
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="agregar" onClick={() => setFilas([...filas, vacia()])}>
        + Agregar otro
      </button>
      {error && <p className="error">{error}</p>}
      <button type="button" className="boton" disabled={enviando} onClick={() => enviar(() => enviarLista(tipo, filas), onListo)}>
        {enviando ? "Mandando..." : "Enviar a revisión"}
      </button>
    </section>
  );
}

function SeccionAyuda({
  catalogoObjetivos,
  catalogoFortalezas,
  objetivos,
  fortalezas,
  pendienteObjetivos,
  pendienteFortalezas,
  onListo,
}: {
  catalogoObjetivos: { id: string; nombre: string }[];
  catalogoFortalezas: { id: string; nombre: string }[];
  objetivos: ValorObjetivos;
  fortalezas: ItemFortaleza[];
  pendienteObjetivos: Pendiente | null;
  pendienteFortalezas: Pendiente | null;
  onListo: () => void;
}) {
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(objetivos.ids));
  const [nuevos, setNuevos] = useState<string[]>(objetivos.nuevos);
  const [fuertes, setFuertes] = useState<ItemFortaleza[]>(fortalezas);
  // Lo que está escribiendo para sumar: un objetivo o una fortaleza que no está en la lista.
  const [escribiendo, setEscribiendo] = useState<"objetivo" | "fortaleza" | null>(null);
  const [escrito, setEscrito] = useState("");
  const [avisoEscrito, setAvisoEscrito] = useState<string | null>(null);
  const envioObjetivos = useEnvio();
  const envioFortalezas = useEnvio();

  function alternarObjetivo(id: string) {
    const n = new Set(elegidos);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setElegidos(n);
  }
  function alternarFortaleza(id: string) {
    if (fuertes.some((f) => f.id_fortaleza === id)) setFuertes(fuertes.filter((f) => f.id_fortaleza !== id));
    else if (fuertes.length < 3) setFuertes([...fuertes, { id_fortaleza: id, principal: fuertes.length === 0 }]);
  }
  function marcarPrincipal(i: number) {
    setFuertes(fuertes.map((f, j) => ({ ...f, principal: j === i })));
  }
  function abrir(que: "objetivo" | "fortaleza") {
    setEscribiendo(que);
    setEscrito("");
    setAvisoEscrito(null);
  }

  // Si escribe uno que ya está en la lista, se marca ese: no se duplica.
  function sumarEscrito() {
    const nombre = limpiarNombre(escrito);
    if (nombre.length < 3) return setAvisoEscrito("Escribí un poco más.");
    if (escribiendo === "objetivo") {
      const igual = catalogoObjetivos.find((o) => mismoNombre(o.nombre, nombre));
      if (igual) setElegidos(new Set(elegidos).add(igual.id));
      else if (!nuevos.some((n) => mismoNombre(n, nombre))) {
        if (nuevos.length >= 3) return setAvisoEscrito("Sumá hasta 3 nuevos por vez.");
        setNuevos([...nuevos, nombre]);
      }
    } else {
      const igual = catalogoFortalezas.find((f) => mismoNombre(f.nombre, nombre));
      const yaEsta = fuertes.some((f) => (igual ? f.id_fortaleza === igual.id : f.nuevo && mismoNombre(f.nuevo, nombre)));
      if (!yaEsta) {
        if (fuertes.length >= 3) return setAvisoEscrito("Ya tenés 3. Para sumar otra, sacá una.");
        setFuertes([...fuertes, igual ? { id_fortaleza: igual.id, principal: fuertes.length === 0 } : { id_fortaleza: null, nuevo: nombre, principal: fuertes.length === 0 }]);
      }
    }
    setEscribiendo(null);
    setEscrito("");
    setAvisoEscrito(null);
  }

  const cajaEscribir = (placeholder: string) => (
    <div className="escribir-otro">
      <input
        value={escrito}
        maxLength={60}
        placeholder={placeholder}
        aria-label="Escribilo acá"
        onChange={(e) => setEscrito(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            sumarEscrito();
          }
        }}
      />
      <button type="button" className="boton chico" onClick={sumarEscrito}>
        Sumar
      </button>
      <button type="button" className="texto-boton" onClick={() => setEscribiendo(null)}>
        Cancelar
      </button>
      {avisoEscrito && <p className="aviso-paso">{avisoEscrito}</p>}
    </div>
  );

  const fortalezasNuevas = fuertes.map((f, i) => ({ f, i })).filter(({ f }) => !f.id_fortaleza && f.nuevo);

  return (
    <>
      <section className="tarjeta seccion-ficha">
        <h2>En qué ayudo</h2>
        <p className="ayuda">
          Los objetivos de tus pacientes. En la pantalla, el cliente toca su objetivo y te ve a vos. <b>Si trabajás uno que no está, sumalo:</b> lo revisa WiiGo
          antes de que salga.
        </p>
        <EstadoRevision pendiente={pendienteObjetivos} />
        <div className="opciones envolver">
          {catalogoObjetivos.map((o) => (
            <button key={o.id} type="button" aria-pressed={elegidos.has(o.id)} onClick={() => alternarObjetivo(o.id)}>
              {o.nombre}
            </button>
          ))}
          {nuevos.map((n) => (
            <span key={n} className="chip-nuevo">
              {n} <small>nuevo</small>
              <button type="button" aria-label={`Sacar ${n}`} onClick={() => setNuevos(nuevos.filter((x) => x !== n))}>
                ×
              </button>
            </span>
          ))}
          {escribiendo !== "objetivo" && (
            <button type="button" className="chip-mas" onClick={() => abrir("objetivo")}>
              + Otro objetivo
            </button>
          )}
        </div>
        {escribiendo === "objetivo" && cajaEscribir("Ej: Embarazo y lactancia")}
        {nuevos.length > 0 && (
          <p className="revisa">
            Los que dicen <b>nuevo</b> los mira WiiGo: si ya hay uno parecido, te va a pedir que uses ese.
          </p>
        )}
        {envioObjetivos.error && <p className="error">{envioObjetivos.error}</p>}
        <button type="button" className="boton" disabled={envioObjetivos.enviando} onClick={() => envioObjetivos.enviar(() => enviarObjetivos([...elegidos], nuevos), onListo)}>
          {envioObjetivos.enviando ? "Mandando..." : "Enviar a revisión"}
        </button>
      </section>

      <section className="tarjeta seccion-ficha">
        <h2>
          En qué me destaco <small className="mono">{fuertes.length} de 3</small>
        </h2>
        <p className="ayuda">
          Elegí hasta 3. Tocá la estrella para marcar la principal. <b>Si no está lo tuyo, sumalo.</b>
        </p>
        <EstadoRevision pendiente={pendienteFortalezas} />
        <div className="opciones envolver">
          {catalogoFortalezas.map((f) => {
            const i = fuertes.findIndex((x) => x.id_fortaleza === f.id);
            const elegida = i >= 0 ? fuertes[i] : null;
            return (
              <span key={f.id} className="opcion-fortaleza">
                <button type="button" aria-pressed={Boolean(elegida)} onClick={() => alternarFortaleza(f.id)}>
                  {f.nombre}
                </button>
                {elegida && (
                  <button
                    type="button"
                    className={elegida.principal ? "estrella on" : "estrella"}
                    aria-label={elegida.principal ? "Es la principal" : "Marcar como principal"}
                    onClick={() => marcarPrincipal(i)}
                  >
                    ★
                  </button>
                )}
              </span>
            );
          })}
          {fortalezasNuevas.map(({ f, i }) => (
            <span key={f.nuevo} className="opcion-fortaleza">
              <span className="chip-nuevo">
                {f.nuevo} <small>nueva</small>
                <button type="button" aria-label={`Sacar ${f.nuevo}`} onClick={() => setFuertes(fuertes.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
              <button
                type="button"
                className={f.principal ? "estrella on" : "estrella"}
                aria-label={f.principal ? "Es la principal" : "Marcar como principal"}
                onClick={() => marcarPrincipal(i)}
              >
                ★
              </button>
            </span>
          ))}
          {escribiendo !== "fortaleza" && fuertes.length < 3 && (
            <button type="button" className="chip-mas" onClick={() => abrir("fortaleza")}>
              + Otra
            </button>
          )}
        </div>
        {escribiendo === "fortaleza" && cajaEscribir("Ej: Nutrición deportiva")}
        {fortalezasNuevas.length > 0 && <p className="revisa">La que dice <b>nueva</b> la mira WiiGo antes de que salga.</p>}
        {envioFortalezas.error && <p className="error">{envioFortalezas.error}</p>}
        <button type="button" className="boton" disabled={envioFortalezas.enviando} onClick={() => envioFortalezas.enviar(() => enviarLista("FORTALEZAS", fuertes), onListo)}>
          {envioFortalezas.enviando ? "Mandando..." : "Enviar a revisión"}
        </button>
      </section>
    </>
  );
}

// ---------- Formación y recorrido: una línea de tiempo ----------

type Paso = { id: string; titulo: string; lugar: string; desde: string; hasta: string; sigue: boolean };

const anioValido = (v: string) => /^\d{4}$/.test(v) && Number(v) >= 1950 && Number(v) <= 2100;
const soloAnio = (v: string) => v.replace(/\D/g, "").slice(0, 4);
// Igual que en la pantalla: arriba lo más viejo, los que no tienen año primero.
const ordenarPasos = (pasos: Paso[]) => ordenarPorAnio(pasos, (p) => (anioValido(p.desde) ? Number(p.desde) : null));

/**
 * Se lee como su camino, de arriba (el comienzo) hacia abajo (hoy), y se
 * ordena solo por año: ella no tiene que acomodar nada. Cada paso se edita
 * en su lugar y al tocar «Listo» se va a donde le toca.
 */
function SeccionLinea({
  tipo,
  inicial,
  pendiente,
  onListo,
}: {
  tipo: "FORMACION" | "TRAYECTORIA";
  inicial: (ItemFormacion | ItemTrayectoria)[];
  pendiente: Pendiente | null;
  onListo: () => void;
}) {
  const esRecorrido = tipo === "TRAYECTORIA";
  const [pasos, setPasos] = useState<Paso[]>(() =>
    ordenarPasos(
      inicial.map((x, i) => {
        if (esRecorrido) {
          const t = x as ItemTrayectoria;
          const hasta = t.anio_hasta ? String(t.anio_hasta) : "";
          return { id: `p${i}`, titulo: t.titulo ?? "", lugar: t.lugar ?? "", desde: t.anio_desde ? String(t.anio_desde) : "", hasta, sigue: !hasta };
        }
        const f = x as ItemFormacion;
        return { id: `p${i}`, titulo: f.titulo ?? "", lugar: f.institucion ?? "", desde: f.anio ? String(f.anio) : "", hasta: "", sigue: false };
      })
    )
  );
  const [borrador, setBorrador] = useState<Paso | null>(null);
  const [avisoPaso, setAvisoPaso] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvio();

  // Al ordenar, cada tarjeta se desliza desde donde estaba hasta su lugar.
  const linea = useRef<HTMLDivElement>(null);
  const posiciones = useRef<Map<string, number> | null>(null);
  function medir() {
    const m = new Map<string, number>();
    linea.current?.querySelectorAll<HTMLElement>("[data-paso]").forEach((el) => m.set(el.dataset.paso ?? "", el.getBoundingClientRect().top));
    posiciones.current = m;
  }
  useLayoutEffect(() => {
    const antes = posiciones.current;
    posiciones.current = null;
    if (!antes || !linea.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    linea.current.querySelectorAll<HTMLElement>("[data-paso]").forEach((el) => {
      const arriba = antes.get(el.dataset.paso ?? "");
      if (arriba === undefined || typeof el.animate !== "function") return;
      const dy = arriba - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 2) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  }, [pasos]);

  function abrir(p: Paso) {
    setAvisoPaso(null);
    setBorrador({ ...p });
  }
  function sumar() {
    setAvisoPaso(null);
    setBorrador({ id: `n${Date.now()}`, titulo: "", lugar: "", desde: "", hasta: "", sigue: false });
  }
  function listoPaso() {
    if (!borrador) return;
    const b = { ...borrador, titulo: borrador.titulo.trim(), lugar: borrador.lugar.trim() };
    if (!b.titulo) return setAvisoPaso(esRecorrido ? "Poné qué hacías." : "Poné el título o el curso.");
    if (b.desde && !anioValido(b.desde)) return setAvisoPaso("El año va con 4 números, por ejemplo 2019.");
    if (esRecorrido && anioValido(b.desde) && !b.sigue) {
      if (!anioValido(b.hasta)) return setAvisoPaso("Poné hasta qué año, o tildá «Sigo trabajando acá».");
      if (Number(b.hasta) < Number(b.desde)) return setAvisoPaso("El año de «hasta» es anterior al de «desde».");
    }
    medir();
    const existe = pasos.some((p) => p.id === b.id);
    setPasos(ordenarPasos(existe ? pasos.map((p) => (p.id === b.id ? b : p)) : [...pasos, b]));
    setBorrador(null);
  }
  function quitarPaso() {
    if (!borrador) return;
    setPasos(pasos.filter((p) => p.id !== borrador.id));
    setBorrador(null);
  }
  function mandar() {
    const items = esRecorrido
      ? pasos.map((p) => ({ titulo: p.titulo, lugar: p.lugar, anio_desde: p.desde, anio_hasta: p.sigue ? "" : p.hasta }))
      : pasos.map((p) => ({ titulo: p.titulo, institucion: p.lugar, anio: p.desde }));
    enviar(() => enviarLista(tipo, items), onListo);
  }

  const cuando = (p: Paso) => (!anioValido(p.desde) ? null : esRecorrido ? `${p.desde} — ${p.sigue ? "hoy" : p.hasta || "…"}` : p.desde);
  const sinAnio = pasos.filter((p) => !anioValido(p.desde)).length;
  // "Ex nutricionista" con años al lado sobra: los años ya dicen que terminó.
  const conEx = esRecorrido ? pasos.find((p) => /^ex[\s-]+\S/i.test(p.titulo)) : undefined;
  const sinEx = conEx ? limpiarNombre(conEx.titulo.replace(/^ex[\s-]+/i, ""), 120) : "";

  const formulario = (b: Paso) => {
    const enter = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        listoPaso();
      }
    };
    return (
      <div key={b.id} data-paso={b.id} className={anioValido(b.desde) ? "paso editando" : "paso editando sin-anio"}>
        <div className="campos">
          <label className="campo">
            <span>{esRecorrido ? "Qué hacías" : "Título o curso"}</span>
            <input
              value={b.titulo}
              maxLength={120}
              placeholder={esRecorrido ? "Ej: Nutricionista" : "Ej: Licenciatura en Nutrición"}
              onChange={(e) => setBorrador({ ...b, titulo: e.target.value })}
              onKeyDown={enter}
            />
          </label>
          <label className="campo">
            <span>{esRecorrido ? "Dónde" : "Dónde lo estudiaste"}</span>
            <input
              value={b.lugar}
              maxLength={120}
              placeholder={esRecorrido ? "Ej: Club Deportivo Maipú" : "Ej: Universidad Juan Agustín Maza"}
              onChange={(e) => setBorrador({ ...b, lugar: e.target.value })}
              onKeyDown={enter}
            />
          </label>
        </div>
        {esRecorrido ? (
          <>
            <div className="anios">
              <label className="campo">
                <span>Desde (año)</span>
                <input value={b.desde} inputMode="numeric" maxLength={4} placeholder="Ej: 2019" onChange={(e) => setBorrador({ ...b, desde: soloAnio(e.target.value) })} onKeyDown={enter} />
              </label>
              <label className="campo">
                <span>Hasta (año)</span>
                <input
                  value={b.sigue ? "" : b.hasta}
                  disabled={b.sigue}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder={b.sigue ? "Hoy" : "Ej: 2022"}
                  onChange={(e) => setBorrador({ ...b, hasta: soloAnio(e.target.value) })}
                  onKeyDown={enter}
                />
              </label>
            </div>
            <label className="tilde">
              <input type="checkbox" checked={b.sigue} onChange={(e) => setBorrador({ ...b, sigue: e.target.checked, hasta: e.target.checked ? "" : b.hasta })} />
              Sigo trabajando acá
            </label>
          </>
        ) : (
          <div className="anios">
            <label className="campo">
              <span>Año en que lo terminaste</span>
              <input value={b.desde} inputMode="numeric" maxLength={4} placeholder="Ej: 2016" onChange={(e) => setBorrador({ ...b, desde: soloAnio(e.target.value) })} onKeyDown={enter} />
            </label>
          </div>
        )}
        {avisoPaso && <p className="aviso-paso">{avisoPaso}</p>}
        <div className="acciones-paso">
          <button type="button" className="boton chico claro" onClick={listoPaso}>
            Listo
          </button>
          <button type="button" className="texto-boton" onClick={() => setBorrador(null)}>
            Cancelar
          </button>
          {pasos.some((p) => p.id === b.id) && (
            <button type="button" className="texto-boton rojo" onClick={quitarPaso}>
              Quitar
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="tarjeta seccion-ficha">
      <h2>{esRecorrido ? "Recorrido" : "Formación"}</h2>
      <p className="ayuda">
        {esRecorrido ? "Dónde trabajaste o trabajás: clubes, consultorios, equipos. " : "Tus títulos, posgrados y cursos. "}
        <b>
          Se ordena solo por año: arriba {esRecorrido ? "lo primero que hiciste" : "tu primer título"}, abajo {esRecorrido ? "lo de hoy" : "lo último que hiciste"}.
        </b>{" "}
        {esRecorrido ? "Así el cliente lo lee como tu camino." : "Con la institución se ve mucho más sólido."}
      </p>
      <EstadoRevision pendiente={pendiente} />

      <div ref={linea} className={esRecorrido ? "linea" : "linea formacion"}>
        <span className="hito">{esRecorrido ? "Tu comienzo" : "Tu primer título"}</span>
        {pasos.map((p) => {
          if (borrador?.id === p.id) return formulario(borrador);
          const c = cuando(p);
          return (
            <button key={p.id} type="button" data-paso={p.id} className={c ? "paso" : "paso sin-anio"} onClick={() => abrir(p)}>
              {c ? <span className="cuando mono">{c}</span> : <span className="cuando falta">Falta el año</span>}
              <span className="que">{p.titulo}</span>
              {p.lugar && <span className="donde">{p.lugar}</span>}
              <span className="editar">Editar</span>
            </button>
          );
        })}
        {borrador && !pasos.some((p) => p.id === borrador.id) && formulario(borrador)}
        {!borrador && (
          <button type="button" className="sumar-paso" onClick={sumar}>
            + {esRecorrido ? "Sumar un lugar" : "Sumar un título o curso"}
          </button>
        )}
        <span className="hito hoy">{esRecorrido ? "Hoy" : "Lo más reciente"}</span>
      </div>

      {sinAnio > 0 && (
        <p className="revisa">
          {sinAnio === 1 ? "A 1 le falta el año." : `A ${sinAnio} les falta el año.`} Sin año quedan arriba de todo y no se entiende el orden. Tocalos para
          completarlo.
        </p>
      )}
      {conEx && sinEx && (
        <p className="consejo">
          Con los años ya se entiende si seguís o no: podés poner «{sinEx}» en vez de «{conEx.titulo}».
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <button type="button" className="boton" disabled={enviando || borrador !== null} onClick={mandar}>
        {enviando ? "Mandando..." : "Enviar a revisión"}
      </button>
      {borrador && <p className="ayuda">Primero tocá «Listo» en el que estás editando.</p>}
    </section>
  );
}

// ---------- Redes ----------

/**
 * Sus redes, con la vista de cómo la ve el cliente: el usuario y un QR que
 * escanea con su celular (desde la pantalla del local no se abren links).
 */
function SeccionRedes({
  nombre,
  redes,
  disponible,
  pendiente,
  onListo,
}: {
  nombre: string;
  redes: Redes;
  disponible: boolean;
  pendiente: Pendiente | null;
  onListo: () => void;
}) {
  const [valores, setValores] = useState<Record<ClaveRed, string>>(
    () => Object.fromEntries(REDES.map((r) => [r.clave, redes[r.clave] ? textoDeRed(r.clave, redes[r.clave] as string) : ""])) as Record<ClaveRed, string>
  );
  // El error de cada casillero se muestra recién cuando sale de él, no mientras escribe.
  const [tocadas, setTocadas] = useState<Set<ClaveRed>>(() => new Set());
  const [vista, setVista] = useState<ClaveRed | null>(null);
  const [qr, setQr] = useState<{ link: string; svg: string } | null>(null);
  const { enviando, error, enviar } = useEnvio();

  const revisadas = REDES.map((r) => ({ ...r, ...linkDeRed(r.clave, valores[r.clave]) }));
  const llenas = revisadas.filter((r) => r.link);
  const actual = llenas.find((r) => r.clave === vista) ?? llenas[0] ?? null;
  const linkActual = actual?.link ?? null;

  useEffect(() => {
    if (!linkActual) return;
    let vigente = true;
    import("qrcode")
      .then((Q) => Q.toString(linkActual, { type: "svg", margin: 0, color: { dark: "#2a2f26", light: "#0000" } }))
      .then((svg) => {
        if (vigente) setQr({ link: linkActual, svg });
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [linkActual]);

  return (
    <section className="tarjeta seccion-ficha">
      <h2>Redes</h2>
      <p className="ayuda">Para que los clientes te sigan. Podés escribir tu usuario o pegar el link. Dejá vacías las que no uses.</p>
      <EstadoRevision pendiente={pendiente} />
      {!disponible && <p className="estado-revision">Todavía no se pueden cargar: WiiGo está terminando de prepararlo.</p>}

      <div className="redes">
        {revisadas.map((r) => (
          <div key={r.clave} className="red">
            <span className={`sello ${r.clave}`} aria-hidden="true">
              {r.sello}
            </span>
            <label className="campo">
              <span>{r.nombre}</span>
              <input
                value={valores[r.clave]}
                placeholder={r.ejemplo}
                maxLength={200}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => setValores({ ...valores, [r.clave]: e.target.value })}
                onBlur={() => setTocadas(new Set(tocadas).add(r.clave))}
              />
              {r.error && tocadas.has(r.clave) && <small className="error-red">{r.error}</small>}
            </label>
          </div>
        ))}
      </div>

      {actual && (
        <div className="vista-cliente">
          <div>
            <p className="ceja">Así te ve el cliente en la pantalla</p>
            <h3>Seguí a {nombre}</h3>
            <div className="opciones envolver">
              {llenas.map((r) => (
                <button key={r.clave} type="button" aria-pressed={r.clave === actual.clave} onClick={() => setVista(r.clave)}>
                  {r.nombre}
                </button>
              ))}
            </div>
            <p className="usuario mono">{textoDeRed(actual.clave, actual.link as string)}</p>
          </div>
          <div className="qr">
            {qr && qr.link === linkActual ? <span className="qr-img" dangerouslySetInnerHTML={{ __html: qr.svg }} /> : <span className="qr-img" />}
            <small>Escaneá con tu celular</small>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <button type="button" className="boton" disabled={enviando || !disponible} onClick={() => enviar(() => enviarRedes(valores), onListo)}>
        {enviando ? "Mandando..." : "Enviar a revisión"}
      </button>
    </section>
  );
}

function SeccionContacto({ telefono, email, onListo }: { telefono: string; email: string; onListo: () => void }) {
  const [tel, setTel] = useState(telefono);
  const [mail, setMail] = useState(email);
  const { enviando, error, enviar } = useEnvio();
  return (
    <section className="tarjeta seccion-ficha">
      <h2>Contacto</h2>
      <p className="ayuda">Para que WiiGo te ubique. No sale en la pantalla, así que se guarda al toque, sin revisión.</p>
      <div className="campos">
        <label className="campo">
          <span>WhatsApp</span>
          <input value={tel} inputMode="tel" placeholder="261 555-0123" onChange={(e) => setTel(e.target.value)} />
        </label>
        <label className="campo">
          <span>Mail</span>
          <input value={mail} type="email" placeholder="tu@mail.com" onChange={(e) => setMail(e.target.value)} />
        </label>
      </div>
      <p className="ayuda">Este mail es para contactarte. Para cambiar el mail con el que entrás, pedíselo a WiiGo.</p>
      {error && <p className="error">{error}</p>}
      <button type="button" className="boton" disabled={enviando} onClick={() => enviar(() => guardarContacto(tel, mail), onListo)}>
        {enviando ? "Guardando..." : "Guardar"}
      </button>
    </section>
  );
}
