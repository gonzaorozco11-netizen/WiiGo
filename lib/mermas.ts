import { getSupabaseServerClient } from "@/lib/supabase";

// La merma, mirada de arriba.
//
// El hecho físico es siempre el mismo —se rompió una bolsa— pero la plata se
// comporta distinto según de quién era la mercadería, y esa diferencia es lo
// único que hay que entender de este archivo:
//
//   LIQUIDACION  (Alifrut)      se le paga: entra en la próxima liquidación
//   PROPIA       (Coca Cola)    ya estaba pagada con la factura; la pérdida es tuya
//   CONSIGNACION (Alta, Fitt)   la mercadería es de la marca y el riesgo también
//
// El costo se guarda congelado en la merma (ver app/(app)/stock/actions.ts),
// así que acá no se recalcula nada: lo que se perdió se perdió a ese precio.

export type DuenioMerma = "LIQUIDACION" | "PROPIA" | "CONSIGNACION";

export type MermaListada = {
  idMerma: string;
  fecha: string;
  producto: string;
  idVariante: string;
  local: string;
  cantidad: number;
  costoUnitario: number | null;
  /** cantidad × costo. Null cuando el producto no tiene costo cargado. */
  costoTotal: number | null;
  motivo: string;
  detalle: string | null;
  usuario: string | null;
  duenio: DuenioMerma;
  /** Nombre del proveedor o de la marca, según el caso. */
  deQuien: string;
  /** Ya entró en una liquidación: esa plata ya se pagó. */
  liquidada: boolean;
};

export type ResumenMerma = {
  /** Plata perdida en total, sin importar quién la absorbe. */
  total: number;
  /** Lo que se le paga a proveedores por liquidación. */
  seLePaga: number;
  /** Lo que sale de tu bolsillo porque la mercadería ya era tuya. */
  perdidaPropia: number;
  /** Lo que absorbe la marca: no te cuesta plata, pero sí góndola vacía. */
  deLaMarca: number;
  unidades: number;
};

export async function listarMermas(params: {
  desde?: string;
  hasta?: string;
  idLocal?: string;
  /** Para la ficha de un proveedor: solo lo suyo. */
  idProveedor?: string;
  /** Para Rentabilidad: solo los productos de esa marca. */
  idMarca?: string;
  limite?: number;
}): Promise<{ mermas: MermaListada[]; resumen: ResumenMerma }> {
  const supabase = getSupabaseServerClient();
  const vacio: ResumenMerma = { total: 0, seLePaga: 0, perdidaPropia: 0, deLaMarca: 0, unidades: 0 };

  let q = supabase
    .from("mermas")
    .select("id_merma, id_variante, id_local, cantidad, motivo, detalle, costo_unitario, fecha, usuario, id_liquidacion_proveedor")
    .order("fecha", { ascending: false })
    .limit(params.limite ?? 300);

  if (params.desde) q = q.gte("fecha", `${params.desde}T00:00:00`);
  if (params.hasta) q = q.lte("fecha", `${params.hasta}T23:59:59`);
  if (params.idLocal) q = q.eq("id_local", params.idLocal);

  const { data } = await q;
  const filas = data ?? [];
  if (filas.length === 0) return { mermas: [], resumen: vacio };

  // ---------- De quién era cada cosa ----------
  const idsVariante = [...new Set(filas.map((m) => m.id_variante as string))];
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_variante", idsVariante);

  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto as string))];
  const { data: productos } = idsProducto.length
    ? await supabase
        .from("productos")
        .select("id_producto, nombre, id_marca, id_proveedor_liquidacion")
        .in("id_producto", idsProducto)
    : { data: [] as Record<string, unknown>[] };

  const idsMarca = [...new Set((productos ?? []).map((p) => p.id_marca as string).filter(Boolean))];
  const idsProv = [
    ...new Set(
      (productos ?? []).map((p) => p.id_proveedor_liquidacion as string | null).filter((x): x is string => Boolean(x))
    ),
  ];

  const [marcasRes, provRes, localesRes] = await Promise.all([
    idsMarca.length
      ? supabase.from("marcas").select("id_marca, nombre, tipo_comercializacion").in("id_marca", idsMarca)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    idsProv.length
      ? supabase.from("proveedores").select("id_proveedor, nombre").in("id_proveedor", idsProv)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.from("locales").select("id_local, nombre"),
  ]);

  const marcaPorId = new Map((marcasRes.data ?? []).map((m) => [m.id_marca as string, m]));
  const provPorId = new Map((provRes.data ?? []).map((p) => [p.id_proveedor as string, p.nombre as string]));
  const localPorId = new Map((localesRes.data ?? []).map((l) => [l.id_local as string, l.nombre as string]));
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p]));
  const variantePorId = new Map((variantes ?? []).map((v) => [v.id_variante as string, v]));

  const mermas: MermaListada[] = [];
  for (const m of filas) {
    const v = variantePorId.get(m.id_variante as string);
    const p = v ? productoPorId.get(v.id_producto as string) : undefined;
    const idProv = (p?.id_proveedor_liquidacion as string | null) ?? null;
    const marca = p?.id_marca ? marcaPorId.get(p.id_marca as string) : undefined;

    // El orden de las preguntas importa: un producto de Alifrut también tiene
    // marca (la propia), así que la liquidación se pregunta primero.
    const duenio: DuenioMerma = idProv
      ? "LIQUIDACION"
      : (marca?.tipo_comercializacion as string | undefined) === "PROPIA"
        ? "PROPIA"
        : "CONSIGNACION";

    if (params.idProveedor && idProv !== params.idProveedor) continue;
    if (params.idMarca && (p?.id_marca as string | undefined) !== params.idMarca) continue;

    const base = (p?.nombre as string) ?? "Producto";
    const cantidad = (m.cantidad as number) ?? 0;
    const costoUnitario = (m.costo_unitario as number | null) ?? null;

    mermas.push({
      idMerma: m.id_merma as string,
      fecha: m.fecha as string,
      producto: v && v.nombre !== "Único" ? `${base} — ${v.nombre}` : base,
      idVariante: m.id_variante as string,
      local: localPorId.get(m.id_local as string) ?? "—",
      cantidad,
      costoUnitario,
      costoTotal: costoUnitario != null ? Math.round(costoUnitario * cantidad * 100) / 100 : null,
      motivo: (m.motivo as string) ?? "OTRO",
      detalle: (m.detalle as string | null) ?? null,
      usuario: (m.usuario as string | null) ?? null,
      duenio,
      deQuien: idProv
        ? provPorId.get(idProv) ?? "Proveedor"
        : ((marca?.nombre as string | undefined) ?? "—"),
      liquidada: Boolean(m.id_liquidacion_proveedor),
    });
  }

  const resumen = mermas.reduce<ResumenMerma>((acc, m) => {
    const costo = m.costoTotal ?? 0;
    acc.unidades += m.cantidad;
    acc.total += costo;
    if (m.duenio === "LIQUIDACION") acc.seLePaga += costo;
    else if (m.duenio === "PROPIA") acc.perdidaPropia += costo;
    else acc.deLaMarca += costo;
    return acc;
  }, { ...vacio });

  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    mermas,
    resumen: {
      total: r2(resumen.total),
      seLePaga: r2(resumen.seLePaga),
      perdidaPropia: r2(resumen.perdidaPropia),
      deLaMarca: r2(resumen.deLaMarca),
      unidades: resumen.unidades,
    },
  };
}
