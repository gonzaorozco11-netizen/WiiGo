import { canonPortal, resumenPortal } from "@/app/portal/actions";

export const dynamic = "force-dynamic";

// «Mi situación» (Gonzalo, 21/11, maqueta aprobada): dos tarjetas separadas, sin
// cuentas cruzadas. De un lado lo vendido en el mes; del otro lo que la marca
// tiene que pagar (su canon), que va corriendo desde el primer día del mes y no
// aparece recién el 25. Lo vendido sale del mismo resumen que el Tablero.

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export default async function PortalSituacionPage() {
  const [resumen, canon] = await Promise.all([resumenPortal(), canonPortal()]);
  if (!resumen || !canon) return <p className="vacio">No se pudo cargar tu situación. Probá recargar.</p>;

  const mes = MESES[Number(resumen.hastaISO.slice(5, 7)) - 1];
  const dia = Number(resumen.hastaISO.slice(8, 10));
  const maximo = Math.max(1, ...resumen.serieMes);
  const p = canon.principal;

  return (
    <div>
      <div className="modulo-cab">
        <h1 className="situ-titulo">Mi situación</h1>
        <p className="desc">
          {mes.charAt(0).toUpperCase() + mes.slice(1)}, al {dia}. Se actualiza solo.
        </p>
      </div>

      <div className="fila-2">
        {/* ===== LO VENDIDO ===== */}
        <section className="modulo">
          <div className="modulo-cab">
            <h2>🛍️ Lo vendido</h2>
            <p className="desc">En la estación, este mes</p>
          </div>
          <p className="cifra-xl mono">{pesos(resumen.mes.bruto)}</p>
          <p className="situ-pie">
            {resumen.mes.operaciones} {resumen.mes.operaciones === 1 ? "venta" : "ventas"} en {mes}
          </p>
          <div className="kpis" style={{ marginTop: 14 }}>
            <div className="kpi">
              <p className="et">Vendido hoy</p>
              <p className="cifra mono">{pesos(resumen.hoy.bruto)}</p>
            </div>
            <div className="kpi">
              <p className="et">Unidades del mes</p>
              <p className="cifra mono">{resumen.mes.unidades}</p>
            </div>
          </div>
          <div className="situ-barras" aria-label="Ventas por día del mes">
            {resumen.serieMes.map((v, i) => (
              <i key={i} title={`${i + 1}: ${pesos(v)}`} style={{ height: `${Math.max(4, (v / maximo) * 100)}%`, opacity: i + 1 > dia ? 0.25 : v > 0 ? 1 : 0.35 }} />
            ))}
          </div>
          <div className="situ-eje">
            <span>1</span>
            {resumen.serieMes.length > dia ? (
              <>
                <span>hoy, {dia}</span>
                <span>{resumen.serieMes.length}</span>
              </>
            ) : (
              <span>hoy, {dia}</span>
            )}
          </div>
        </section>

        {/* ===== LO QUE TENÉS QUE PAGAR ===== */}
        <section className="modulo situ-pagar">
          <div className="modulo-cab">
            <h2>🗓️ Lo que tenés que pagar</h2>
            <p className="desc">Tu canon mensual a WiiGo · se paga aparte de tu liquidación</p>
          </div>
          {!p ? (
            <p className="vacio">No tenés nada para pagar.</p>
          ) : (
            <>
              <p className={`cifra-xl mono ${p.estado === "VENCIDO" ? "situ-vencido" : ""}`}>{pesos(p.total)}</p>
              <p className="situ-pie">
                {p.concepto.replace(/ \(.*\)$/, "")}
                {p.iva > 0 && ` · ${pesos(p.neto)} + IVA ${pesos(p.iva)}`}
              </p>
              {/* El primer mes es proporcional: se dice con todas las letras (Gonzalo, 21/11). */}
              {(() => {
                const m = /^Canon de (\S+) \(del (\d+) al (\d+): (\d+) de (\d+) días\)$/.exec(p.concepto);
                return m ? (
                  <p className="situ-explica">
                    El canon de {m[1]} se cobra <b>del {m[2]} al {m[3]} de {m[1]}</b>: son {m[4]} de los {m[5]} días del mes, porque arrancaste en la
                    estación el {m[2]}. Desde el mes que viene se cobra el mes completo.
                  </p>
                ) : null;
              })()}
              {p.estado === "CORRIENDO" && canon.corriendo && (
                <>
                  <div className="situ-prog" aria-hidden="true">
                    <i style={{ width: `${(canon.corriendo.dias / Math.max(1, canon.corriendo.de)) * 100}%` }} />
                  </div>
                  <p className="situ-pie">
                    Va corriendo: {canon.corriendo.dias} de {canon.corriendo.de} días · {p.cuando.toLowerCase()}
                  </p>
                </>
              )}
            </>
          )}
          {canon.renglones.length > 0 && (
            <ul className="situ-renglones">
              {canon.renglones.map((r, i) => (
                <li key={i}>
                  <span>
                    <b>{r.concepto.replace(/ \(.*\)$/, "")}</b>
                    <small>
                      {r.estado === "CORRIENDO" ? "Va corriendo" : r.estado === "PROXIMO" ? "Mes completo" : r.estado === "VENCIDO" ? "Vencido" : "Para pagar"}
                    </small>
                  </span>
                  <span className="situ-der">
                    <b className="mono">{pesos(r.total)}</b>
                    <small className={r.estado === "VENCIDO" ? "situ-chip rojo" : "situ-chip"}>{r.cuando}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="situ-como">
            Pedile a Gonzalo los datos para transferir. Cuando nos llega, queda como <b>✓ pagado</b>.
          </p>
        </section>
      </div>
    </div>
  );
}
