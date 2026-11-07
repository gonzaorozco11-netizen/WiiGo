import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ConteosAdminApp, { type DiferenciaVista, type ConteoFirmadoVista } from "@/components/ConteosAdminApp";
import { marcasFabricaParaPantalla, conMarca } from "@/lib/marcaFabrica";

export const dynamic = "force-dynamic";

// Lo que se contó en los turnos y las diferencias que quedan por resolver.
export default async function ConteosPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "stock-conteos")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const haceDias = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

  const [difs, conteos, locales, marcas, { count: activas }] = await Promise.all([
    supabase.from("diferencias_stock").select("*").neq("estado", "RESUELTA").order("contado_en", { ascending: true }),
    supabase
      .from("conteos_stock")
      .select("id_conteo, id_local, nombre, fecha, estado, firma, firmado_en, creado_en, conteos_stock_items(id_variante, resultado, contado_en)")
      .gte("creado_en", haceDias(14))
      .order("creado_en", { ascending: false }),
    supabase.from("locales").select("id_local, nombre"),
    marcasFabricaParaPantalla(supabase),
    supabase.from("variantes_producto").select("id_variante", { count: "exact", head: true }).eq("estado", "ACTIVO"),
  ]);

  if (difs.error || conteos.error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-1">Falta crear las tablas del conteo</p>
        <p className="text-sm text-neutral-500">Corré sql/conteos-stock.sql en el SQL Editor de Supabase.</p>
      </div>
    );
  }

  const listaConteos = (conteos.data ?? []) as unknown as {
    id_conteo: string;
    id_local: string;
    nombre: string | null;
    fecha: string;
    estado: string;
    firma: string | null;
    firmado_en: string | null;
    creado_en: string;
    conteos_stock_items: { id_variante: string; resultado: string | null; contado_en: string | null }[];
  }[];
  const listaDifs = (difs.data ?? []) as Record<string, unknown>[];

  // Nombres de lo que aparece en las diferencias.
  const ids = [...new Set(listaDifs.map((d) => d.id_variante as string))];
  const { data: vars } = ids.length
    ? await supabase.from("variantes_producto").select("id_variante, id_producto, nombre").in("id_variante", ids)
    : { data: [] };
  const idsProd = [...new Set((vars ?? []).map((v) => v.id_producto as string))];
  const { data: prods } = idsProd.length ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProd) : { data: [] };
  const nombreProd = new Map((prods ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
  const nombreVar = new Map(
    (vars ?? []).map((v) => {
      const base = conMarca(nombreProd.get(v.id_producto as string) ?? "Producto", marcas[v.id_producto as string]);
      return [v.id_variante as string, v.nombre && v.nombre !== "Único" ? `${base} — ${v.nombre}` : base];
    })
  );
  const nombreLocal = new Map((locales.data ?? []).map((l) => [l.id_local as string, l.nombre as string]));
  const variosLocales = (locales.data ?? []).length > 1;

  const diferencias: DiferenciaVista[] = listaDifs.map((d) => ({
    id: d.id_diferencia as string,
    producto: nombreVar.get(d.id_variante as string) ?? "Producto",
    local: variosLocales ? nombreLocal.get(d.id_local as string) ?? null : null,
    estado: d.estado as "ABIERTA" | "CONFIRMADA",
    esperado: Number(d.esperado),
    contado: Number(d.contado),
    diferencia: Number(d.diferencia),
    contadoPor: (d.contado_por as string | null) ?? "—",
    contadoEn: d.contado_en as string,
    recuento: d.recuento == null ? null : Number(d.recuento),
    recontadoPor: (d.recontado_por as string | null) ?? null,
    recontadoEn: (d.recontado_en as string | null) ?? null,
  }));

  const semana = listaConteos.filter((c) => c.creado_en >= haceDias(7));
  const itemsSemana = semana.flatMap((c) => c.conteos_stock_items.filter((i) => i.contado_en));
  // Cuánto del local se contó en el último mes (variantes distintas).
  const { data: mes } = await supabase.from("conteos_stock_items").select("id_variante").gte("contado_en", haceDias(30)).range(0, 9999);
  const contadasMes = new Set((mes ?? []).map((m) => m.id_variante as string)).size;

  const firmados: ConteoFirmadoVista[] = listaConteos.map((c) => ({
    id: c.id_conteo,
    nombre: c.nombre ?? "—",
    local: variosLocales ? nombreLocal.get(c.id_local) ?? null : null,
    cuando: c.firmado_en ?? c.creado_en,
    estado: c.estado as "ABIERTO" | "FIRMADO",
    productos: c.conteos_stock_items.length,
    contados: c.conteos_stock_items.filter((i) => i.contado_en).length,
    diferencias: c.conteos_stock_items.filter((i) => i.resultado === "DIFERENCIA").length,
    firma: c.firma,
  }));

  return (
    <ConteosAdminApp
      kpis={{
        contados: itemsSemana.length,
        bien: itemsSemana.filter((i) => i.resultado === "OK").length,
        porResolver: diferencias.length,
        pctLocal: activas ? Math.round((contadasMes / activas) * 100) : 0,
      }}
      diferencias={diferencias}
      conteos={firmados}
    />
  );
}
