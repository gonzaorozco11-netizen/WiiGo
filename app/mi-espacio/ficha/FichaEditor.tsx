"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  enviarDatos,
  enviarFotoPerfil,
  enviarFotoGaleria,
  cambiarVisibilidadFoto,
  enviarLista,
  guardarContacto,
} from "../actions";
import type { CampoDatos, TipoCambio, ItemFormacion, ItemTrayectoria, ItemVideo, ItemFortaleza } from "@/lib/cambiosProfesional";

export type DatosFicha = {
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
};

export type Pendiente = {
  idCambio: string;
  tipo: TipoCambio;
  valor: unknown;
  estado: "PENDIENTE" | "CORREGIR";
  nota: string | null;
};

type Seccion = "sobre" | "historia" | "turnos" | "fotos" | "formacion" | "recorrido" | "ayuda" | "videos" | "contacto";

const SECCIONES: { clave: Seccion; label: string; tipos: TipoCambio[]; campos?: CampoDatos[] }[] = [
  { clave: "sobre", label: "Sobre mí", tipos: ["DATOS"], campos: ["titulo", "especialidad", "matricula", "ciudad", "bio"] },
  { clave: "historia", label: "Mi historia", tipos: ["DATOS"], campos: ["biografia_completa"] },
  { clave: "turnos", label: "Atención y precios", tipos: ["DATOS"], campos: ["tipo_atencion", "precio_presencial", "precio_online"] },
  { clave: "fotos", label: "Fotos", tipos: ["FOTO_PERFIL", "FOTO"] },
  { clave: "formacion", label: "Formación", tipos: ["FORMACION"] },
  { clave: "recorrido", label: "Recorrido", tipos: ["TRAYECTORIA"] },
  { clave: "ayuda", label: "En qué ayudo", tipos: ["OBJETIVOS", "FORTALEZAS"] },
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
        <SeccionLista
          key="formacion"
          tipo="FORMACION"
          titulo="Formación"
          ayuda="Tus títulos, posgrados y cursos. Con la institución y el año se ve mucho más sólido."
          columnas={[
            { clave: "titulo", label: "Título", placeholder: "Licenciatura en Nutrición", ancho: 2 },
            { clave: "institucion", label: "Dónde", placeholder: "Universidad Maza", ancho: 2 },
            { clave: "anio", label: "Año", placeholder: "2018", ancho: 1, numero: true },
          ]}
          inicial={(pendienteDe("FORMACION")?.valor as Record<string, unknown>[]) ?? datos.formacion}
          pendiente={pendienteDe("FORMACION")}
          onListo={listo}
        />
      )}

      {seccion === "recorrido" && (
        <SeccionLista
          key="recorrido"
          tipo="TRAYECTORIA"
          titulo="Recorrido"
          ayuda="Dónde trabajaste o trabajás: clubes, consultorios, equipos."
          columnas={[
            { clave: "titulo", label: "Qué hacías", placeholder: "Nutricionista", ancho: 2 },
            { clave: "lugar", label: "Dónde", placeholder: "Club Deportivo Maipú", ancho: 2 },
            { clave: "anio_desde", label: "Desde", placeholder: "2019", ancho: 1, numero: true },
            { clave: "anio_hasta", label: "Hasta", placeholder: "hoy", ancho: 1, numero: true },
          ]}
          inicial={(pendienteDe("TRAYECTORIA")?.valor as Record<string, unknown>[]) ?? datos.trayectoria}
          pendiente={pendienteDe("TRAYECTORIA")}
          onListo={listo}
        />
      )}

      {seccion === "ayuda" && (
        <SeccionAyuda
          catalogoObjetivos={datos.catalogoObjetivos}
          catalogoFortalezas={datos.catalogoFortalezas}
          objetivos={(pendienteDe("OBJETIVOS")?.valor as string[]) ?? datos.objetivos}
          fortalezas={(pendienteDe("FORTALEZAS")?.valor as ItemFortaleza[]) ?? datos.fortalezas}
          pendienteObjetivos={pendienteDe("OBJETIVOS")}
          pendienteFortalezas={pendienteDe("FORTALEZAS")}
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
  objetivos: string[];
  fortalezas: ItemFortaleza[];
  pendienteObjetivos: Pendiente | null;
  pendienteFortalezas: Pendiente | null;
  onListo: () => void;
}) {
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(objetivos));
  const [fuertes, setFuertes] = useState<ItemFortaleza[]>(fortalezas);
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
  function marcarPrincipal(id: string) {
    setFuertes(fuertes.map((f) => ({ ...f, principal: f.id_fortaleza === id })));
  }

  return (
    <>
      <section className="tarjeta seccion-ficha">
        <h2>En qué ayudo</h2>
        <p className="ayuda">Los objetivos de tus pacientes. En la pantalla, el cliente toca su objetivo y te ve a vos.</p>
        <EstadoRevision pendiente={pendienteObjetivos} />
        <div className="opciones envolver">
          {catalogoObjetivos.map((o) => (
            <button key={o.id} type="button" aria-pressed={elegidos.has(o.id)} onClick={() => alternarObjetivo(o.id)}>
              {o.nombre}
            </button>
          ))}
        </div>
        {envioObjetivos.error && <p className="error">{envioObjetivos.error}</p>}
        <button type="button" className="boton" disabled={envioObjetivos.enviando} onClick={() => envioObjetivos.enviar(() => enviarLista("OBJETIVOS", [...elegidos]), onListo)}>
          {envioObjetivos.enviando ? "Mandando..." : "Enviar a revisión"}
        </button>
      </section>

      <section className="tarjeta seccion-ficha">
        <h2>En qué me destaco</h2>
        <p className="ayuda">Elegí hasta 3. Tocá la estrella para marcar la principal.</p>
        <EstadoRevision pendiente={pendienteFortalezas} />
        <div className="opciones envolver">
          {catalogoFortalezas.map((f) => {
            const elegida = fuertes.find((x) => x.id_fortaleza === f.id);
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
                    onClick={() => marcarPrincipal(f.id)}
                  >
                    ★
                  </button>
                )}
              </span>
            );
          })}
        </div>
        {envioFortalezas.error && <p className="error">{envioFortalezas.error}</p>}
        <button type="button" className="boton" disabled={envioFortalezas.enviando} onClick={() => envioFortalezas.enviar(() => enviarLista("FORTALEZAS", fuertes), onListo)}>
          {envioFortalezas.enviando ? "Mandando..." : "Enviar a revisión"}
        </button>
      </section>
    </>
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
