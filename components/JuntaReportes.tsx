"use client";

import { useState } from "react";
import { generarReporteAhora, listarReportes, verReporte, type ReporteListado } from "@/app/(app)/junta/actions";

// Los reportes de la Junta guardados: el diario de cada mañana y el semanal
// de los lunes. Se abren tal cual llegaron por mail. También se pueden armar
// en el momento, sin esperar a la mañana siguiente.

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export default function JuntaReportes({ iniciales }: { iniciales: { reportes: ReporteListado[]; faltaSql: boolean } }) {
  const [lista, setLista] = useState(iniciales);
  const [abierto, setAbierto] = useState<{ titulo: string; html: string } | null>(null);
  const [armando, setArmando] = useState<"DIARIO" | "SEMANAL" | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  async function abrir(r: ReporteListado) {
    const { html } = await verReporte(r.id);
    if (html) setAbierto({ titulo: r.titulo, html });
  }

  async function armar(tipo: "DIARIO" | "SEMANAL") {
    setArmando(tipo);
    setAviso(null);
    const r = await generarReporteAhora(tipo);
    setArmando(null);
    setAviso(r.error ? { ok: false, texto: r.error } : { ok: true, texto: r.mensaje ?? "Listo." });
    setLista(await listarReportes());
  }

  if (lista.faltaSql) return <p className="jt-aviso">Falta correr sql/junta-reportes.sql en Supabase para guardar y mandar los reportes.</p>;

  return (
    <div className="jt-tareas">
      <p className="jt-nota" style={{ margin: 0 }}>
        Te llegan por mail: el diario cada mañana entre las 6 y las 7, y el semanal los lunes a la misma hora.
      </p>
      <div className="jt-botones">
        <button type="button" className="si" disabled={armando !== null} onClick={() => armar("DIARIO")}>
          {armando === "DIARIO" ? "Armando… (unos 30 segundos)" : "Armar el de ayer ahora"}
        </button>
        <button type="button" disabled={armando !== null} onClick={() => armar("SEMANAL")}>
          {armando === "SEMANAL" ? "Armando…" : "Armar el semanal ahora"}
        </button>
      </div>
      {aviso && <p className={aviso.ok ? "jt-nota" : "jt-error"}>{aviso.texto}</p>}

      {lista.reportes.length === 0 ? (
        <p className="jt-vacio">Todavía no hay reportes. El primero llega mañana a la mañana, o armalo ahora con el botón de arriba.</p>
      ) : (
        <div className="jt-activas">
          {lista.reportes.map((r) => (
            <button key={r.id} type="button" className="jt-reporte" onClick={() => abrir(r)}>
              <span className={`jt-estado ${r.tipo === "SEMANAL" ? "hecha" : "pendiente"}`}>{r.tipo === "SEMANAL" ? "Semanal" : "Diario"}</span>
              <span className="jt-reporte-txt">
                <b>{r.titulo}</b>
                <span>
                  {r.titular ?? ""} {r.error ? `· no se mandó el mail: ${r.error}` : r.enviadoA ? `· enviado ${ddmm(r.fecha)}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {abierto && (
        <div className="jt-modal" role="dialog" aria-modal="true" aria-label={abierto.titulo} onClick={() => setAbierto(null)}>
          <div className="jt-modal-caja" onClick={(e) => e.stopPropagation()}>
            <div className="jt-modal-cab">
              <b>{abierto.titulo}</b>
              <button type="button" onClick={() => setAbierto(null)} aria-label="Cerrar">
                ×
              </button>
            </div>
            <iframe title={abierto.titulo} srcDoc={abierto.html} sandbox="" className="jt-modal-mail" />
          </div>
        </div>
      )}
    </div>
  );
}
