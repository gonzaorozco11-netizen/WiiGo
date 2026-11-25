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

export type BolsitaDeGranel = {
  idVariante: string;
  nombre: string;
  peso: number;
  /** Lo que hay en el local: el blistero más el cajón de abajo. */
  enGondola: number;
  minimo: number;
  /** Hasta cuánto se llena: 5 en el blistero + 3 en el cajón = 8 (el máximo del producto). */
  objetivo: number;
  /** Vendidas en los últimos 7 días. */
  vendidasSemana: number;
  /** Los días que dura, si están cargados en el producto (si no, se usa la duración sugerida por nombre). */
  dias: number | null;
};
export type GranelVista = {
  idVariante: string;
  nombre: string;
  gramos: number;
  /** Lo que trae una bolsa cerrada: los cereales vienen por bolsa (2, 3, 4 kg); el resto por kilo. */
  gramosBolsa: number;
  bolsitas: BolsitaDeGranel[];
};
export type FraccionadoVista = { id: string; cuando: string; quien: string; granel: string; bolsa: string | null; bolsitas: number; gramos: number; tipo: "FRACCIONADO" | "CIERRE"; merma: number };
export type ResumenGranel = { nombre: string; recibido: number; embolsado: number; merma: number; deposito: number };

/** Un paso a paso que quedó por la mitad (sql/fraccionado-guiado.sql). */
export type EnCursoVista = {
  id: string;
  idVarianteGranel: string;
  idVarianteBolsa: string;
  paso: number;
  bolsitas: number | null;
  seTermino: boolean | null;
  gramosQuedan: number | null;
  vencimiento: string | null;
  quien: string;
  idUsuario: string;
  actualizado: string;
  /** Quién imprimió / pegó las etiquetas y cuándo (sql/tanda-pasos.sql; sin él, null). */
  impresasPor: string | null;
  impresasEn: string | null;
  pegadasPor: string | null;
  pegadasEn: string | null;
};

/** Los fraccionados sin terminar del local (o de una persona). Sin la tabla, ninguno. */
export async function fraccionadosEnCurso(supabase: SupabaseClient, filtro: { idLocal?: string; idUsuario?: string }): Promise<EnCursoVista[]> {
  let q = supabase.from("fraccionados_en_curso").select("*").order("actualizado", { ascending: false }).limit(20);
  if (filtro.idLocal) q = q.eq("id_local", filtro.idLocal);
  if (filtro.idUsuario) q = q.eq("id_usuario", filtro.idUsuario);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []).map((f) => ({
    id: f.id_en_curso as string,
    idVarianteGranel: f.id_variante_granel as string,
    idVarianteBolsa: f.id_variante_bolsa as string,
    paso: Number(f.paso ?? 2),
    bolsitas: f.bolsitas == null ? null : Number(f.bolsitas),
    seTermino: f.se_termino == null ? null : Boolean(f.se_termino),
    gramosQuedan: f.gramos_quedan == null ? null : Number(f.gramos_quedan),
    vencimiento: (f.vencimiento as string | null) ?? null,
    quien: (f.usuario as string | null) ?? "—",
    idUsuario: f.id_usuario as string,
    actualizado: f.actualizado as string,
    impresasPor: (f.impresas_por as string | null) ?? null,
    impresasEn: (f.impresas_en as string | null) ?? null,
    pegadasPor: (f.pegadas_por as string | null) ?? null,
    pegadasEn: (f.pegadas_en as string | null) ?? null,
  }));
}

/**
 * Bolsitas ya embolsadas que todavía NO están en el stock: esperan la etiqueta
 * (el stock se suma recién en «Sumar al stock» de la tanda). Están en el local,
 * así que el conteo del turno tiene que saberlo: el 19/11 Tomás contó 8
 * almohaditas de limón (3 + 5 sin etiquetar), el conteo las ajustó y después la
 * tanda volvió a sumar las 5. Por variante de bolsita; sin la tabla, ninguna.
 */
export async function sinEtiquetarPorVariante(supabase: SupabaseClient, idLocal: string, idsVariante: string[]): Promise<Map<string, number>> {
  const salida = new Map<string, number>();
  if (!idsVariante.length) return salida;
  const { data, error } = await supabase
    .from("fraccionados_en_curso")
    .select("id_variante_bolsa, bolsitas")
    .eq("id_local", idLocal)
    .in("id_variante_bolsa", idsVariante)
    .not("bolsitas", "is", null);
  if (error) return salida;
  for (const f of data ?? []) {
    const n = Number(f.bolsitas ?? 0);
    if (n > 0) salida.set(f.id_variante_bolsa as string, (salida.get(f.id_variante_bolsa as string) ?? 0) + n);
  }
  return salida;
}

/** Una tanda del historial de fraccionado (Gonzalo, 16/11: «quién fraccionó y qué producto»). */
export type TandaHistorial = {
  id: string;
  cuando: string;
  quien: string;
  idUsuario: string | null;
  granel: string;
  bolsa: string | null;
  tipo: "FRACCIONADO" | "CIERRE";
  bolsitas: number;
  gramos: number;
  merma: number;
  quedaron: number | null;
  vencimiento: string | null;
  lote: string | null;
  costo: number | null;
};

/** El historial de un local entre dos fechas (Argentina, AAAA-MM-DD), con los nombres ya puestos. */
export async function historialFraccionado(supabase: SupabaseClient, idLocal: string | null, desde: string, hasta: string): Promise<TandaHistorial[]> {
  let q = supabase
    .from("fraccionados")
    .select("*")
    .gte("fecha", `${desde}T00:00:00-03:00`)
    .lte("fecha", `${hasta}T23:59:59-03:00`)
    .order("fecha", { ascending: false })
    .limit(500);
  if (idLocal) q = q.eq("id_local", idLocal);
  const { data, error } = await q;
  if (error || !data?.length) return [];
  const ids = [...new Set(data.flatMap((f) => [f.id_variante_granel as string, f.id_variante_bolsa as string | null]).filter(Boolean) as string[])];
  const { data: vars } = await supabase.from("variantes_producto").select("id_variante, productos(nombre)").in("id_variante", ids);
  const nombre = new Map(
    (vars ?? []).map((v) => [v.id_variante as string, String((v.productos as unknown as { nombre: string } | null)?.nombre ?? "Producto").replace(/\s*·\s*a granel$/i, "")])
  );
  return data.map((f) => ({
    id: f.id_fraccionado as string,
    cuando: f.fecha as string,
    quien: (f.usuario as string | null) ?? "—",
    idUsuario: (f.id_usuario as string | null) ?? null,
    granel: nombre.get(f.id_variante_granel as string) ?? "Granel",
    bolsa: f.id_variante_bolsa ? nombre.get(f.id_variante_bolsa as string) ?? null : null,
    tipo: f.tipo as "FRACCIONADO" | "CIERRE",
    bolsitas: Number(f.bolsitas ?? 0),
    gramos: Number(f.gramos ?? 0),
    merma: Number(f.merma_gramos ?? 0),
    quedaron: f.gramos_quedaron == null ? null : Number(f.gramos_quedaron),
    vencimiento: (f.vencimiento as string | null) ?? null,
    lote: (f.lote as string | null) ?? null,
    costo: f.costo_total == null ? null : Number(f.costo_total),
  }));
}

/** Unidades vendidas en los últimos 7 días, por variante, en este local. Si algo falla, vacío. */
async function vendidasUltimos7Dias(supabase: SupabaseClient, idLocal: string, idsVariante: string[]): Promise<Map<string, number>> {
  const salida = new Map<string, number>();
  if (idsVariante.length === 0) return salida;
  try {
    const desde = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: ventas } = await supabase.from("ventas").select("id_venta").eq("estado", "PAGADA").eq("id_local", idLocal).gte("fecha", desde).range(0, 9999);
    const ids = (ventas ?? []).map((v) => v.id_venta as string);
    const quiero = new Set(idsVariante);
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from("detalle_ventas").select("id_variante, cantidad").in("id_venta", ids.slice(i, i + 200));
      for (const d of data ?? []) {
        const id = d.id_variante as string;
        if (quiero.has(id)) salida.set(id, (salida.get(id) ?? 0) + (Number(d.cantidad) || 0));
      }
    }
  } catch {
    /* sin el dato, la lista sale igual */
  }
  return salida;
}

export async function datosFraccionar(supabase: SupabaseClient, idLocal: string) {
  const { data: graneles, error } = await supabase.from("productos").select("id_producto, nombre, id_granel").eq("estado", ESTADO_GRANEL).range(0, 4999);
  if (error) return null; // sin sql/granel-fraccionado.sql
  const idsGranel = [...new Set((graneles ?? []).map((g) => g.id_granel as string))];
  const [{ data: varsGranel }, { data: hijas }] = await Promise.all([
    graneles?.length
      ? supabase.from("variantes_producto").select("id_variante, id_producto").in("id_producto", graneles.map((g) => g.id_producto as string))
      : Promise.resolve({ data: [] as { id_variante: string; id_producto: string }[] }),
    idsGranel.length
      ? supabase.from("productos").select("id_producto, nombre, id_granel, peso_neto_g, dias_vida_util").eq("estado", "ACTIVO").not("id_envase", "is", null).gt("peso_neto_g", 0).in("id_granel", idsGranel)
      : Promise.resolve({ data: [] as { id_producto: string; nombre: string; id_granel: string; peso_neto_g: number; dias_vida_util: number | null }[] }),
  ]);
  const [{ data: varsHijas }, { data: costosGranel }] = await Promise.all([
    hijas?.length
      ? supabase.from("variantes_producto").select("id_variante, id_producto, stock_minimo, stock_objetivo").eq("estado", "ACTIVO").in("id_producto", hijas.map((h) => h.id_producto as string))
      : Promise.resolve({ data: [] as { id_variante: string; id_producto: string; stock_minimo: number | null; stock_objetivo: number | null }[] }),
    idsGranel.length
      ? supabase.from("costos_granel").select("id_granel, unidad, kg_bulto").in("id_granel", idsGranel)
      : Promise.resolve({ data: [] as { id_granel: string; unidad: string | null; kg_bulto: number | null }[] }),
  ]);
  // Una bolsa cerrada: los que se compran por bulto traen sus kilos; el resto viene por kilo.
  const gramosBolsaDe = new Map(
    (costosGranel ?? []).map((c) => [c.id_granel as string, c.unidad === "BULTO" && Number(c.kg_bulto) > 0 ? Number(c.kg_bulto) * 1000 : 1000])
  );
  const vendidas = await vendidasUltimos7Dias(supabase, idLocal, (varsHijas ?? []).map((v) => v.id_variante as string));

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
            objetivo: Math.max(Number(v.stock_objetivo ?? 0), Number(v.stock_minimo ?? 0)),
            vendidasSemana: vendidas.get(v.id_variante as string) ?? 0,
            dias: Number(h.dias_vida_util) > 0 ? Number(h.dias_vida_util) : null,
          }))
      )
      .sort((a, b) => a.peso - b.peso);
    if (bolsitas.length === 0) continue;
    lista.push({
      idVariante: idVar,
      nombre: String(g.nombre).replace(/\s*·\s*a granel$/i, ""),
      gramos: hay.get(idVar) ?? 0,
      gramosBolsa: gramosBolsaDe.get(g.id_granel as string) ?? 1000,
      bolsitas,
    });
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
