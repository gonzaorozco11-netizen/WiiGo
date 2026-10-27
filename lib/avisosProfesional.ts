import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase";
import { enviarMail, plantilla } from "@/lib/mail";
import { baseUrlPublica } from "@/lib/urlPublica";
import { fechaHoraArgentina } from "@/lib/horarios";
import { lunesDe, reglasProfesionales } from "@/lib/semanaProfesional";
import { completitudProfesional } from "@/lib/completitudProfesional";

// Los mails a las profesionales. Mismas reglas que los avisos a las marcas
// (lib/avisosEnviar.ts): nunca tiran, corren en su propio pedido y quedan
// anotados en avisos_profesional, también los que fallan, con el motivo.
//
// Solo a las que tienen usuario activo: son las que pueden entrar a ver lo
// que dice el mail.

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const inicioDelDia = (fecha: string) => `${fecha}T00:00:00-03:00`;

async function destinoDe(supabase: SupabaseClient, idProfesional: string) {
  const [{ data: p }, { data: u }] = await Promise.all([
    supabase.from("profesionales").select("nombre, email, estado").eq("id_profesional", idProfesional).maybeSingle(),
    supabase.from("usuarios").select("email, estado").eq("id_profesional", idProfesional).eq("rol", "profesional").maybeSingle(),
  ]);
  if (!p || p.estado !== "ACTIVO" || !u || u.estado !== "ACTIVO") return null;
  const para = ((p.email as string | null) || (u.email as string | null) || "").trim();
  return para ? { nombre: p.nombre as string, para } : null;
}

async function yaSeMando(supabase: SupabaseClient, idProfesional: string, tipo: string, referencia: string) {
  const { data, error } = await supabase
    .from("avisos_profesional")
    .select("id_aviso")
    .eq("id_profesional", idProfesional)
    .eq("tipo", tipo)
    .eq("referencia", referencia)
    .eq("ok", true)
    .limit(1);
  // Sin la tabla no hay dónde anotar: mejor no mandar que mandar repetido.
  if (error) return true;
  return (data ?? []).length > 0;
}

async function mandarYAnotar(
  supabase: SupabaseClient,
  idProfesional: string,
  tipo: string,
  referencia: string,
  para: string,
  asunto: string,
  html: string,
  texto: string
) {
  const r = await enviarMail({ para: [para], asunto, html, texto });
  await supabase.from("avisos_profesional").insert({ id_profesional: idProfesional, tipo, referencia, asunto, para, ok: r.ok, error: r.error });
}

function contarPacientes(referidos: { id_cliente: string | null }[]) {
  return new Set(referidos.map((r) => r.id_cliente).filter(Boolean)).size + referidos.filter((r) => !r.id_cliente).length;
}

/** Una venta con su código: «¡Un paciente usó tu código!». Lo llama avisarVenta. */
export async function avisarProfesionalPorVenta(idVenta: string): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    const { data: ref } = await supabase
      .from("referidos_profesionales")
      .select("id_profesional, recompensa_profesional, estado")
      .eq("id_venta", idVenta)
      .neq("estado", "ANULADO")
      .maybeSingle();
    if (!ref) return;
    const idProfesional = ref.id_profesional as string;
    if (await yaSeMando(supabase, idProfesional, "CODIGO", idVenta)) return;
    const destino = await destinoDe(supabase, idProfesional);
    if (!destino) return;

    const lunes = lunesDe();
    const [{ data: semana }, reglas] = await Promise.all([
      supabase.from("referidos_profesionales").select("id_cliente").eq("id_profesional", idProfesional).neq("estado", "ANULADO").gte("fecha", inicioDelDia(lunes)),
      reglasProfesionales(supabase),
    ]);
    const llevas = contarPacientes((semana ?? []).map((r) => ({ id_cliente: (r.id_cliente as string | null) ?? null })));
    const meta = reglas.objetivoSemanal;
    const progreso = llevas >= meta ? `¡Cumpliste tu objetivo de la semana! Vas ${llevas} de ${meta}.` : `Vas ${llevas} de ${meta} esta semana.`;
    const base = baseUrlPublica();
    const suma = Number(ref.recompensa_profesional ?? 0);

    const asunto = "¡Un paciente usó tu código!";
    const html = plantilla({
      titulo: asunto,
      bajada: `Gracias por recomendar WiiGo, ${destino.nombre}.`,
      destacado: suma > 0 ? `+${pesos(suma)}` : undefined,
      detalle: [suma > 0 ? "de saldo para usar en el local" : "", progreso].filter(Boolean),
      boton: base ? { texto: "Ver mi espacio", url: `${base}/mi-espacio` } : undefined,
      pie: "Te escribimos cada vez que alguien usa tu código en WiiGo.",
      base,
    });
    const texto = `${asunto}\n\nGracias por recomendar WiiGo, ${destino.nombre}.${suma > 0 ? `\nSumaste ${pesos(suma)} de saldo.` : ""}\n${progreso}${base ? `\n\n${base}/mi-espacio` : ""}`;
    await mandarYAnotar(supabase, idProfesional, "CODIGO", idVenta, destino.para, asunto, html, texto);
  } catch {
    // El mail es lo accesorio: la venta ya pasó.
  }
}

/**
 * El resumen de los lunes: cómo le fue la semana pasada en la pantalla y con
 * su código, y lo que le falta a su ficha. Solo si hay algo para contarle.
 */
export async function mandarResumenesSemanales(): Promise<{ mandados: number; salteados: number }> {
  const supabase = getSupabaseServerClient();
  const lunes = lunesDe();
  const lunesPasado = lunesDe(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const { data: usuarios } = await supabase.from("usuarios").select("id_profesional").eq("rol", "profesional").eq("estado", "ACTIVO");
  const ids = (usuarios ?? []).map((u) => u.id_profesional as string).filter(Boolean);
  const base = baseUrlPublica();
  let mandados = 0;
  let salteados = 0;

  for (const id of ids) {
    try {
      if (await yaSeMando(supabase, id, "SEMANAL", lunes)) {
        salteados += 1;
        continue;
      }
      const destino = await destinoDe(supabase, id);
      if (!destino) {
        salteados += 1;
        continue;
      }
      const [visRes, refRes, completitud] = await Promise.all([
        supabase.from("visitas_asesor").select("evento").eq("id_profesional", id).gte("fecha", inicioDelDia(lunesPasado)).lt("fecha", inicioDelDia(lunes)),
        supabase.from("referidos_profesionales").select("id_cliente").eq("id_profesional", id).neq("estado", "ANULADO").gte("fecha", inicioDelDia(lunesPasado)).lt("fecha", inicioDelDia(lunes)),
        completitudProfesional(supabase, id),
      ]);
      const fichas = (visRes.data ?? []).filter((v) => v.evento === "FICHA").length;
      const conoceme = (visRes.data ?? []).filter((v) => v.evento === "CONOCEME_FIN").length;
      const pacientes = contarPacientes((refRes.data ?? []).map((r) => ({ id_cliente: (r.id_cliente as string | null) ?? null })));
      const faltan = completitud.items.filter((i) => !i.ok);

      // Nada que contar ni nada que pedirle: no se le escribe.
      if (fichas === 0 && pacientes === 0 && faltan.length === 0) {
        salteados += 1;
        continue;
      }

      const lineas: string[] = [];
      // Veces, no personas: la pantalla no sabe quién toca.
      if (fichas > 0) lineas.push(`Tu ficha se abrió <strong>${fichas}</strong> ${fichas === 1 ? "vez" : "veces"} en la pantalla del local.`);
      if (conoceme > 0) lineas.push(`Tu Conóceme se vio entero <strong>${conoceme}</strong> ${conoceme === 1 ? "vez" : "veces"}.`);
      if (pacientes > 0) lineas.push(`<strong>${pacientes}</strong> ${pacientes === 1 ? "paciente compró" : "pacientes compraron"} con tu código o como paciente tuyo.`);
      if (lineas.length === 0) lineas.push("La semana pasada nadie abrió tu ficha. ¿Les contás a tus pacientes que estás en la pantalla de WiiGo?");

      const asunto = faltan.length > 0 && fichas === 0 && pacientes === 0 ? `${destino.nombre}, te ${faltan.length === 1 ? "falta 1 cosa" : `faltan ${faltan.length} cosas`} para completar tu ficha` : `Tu semana en WiiGo, ${destino.nombre}`;
      const listaFaltan = faltan.slice(0, 5).map((f) => `<li>${f.label}</li>`).join("");
      const html = plantilla({
        titulo: "Tu semana en WiiGo",
        bajada: `Del lunes ${fechaHoraArgentina(inicioDelDia(lunesPasado)).fecha.slice(8, 10)} al domingo.`,
        detalle: lineas,
        cuerpo: faltan.length > 0 ? `Para que tu ficha quede completa te falta:<ul style="margin:8px 0 0;padding-left:20px">${listaFaltan}</ul>` : "¡Tu ficha está completa!",
        boton: base ? { texto: faltan.length > 0 ? "Completar mi ficha" : "Ver mi espacio", url: `${base}/mi-espacio${faltan.length > 0 ? "/ficha" : ""}` } : undefined,
        pie: "Te escribimos los lunes, solo si hay algo para contarte.",
        base,
      });
      const texto = [
        "Tu semana en WiiGo",
        ...lineas.map((l) => l.replace(/<[^>]+>/g, "")),
        faltan.length > 0 ? `Te falta: ${faltan.map((f) => f.label).join(", ")}.` : "¡Tu ficha está completa!",
        base ? `${base}/mi-espacio` : "",
      ]
        .filter(Boolean)
        .join("\n");
      await mandarYAnotar(supabase, id, "SEMANAL", lunes, destino.para, asunto, html, texto);
      mandados += 1;
    } catch {
      salteados += 1;
    }
  }
  return { mandados, salteados };
}
