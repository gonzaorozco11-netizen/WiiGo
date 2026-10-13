import Link from "next/link";
import type { TareasPortal } from "@/app/portal/actions";

// Mis tareas: todo lo que depende de la marca, en un solo lugar.
//
// Ordenado por consecuencia y no por tipo. Una lista plana de "pendientes" se
// lee como deberes y se ignora; agrupada en "esto frena algo" y "esto te hace
// vender más", cada línea dice qué le pasa si no lo hace.
//
// Y el bloque de "al día" no es relleno: cerrar con "en esto estás bien" es lo
// que hace que quieran vaciar los otros dos.

export default function PortalTareas({ datos }: { datos: TareasPortal }) {
  const frena = datos.tareas.filter((t) => t.grupo === "FRENA");
  const vender = datos.tareas.filter((t) => t.grupo === "VENDER");
  const faltanPasos = datos.pasosHechos < datos.pasos.length;

  return (
    <main className="portal-lienzo">
      <div className="tareas-cab">
        <h1>Mis tareas</h1>
        <p>Todo lo que depende de vos, en un solo lugar.</p>
      </div>

      {/* Primeros pasos. Desaparece solo cuando los cuatro están: no es un
          cartel que se cierra, es una lista que se vacía. */}
      {faltanPasos && (
        <section className="pasos">
          <div className="pasos-cab">
            <div>
              <p className="rotulo">Primeros pasos</p>
              <p className="sub">Cuando termines los cuatro, este bloque desaparece.</p>
            </div>
            <div className="pasos-prog">
              <span className="barra">
                <span style={{ width: `${(datos.pasosHechos / datos.pasos.length) * 100}%` }} />
              </span>
              <b className="mono">
                {datos.pasosHechos} de {datos.pasos.length}
              </b>
            </div>
          </div>

          <ol>
            {datos.pasos.map((p) => (
              <li key={p.id} className={p.hecho ? "hecho" : undefined}>
                <span className="marca" aria-hidden="true">
                  {p.hecho ? "✓" : ""}
                </span>
                <span className="texto">{p.texto}</span>
                {!p.hecho && (
                  <Link className="tarea-btn" href={p.href}>
                    Hacerlo
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {frena.length > 0 && (
        <section className="tareas-grupo frena">
          <h2>
            Esto frena algo
            <span className="cuantas">{frena.length}</span>
          </h2>
          {frena.map((t) => (
            <FilaTarea key={t.id} t={t} fuerte />
          ))}
        </section>
      )}

      {vender.length > 0 && (
        <section className="tareas-grupo vender">
          <h2>
            Esto te hace vender más
            <span className="cuantas">{vender.length}</span>
          </h2>
          {vender.map((t) => (
            <FilaTarea key={t.id} t={t} />
          ))}
        </section>
      )}

      {datos.alDia.length > 0 && (
        <section className="tareas-grupo aldia">
          <h2>Al día</h2>
          <div className="aldia-caja">
            <span aria-hidden="true">✓</span>
            <p>{datos.alDia.join(" · ")}</p>
          </div>
        </section>
      )}

      {datos.tareas.length === 0 && (
        <p className="vacio">No tenés nada pendiente. Tu marca está al día.</p>
      )}
    </main>
  );
}

function FilaTarea({ t, fuerte }: { t: TareasPortal["tareas"][number]; fuerte?: boolean }) {
  return (
    <div className="tarea">
      <span className="tarea-n">{t.cuantas}</span>
      <div className="tarea-txt">
        <p className="tit">{t.titulo}</p>
        <p className="por">{t.porque}</p>
      </div>
      <Link className={`tarea-btn${fuerte ? " fuerte" : ""}`} href={t.href}>
        {t.accion}
      </Link>
    </div>
  );
}
