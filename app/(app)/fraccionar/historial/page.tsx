import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import PestanasStock from "@/components/PestanasStock";
import { historialFraccionado, localDeSesion } from "@/lib/fraccionado";
import { textoGramos } from "@/lib/gramos";
import { fechaHoraArgentina } from "@/lib/horarios";

export const dynamic = "force-dynamic";

// Historial de fraccionado (Gonzalo, 2026-11-16: «que me figure quién fraccionó y qué producto»).
// Cada tanda: cuándo, quién, granel → bolsita, cuántas, gramos, merma, vencimiento escrito, lote y costo.
// El Dueño ve todas; los demás, solo las suyas.

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fechaCorta = (iso: string) => iso.split("-").reverse().join("/");
const plata = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const sinTilde = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default async function HistorialFraccionadoPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; quien?: string; producto?: string }> }) {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "fraccionar")) return <PantallaBloqueada />;
  const esAdmin = sesion.rol === "admin";
  const sp = await searchParams;
  const hoy = fechaHoraArgentina().fecha;
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const desde = sp.desde && FECHA.test(sp.desde) ? sp.desde : hace30;
  const hasta = sp.hasta && FECHA.test(sp.hasta) ? sp.hasta : hoy;

  const supabase = getSupabaseServerClient();
  const idLocal = esAdmin ? null : await localDeSesion(supabase, sesion.idUsuario);
  let tandas = await historialFraccionado(supabase, idLocal, desde, hasta);
  // Los operativos ven las suyas (por id; las viejas, sin id, por el nombre).
  if (!esAdmin) tandas = tandas.filter((t) => (t.idUsuario ? t.idUsuario === sesion.idUsuario : t.quien === sesion.nombre));
  const personas = [...new Set(tandas.map((t) => t.quien))].sort((a, b) => a.localeCompare(b, "es"));
  if (sp.quien) tandas = tandas.filter((t) => t.quien === sp.quien);
  if (sp.producto?.trim()) tandas = tandas.filter((t) => sinTilde(`${t.granel} ${t.bolsa ?? ""}`).includes(sinTilde(sp.producto!.trim())));

  const tandasFr = tandas.filter((t) => t.tipo === "FRACCIONADO");
  const totales = {
    bolsitas: tandasFr.reduce((a, t) => a + t.bolsitas, 0),
    gramos: tandasFr.reduce((a, t) => a + t.gramos, 0),
    merma: tandas.reduce((a, t) => a + t.merma, 0),
  };
  const campo = "rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="max-w-5xl mx-auto">
      <PestanasStock actual="historial" />
      <h1 className="text-xl font-semibold text-neutral-900">Historial de fraccionado</h1>
      <p className="text-sm text-neutral-500 mt-0.5 mb-4">{esAdmin ? "Quién fraccionó qué, cuándo, con su lote y su vencimiento." : "Lo que fraccionaste vos."}</p>

      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="grid gap-1 text-xs font-semibold text-neutral-600">
          Desde
          <input type="date" name="desde" defaultValue={desde} className={campo} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-neutral-600">
          Hasta
          <input type="date" name="hasta" defaultValue={hasta} className={campo} />
        </label>
        {esAdmin && (
          <label className="grid gap-1 text-xs font-semibold text-neutral-600">
            Quién
            <select name="quien" defaultValue={sp.quien ?? ""} className={campo}>
              <option value="">Todos</option>
              {personas.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-xs font-semibold text-neutral-600">
          Producto
          <input type="search" name="producto" defaultValue={sp.producto ?? ""} placeholder="Almendra, chía…" className={campo} />
        </label>
        <button className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">Ver</button>
      </form>

      <div className="mb-4 grid grid-cols-3 gap-2 max-w-lg">
        {(
          [
            ["Bolsitas", String(totales.bolsitas)],
            ["Granel usado", textoGramos(totales.gramos)],
            ["Merma", textoGramos(totales.merma)],
          ] as const
        ).map(([t, v]) => (
          <div key={t} className="rounded-xl border border-neutral-200 bg-white p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">{t}</p>
            <p className="text-lg font-bold tabular-nums text-neutral-900">{v}</p>
          </div>
        ))}
      </div>

      {tandas.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500 border border-dashed border-neutral-300 rounded-xl">No hay fraccionados en esas fechas.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-3 py-2.5 font-semibold">Cuándo</th>
                <th className="px-3 py-2.5 font-semibold">Quién</th>
                <th className="px-3 py-2.5 font-semibold">Producto</th>
                <th className="px-3 py-2.5 font-semibold text-right">Bolsitas</th>
                <th className="px-3 py-2.5 font-semibold text-right">Granel</th>
                <th className="px-3 py-2.5 font-semibold text-right">Merma</th>
                <th className="px-3 py-2.5 font-semibold">Vence</th>
                <th className="px-3 py-2.5 font-semibold">Lote</th>
                {esAdmin && <th className="px-3 py-2.5 font-semibold text-right">Costo</th>}
              </tr>
            </thead>
            <tbody>
              {tandas.map((t) => (
                <tr key={t.id} className="border-t border-neutral-100 align-top">
                  <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-neutral-600">{cuando(t.cuando)}</td>
                  <td className="px-3 py-2.5">{t.quien}</td>
                  <td className="px-3 py-2.5">
                    {t.tipo === "CIERRE" ? (
                      <>
                        Se terminó el granel de <b>{t.granel}</b>
                      </>
                    ) : (
                      <>
                        <b>{t.bolsa ?? t.granel}</b>
                        <span className="block text-xs text-neutral-400">de {t.granel} a granel</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.tipo === "CIERRE" ? "—" : t.bolsitas}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.tipo === "CIERRE" ? "—" : textoGramos(t.gramos)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${t.merma > 0 ? "text-amber-700 font-semibold" : "text-neutral-400"}`}>{t.merma > 0 ? textoGramos(t.merma) : "0"}</td>
                  <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{t.vencimiento ? fechaCorta(t.vencimiento) : "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{t.lote ?? "—"}</td>
                  {esAdmin && <td className="px-3 py-2.5 text-right tabular-nums">{t.costo != null ? plata(t.costo) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
