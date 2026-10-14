"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionMarca } from "@/lib/marcaSesion";
import { MAX_MAILS, TIPOS_AVISO, avisoPrendido, mailValido, type TipoAviso } from "@/lib/avisosMarca";
import { NIVEL, type PlanMarca } from "@/lib/planesMarca";

// Las preferencias de aviso de la marca.

export type AvisosPortal = {
  plan: PlanMarca;
  /** Los avisos son de Silver para arriba. */
  habilitado: boolean;
  prendidos: Record<TipoAviso, boolean>;
  mails: string[];
  /** Lo último que salió, para que vea que funciona. */
  ultimos: { tipo: string; asunto: string | null; cuando: string; ok: boolean }[];
};

export async function misAvisos(): Promise<AvisosPortal | null> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const { data: marca } = await supabase
    .from("marcas")
    .select("avisos, avisos_mails")
    .eq("id_marca", sesion.idMarca)
    .maybeSingle();

  const guardados = ((marca?.avisos as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const prendidos = Object.fromEntries(
    TIPOS_AVISO.map((t) => [t, avisoPrendido(guardados, t)])
  ) as Record<TipoAviso, boolean>;

  const { data: ultimos } = await supabase
    .from("avisos_enviados")
    .select("tipo, asunto, enviado_el, ok")
    .eq("id_marca", sesion.idMarca)
    .order("enviado_el", { ascending: false })
    .limit(5);

  return {
    plan: sesion.plan,
    habilitado: NIVEL[sesion.plan] >= NIVEL.METAL,
    prendidos,
    mails: ((marca?.avisos_mails as string[] | null) ?? []).filter(Boolean),
    ultimos: (ultimos ?? []).map((u) => ({
      tipo: (u.tipo as string) ?? "",
      asunto: (u.asunto as string | null) ?? null,
      cuando: (u.enviado_el as string) ?? "",
      ok: Boolean(u.ok),
    })),
  };
}

export async function guardarAvisos(datos: {
  prendidos: Record<string, boolean>;
  mails: string[];
}): Promise<{ error: string | null }> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return { error: "Tenés que entrar de nuevo." };
  // El plan se vuelve a mirar acá: un botón apagado no protege nada.
  if (NIVEL[sesion.plan] < NIVEL.METAL) {
    return { error: "Los avisos por mail son del plan Silver para arriba." };
  }

  const mails = [...new Set(datos.mails.map((m) => m.trim()).filter(Boolean))];
  if (mails.length > MAX_MAILS) return { error: `Hasta ${MAX_MAILS} direcciones.` };
  const malo = mails.find((m) => !mailValido(m));
  if (malo) return { error: `«${malo}» no parece un mail.` };

  // Solo se guardan los tipos conocidos: lo que venga de más no entra a la
  // base, que es donde después se lee sin volver a revisar.
  const avisos = Object.fromEntries(
    TIPOS_AVISO.map((t) => [t, Boolean(datos.prendidos[t])])
  );

  const { error } = await getSupabaseServerClient()
    .from("marcas")
    .update({ avisos, avisos_mails: mails })
    .eq("id_marca", sesion.idMarca);
  if (error) return { error: error.message };

  revalidatePath("/portal/avisos");
  return { error: null };
}
