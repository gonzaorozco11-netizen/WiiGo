import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import { semanaProfesional } from "@/lib/semanaProfesional";
import { sugerenciasParaProfesional } from "@/lib/sugerenciasProfesional";
import { TarjetaSemana, TarjetaObjetivo } from "../TarjetasSemana";

export const dynamic = "force-dynamic";

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const pct = (n: number) => `${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;

export default async function ObjetivosEspacio() {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) redirect("/login?next=/mi-espacio/objetivos");
  const id = sesion.idProfesional;
  const supabase = getSupabaseServerClient();

  const [semana, sugerencias, codigoRes, localRes] = await Promise.all([
    semanaProfesional(supabase, id, sesion.nombre),
    sugerenciasParaProfesional(supabase, id),
    supabase.from("codigos_profesionales").select("codigo").eq("id_profesional", id).eq("estado", "ACTIVO").limit(1),
    supabase.from("locales").select("direccion").eq("estado", "ACTIVO").order("nombre").limit(1),
  ]);
  const codigo = (codigoRes.data?.[0]?.codigo as string | undefined) ?? null;
  const direccion = (localRes.data?.[0]?.direccion as string | undefined) ?? null;
  const dondeEsta = `WiiGo${direccion ? `, ${direccion}` : ""}`;

  return (
    <main className="esp-lienzo">
      <div className="esp-dos">
        <div className="esp-col">
          <TarjetaSemana semana={semana} />
          <TarjetaObjetivo semana={semana} />

          <section className="tarjeta">
            <h2>
              {semana.racha > 0 ? `${semana.racha} ${semana.racha === 1 ? "semana" : "semanas"} seguidas` : "Tu racha"}
              <small>con pacientes que usan tu código</small>
            </h2>
            <div className="semanas" aria-label="Últimas 6 semanas">
              {semana.semanasRacha.map((si, i) => (
                <span key={i} className={si ? "si" : i === semana.semanasRacha.length - 1 ? "ahora" : "no"}>
                  {si ? "✓" : i === semana.semanasRacha.length - 1 ? "?" : ""}
                </span>
              ))}
            </div>
            <p className="nota">
              {semana.racha >= 2 ? "¡Venís sin cortarla, seguí así! " : ""}Cada semana con al menos un paciente que use tu código suma a tu racha.
            </p>
          </section>

          <section className="tarjeta">
            <h2>
              {semana.nivel.destacada ? "Tu ficha está destacada" : "Ficha destacada"}
              <small>este mes</small>
            </h2>
            <div className="barra-nivel" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (semana.nivel.pacientesMes / semana.nivel.meta) * 100)}%` }} />
            </div>
            <p className="nota">
              {semana.nivel.pacientesMes} de {semana.nivel.meta} pacientes este mes.{" "}
              {semana.nivel.destacada
                ? "Las fichas destacadas aparecen primero en la pantalla del local."
                : `Con ${semana.nivel.meta} tu ficha pasa a destacada y aparece primero en la pantalla del local.`}
            </p>
          </section>
        </div>

        <div className="esp-col">
          <section className="tarjeta">
            <h2>
              Avisale a tus pacientes <small>lo mandás vos, desde tu WhatsApp</small>
            </h2>
            {sugerencias.length === 0 ? (
              <p className="vacio">Todavía no hay productos cargados para lo que trabajás. WiiGo los va sumando.</p>
            ) : (
              <div className="sugerencias">
                {sugerencias.map((s) => {
                  const mensaje = `Te recomiendo ${s.nombre}${s.objetivo ? ` para ${s.objetivo.toLowerCase()}` : ""}. Lo conseguís en ${dondeEsta}.${codigo ? ` Decí mi código ${codigo} en la caja.` : ""}`;
                  return (
                    <article key={s.idProducto} className="sugerencia">
                      <div className="sug-cab">
                        {s.imagen ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.imagen} alt="" />
                        ) : (
                          <span className="sin-img" />
                        )}
                        <div>
                          {s.objetivo && <span className="chip-obj">{s.objetivo}</span>}
                          <b>{s.nombre}</b>
                          <span>
                            {s.marca}
                            {s.precio != null && ` · ${pesos(s.precio)}`}
                          </span>
                        </div>
                      </div>
                      <p className="reparto">
                        Tu paciente: <b>{pct(s.porcentajeCliente)}</b> · Vos: <b>{pct(s.porcentajeProfesional)}</b>
                      </p>
                      <p className="sug-msj">«{mensaje}»</p>
                      <a className="boton-wa" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener noreferrer">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" />
                        </svg>
                        Mandar por WhatsApp
                      </a>
                    </article>
                  );
                })}
              </div>
            )}
            <p className="nota">Elegís a quién se lo mandás. WiiGo nunca ve a qué paciente le escribís.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
