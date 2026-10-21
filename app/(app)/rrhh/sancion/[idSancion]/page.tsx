import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import BotonImprimirRecibo from "@/components/BotonImprimirRecibo";

// Un llamado de atención o apercibimiento, para imprimir o guardar en PDF:
// el texto tal como lo leyó la persona al fichar, y su firma (o que se negó).
export const dynamic = "force-dynamic";

function horaYFecha(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function SancionPage({ params }: { params: Promise<{ idSancion: string }> }) {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return <PantallaBloqueada />;

  const { idSancion } = await params;
  const supabase = getSupabaseServerClient();
  const { data: s } = await supabase.from("sanciones").select("*").eq("id_sancion", idSancion).maybeSingle();
  if (!s) notFound();

  const parrafos = String(s.texto).split("\n\n");
  const anulada = s.estado === "ANULADA";

  return (
    <div className="sa-pagina">
      <style>{`
        .sa-pagina { padding: 0 0 60px; }
        .sa-barra { max-width: 760px; margin: 0 auto 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .sa-hoja { position: relative; max-width: 760px; margin: 0 auto; background: #fff; color: #161b26; border: 1px solid #ddd; padding: 40px 48px; font-family: Georgia, "Times New Roman", serif; font-size: 14px; line-height: 1.6; }
        .sa-fecha { text-align: right; color: #5b6475; font-size: 13px; }
        .sa-titulo { text-align: center; font-family: Arial, Helvetica, sans-serif; font-weight: 700; letter-spacing: .14em; font-size: 15px; margin: 22px 0 18px; }
        .sa-hoja p { margin: 0 0 12px; white-space: pre-line; }
        .sa-noti { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; font-family: Arial, Helvetica, sans-serif; font-size: 11.5px; color: #5b6475; text-align: center; }
        .sa-firma { height: 70px; display: flex; align-items: flex-end; justify-content: center; border-bottom: 1px solid #161b26; margin-bottom: 6px; }
        .sa-firma img { max-height: 70px; max-width: 240px; }
        .sa-anulada { position: absolute; top: 46%; left: 50%; transform: translate(-50%, -50%) rotate(-18deg); font-family: Arial, sans-serif; font-weight: 800; font-size: 54px; letter-spacing: .1em; color: rgba(185, 28, 28, .18); border: 6px solid rgba(185, 28, 28, .18); padding: 6px 22px; pointer-events: none; }
        .sa-nota { font-family: Arial, sans-serif; font-size: 11.5px; color: #5b6475; margin-top: 18px; }
        @media print {
          .sa-barra { display: none !important; }
          .sa-hoja { border: 0; padding: 18mm 16mm; max-width: none; }
        }
      `}</style>

      <div className="sa-barra">
        <BotonImprimirRecibo />
      </div>

      <article className="sa-hoja">
        {anulada && <div className="sa-anulada">ANULADO</div>}
        {parrafos.map((p, i) =>
          i === 0 ? (
            <p key={i} className="sa-fecha">
              {p}
            </p>
          ) : i === 1 ? (
            <p key={i} className="sa-titulo">
              {p}
            </p>
          ) : (
            <p key={i}>{p}</p>
          )
        )}

        <div className="sa-noti">
          <div>
            <div className="sa-firma">
              {s.firma ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.firma as string} alt="Firma" />
              ) : null}
            </div>
            {s.firma
              ? `Me notifico · firmado en la tablet el ${horaYFecha(s.firmado_en as string)}`
              : s.se_nego
                ? `Se negó a firmar el ${horaYFecha(s.firmado_en as string)}`
                : "Firma: me notifico"}
          </div>
          <div>
            <div className="sa-firma" />
            Firma por la empresa
          </div>
        </div>

        {s.motivo && <p className="sa-nota">Motivo que escribió al fichar: “{s.motivo as string}”</p>}
        {anulada && (
          <p className="sa-nota">
            Anulado por {(s.anulada_por as string) ?? "administración"} el {horaYFecha(s.anulada_en as string)}: {(s.motivo_anulacion as string) ?? ""}
          </p>
        )}
      </article>
    </div>
  );
}
