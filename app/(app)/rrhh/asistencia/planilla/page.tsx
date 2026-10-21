import Link from "next/link";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import BotonImprimirRecibo from "@/components/BotonImprimirRecibo";
import { armarPlanillasAsistencia, type DiaPlanilla, type MarcaPlanilla } from "@/app/(app)/rrhh/asistencia-actions";
import type { ParamsRrhh } from "../../pantalla";

// Planilla de asistencia del mes para imprimir o guardar en PDF: una hoja por
// operativo, con la firma que hizo al fichar cada entrada y cada salida.
// ?mes=AAAA-MM y ?persona=<id> (sin persona, salen todas juntas).
export const dynamic = "force-dynamic";

const DIA = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const horas = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

function Marca({ m }: { m: MarcaPlanilla | null }) {
  if (!m) return <span className="pl-vacio">—</span>;
  return (
    <span className="pl-marca">
      <span className="pl-hora">{m.hora}</span>
      {m.firma ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.firma} alt="Firma" className="pl-firma" />
      ) : (
        <span className="pl-sinfirma">{m.manual ? "adm." : "sin firma"}</span>
      )}
    </span>
  );
}

const CLASE_FILA: Partial<Record<DiaPlanilla["tipo"], string>> = {
  no_trabaja: "pl-gris",
  futuro: "pl-gris",
  feriado: "pl-gris",
  lic: "pl-lic",
  tarde: "pl-tarde",
  falta: "pl-falta",
  sin_salida: "pl-falta",
};

export default async function PlanillaAsistenciaPage({ searchParams }: { searchParams: ParamsRrhh }) {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return <PantallaBloqueada />;

  const params = await searchParams;
  const mes = typeof params.mes === "string" ? params.mes : "";
  const persona = typeof params.persona === "string" ? params.persona : undefined;
  const datos = await armarPlanillasAsistencia(mes, persona);

  return (
    <div className="pl-pagina">
      <style>{`
        .pl-pagina { padding: 0 0 60px; }
        .pl-barra { max-width: 820px; margin: 0 auto 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .pl-barra p { font-size: 13px; color: #555; margin: 0; }
        .pl-aviso { max-width: 820px; margin: 0 auto 16px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; font-size: 12.5px; color: #92400e; }
        .pl-hoja { max-width: 820px; margin: 0 auto 24px; background: #fff; color: #161b26; border: 1px solid #ddd; padding: 26px 30px 22px; font-family: Arial, Helvetica, sans-serif; font-size: 11.5px; line-height: 1.35; }
        .pl-enc { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #161b26; padding-bottom: 8px; }
        .pl-emp { font-size: 14px; font-weight: 700; }
        .pl-emp-datos { font-size: 10px; color: #5b6475; }
        .pl-tit { text-align: right; }
        .pl-tit b { display: block; font-size: 14px; letter-spacing: .04em; text-transform: uppercase; }
        .pl-tit span { font-size: 12px; color: #5b6475; }
        .pl-datos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 16px; padding: 8px 0; border-bottom: 1px solid #cfd4dc; }
        .pl-datos span { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .07em; color: #5b6475; }
        .pl-datos b { font-weight: 600; }
        .pl-datos i { color: #8a93a3; font-weight: 400; }
        table.pl-tabla { width: 100%; border-collapse: collapse; margin-top: 6px; }
        .pl-tabla th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: .07em; color: #5b6475; font-weight: 600; padding: 4px 5px; border-bottom: 1px solid #161b26; }
        .pl-tabla td { padding: 1px 5px; border-bottom: 1px solid #eceff3; height: 22px; vertical-align: middle; }
        .pl-tabla .pl-der { text-align: right; }
        .pl-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .pl-marca { display: inline-flex; align-items: center; gap: 6px; }
        .pl-hora { font-variant-numeric: tabular-nums; min-width: 34px; }
        .pl-firma { height: 20px; width: 60px; object-fit: contain; mix-blend-mode: multiply; }
        .pl-sinfirma { font-size: 8.5px; color: #8a93a3; font-style: italic; }
        .pl-vacio { color: #b4bac5; }
        .pl-obs { font-size: 10px; }
        tr.pl-gris td { color: #a0a7b4; background: #f7f8fa; }
        tr.pl-lic td { background: #f6f2fe; }
        tr.pl-lic .pl-obs { color: #5b2bb5; font-weight: 600; }
        tr.pl-tarde .pl-obs { color: #9a4a00; font-weight: 600; }
        tr.pl-falta .pl-obs { color: #b91c1c; font-weight: 600; }
        .pl-totales { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin-top: 8px; border: 1px solid #161b26; }
        .pl-totales div { padding: 5px 8px; border-right: 1px solid #cfd4dc; }
        .pl-totales div:last-child { border-right: 0; }
        .pl-totales span { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .07em; color: #5b6475; }
        .pl-totales b { font-size: 13px; font-variant-numeric: tabular-nums; }
        .pl-ganado { margin-top: 8px; padding: 7px 9px; background: #f4f6f9; border-radius: 4px; font-size: 11px; }
        .pl-ganado b { font-variant-numeric: tabular-nums; }
        .pl-chico { font-size: 9.5px; color: #5b6475; margin: 6px 0 0; }
        .pl-firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; font-size: 10px; text-align: center; color: #5b6475; }
        .pl-firmas div { border-top: 1px solid #161b26; padding-top: 4px; }
        .pl-pie { display: flex; justify-content: space-between; margin-top: 12px; font-size: 8.5px; color: #a0a7b4; }
        @media print {
          @page { size: A4; margin: 10mm; }
          .pl-pagina { padding: 0; }
          .pl-barra, .pl-aviso { display: none !important; }
          .pl-hoja { border: 0; margin: 0; max-width: none; padding: 0; }
          .pl-hoja + .pl-hoja { page-break-before: always; }
          tr.pl-gris td, tr.pl-lic td, .pl-ganado { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="pl-barra">
        <BotonImprimirRecibo />
        <Link href={`/rrhh/asistencia?mes=${datos.periodo}`} className="text-sm font-semibold text-accent">
          ← Volver a Asistencia
        </Link>
        <p>Desde la ventana de imprimir podés elegir “Guardar como PDF” para mandarla por WhatsApp.</p>
      </div>

      {datos.faltaSqlFirma && (
        <div className="pl-aviso">
          Para que se guarden las firmas al fichar falta correr <b>sql/fichajes-firma.sql</b> en Supabase. Mientras tanto la planilla sale sin firmas.
        </div>
      )}

      {datos.planillas.length === 0 && (
        <div className="pl-aviso">
          No hay operativos con horario fijo para {datos.etiquetaMes.toLowerCase()}. La planilla sale solo para quienes tienen horario fijo.
        </div>
      )}

      {datos.planillas.map((p) => (
        <article key={p.idPersona} className="pl-hoja">
          <div className="pl-enc">
            <div>
              <div className="pl-emp">{datos.empresa.razonSocial}</div>
              <div className="pl-emp-datos">
                CUIT {datos.empresa.cuit} · {datos.empresa.domicilio}
              </div>
            </div>
            <div className="pl-tit">
              <b>Planilla de asistencia</b>
              <span>{datos.etiquetaMes}</span>
            </div>
          </div>

          <div className="pl-datos">
            <div>
              <span>Empleado/a</span>
              <b>{p.nombre}</b>
            </div>
            <div>
              <span>Puesto</span>
              <b>{p.puesto ?? <i>sin cargar</i>}</b>
            </div>
            <div>
              <span>CUIL</span>
              <b>{p.cuil ?? <i>sin cargar</i>}</b>
            </div>
            <div>
              <span>Horario</span>
              <b>{p.horario}</b>
            </div>
            <div>
              <span>Días</span>
              <b>{p.dias}</b>
            </div>
            <div>
              <span>Ingreso</span>
              <b>{p.fechaIngreso ?? <i>sin cargar</i>}</b>
            </div>
          </div>

          <table className="pl-tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Día</th>
                <th>Entrada y firma</th>
                <th>Salida y firma</th>
                <th className="pl-der">Horas</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {p.filas.map((f) => (
                <tr key={f.fecha} className={CLASE_FILA[f.tipo] ?? ""}>
                  <td className="pl-num">{f.fecha.slice(8, 10)}/{f.fecha.slice(5, 7)}</td>
                  <td>{DIA[f.diaSemana]}</td>
                  <td>
                    {f.tipo === "futuro" ? "" : f.tramos.length === 0 ? <Marca m={null} /> : f.tramos.map((t, i) => <div key={i}><Marca m={t.entrada} /></div>)}
                  </td>
                  <td>
                    {f.tipo === "futuro" ? "" : f.tramos.length === 0 ? <Marca m={null} /> : f.tramos.map((t, i) => <div key={i}><Marca m={t.salida} /></div>)}
                  </td>
                  <td className="pl-der pl-num">{f.horas !== null ? horas(f.horas) : f.tipo === "futuro" ? "" : "—"}</td>
                  <td className="pl-obs">{f.obs}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pl-totales">
            <div>
              <span>Horas del mes</span>
              <b>{horas(p.totales.horas)} h</b>
            </div>
            <div>
              <span>Días trabajados</span>
              <b>
                {p.totales.diasTrabajados} de {p.totales.diasEsperados}
              </b>
            </div>
            <div>
              <span>Llegadas tarde</span>
              <b>{p.totales.tardanzas}</b>
            </div>
            <div>
              <span>Faltas</span>
              <b>{p.totales.faltas}</b>
            </div>
            <div>
              <span>Presentismo</span>
              <b>{p.presentismo}</b>
            </div>
          </div>

          {p.ganado ? (
            <div className="pl-ganado">
              {p.ganado.cerrado ? "Cobra en el mes" : "Lleva ganado"}:{" "}
              {p.ganado.porHora ? (
                <>
                  <b>{horas(p.ganado.horas)} h</b> × <b>{pesos(p.ganado.valorHora)}</b>
                  {p.ganado.horasFeriado > 0 && <> (las {horas(p.ganado.horasFeriado)} h de feriado, al doble)</>} = <b>{pesos(p.ganado.base)}</b>
                </>
              ) : (
                <>
                  sueldo fijo <b>{pesos(p.ganado.base)}</b>
                </>
              )}
              {p.ganado.cobraPresentismo && (
                <>
                  {" "}
                  + presentismo <b>{pesos(p.ganado.presentismo)}</b>
                </>
              )}
              {p.ganado.adelantos > 0 && (
                <>
                  {" "}
                  − adelantos <b>{pesos(p.ganado.adelantos)}</b>
                </>
              )}{" "}
              = <b>{pesos(p.ganado.aCobrar)}</b>
              {!p.ganado.cerrado && <> (todavía puede cambiar hasta el cierre del mes)</>}
            </div>
          ) : (
            <div className="pl-ganado">Sin sueldo cargado: lo ganado sale cuando tenga usuario y sueldo en Sueldos.</div>
          )}

          <p className="pl-chico">
            Las horas salen de los fichajes en el local, con la firma que hizo al fichar. “adm.”: salida cargada por administración porque no se fichó.
            {p.totales.sinFirma > 0 && <> {p.totales.sinFirma} fichajes de antes de que se pidiera la firma figuran “sin firma”.</>}
          </p>

          <div className="pl-firmas">
            <div>
              Firma de {p.nombre}
              <br />
              Conforme con las horas registradas
            </div>
            <div>Firma por {datos.empresa.razonSocial}</div>
          </div>
          <div className="pl-pie">
            <span>Generada por WiiGo el {datos.generada}</span>
            <span>{p.nombre} · {datos.etiquetaMes}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
