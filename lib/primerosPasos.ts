import type { SupabaseClient } from "@supabase/supabase-js";
import { completitudProfesional } from "@/lib/completitudProfesional";
import { leerRedes } from "@/lib/redesProfesional";
import { mesesVinculo } from "@/lib/pacientesProfesional";
import { reglasPuntos } from "@/lib/puntosProfesionales";
import { fechaHoraArgentina } from "@/lib/horarios";
import { PEDIDOS_ABIERTOS_PROFESIONALES } from "@/lib/pedidosProfesional";

// La bienvenida de las profesionales (Gonzalo, 2026-11-02; vista previa
// aprobada: https://claude.ai/artifact/RFEFyMgpwcLpXwp2odSQii):
// - una presentación de 5 pasos la primera vez que entran, y
// - «Tus primeros pasos» en Inicio, que se tildan solos y desaparecen al terminar.
//
// Que vio la presentación se guarda como una línea en su historial
// (actividad_profesional), así no hace falta una columna nueva y Gonzalo lo
// ve en «Todo lo que hizo».

export const ACCION_PRESENTACION = "Vio la presentación de bienvenida";

export async function vioPresentacion(supabase: SupabaseClient, idProfesional: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("actividad_profesional")
    .select("id_actividad")
    .eq("id_profesional", idProfesional)
    .eq("accion", ACCION_PRESENTACION)
    .limit(1);
  // Si la tabla no está, no se la muestra: mejor eso que mostrársela siempre.
  if (error) return true;
  return (data ?? []).length > 0;
}

const pct = (n: number) => `${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })} %`;

export type DatosPresentacion = {
  nombre: string;
  codigo: string | null;
  pctCliente: string;
  pctProfesional: string;
  meses: number;
  historiasSemana: number;
  reelCadaDias: number;
};

/** Los números reales que dice la presentación: su código, los % de las marcas, los meses. */
export async function datosPresentacion(supabase: SupabaseClient, idProfesional: string, nombre: string): Promise<DatosPresentacion> {
  const hoy = fechaHoraArgentina().fecha;
  const [codRes, confRes, meses, reglas] = await Promise.all([
    supabase.from("codigos_profesionales").select("codigo").eq("id_profesional", idProfesional).eq("estado", "ACTIVO").limit(1),
    supabase
      .from("config_profesionales_marca")
      .select("id_marca, porcentaje_cliente, porcentaje_profesional, fecha_desde")
      .eq("estado", "ACTIVA")
      .eq("participa", true)
      .lte("fecha_desde", hoy)
      .or(`fecha_hasta.is.null,fecha_hasta.gte.${hoy}`)
      .order("fecha_desde", { ascending: false }),
    mesesVinculo(supabase).catch(() => 6),
    reglasPuntos(supabase).catch(() => null),
  ]);
  const vigente = new Map<string, { c: number; p: number }>();
  for (const c of confRes.data ?? []) {
    if (!vigente.has(c.id_marca as string)) vigente.set(c.id_marca as string, { c: Number(c.porcentaje_cliente ?? 0), p: Number(c.porcentaje_profesional ?? 0) });
  }
  const rango = (k: "c" | "p") => {
    const v = [...vigente.values()].map((x) => x[k]);
    if (v.length === 0) return pct(0);
    const min = Math.min(...v);
    const max = Math.max(...v);
    return min === max ? pct(max) : `entre ${pct(min)} y ${pct(max)}`;
  };
  return {
    nombre,
    codigo: (codRes.data?.[0]?.codigo as string | undefined) ?? null,
    pctCliente: rango("c"),
    pctProfesional: rango("p"),
    meses,
    historiasSemana: reglas?.historiasSemana ?? 2,
    reelCadaDias: reglas?.reelCadaDias ?? 15,
  };
}

export type PasoInicial = { clave: string; titulo: string; ayuda: string; href: string; boton: string; hecho: boolean };

/**
 * Los 5 primeros pasos y si ya los hizo. Cuenta también lo que mandó y está
 * esperando la aprobación de Gonzalo: ella ya hizo su parte.
 */
export async function primerosPasos(supabase: SupabaseClient, idProfesional: string): Promise<PasoInicial[]> {
  const [completitud, profRes, cambiosRes, pacRes, refRes, pubRes] = await Promise.all([
    completitudProfesional(supabase, idProfesional),
    supabase.from("profesionales").select("redes").eq("id_profesional", idProfesional).maybeSingle(),
    supabase.from("cambios_profesional").select("tipo").eq("id_profesional", idProfesional).in("estado", ["PENDIENTE", "CORREGIR", "APROBADO"]),
    supabase.from("pacientes_profesional").select("id_vinculo").eq("id_profesional", idProfesional).limit(1),
    supabase.from("referidos_profesionales").select("id_referido").eq("id_profesional", idProfesional).neq("estado", "ANULADO").limit(1),
    supabase.from("publicaciones_profesional").select("id_publicacion").eq("id_profesional", idProfesional).limit(1),
  ]);
  const ok = (clave: string) => completitud.items.find((i) => i.clave === clave)?.ok ?? false;
  const mando = new Set((cambiosRes.data ?? []).map((c) => c.tipo as string));
  const redes = Object.keys(leerRedes(profRes.data?.redes)).length > 0 || mando.has("REDES");

  return [
    {
      clave: "foto",
      titulo: "Subí tu foto",
      ayuda: "Es lo primero que ve el cliente en la pantalla del local.",
      href: "/mi-espacio/ficha?seccion=fotos",
      boton: "Ir a Mi ficha",
      hecho: ok("foto") || mando.has("FOTO_PERFIL"),
    },
    {
      clave: "presentacion",
      titulo: "Contá quién sos y en qué ayudás",
      ayuda: "Tu presentación corta y los objetivos de tus pacientes.",
      href: "/mi-espacio/ficha?seccion=sobre",
      boton: "Ir a Mi ficha",
      hecho: (ok("bio") || mando.has("DATOS")) && (ok("objetivos") || mando.has("OBJETIVOS")),
    },
    {
      clave: "redes",
      titulo: "Cargá tus redes",
      ayuda: "Instagram o TikTok: salen con un QR en la pantalla del local.",
      href: "/mi-espacio/ficha?seccion=redes",
      boton: "Ir a Mi ficha",
      hecho: redes,
    },
    {
      clave: "paciente",
      titulo: "Sumá tu primer paciente",
      ...(PEDIDOS_ABIERTOS_PROFESIONALES
        ? { ayuda: "Armándole un pedido o desde «Sumar paciente» en Mi saldo.", href: "/mi-espacio/pedidos", boton: "Armar pedido" }
        : { ayuda: "Desde «Sumar paciente» en Mi saldo, o cuando dice tu código en la caja.", href: "/mi-espacio/saldo", boton: "Ir a Mi saldo" }),
      hecho: (pacRes.data ?? []).length > 0 || (refRes.data ?? []).length > 0,
    },
    {
      clave: "historia",
      titulo: "Subí tu primera historia con @wiigo.arg",
      ayuda: "Y avisala desde Objetivos: suma puntos para el ranking del mes.",
      href: "/mi-espacio/objetivos",
      boton: "Ir a Objetivos",
      hecho: (pubRes.data ?? []).length > 0,
    },
  ];
}
