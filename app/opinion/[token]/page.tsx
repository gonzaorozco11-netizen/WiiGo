import type { Metadata } from "next";
import { getSupabaseServerClient } from "@/lib/supabase";
import { outfit, manrope } from "@/app/fuentes/espacio";
import { INTENTOS_DNI, nombreParaMostrar } from "@/lib/opinionesPacientes";
import FormOpinion from "./FormOpinion";
import "./opinion.css";

// La página que abre el paciente desde el WhatsApp de su profesional (sin
// login; el proxy la deja pasar). Maqueta aprobada por Gonzalo el 2026-11-06:
// https://claude.ai/artifact/1dAikxireMDGeEaZsvpSeQ
// No muestra nada del paciente salvo su nombre de pila e inicial: el DNI ni se
// manda al navegador, se compara en el servidor (actions.ts).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tu opinión · WiiGo", robots: { index: false, follow: false } };

export default async function OpinionPaciente({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseServerClient();
  const { data: p } = await supabase
    .from("pedidos_opinion")
    .select("vence_el, usado_el, intentos, clientes(nombre, apellido), profesionales(nombre, apellido, titulo, especialidad, foto)")
    .eq("token", token.slice(0, 64))
    .maybeSingle();

  const prof = p?.profesionales as unknown as { nombre: string; apellido: string | null; titulo: string | null; especialidad: string | null; foto: string | null } | null;
  const cli = p?.clientes as unknown as { nombre: string; apellido: string | null } | null;

  let cartel: { titulo: string; texto: string } | null = null;
  if (!p || !prof || !cli) cartel = { titulo: "Este link no existe", texto: "Fijate que esté completo, o pedile uno nuevo a tu profesional." };
  else if (p.usado_el) cartel = { titulo: "¡Ya dejaste tu opinión!", texto: "Gracias por tomarte el tiempo. WiiGo la revisa y después sale en la pantalla del local." };
  else if (new Date(p.vence_el as string) < new Date()) cartel = { titulo: "Este link venció", texto: "Pedile uno nuevo a tu profesional." };
  else if ((p.intentos as number) >= INTENTOS_DNI) cartel = { titulo: "Este link se bloqueó", texto: "Por seguridad, después de varios intentos con el DNI equivocado. Pedile uno nuevo a tu profesional." };

  const nombreProf = prof ? [prof.nombre, prof.apellido].filter(Boolean).join(" ") : "";

  return (
    <main className={`op-pagina ${outfit.variable} ${manrope.variable}`}>
      <div className="op-hoja">
        <div className="op-marca">WIIGO</div>
        {cartel ? (
          <div className="op-cartel">
            <h1>{cartel.titulo}</h1>
            <p>{cartel.texto}</p>
          </div>
        ) : (
          <FormOpinion
            token={token}
            profesional={{
              nombre: nombreProf,
              pila: prof!.nombre,
              cargo: [prof!.titulo, prof!.especialidad].filter(Boolean).join(" · "),
              foto: prof!.foto,
            }}
            nombres={{
              NOMBRE: nombreParaMostrar(cli!.nombre, cli!.apellido, "NOMBRE") ?? "Tu nombre",
              INICIALES: nombreParaMostrar(cli!.nombre, cli!.apellido, "INICIALES") ?? "Tus iniciales",
            }}
          />
        )}
      </div>
    </main>
  );
}
