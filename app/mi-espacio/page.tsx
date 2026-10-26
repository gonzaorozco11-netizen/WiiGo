import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import { completitudProfesional } from "@/lib/completitudProfesional";
import { saldosPorMarca } from "@/lib/canjesProfesionales";

export const dynamic = "force-dynamic";

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

// Cada cosa que le falta lleva a la parte de «Mi ficha» donde se completa.
const SECCION_DE_ITEM: Record<string, string> = {
  foto: "fotos",
  titulo: "sobre",
  bio: "sobre",
  fortalezas: "ayuda",
  objetivos: "ayuda",
  turnos: "turnos",
  historia: "historia",
  precio: "turnos",
  formacion: "formacion",
  fotos: "fotos",
  video: "videos",
};

export default async function InicioEspacio() {
  // Cada página mira la sesión por su cuenta: el layout no siempre se vuelve
  // a ejecutar al pasar de una página a otra.
  const sesion = await obtenerSesionProfesional();
  if (!sesion) redirect("/login?next=/mi-espacio");
  const id = sesion.idProfesional;
  const supabase = getSupabaseServerClient();

  const [completitud, codigosRes, referidosRes, saldos, profRes, localRes, cambiosRes] = await Promise.all([
    completitudProfesional(supabase, id),
    supabase.from("codigos_profesionales").select("codigo, estado").eq("id_profesional", id).eq("estado", "ACTIVO").limit(1),
    supabase.from("referidos_profesionales").select("id_referido, estado").eq("id_profesional", id),
    saldosPorMarca(supabase, id),
    supabase.from("profesionales").select("publicado, id_consultorio").eq("id_profesional", id).maybeSingle(),
    supabase.from("locales").select("nombre, direccion").eq("estado", "ACTIVO").order("nombre").limit(1),
    supabase.from("cambios_profesional").select("estado").eq("id_profesional", id).in("estado", ["PENDIENTE", "CORREGIR"]),
  ]);
  const esperando = (cambiosRes.data ?? []).filter((c) => c.estado === "PENDIENTE").length;
  const paraCorregir = (cambiosRes.data ?? []).filter((c) => c.estado === "CORREGIR").length;

  const codigo = (codigosRes.data?.[0]?.codigo as string | undefined) ?? null;
  const compras = (referidosRes.data ?? []).filter((r) => r.estado !== "ANULADO").length;
  const conSaldo = saldos.filter((s) => s.saldo > 0);
  const saldoTotal = conSaldo.reduce((t, s) => t + s.saldo, 0);
  const direccion = (localRes.data?.[0]?.direccion as string | undefined) ?? null;

  // Con quién comparte agenda, si atiende en un consultorio.
  let consultorio: { nombre: string; companeras: { nombre: string; foto: string | null }[] } | null = null;
  const idConsultorio = profRes.data?.id_consultorio as string | null | undefined;
  if (idConsultorio) {
    const [cRes, mRes] = await Promise.all([
      supabase.from("consultorios").select("nombre").eq("id_consultorio", idConsultorio).maybeSingle(),
      supabase.from("profesionales").select("id_profesional, nombre, apellido, foto").eq("id_consultorio", idConsultorio).eq("estado", "ACTIVO"),
    ]);
    consultorio = {
      nombre: (cRes.data?.nombre as string | undefined) ?? "Consultorio",
      companeras: (mRes.data ?? [])
        .filter((m) => m.id_profesional !== id)
        .map((m) => ({ nombre: [m.nombre, m.apellido].filter(Boolean).join(" "), foto: (m.foto as string | null) ?? null })),
    };
  }

  const enPantalla = Boolean(profRes.data?.publicado);
  const faltan = completitud.items.filter((i) => !i.ok);
  const listos = completitud.items.filter((i) => i.ok);
  const mensajeCodigo = codigo
    ? `Si pasás por WiiGo${direccion ? ` (${direccion})` : ""}, decí mi código ${codigo} en la caja.`
    : "";

  return (
    <main className="esp-lienzo">
      <div className="esp-dos">
        <div className="esp-col">
          <section className="hola" aria-label="Tu ficha">
            <div className="anillo" style={{ "--p": completitud.porcentaje } as React.CSSProperties}>
              {sesion.foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sesion.foto} alt="" />
              ) : (
                <span className="sin-foto">{sesion.nombre.charAt(0)}</span>
              )}
              <span className="pct">{completitud.porcentaje}%</span>
            </div>
            <div>
              <h1>Hola, {sesion.nombre}</h1>
              {enPantalla ? (
                <p className="estado-pantalla si">
                  <i />
                  Estás en la pantalla del local
                </p>
              ) : (
                <p className="estado-pantalla no">
                  <i />
                  Todavía no estás en la pantalla: WiiGo te publica cuando tu ficha está lista
                </p>
              )}
              {paraCorregir > 0 && (
                <Link className="chip-estado corregir" href="/mi-espacio/ficha">
                  WiiGo te pidió que corrijas {paraCorregir === 1 ? "algo" : `${paraCorregir} cosas`} ›
                </Link>
              )}
              {esperando > 0 && (
                <span className="chip-estado">
                  {esperando === 1 ? "1 cambio esperando que WiiGo lo apruebe" : `${esperando} cambios esperando que WiiGo los apruebe`}
                </span>
              )}
            </div>
          </section>

          <section className="tarjeta">
            {faltan.length > 0 ? (
              <>
                <h2>
                  {faltan.length === 1 ? "Te falta 1 cosa" : `Te faltan ${faltan.length} cosas`}
                  <small>para que tu ficha quede completa</small>
                </h2>
                <div className="faltas">
                  {faltan.slice(0, 6).map((i) => (
                    <Link key={i.clave} className="falta" href={`/mi-espacio/ficha?seccion=${SECCION_DE_ITEM[i.clave] ?? "sobre"}`}>
                      <span className="mas">+</span>
                      <b>{i.label}</b>
                      <span>{i.ayuda}</span>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <p className="completa">¡Tu ficha está completa! Así es como mejor se ve en la pantalla del local.</p>
            )}
            {listos.length > 0 && (
              <details className="listas">
                <summary>
                  {listos.length === 1 ? "1 cosa ya lista" : `${listos.length} cosas ya listas`} ›
                </summary>
                <ul>
                  {listos.map((i) => (
                    <li key={i.clave}>{i.label}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>

        <div className="esp-col">
          <section className="tarjeta">
            <h2>Tu código</h2>
            {codigo ? (
              <>
                <div className="codigo">
                  <span className="cod">{codigo}</span>
                  <a className="boton-wa" href={`https://wa.me/?text=${encodeURIComponent(mensajeCodigo)}`} target="_blank" rel="noopener noreferrer">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" />
                    </svg>
                    Compartir
                  </a>
                </div>
                <p className="nota">Tus pacientes lo dicen en la caja y vos sumás saldo para usar en el local.</p>
              </>
            ) : (
              <p className="vacio">Todavía no tenés código. Pedíselo a WiiGo.</p>
            )}
            <div className="numeros">
              <div>
                <b>{compras}</b>
                <span>{compras === 1 ? "compra con tu código" : "compras con tu código"}</span>
              </div>
              <div>
                <b>{pesos(saldoTotal)}</b>
                <span>{conSaldo.length === 1 ? `de saldo en ${conSaldo[0].nombreMarca}` : "de saldo para usar en el local"}</span>
              </div>
            </div>
          </section>

          <section className="tarjeta">
            <h2>Tus turnos</h2>
            {consultorio && consultorio.companeras.length > 0 ? (
              <div className="agenda">
                <div className="duo">
                  {[{ nombre: sesion.nombre, foto: sesion.foto }, ...consultorio.companeras].slice(0, 3).map((m, i) =>
                    m.foto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={m.foto} alt="" />
                    ) : (
                      <span key={i} className="ini">
                        {m.nombre.charAt(0)}
                      </span>
                    )
                  )}
                </div>
                <div>
                  <b>Agenda compartida con {consultorio.companeras.map((c) => c.nombre).join(" y ")}</b>
                  <span>La maneja WiiGo. Si querés cambiar algo, escribinos.</span>
                </div>
              </div>
            ) : (
              <p className="vacio">Tu link de turnos lo maneja WiiGo. Si querés cambiar algo, escribinos.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
