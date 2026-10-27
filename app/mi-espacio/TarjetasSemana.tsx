import Link from "next/link";
import type { SemanaProfesional } from "@/lib/semanaProfesional";

// Las tarjetas de "su semana", compartidas por Inicio y Objetivos.

export function TarjetaSemana({ semana }: { semana: SemanaProfesional }) {
  return (
    <section className="tarjeta">
      <h2>
        Tu semana en la pantalla <small>desde el lunes</small>
      </h2>
      <div className="vistas">
        <div>
          <b className="mono">{semana.fichas}</b>
          <span>{semana.fichas === 1 ? "abrió tu ficha" : "abrieron tu ficha"}</span>
        </div>
        <div>
          <b className="mono">{semana.conocemeEntero}</b>
          <span>{semana.conocemeEntero === 1 ? "vio tu Conóceme entero" : "vieron tu Conóceme entero"}</span>
        </div>
        <div>
          <b className="mono">{semana.reservar}</b>
          <span>{semana.reservar === 1 ? "tocó «Reservar turno»" : "tocaron «Reservar turno»"}</span>
        </div>
      </div>
      <p className="elogio">{semana.elogio}</p>
    </section>
  );
}

export function TarjetaObjetivo({ semana, conLink = false }: { semana: SemanaProfesional; conLink?: boolean }) {
  const { meta, llevas, diasQuedan } = semana.objetivo;
  const cumplido = llevas >= meta;
  const porcentaje = Math.min(100, Math.round((llevas / meta) * 100));
  const contenido = (
    <>
      <h2>
        Tu objetivo de la semana{" "}
        <small>{cumplido ? "¡cumplido!" : diasQuedan === 1 ? "queda 1 día" : `quedan ${diasQuedan} días`}</small>
      </h2>
      <div className="obj-fila">
        <div className="obj-anillo" style={{ "--p": porcentaje } as React.CSSProperties}>
          <b className="mono">
            {llevas}/{meta}
          </b>
        </div>
        <div>
          <b>
            {meta} {meta === 1 ? "paciente que use" : "pacientes que usen"} tu código
          </b>
          <span>
            {cumplido
              ? "¡Lo lograste! Todo lo que venga ahora suma a tu mes."
              : `Te ${meta - llevas === 1 ? "falta 1" : `faltan ${meta - llevas}`} para cumplirlo.`}
          </span>
        </div>
      </div>
    </>
  );
  return conLink ? (
    <Link className="tarjeta tarjeta-link" href="/mi-espacio/objetivos">
      {contenido}
    </Link>
  ) : (
    <section className="tarjeta">{contenido}</section>
  );
}
