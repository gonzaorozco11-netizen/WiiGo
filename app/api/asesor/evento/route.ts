// Lo que se mira de cada profesional en la pantalla del local.
//
// Lo llama la pantalla asesora (pública, sin login) cada vez que alguien abre
// la ficha de una profesional, ve su Conóceme hasta el final o toca "Reservar
// turno". Con eso, cada profesional ve en su espacio cuánta gente la mira.
//
// No se guarda nada de quién toca: solo qué profesional, qué local, qué cosa y
// cuándo. Como es pública, se cuida de no inflar los números: solo cuenta
// profesionales publicadas, de un local que existe, y no repite el mismo
// toque de la misma pantalla en pocos segundos.

import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

const EVENTOS = new Set(["FICHA", "CONOCEME_FIN", "RESERVAR"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGUNDOS_SIN_REPETIR = 20;

export async function POST(req: Request) {
  let cuerpo: { idLocal?: unknown; idProfesional?: unknown; evento?: unknown };
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const idLocal = typeof cuerpo.idLocal === "string" ? cuerpo.idLocal : "";
  const idProfesional = typeof cuerpo.idProfesional === "string" ? cuerpo.idProfesional : "";
  const evento = typeof cuerpo.evento === "string" ? cuerpo.evento : "";
  if (!UUID.test(idLocal) || !UUID.test(idProfesional) || !EVENTOS.has(evento)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const desde = new Date(Date.now() - SEGUNDOS_SIN_REPETIR * 1000).toISOString();
  const [profRes, localRes, repetidoRes] = await Promise.all([
    supabase.from("profesionales").select("estado, publicado").eq("id_profesional", idProfesional).maybeSingle(),
    supabase.from("locales").select("id_local").eq("id_local", idLocal).maybeSingle(),
    supabase
      .from("visitas_asesor")
      .select("id_visita")
      .eq("id_local", idLocal)
      .eq("id_profesional", idProfesional)
      .eq("evento", evento)
      .gte("fecha", desde)
      .limit(1),
  ]);
  if (!profRes.data || profRes.data.estado !== "ACTIVO" || !profRes.data.publicado || !localRes.data) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  // Sin la tabla (falta el SQL) no hay dónde contar: se ignora sin romper la pantalla.
  if (repetidoRes.error) return NextResponse.json({ ok: false });
  if ((repetidoRes.data ?? []).length > 0) return NextResponse.json({ ok: true, repetido: true });

  await supabase.from("visitas_asesor").insert({ id_local: idLocal, id_profesional: idProfesional, evento });
  return NextResponse.json({ ok: true });
}
