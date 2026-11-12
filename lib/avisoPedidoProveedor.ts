import { getSupabaseServerClient } from "@/lib/supabase";
import { enviarMail, plantilla } from "@/lib/mail";
import { baseUrlPublica } from "@/lib/urlPublica";
import { leerMailsResumen, PARAMETRO_MAILS_RESUMEN } from "@/lib/resumenTurno";

/**
 * El mail a Gonzalo cuando el equipo arma un pedido para el proveedor: que lo
 * cargue en la web de Alifrut. Va a los mismos mails que las ventas
 * (Configuración → Ventas por mail). Nunca tira.
 */
export async function avisarPedidoArmado(idOrden: string, quien: string, productos: number): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    const { data } = await supabase.from("configuracion").select("valor").eq("parametro", PARAMETRO_MAILS_RESUMEN).maybeSingle();
    const mails = leerMailsResumen(data?.valor as string | undefined);
    if (mails.length === 0) return;
    const base = baseUrlPublica();
    const url = `${base}/compras/pedir/${idOrden}`;
    const asunto = `Pedido para Alifrut: ${productos} ${productos === 1 ? "producto" : "productos"} para cargar`;
    await enviarMail({
      para: mails,
      asunto,
      html: plantilla({
        base,
        tono: "ambar",
        titulo: "Hay un pedido para cargar en Alifrut",
        bajada: `Lo armó ${quien} con lo que llegó al mínimo.`,
        destacado: `${productos} ${productos === 1 ? "producto" : "productos"}`,
        destacadoChico: true,
        cuerpo: "Abrilo, cargalo en la web de Alifrut y marcá lo que no tengan. Al terminar tocá «Listo, ya lo pedí»: queda esperando en Recepción.",
        boton: { texto: "Abrir el pedido", url },
        pie: "Te llega porque tu mail está en Configuración → Ventas por mail. WiiGo, Mendoza",
      }),
      texto: `${asunto}. Lo armó ${quien}. Abrilo acá: ${url}`,
    });
  } catch {
    // El pedido igual aparece en Mis Tareas.
  }
}
