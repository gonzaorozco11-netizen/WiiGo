import type { SupabaseClient } from "@supabase/supabase-js";
import { ESTADO_GRANEL } from "@/lib/granel";
import { fechaHoraArgentina } from "@/lib/horarios";

// Los datos de la pantalla Fraccionar (app/(app)/fraccionar).

/** El local de quien usa la pantalla: el de su persona, o el único que haya. */
export async function localDeSesion(supabase: SupabaseClient, idUsuario: string): Promise<string | null> {
  const { data: u } = await supabase.from("usuarios").select("id_persona").eq("id_usuario", idUsuario).maybeSingle();
  if (u?.id_persona) {
    const { data: p } = await supabase.from("personas").select("id_local").eq("id_persona", u.id_persona as string).maybeSingle();
    if (p?.id_local) return p.id_local as string;
  }
  const { data: locales } = await supabase.from("locales").select("id_local").eq("estado", "ACTIVO");
  return (locales ?? []).length === 1 ? (locales![0].id_local as string) : null;
}

export type BolsitaDeGranel = { idVariante: string; nombre: string; peso: number; enGondola: number; minimo: number };
export type GranelVista = {
  idVariante: string;
  nombre: string;
  gramos: number;
  bolsitas: BolsitaDeGranel[];
};
export type FraccionadoVista = { id: string; cuando: string; quien: string; granel: string; bolsa: string | null; bolsitas: number; gramos: number; tipo: "FRACCIONADO" | "CIERRE"; merma: number };
export type ResumenGranel = { nombre: string; recibido: number; embolsado: number; merma: number; deposito: number };

export async function datosFraccionar(supabase: SupabaseClient, idLocal: string) {
  const { data: graneles, error } = await supabase.from("productos").select("id_producto, nombre, id_granel").eq("estado", ESTADO_GRANEL).range(0, 4999);
  if (error) return null; // sin sql/granel-fraccionado.sql
  const idsGranel = [...new Set((graneles ?? []).map((g) => g.id_granel as string))];
  const [{ data: varsGranel }, { data: hijas }] = await Promise.all([
    graneles?.length
      ? supabase.from("variantes_producto").select("id_variante, id_producto").in("id_producto", graneles.map((g) => g.id_producto as string))
      : Promise.resolve({ data: [] as { id_variante: string; id_producto: string }[] }),
    idsGranel.length
      ? supabase.from("productos").select("id_producto, nombre, id_granel, peso_neto_g").eq("estado", "ACTIVO").not("id_envase", "is", null).gt("peso_neto_g", 0).in("id_granel", idsGranel)
      : Promise.resolve({ data: [] as { id_producto: string; nombre: string; id_granel: string; peso_neto_g: number }[] }),
  ]);
  const { data: varsHijas } = hijas?.length
    ? await supabase.from("variantes_producto").select("id_variante, id_producto, stock_minimo").eq("estado", "ACTIVO").in("id_producto", hijas.map((h) => h.id_producto as string))
    : { data: [] as { id_variante: string; id_producto: string; stock_minimo: number | null }[] };

  const idsVariante = [...(varsGranel ?? []).map((v) => v.id_variante as string), ...(varsHijas ?? []).map((v) => v.id_variante as string)];
  const { data: stock } = idsVariante.length
    ? await supabase.from("stock").select("id_variante, cantidad").eq("id_local", idLocal).in("id_variante", idsVariante)
    : { data: [] as { id_variante: string; cantidad: number }[] };
  const hay = new Map((stock ?? []).map((s) => [s.id_variante as string, Number(s.cantidad ?? 0)]));

  const varDeProducto = new Map<string, string>();
  for (const v of varsGranel ?? []) varDeProducto.set(v.id_producto as string, v.id_variante as string);
  const lista: GranelVista[] = [];
  for (const g of graneles ?? []) {
    const idVar = varDeProducto.get(g.id_producto as string);
    if (!idVar) continue;
    const bolsitas: BolsitaDeGranel[] = (hijas ?? [])
      .filter((h) => h.id_granel === g.id_granel)
      .flatMap((h) =>
        (varsHijas ?? [])
          .filter((v) => v.id_producto === h.id_producto)
          .map((v) => ({
            idVariante: v.id_variante as string,
            nombre: h.nombre as string,
            peso: Number(h.peso_neto_g),
            enGondola: hay.get(v.id_variante as string) ?? 0,
            minimo: Number(v.stock_minimo ?? 0),
          }))
      )
      .sort((a, b) => a.peso - b.peso);
    if (bolsitas.length === 0) continue;
    lista.push({ idVariante: idVar, nombre: String(g.nombre).replace(/\s*·\s*a granel$/i, ""), gramos: hay.get(idVar) ?? 0, bolsitas });
  }
  // Primero lo que tiene granel para embolsar, y dentro de eso lo que queda poco en la góndola.
  lista.sort((a, b) => Number(b.gramos > 0) - Number(a.gramos > 0) || a.nombre.localeCompare(b.nombre, "es"));

  // Lo último que se fraccionó y el resumen del mes.
  const nombreVar = new Map<string, string>();
  for (const g of lista) {
    nombreVar.set(g.idVariante, g.nombre);
    for (const b of g.bolsitas) nombreVar.set(b.idVariante, b.nombre);
  }
  const inicioMes = `${fechaHoraArgentina().fecha.slice(0, 7)}-01T00:00:00-03:00`;
  const [{ data: recientes }, { data: delMes }, recibidosRes] = await Promise.all([
    supabase.from("fraccionados").select("*").eq("id_local", idLocal).order("fecha", { ascending: false }).limit(20),
    supabase.from("fraccionados").select("id_variante_granel, tipo, gramos, merma_gramos").eq("id_local", idLocal).gte("fecha", inicioMes),
    (varsGranel ?? []).length
      ? supabase
          .from("detalle_recepcion_proveedor")
          .select("id_variante, cantidad_recibida, recepciones_proveedor!inner(fecha, id_local)")
          .in("id_variante", (varsGranel ?? []).map((v) => v.id_variante as string))
          .eq("recepciones_proveedor.id_local", idLocal)
          .gte("recepciones_proveedor.fecha", inicioMes)
      : Promise.resolve({ data: [] as { id_variante: string; cantidad_recibida: number }[] }),
  ]);

  const resumen = new Map<string, ResumenGranel>();
  const fila = (id: string) => {
    if (!resumen.has(id)) resumen.set(id, { nombre: nombreVar.get(id) ?? "Granel", recibido: 0, embolsado: 0, merma: 0, deposito: hay.get(id) ?? 0 });
    return resumen.get(id)!;
  };
  for (const r of (recibidosRes.data ?? []) as { id_variante: string; cantidad_recibida: number }[]) fila(r.id_variante).recibido += Number(r.cantidad_recibida ?? 0);
  for (const f of delMes ?? []) {
    const r = fila(f.id_variante_granel as string);
    r.embolsado += Number(f.gramos ?? 0);
    r.merma += Number(f.merma_gramos ?? 0);
  }

  return {
    graneles: lista,
    recientes: (recientes ?? []).map(
      (f): FraccionadoVista => ({
        id: f.id_fraccionado as string,
        cuando: f.fecha as string,
        quien: (f.usuario as string | null) ?? "—",
        granel: nombreVar.get(f.id_variante_granel as string) ?? "Granel",
        bolsa: f.id_variante_bolsa ? nombreVar.get(f.id_variante_bolsa as string) ?? null : null,
        bolsitas: Number(f.bolsitas ?? 0),
        gramos: Number(f.gramos ?? 0),
        tipo: f.tipo as "FRACCIONADO" | "CIERRE",
        merma: Number(f.merma_gramos ?? 0),
      })
    ),
    resumen: [...resumen.values()].sort((a, b) => b.recibido + b.embolsado - (a.recibido + a.embolsado)),
  };
}
