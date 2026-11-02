import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import { semanaProfesional } from "@/lib/semanaProfesional";
import { sugerenciasParaProfesional } from "@/lib/sugerenciasProfesional";
import { objetivosRedes, rankingDelMes } from "@/lib/puntosProfesionales";
import { TarjetaSemana } from "../TarjetasSemana";
import { TarjetaObjetivosSemana, TarjetaRanking, type FilaRanking } from "./ObjetivosRedes";

export const dynamic = "force-dynamic";

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const pct = (n: number) => `${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export default async function ObjetivosEspacio() {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) redirect("/login?next=/mi-espacio/objetivos");
  const id = sesion.idProfesional;
  const supabase = getSupabaseServerClient();

  const [semana, sugerencias, codigoRes, localRes, redes, ranking] = await Promise.all([
    semanaProfesional(supabase, id, sesion.nombre),
    sugerenciasParaProfesional(supabase, id),
    supabase.from("codigos_profesionales").select("codigo").eq("id_profesional", id).eq("estado", "ACTIVO").limit(1),
    supabase.from("locales").select("direccion").eq("estado", "ACTIVO").order("nombre").limit(1),
    objetivosRedes(supabase, id),
    rankingDelMes(supabase),
  ]);
  const codigo = (codigoRes.data?.[0]?.codigo as string | undefined) ?? null;
  const direccion = (localRes.data?.[0]?.direccion as string | undefined) ?? null;
  const dondeEsta = `WiiGo${direccion ? `, ${direccion}` : ""}`;

  // El ranking sin nombres: ella se ve como "Vos" y las demás como Profesional A, B…
  const mia = ranking.filas.find((f) => f.idProfesional === id);
  const misPuntos = mia?.puntos ?? 0;
  const miPuesto = mia?.puesto ?? ranking.filas.length;
  let letra = 0;
  const conEtiqueta: FilaRanking[] = ranking.filas
    .filter((f) => f.puntos > 0 || f.idProfesional === id)
    .map((f) => ({ puesto: f.puesto, puntos: f.puntos, yo: f.idProfesional === id, etiqueta: f.idProfesional === id ? "Vos" : `Profesional ${LETRAS[letra++ % 26]}` }));
  const filasRanking = conEtiqueta.filter((f, i) => i < 3 || f.yo);

  // Cuánto le falta para subir un puesto, en cosas que puede hacer.
  const r = ranking.reglas;
  const arriba = ranking.filas.filter((f) => f.puntos > misPuntos).at(-1);
  const formas = `una historia suma ${r.ptsHistoria}, un paciente ${r.ptsPaciente} y un reel ${r.ptsReel}`;
  const consejo = !ranking.filas.some((f) => f.puntos > 0)
    ? `Este mes todavía nadie sumó: tu primer paciente o tu primera historia te ponen arriba (${formas}).`
    : !arriba
      ? "¡Vas primera! Seguí así para quedarte con el 1.er lugar del mes."
      : `Te ${arriba.puntos - misPuntos + 1 === 1 ? "falta 1 punto" : `faltan ${arriba.puntos - misPuntos + 1} puntos`} para el ${arriba.puesto}.º lugar: ${formas}.`;

  // Una idea de historia con los productos de lo que ella trabaja.
  const productos = sugerencias.slice(0, 3).map((s) => s.nombre);
  const idea = productos.length
    ? `«Lo que les recomiendo a mis pacientes: ${productos[0]}. Lo consiguen en @wiigo.arg 🌿»`
    : "«Mis pacientes me preguntan dónde comprar lo que les recomiendo: en @wiigo.arg 🌿»";

  return (
    <main className="esp-lienzo">
      <div className="esp-dos">
        <div className="esp-col">
          <TarjetaObjetivosSemana redes={redes} pacientes={semana.objetivo} soloLectura={sesion.soloLectura} />
          <section className="tarjeta obj-idea">
            <h2>
              💡 Idea para tu historia de hoy <small>copiala o hacela tuya</small>
            </h2>
            <p>{idea}</p>
            {productos.length > 0 && <p className="nota">Productos de tus objetivos: {productos.join(", ")}.</p>}
          </section>
          <TarjetaSemana semana={semana} />

          <section className="tarjeta">
            <h2>
              {semana.racha > 0 ? `${semana.racha} ${semana.racha === 1 ? "semana seguida" : "semanas seguidas"}` : "Tu racha"}
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
          <TarjetaRanking puesto={miPuesto} puntos={misPuntos} filas={filasRanking} consejo={consejo} />
          <section className="tarjeta">
            <h2>
              Avisale a tus pacientes <small>lo mandás vos, desde tu WhatsApp</small>
            </h2>
            {sugerencias.length === 0 ? (
              <p className="vacio">Todavía no hay productos cargados para lo que trabajás. WiiGo los va sumando.</p>
            ) : (
              <div className="sugerencias">
                {sugerencias.map((s) => {
                  const mensaje = `Te recomiendo ${s.nombre}${s.objetivo ? ` para ${s.objetivo.toLowerCase()}` : ""}. Lo conseguís en ${dondeEsta}.${codigo ? ` Decí mi código ${codigo} en la caja con tu DNI.` : ""}`;
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
                        Tu paciente: <b>{pct(s.porcentajeCliente)}</b> en su primera compra · Vos: <b>{pct(s.porcentajeProfesional)}</b>
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
