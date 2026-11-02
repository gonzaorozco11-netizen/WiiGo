"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { avisarPublicacion } from "../actions";
import type { ObjetivosRedes } from "@/lib/puntosProfesionales";

// Sus objetivos de la semana (pacientes, historias y reel) con el "Ya lo
// subí", y su lugar en el ranking del mes. Mockup aprobado por Gonzalo:
// https://claude.ai/artifact/AUQiJqKJQvyx1DVxcBLYEu

const ICONO_IG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
  </svg>
);

const ESTADO: Record<string, { texto: string; clase: string }> = {
  PENDIENTE: { texto: "En revisión", clase: "ojo" },
  VERIFICADA: { texto: "Verificada", clase: "ok" },
  RECHAZADA: { texto: "No cumple", clase: "mal" },
};

/** Achica la captura en el celular antes de mandarla: Vercel no acepta más de 4,5 MB por pedido. */
async function achicar(archivo: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, 1080 / bitmap.width, 1920 / bitmap.height);
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(bitmap.width * escala);
    lienzo.height = Math.round(bitmap.height * escala);
    lienzo.getContext("2d")?.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/jpeg", 0.82));
    return blob ?? archivo;
  } catch {
    return archivo;
  }
}

export function TarjetaObjetivosSemana({
  redes,
  pacientes,
  soloLectura,
}: {
  redes: ObjetivosRedes;
  pacientes: { llevas: number; meta: number; diasQuedan: number };
  soloLectura: boolean;
}) {
  const [subiendo, setSubiendo] = useState<"HISTORIA" | "REEL" | null>(null);
  const { reglas } = redes;
  const pctPacientes = Math.min(100, Math.round((pacientes.llevas / Math.max(1, pacientes.meta)) * 100));
  const hechasHistorias = redes.historias.verificadas + redes.historias.enRevision;
  const pctHistorias = Math.min(100, Math.round((redes.historias.verificadas / Math.max(1, redes.historias.meta)) * 100));

  return (
    <section className="tarjeta">
      <h2>
        Tus objetivos de la semana <small>se renuevan el lunes</small>
      </h2>
      <div className="obj-lista">
        <div className="obj-tarea">
          <span className="obj-ico" style={{ background: "var(--salvia-fuerte)" }} aria-hidden="true">
            👥
          </span>
          <span>
            <b>
              {pacientes.meta} {pacientes.meta === 1 ? "paciente" : "pacientes"} con tu código
            </b>
            <small>
              Llevás {pacientes.llevas} · cada paciente del mes suma <span className="obj-pts">{reglas.ptsPaciente} pts</span>
            </small>
            <span className="obj-barra">
              <i style={{ width: `${pctPacientes}%` }} />
            </span>
          </span>
          <span className={`obj-chip ${pacientes.llevas >= pacientes.meta ? "ok" : "ojo"}`}>
            {pacientes.llevas} de {pacientes.meta}
          </span>
        </div>

        <div className="obj-tarea">
          <span className="obj-ico" style={{ background: "#d6286a" }}>
            {ICONO_IG}
          </span>
          <span>
            <b>
              {redes.historias.meta} {redes.historias.meta === 1 ? "historia" : "historias"} mencionando a @wiigo.arg
            </b>
            <small>
              {redes.historias.verificadas} {redes.historias.verificadas === 1 ? "verificada" : "verificadas"}
              {redes.historias.enRevision > 0 && `, ${redes.historias.enRevision} en revisión`} · cada una suma{" "}
              <span className="obj-pts">{reglas.ptsHistoria} pts</span>
            </small>
            <span className="obj-barra">
              <i style={{ width: `${pctHistorias}%` }} />
            </span>
          </span>
          {hechasHistorias >= redes.historias.meta ? (
            <span className="obj-chip ok">¡Listo!</span>
          ) : (
            <button className="obj-btn" type="button" onClick={() => setSubiendo("HISTORIA")} disabled={!redes.disponible}>
              Ya lo subí
            </button>
          )}
        </div>

        <div className="obj-tarea">
          <span className="obj-ico" style={{ background: "#22252a" }} aria-hidden="true">
            ▶
          </span>
          <span>
            <b>1 reel cada {reglas.reelCadaDias} días</b>
            <small>
              {redes.reel.hechoEnPeriodo
                ? `Ya sumaste el tuyo · el próximo suma en ${redes.reel.sumaEnDias} ${redes.reel.sumaEnDias === 1 ? "día" : "días"}`
                : redes.reel.enRevision > 0
                  ? "Tu reel está en revisión"
                  : "Subilo cuando quieras"}{" "}
              · suma <span className="obj-pts">{reglas.ptsReel} pts</span>
            </small>
            <span className="obj-barra">
              <i style={{ width: redes.reel.hechoEnPeriodo ? "100%" : "0%" }} />
            </span>
          </span>
          {redes.reel.hechoEnPeriodo ? (
            <span className="obj-chip ok">¡Listo!</span>
          ) : redes.reel.enRevision > 0 ? (
            <span className="obj-chip ojo">En revisión</span>
          ) : (
            <button className="obj-btn" type="button" onClick={() => setSubiendo("REEL")} disabled={!redes.disponible}>
              Ya lo subí
            </button>
          )}
        </div>
      </div>

      {!redes.disponible && <p className="nota">Muy pronto vas a poder avisar tus historias y reels desde acá.</p>}

      {redes.recientes.length > 0 && (
        <div className="obj-recientes">
          <p className="obj-sub">Lo último que avisaste</p>
          <ul>
            {redes.recientes.map((p) => (
              <li key={p.idPublicacion}>
                <span>
                  {p.tipo === "REEL" ? "Reel" : "Historia"} ·{" "}
                  {new Date(p.creadaEl).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })}
                  {p.estado === "RECHAZADA" && p.motivo && <em> — {p.motivo}</em>}
                </span>
                <span className={`obj-chip ${ESTADO[p.estado].clase}`}>{ESTADO[p.estado].texto}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {subiendo && <VentanaYaLoSubi tipo={subiendo} soloLectura={soloLectura} onCerrar={() => setSubiendo(null)} />}
    </section>
  );
}

function VentanaYaLoSubi({ tipo, soloLectura, onCerrar }: { tipo: "HISTORIA" | "REEL"; soloLectura: boolean; onCerrar: () => void }) {
  const router = useRouter();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [menciono, setMenciono] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esHistoria = tipo === "HISTORIA";

  async function enviar() {
    setError(null);
    setEnviando(true);
    try {
      const datos = new FormData();
      datos.set("tipo", tipo);
      if (menciono) datos.set("menciono", "on");
      if (esHistoria && archivo) datos.set("archivo", await achicar(archivo), "captura.jpg");
      if (!esHistoria) datos.set("link", link);
      const r = await avisarPublicacion(datos);
      if (r.error) return setError(r.error);
      onCerrar();
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="obj-fondo" role="dialog" aria-modal="true" aria-labelledby="ya-lo-subi">
      <div className="obj-modal">
        <h3 id="ya-lo-subi">{esHistoria ? "Ya subí mi historia" : "Ya subí mi reel"}</h3>
        {esHistoria ? (
          <label className="obj-subir">
            <input type="file" accept="image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            {archivo ? (
              <b>📷 {archivo.name}</b>
            ) : (
              <>
                <b>📷 Subí la captura de tu historia</b>
                <small>Las historias duran 24 h: con la captura, WiiGo la puede verificar.</small>
              </>
            )}
          </label>
        ) : (
          <label className="obj-campo">
            Link del reel
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" inputMode="url" />
          </label>
        )}
        <label className="obj-check">
          <input type="checkbox" checked={menciono} onChange={(e) => setMenciono(e.target.checked)} />
          <span>
            Mencioné a <b>@wiigo.arg</b> {esHistoria ? "en la historia" : "en el reel"}.
          </span>
        </label>
        <p className="nota">Suma cuando WiiGo lo verifica. Si algo no se ve bien, te llega el motivo acá para que lo corrijas.</p>
        {soloLectura && <p className="obj-error">Estás mirando su espacio: desde acá no se manda nada.</p>}
        {error && <p className="obj-error">{error}</p>}
        <div className="obj-acciones">
          <button type="button" className="obj-btn sec" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="button" className="obj-btn" onClick={enviar} disabled={enviando || soloLectura}>
            {enviando ? "Mandando…" : "Avisar a WiiGo"}
          </button>
        </div>
      </div>
    </div>
  );
}

export type FilaRanking = { puesto: number; etiqueta: string; puntos: number; yo: boolean };

export function TarjetaRanking({
  puesto,
  puntos,
  filas,
  consejo,
}: {
  puesto: number;
  puntos: number;
  filas: FilaRanking[];
  consejo: string;
}) {
  const enPodio = puntos > 0 && puesto <= 3;
  return (
    <section className="tarjeta">
      <h2>
        Tu lugar este mes <small>se reinicia el 1.º</small>
      </h2>
      <div className="rk-puesto">
        <span className="rk-num">{puntos > 0 ? `${puesto}.º` : "—"}</span>
        <div>
          <b>
            {puntos} {puntos === 1 ? "punto" : "puntos"}
          </b>
          <small>{enPodio ? "Estás en el podio: este mes te toca todo lo de abajo 🎉" : "Las 3 primeras del mes se llevan todo lo de abajo."}</small>
        </div>
      </div>
      <p className="rk-consejo">{consejo}</p>
      <div className="rk-premios">
        <b>¿Para qué sirve cumplir tus objetivos?</b>
        <p>Las 3 primeras del mes:</p>
        <ul>
          <li>
            <span aria-hidden="true">📺</span> Salen en las <b>pantallas del local</b>, con su foto y su especialidad.
          </li>
          <li>
            <span aria-hidden="true">📣</span> WiiGo <b>les pauta contenido</b> en redes, pagado por WiiGo.
          </li>
          <li>
            <span aria-hidden="true">🔁</span> WiiGo <b>comparte sus publicaciones</b> en @wiigo.arg.
          </li>
          <li>
            <span aria-hidden="true">⭐</span> Salen <b>primeras en la pantalla asesora</b>, con la insignia Destacada.
          </li>
        </ul>
        <small>Más objetivos cumplidos = más gente que te conoce = más pacientes.</small>
      </div>
      {filas.length > 0 && (
        <div className="rk-lista">
          {filas.map((f, i) => (
            <div key={i} className={`rk-fila${f.yo ? " yo" : ""}`}>
              <span>{f.puesto}</span>
              <span>{f.etiqueta}</span>
              <span className="mono">{f.puntos} pts</span>
            </div>
          ))}
        </div>
      )}
      <p className="nota">Las demás no ven tu nombre ni vos el de ellas: solo los puntos.</p>
    </section>
  );
}
