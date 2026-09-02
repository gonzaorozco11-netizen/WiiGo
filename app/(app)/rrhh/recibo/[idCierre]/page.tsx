import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { EMISOR } from "@/lib/emisor";
import BotonImprimirRecibo from "@/components/BotonImprimirRecibo";

// Recibo para imprimir, firmar y volver a subir como comprobante del pago.
//
// OJO — esto NO es el recibo de sueldo formal del Art. 140 de la LCT. Sirve
// como constancia interna de que el empleado recibió el dinero. Cuando el
// personal pase a estar en blanco hay que rehacerlo con todo lo que la ley
// exige (categoría del convenio, detalle de aportes y contribuciones,
// constancia de depósito de aportes, etc.).
export const dynamic = "force-dynamic";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nombrePeriodo(periodo: string) {
  const [anio, mes] = periodo.split("-").map(Number);
  return `${MESES[mes - 1]} de ${anio}`;
}

function formatearFecha(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function ReciboPage({ params }: { params: Promise<{ idCierre: string }> }) {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return <PantallaBloqueada />;

  const { idCierre } = await params;
  const supabase = getSupabaseServerClient();

  const { data: cierre } = await supabase.from("nomina_cierres").select("*").eq("id_cierre", idCierre).maybeSingle();
  if (!cierre) notFound();

  const { data: persona } = await supabase
    .from("personas")
    .select("nombre, apellido, dni, cuil, fecha_ingreso")
    .eq("id_persona", cierre.id_persona as string)
    .maybeSingle();

  const nombreCompleto = [persona?.nombre, persona?.apellido].filter(Boolean).join(" ") || "—";

  const conceptos: { label: string; monto: number }[] = [
    { label: "Sueldo del período", monto: cierre.sueldo_base as number },
  ];
  if ((cierre.incentivo_presentismo as number) > 0) {
    conceptos.push({ label: "Presentismo", monto: cierre.incentivo_presentismo as number });
  }
  if ((cierre.horas_extra_monto as number) > 0) {
    conceptos.push({
      label: "Horas extra" + (cierre.horas_extra_detalle ? ` (${cierre.horas_extra_detalle})` : ""),
      monto: cierre.horas_extra_monto as number,
    });
  }
  if ((cierre.premios_monto as number) > 0) {
    conceptos.push({
      label: "Premios" + (cierre.premios_detalle ? ` (${cierre.premios_detalle})` : ""),
      monto: cierre.premios_monto as number,
    });
  }

  const descuentos: { label: string; monto: number }[] = [];
  if ((cierre.aportes_empleado as number) > 0) {
    descuentos.push({ label: "Aportes del trabajador", monto: cierre.aportes_empleado as number });
  }
  if ((cierre.adelantos as number) > 0) {
    descuentos.push({ label: "Adelantos ya percibidos", monto: cierre.adelantos as number });
  }

  const bruto = conceptos.reduce((acc, c) => acc + c.monto, 0);
  const totalDescuentos = descuentos.reduce((acc, d) => acc + d.monto, 0);
  const neto = cierre.neto_a_pagar as number;

  // Dos copias en la misma hoja: una queda para el empleado y otra firmada
  // para la empresa, que es la que se sube al sistema.
  const copias = ["ORIGINAL — para la empresa", "DUPLICADO — para el trabajador"];

  return (
    <div className="recibo-pagina">
      <style>{`
        .recibo-pagina { background: #f5f5f5; padding: 24px 16px 60px; }
        .recibo-barra {
          max-width: 800px; margin: 0 auto 16px; display: flex;
          align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
        }
        .recibo-hoja {
          max-width: 800px; margin: 0 auto 20px; background: #fff; color: #111;
          border: 1px solid #ddd; padding: 28px 32px;
          font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.45;
        }
        .recibo-copia { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #666; }
        .recibo-emisor { font-size: 16px; font-weight: 700; margin-top: 4px; }
        .recibo-datos-emisor { font-size: 11px; color: #555; }
        .recibo-titulo {
          text-align: center; font-size: 15px; font-weight: 700; letter-spacing: .04em;
          text-transform: uppercase; margin: 18px 0 4px; padding-top: 14px; border-top: 2px solid #111;
        }
        .recibo-periodo { text-align: center; font-size: 13px; margin-bottom: 16px; }
        .recibo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 16px; }
        .recibo-campo { display: flex; justify-content: space-between; border-bottom: 1px dotted #bbb; padding: 3px 0; }
        .recibo-campo span:first-child { color: #666; }
        table.recibo-tabla { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
        table.recibo-tabla th {
          text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
          color: #666; border-bottom: 1px solid #111; padding: 5px 0;
        }
        table.recibo-tabla th:last-child, table.recibo-tabla td:last-child { text-align: right; }
        table.recibo-tabla td { padding: 4px 0; border-bottom: 1px dotted #ddd; }
        .recibo-total {
          display: flex; justify-content: space-between; align-items: baseline;
          border-top: 2px solid #111; padding-top: 8px; margin-top: 4px;
        }
        .recibo-total-label { font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: .06em; }
        .recibo-total-monto { font-size: 20px; font-weight: 700; }
        .recibo-leyenda { font-size: 11px; color: #444; margin: 14px 0 26px; }
        .recibo-firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 34px; }
        .recibo-firma { border-top: 1px solid #111; padding-top: 6px; font-size: 11px; color: #555; text-align: center; }
        .recibo-aviso {
          max-width: 800px; margin: 0 auto 16px; background: #fffbeb; border: 1px solid #fde68a;
          border-radius: 8px; padding: 12px 14px; font-size: 12.5px; color: #92400e;
        }
        @media print {
          .recibo-pagina { background: #fff; padding: 0; }
          .recibo-barra, .recibo-aviso { display: none !important; }
          .recibo-hoja { border: 0; margin: 0; max-width: none; padding: 18mm 16mm; }
          .recibo-hoja + .recibo-hoja { page-break-before: always; }
        }
      `}</style>

      <div className="recibo-barra">
        <BotonImprimirRecibo />
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
          Imprimilo, que lo firme el trabajador, y subí la copia firmada al registrar el pago.
        </p>
      </div>

      <div className="recibo-aviso">
        <b>Constancia interna.</b> No reemplaza al recibo de sueldo formal (Art. 140 LCT), que exige más datos y
        corresponde cuando el personal está registrado.
      </div>

      {copias.map((copia) => (
        <div key={copia} className="recibo-hoja">
          <p className="recibo-copia">{copia}</p>
          <p className="recibo-emisor">{EMISOR.razonSocial}</p>
          <p className="recibo-datos-emisor">
            CUIT {EMISOR.cuit} · {EMISOR.domicilioComercial}
          </p>

          <p className="recibo-titulo">Recibo de pago de haberes</p>
          <p className="recibo-periodo">Período: {nombrePeriodo(cierre.periodo as string)}</p>

          <div className="recibo-grid">
            <div className="recibo-campo">
              <span>Trabajador</span>
              <span>{nombreCompleto}</span>
            </div>
            <div className="recibo-campo">
              <span>DNI</span>
              <span>{persona?.dni ?? "—"}</span>
            </div>
            <div className="recibo-campo">
              <span>CUIL</span>
              <span>{persona?.cuil ?? "—"}</span>
            </div>
            <div className="recibo-campo">
              <span>Fecha de ingreso</span>
              <span>{formatearFecha(persona?.fecha_ingreso ?? null)}</span>
            </div>
          </div>

          <table className="recibo-tabla">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Importe</th>
              </tr>
            </thead>
            <tbody>
              {conceptos.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td>${formatearMonto(c.monto)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 700 }}>Total de haberes</td>
                <td style={{ fontWeight: 700 }}>${formatearMonto(bruto)}</td>
              </tr>
              {descuentos.map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td>−${formatearMonto(d.monto)}</td>
                </tr>
              ))}
              {totalDescuentos > 0 && (
                <tr>
                  <td style={{ fontWeight: 700 }}>Total de descuentos</td>
                  <td style={{ fontWeight: 700 }}>−${formatearMonto(totalDescuentos)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="recibo-total">
            <span className="recibo-total-label">Neto percibido</span>
            <span className="recibo-total-monto">${formatearMonto(neto)}</span>
          </div>

          <p className="recibo-leyenda">
            Recibí de {EMISOR.razonSocial} la suma indicada como pago de mis haberes correspondientes al período
            {" "}{nombrePeriodo(cierre.periodo as string)}, en concepto de saldo y sin nada más que reclamar por dicho
            período.
          </p>

          <div className="recibo-firmas">
            <div className="recibo-firma">Firma del trabajador</div>
            <div className="recibo-firma">Aclaración y fecha</div>
          </div>
        </div>
      ))}
    </div>
  );
}
