import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import { saldosPorMarca } from "@/lib/canjesProfesionales";
import { mesesVinculo } from "@/lib/pacientesProfesional";
import SumarPaciente from "./SumarPaciente";

export const dynamic = "force-dynamic";

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const porcentaje = (n: number) => `${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });

// Su saldo, lo que da cada marca y las compras hechas con su código.
// Nunca se muestra quién compró ni qué: esos datos son de los clientes del local.
export default async function SaldoEspacio() {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) redirect("/login?next=/mi-espacio/saldo");
  const id = sesion.idProfesional;
  const supabase = getSupabaseServerClient();
  const hoy = new Date().toISOString().slice(0, 10);

  const [saldos, refRes, confRes, marcasRes, pacRes, meses] = await Promise.all([
    saldosPorMarca(supabase, id),
    supabase
      .from("referidos_profesionales")
      .select("id_referido, total_venta, recompensa_profesional, estado, fecha")
      .eq("id_profesional", id)
      .neq("estado", "ANULADO")
      .order("fecha", { ascending: false })
      .limit(50),
    // Lo vigente hoy de cada marca, con la misma regla que usa la caja (lib/referidosProfesionales.ts).
    supabase
      .from("config_profesionales_marca")
      .select("id_marca, porcentaje_cliente, porcentaje_profesional, tipo_beneficio_cliente, fecha_desde")
      .eq("estado", "ACTIVA")
      .eq("participa", true)
      .lte("fecha_desde", hoy)
      .or(`fecha_hasta.is.null,fecha_hasta.gte.${hoy}`)
      .order("fecha_desde", { ascending: false }),
    supabase.from("marcas").select("id_marca, nombre").eq("estado", "ACTIVA"),
    supabase
      .from("pacientes_profesional")
      .select("id_vinculo, hasta, bienvenida_usada, clientes(nombre, apellido)")
      .eq("id_profesional", id)
      .is("cerrado_at", null)
      .gt("hasta", new Date().toISOString())
      .order("hasta", { ascending: false })
      .limit(100),
    mesesVinculo(supabase),
  ]);
  const pacientes = (pacRes.data ?? []).map((p) => {
    const c = p.clientes as unknown as { nombre: string; apellido: string | null } | null;
    return {
      id: p.id_vinculo as string,
      nombre: c ? `${c.nombre}${c.apellido ? ` ${c.apellido}` : ""}` : "Paciente",
      hasta: p.hasta as string,
      bienvenida: !p.bienvenida_usada,
    };
  });

  const conSaldo = saldos.filter((s) => s.saldo > 0);
  const nombrePorMarca = new Map((marcasRes.data ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const vigentePorMarca = new Map<string, { cliente: number; profesional: number; tipo: string }>();
  for (const c of confRes.data ?? []) {
    if (vigentePorMarca.has(c.id_marca as string) || !nombrePorMarca.has(c.id_marca as string)) continue;
    vigentePorMarca.set(c.id_marca as string, {
      cliente: Number(c.porcentaje_cliente ?? 0),
      profesional: Number(c.porcentaje_profesional ?? 0),
      tipo: c.tipo_beneficio_cliente as string,
    });
  }
  const marcas = [...vigentePorMarca.entries()]
    .map(([idMarca, v]) => ({ nombre: nombrePorMarca.get(idMarca) ?? "Marca", ...v }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const compras = refRes.data ?? [];

  return (
    <main className="esp-lienzo">
      <div className="esp-dos">
        <div className="esp-col">
          <section className="tarjeta">
            <h2>Compras con tu código</h2>
            {compras.length === 0 ? (
              <p className="vacio">Todavía nadie compró con tu código. Cuando pase, lo vas a ver acá.</p>
            ) : (
              <div className="tabla-env">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th className="num">Compra</th>
                      <th className="num">Tu saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compras.map((r) => (
                      <tr key={r.id_referido as string}>
                        <td>{fecha(r.fecha as string)}</td>
                        <td className="num">{pesos(Number(r.total_venta ?? 0))}</td>
                        <td className="num mas">+{pesos(Number(r.recompensa_profesional ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="nota">No mostramos quién compró ni qué: esos datos son de los clientes del local.</p>
          </section>
        </div>

        <div className="esp-col">
          {!pacRes.error && (
            <section className="tarjeta">
              <h2>
                Tus pacientes <small>suman {meses} meses cada uno</small>
              </h2>
              {pacientes.length === 0 ? (
                <p className="vacio">Todavía no tenés pacientes registrados. Se suman cuando les armás un pedido, desde acá, o cuando dicen tu código en la caja.</p>
              ) : (
                <div className="tabla-env">
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Paciente</th>
                        <th className="num">Suma hasta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pacientes.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {p.nombre}
                            {p.bienvenida && <span className="bienvenida">tiene su descuento de bienvenida</span>}
                          </td>
                          <td className="num">{fecha(p.hasta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <SumarPaciente meses={meses} />
            </section>
          )}

          <section className="tarjeta">
            <h2>Tu saldo</h2>
            {conSaldo.length === 0 ? (
              <p className="vacio">Todavía no tenés saldo.</p>
            ) : (
              <div className="tabla-env">
                <table className="tabla">
                  <tbody>
                    {conSaldo.map((s) => (
                      <tr key={s.idMarca}>
                        <td>{s.nombreMarca}</td>
                        <td className="num">{pesos(s.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="consejo">Para usarlo: en la caja decís tu código y tu PIN. El saldo de cada marca se usa en productos de esa marca.</p>
          </section>

          <section className="tarjeta">
            <h2>
              Lo que da cada marca <small>lo define cada marca</small>
            </h2>
            {marcas.length === 0 ? (
              <p className="vacio">Por ahora ninguna marca participa.</p>
            ) : (
              <div className="tabla-env">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Marca</th>
                      <th className="num">Tu paciente</th>
                      <th className="num">Vos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marcas.map((m) => (
                      <tr key={m.nombre}>
                        <td>{m.nombre}</td>
                        <td className="num">
                          {porcentaje(m.cliente)} {m.tipo === "DESCUENTO" ? "desc." : "en puntos"} la 1.ª vez
                        </td>
                        <td className="num">{porcentaje(m.profesional)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="nota">
              Tu paciente tiene su beneficio en su primera compra; vos sumás tu % en todo lo que compre mientras sea tu paciente. Las demás marcas todavía
              no participan: si compra de esas, no suma.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
