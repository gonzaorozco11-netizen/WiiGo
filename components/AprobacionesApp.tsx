"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  aprobarSolicitud,
  rechazarSolicitud,
  marcarEtiquetaHecha,
  type SolicitudBandeja,
  type TareaEtiquetaPendiente,
} from "@/app/(app)/aprobaciones/actions";

// Bandeja de aprobaciones.
//
// Está pensada para que no haya forma de equivocarse: una sola lista, lo más
// viejo arriba, y en cada tarjeta el antes y el después bien grandes al lado.
// Nada de tener que abrir otra pantalla para saber qué se está aprobando.

function pesos(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `$${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function haceCuanto(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
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

function TarjetaSolicitud({
  s,
  esAdmin,
  onResuelta,
}: {
  s: SolicitudBandeja;
  esAdmin: boolean;
  onResuelta: () => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [precioCorregido, setPrecioCorregido] = useState("");

  const precioNuevo = typeof s.datos.precio === "number" ? (s.datos.precio as number) : null;
  const precioAnterior = typeof s.datosAnteriores.precio === "number" ? (s.datosAnteriores.precio as number) : null;
  const variacion = typeof s.alertas.variacionPct === "number" ? (s.alertas.variacionPct as number) : null;
  const bloqueada = s.escalaADuenio && !esAdmin;

  function resolver(accion: "aprobar" | "rechazar") {
    setError(null);
    startTransition(async () => {
      const r =
        accion === "aprobar"
          ? await aprobarSolicitud(s.idSolicitud, {
              precioCorregido: corrigiendo && precioCorregido ? Number(precioCorregido) : undefined,
            })
          : await rechazarSolicitud(s.idSolicitud, motivo);
      if (r.error) setError(r.error);
      else onResuelta();
    });
  }

  return (
    <li className={`sol${s.escalaADuenio ? " sol-escala" : ""}`}>
      <div className="sol-cab">
        <div>
          <span className="sol-tipo">{s.tipoEtiqueta}</span>
          <span className="sol-marca">{s.marca}</span>
        </div>
        <span className="sol-cuando">{haceCuanto(s.solicitadaEl)}</span>
      </div>

      {s.producto && <p className="sol-producto">{s.producto}</p>}

      {/* El antes y el después, uno al lado del otro. Es lo único que hay
          que mirar para decidir — no debería hacer falta abrir nada más. */}
      {s.tipo === "PRECIO" && (
        <div className="sol-comparacion">
          <span className="sol-valor">
            <span className="et">Ahora</span>
            <span className="v mono">{pesos(precioAnterior)}</span>
          </span>
          <span className="sol-flecha">→</span>
          <span className="sol-valor nuevo">
            <span className="et">Pasa a</span>
            <span className="v mono">{pesos(precioNuevo)}</span>
          </span>
          {variacion !== null && (
            <span className={`sol-variacion${Math.abs(variacion) >= 30 ? " fuerte" : ""}`}>
              {variacion > 0 ? "+" : ""}
              {variacion}%
            </span>
          )}
        </div>
      )}

      {s.tipo === "DESCRIPCION" && (
        <div className="sol-texto">
          <p className="sol-texto-antes">{String(s.datosAnteriores.descripcion ?? "— sin descripción —")}</p>
          <p className="sol-texto-nuevo">{String(s.datos.descripcion ?? "")}</p>
        </div>
      )}

      {typeof s.alertas.motivoEscala === "string" && (
        <p className="sol-escala-motivo">⚠ {s.alertas.motivoEscala}</p>
      )}

      {s.vigenciaDesde && (
        <p className="sol-vigencia">Si lo aprobás, entra en vigencia el {fechaHora(s.vigenciaDesde)}</p>
      )}

      {error && <p className="sol-error">{error}</p>}

      {bloqueada ? (
        <p className="sol-bloqueada">Esta la tiene que aprobar el dueño.</p>
      ) : rechazando ? (
        <div className="sol-rechazo">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="¿Por qué? La marca lo va a leer"
            className="sol-input"
            autoFocus
          />
          <button onClick={() => resolver("rechazar")} disabled={pendiente || !motivo.trim()} className="sol-btn rechazar">
            Confirmar rechazo
          </button>
          <button onClick={() => setRechazando(false)} className="sol-btn plano">
            Volver
          </button>
        </div>
      ) : (
        <div className="sol-acciones">
          <button onClick={() => resolver("aprobar")} disabled={pendiente} className="sol-btn aprobar">
            {pendiente ? "..." : corrigiendo ? "Aprobar con este precio" : "Aprobar"}
          </button>

          {s.tipo === "PRECIO" && !corrigiendo && (
            <button onClick={() => setCorrigiendo(true)} className="sol-btn plano">
              Aprobar con otro precio
            </button>
          )}
          {corrigiendo && (
            <input
              type="number"
              value={precioCorregido}
              onChange={(e) => setPrecioCorregido(e.target.value)}
              placeholder="Precio"
              className="sol-input corto"
              autoFocus
            />
          )}

          <button onClick={() => setRechazando(true)} className="sol-btn plano">
            Rechazar
          </button>
        </div>
      )}
    </li>
  );
}

export default function AprobacionesApp({
  solicitudes,
  etiquetas,
  esAdmin,
}: {
  solicitudes: SolicitudBandeja[];
  etiquetas: TareaEtiquetaPendiente[];
  esAdmin: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"SOLICITUDES" | "ETIQUETAS">(
    // Si hay etiquetas vencidas, esa pestaña se abre primero: es lo único
    // con riesgo real (el cartel dice un precio y el sistema cobra otro).
    etiquetas.some((e) => e.vencida) ? "ETIQUETAS" : "SOLICITUDES"
  );
  const vencidas = etiquetas.filter((e) => e.vencida).length;

  return (
    <div>
      <div className="apro-cab">
        <div>
          <h1 className="apro-titulo">Aprobaciones</h1>
          <p className="apro-sub">Lo que las marcas mandaron y las etiquetas por cambiar</p>
        </div>
      </div>

      <div className="apro-tabs">
        <button
          className={`apro-tab${tab === "SOLICITUDES" ? " activa" : ""}`}
          onClick={() => setTab("SOLICITUDES")}
        >
          Solicitudes
          {solicitudes.length > 0 && <span className="apro-contador">{solicitudes.length}</span>}
        </button>
        <button className={`apro-tab${tab === "ETIQUETAS" ? " activa" : ""}`} onClick={() => setTab("ETIQUETAS")}>
          Etiquetas
          {etiquetas.length > 0 && (
            <span className={`apro-contador${vencidas > 0 ? " rojo" : ""}`}>{etiquetas.length}</span>
          )}
        </button>
      </div>

      {vencidas > 0 && (
        <div className="apro-alerta">
          <b>{vencidas} {vencidas === 1 ? "etiqueta vencida" : "etiquetas vencidas"}.</b> El precio nuevo ya
          está activo en el sistema y el cartel de góndola todavía muestra el viejo.
        </div>
      )}

      {tab === "SOLICITUDES" ? (
        solicitudes.length === 0 ? (
          <p className="apro-vacio">No hay nada pendiente. 🎉</p>
        ) : (
          <ul className="sol-lista">
            {solicitudes.map((s) => (
              <TarjetaSolicitud key={s.idSolicitud} s={s} esAdmin={esAdmin} onResuelta={() => router.refresh()} />
            ))}
          </ul>
        )
      ) : etiquetas.length === 0 ? (
        <p className="apro-vacio">No hay etiquetas pendientes.</p>
      ) : (
        <ul className="etq-lista">
          {etiquetas.map((e) => (
            <FilaEtiqueta key={e.idTarea} e={e} onHecha={() => router.refresh()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilaEtiqueta({ e, onHecha }: { e: TareaEtiquetaPendiente; onHecha: () => void }) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className={`etq${e.vencida ? " etq-vencida" : ""}`}>
      <div className="etq-info">
        <span className="etq-producto">{e.producto}</span>
        <span className="etq-precios mono">
          {pesos(e.precioAnterior)} → <b>{pesos(e.precioNuevo)}</b>
        </span>
        <span className="etq-vence">
          {e.vencida ? "Venció el" : "Cambiar antes del"} {fechaHora(e.venceEl)}
        </span>
        {error && <span className="sol-error">{error}</span>}
      </div>
      <button
        className="sol-btn aprobar"
        disabled={pendiente}
        onClick={() =>
          startTransition(async () => {
            const r = await marcarEtiquetaHecha(e.idTarea);
            if (r.error) setError(r.error);
            else onHecha();
          })
        }
      >
        {pendiente ? "..." : "Ya la cambié"}
      </button>
    </li>
  );
}
