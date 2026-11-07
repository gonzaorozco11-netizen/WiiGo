import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";

// Conteo de stock en el turno (Gonzalo, 2026-11-07). Ver sql/conteos-stock.sql.
//
// Reglas que pidió:
//   - 10 productos por turno; si hay dos personas adentro, se reparten.
//   - Cuentan sin ver el número del sistema; si no coincide, cuentan de nuevo.
//   - Si sigue sin coincidir, el stock se ajusta EN EL MOMENTO (la caja y el
//     tótem no venden lo que no hay) y la diferencia queda abierta para él
//     hasta que dice qué pasó.
//   - El producto con una diferencia abierta vuelve a salir en el próximo
//     conteo, si se puede para otra persona: si da lo mismo, se confirmó.
//   - Se puede contar de a uno, atender a un cliente y seguir. Lo que no se
//     terminó sigue en el próximo turno de esa persona.

export const POR_TURNO = 10;
/** No se vuelve a pedir lo que se contó hace menos de esto (salvo seguimiento). */
const DIAS_SIN_REPETIR = 4;
/** Sin ventas en esta cantidad de días, con stock, es «quieto». */
const DIAS_QUIETO = 10;

export type MotivoConteo = "SEGUIMIENTO" | "ROTA" | "QUIETO" | "NUNCA";

export type ItemConteo = {
  idItem: string;
  idVariante: string;
  producto: string;
  donde: string | null;
  /** Para encontrarlo escaneando el envase. */
  codigo: string | null;
  motivo: MotivoConteo;
  detalleMotivo: string | null;
  contado: number | null;
  primerConteo: number | null;
  resultado: "OK" | "DIFERENCIA" | null;
  contadoEn: string | null;
};

export type ConteoVista = {
  idConteo: string;
  fecha: string;
  estado: "ABIERTO" | "FIRMADO";
  items: ItemConteo[];
  /** Con quién se repartió el turno (los otros que estaban adentro). */
  companeros: { nombre: string; cuantos: number }[];
  /** La tanda es de un día anterior: quedó sin terminar. */
  deAntes: boolean;
};

type Persona = { id_persona: string; nombre: string | null; apellido: string | null; id_local: string | null };

const inicioDelDia = (fecha: string) => `${fecha}T00:00:00-03:00`;
const nombreDe = (p: Persona) => [p.nombre, p.apellido].filter(Boolean).join(" ").trim() || "Sin nombre";

/** La persona del usuario y su local. null si no está vinculado. */
export async function personaDeUsuario(supabase: SupabaseClient, idUsuario: string): Promise<Persona | null> {
  const { data: u } = await supabase.from("usuarios").select("id_persona").eq("id_usuario", idUsuario).maybeSingle();
  if (!u?.id_persona) return null;
  const { data: p } = await supabase
    .from("personas")
    .select("id_persona, nombre, apellido, id_local")
    .eq("id_persona", u.id_persona as string)
    .maybeSingle();
  return (p as Persona | null) ?? null;
}

/** Quiénes están adentro ahora en el local: su último fichaje de hoy es una ENTRADA. */
export async function adentroEnLocal(supabase: SupabaseClient, idLocal: string): Promise<Persona[]> {
  const hoy = fechaHoraArgentina().fecha;
  const { data: personas } = await supabase.from("personas").select("id_persona, nombre, apellido, id_local").eq("id_local", idLocal);
  const lista = (personas ?? []) as Persona[];
  if (lista.length === 0) return [];
  const { data: fichajes } = await supabase
    .from("fichajes")
    .select("id_persona, tipo, fecha_hora")
    .in("id_persona", lista.map((p) => p.id_persona))
    .gte("fecha_hora", inicioDelDia(hoy))
    .order("fecha_hora", { ascending: true });
  const ultimo = new Map<string, string>();
  for (const f of fichajes ?? []) ultimo.set(f.id_persona as string, f.tipo as string);
  return lista.filter((p) => ultimo.get(p.id_persona) === "ENTRADA");
}

/** Lo que se vendió por variante desde una fecha, en un local. */
async function vendidasDesde(supabase: SupabaseClient, idLocal: string, desde: string) {
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta, fecha")
    .eq("estado", "PAGADA")
    .eq("id_local", idLocal)
    .gte("fecha", desde)
    .range(0, 9999);
  const fechaDe = new Map((ventas ?? []).map((v) => [v.id_venta as string, v.fecha as string]));
  const ids = [...fechaDe.keys()];
  const filas: { id_variante: string; cantidad: number; fecha: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("detalle_ventas").select("id_venta, id_variante, cantidad").in("id_venta", ids.slice(i, i + 200));
    for (const d of data ?? []) {
      filas.push({ id_variante: d.id_variante as string, cantidad: Number(d.cantidad ?? 0), fecha: fechaDe.get(d.id_venta as string) ?? desde });
    }
  }
  return filas;
}

/**
 * Elige qué tiene que contar una persona. Mezcla, en este orden:
 *   1. lo que tiene una diferencia abierta (seguimiento), mejor si la contó otro;
 *   2. lo que más se vendió desde que se contó por última vez;
 *   3. lo que tiene stock pero hace días que no se vende (puede no estar);
 *   4. lo que nunca se contó, para que en unas semanas pase todo el local.
 * No repite lo que ya tiene alguien hoy ni lo contado hace pocos días.
 */
async function elegirProductos(
  supabase: SupabaseClient,
  idLocal: string,
  persona: Persona,
  cuantos: number
): Promise<{ idVariante: string; motivo: MotivoConteo; detalle: string }[]> {
  const ahora = new Date();
  const hace = (dias: number) => new Date(ahora.getTime() - dias * 86400000).toISOString();

  const [{ data: productos }, { data: variantes }, { data: stock }, { data: contados }, { data: abiertas }, { data: enCurso }] = await Promise.all([
    supabase.from("productos").select("id_producto").eq("estado", "ACTIVO").range(0, 4999),
    supabase.from("variantes_producto").select("id_variante, id_producto").eq("estado", "ACTIVO").range(0, 9999),
    supabase.from("stock").select("id_variante, cantidad").eq("id_local", idLocal).range(0, 9999),
    // El último conteo de cada variante en este local.
    supabase
      .from("conteos_stock_items")
      .select("id_variante, contado_en, conteos_stock!inner(id_local)")
      .eq("conteos_stock.id_local", idLocal)
      .not("contado_en", "is", null)
      .order("contado_en", { ascending: false })
      .range(0, 9999),
    supabase.from("diferencias_stock").select("id_variante, contado_por, contado_en").eq("id_local", idLocal).eq("estado", "ABIERTA"),
    // Lo que ya está repartido y sin contar (de cualquiera): no se pide dos veces.
    supabase
      .from("conteos_stock_items")
      .select("id_variante, conteos_stock!inner(id_local, estado)")
      .eq("conteos_stock.id_local", idLocal)
      .eq("conteos_stock.estado", "ABIERTO")
      .is("contado_en", null),
  ]);

  const activos = new Set((productos ?? []).map((p) => p.id_producto as string));
  const vars = (variantes ?? []).filter((v) => activos.has(v.id_producto as string)).map((v) => v.id_variante as string);
  const hay = new Map((stock ?? []).map((s) => [s.id_variante as string, Number(s.cantidad ?? 0)]));
  const ultimoConteo = new Map<string, string>();
  for (const c of contados ?? []) if (!ultimoConteo.has(c.id_variante as string)) ultimoConteo.set(c.id_variante as string, c.contado_en as string);
  const ocupadas = new Set((enCurso ?? []).map((c) => c.id_variante as string));

  const elegidas: { idVariante: string; motivo: MotivoConteo; detalle: string }[] = [];
  const usar = (id: string, motivo: MotivoConteo, detalle: string) => {
    if (elegidas.length >= cuantos || ocupadas.has(id) || elegidas.some((e) => e.idVariante === id)) return;
    elegidas.push({ idVariante: id, motivo, detalle });
  };
  const reciente = (id: string) => {
    const u = ultimoConteo.get(id);
    return Boolean(u && u > hace(DIAS_SIN_REPETIR));
  };

  // 1. Seguimiento: hasta un tercio. Primero las que contó otra persona.
  const yo = nombreDe(persona);
  const seguir = (abiertas ?? [])
    .map((d) => ({ id: d.id_variante as string, deOtro: d.contado_por !== yo }))
    .sort((a, b) => Number(b.deOtro) - Number(a.deOtro));
  const topeSeguimiento = Math.max(1, Math.ceil(cuantos / 3));
  for (const s of seguir.slice(0, topeSeguimiento)) usar(s.id, "SEGUIMIENTO", "Tuvo una diferencia: confirmá cuánto hay");

  // 2 y 3 salen de las ventas del último mes.
  const ventas = await vendidasDesde(supabase, idLocal, hace(30));
  const ultimaVenta = new Map<string, string>();
  for (const v of ventas) if ((ultimaVenta.get(v.id_variante) ?? "") < v.fecha) ultimaVenta.set(v.id_variante, v.fecha);

  // 2. Rotación: lo vendido desde su último conteo (o en el mes, si nunca se contó).
  const rotacion = vars
    .filter((id) => !reciente(id))
    .map((id) => {
      const desde = ultimoConteo.get(id) ?? hace(30);
      const n = ventas.filter((v) => v.id_variante === id && v.fecha > desde).reduce((a, v) => a + v.cantidad, 0);
      return { id, n, nunca: !ultimoConteo.has(id) };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const topeRota = elegidas.length + Math.ceil(cuantos * 0.4);
  for (const r of rotacion) {
    if (elegidas.length >= topeRota) break;
    usar(r.id, "ROTA", `Se vendió mucho: ${r.n} ${r.nunca ? "en el último mes" : "desde el último conteo"}`);
  }

  // 3. Quietos: con stock y sin ventas hace días, el que hace más que no se cuenta primero.
  const quietos = vars
    .filter((id) => !reciente(id) && (hay.get(id) ?? 0) > 0)
    .filter((id) => (ultimaVenta.get(id) ?? "") < hace(DIAS_QUIETO))
    .sort((a, b) => (ultimoConteo.get(a) ?? "").localeCompare(ultimoConteo.get(b) ?? ""));
  const topeQuieto = elegidas.length + Math.ceil(cuantos * 0.2);
  for (const id of quietos) {
    if (elegidas.length >= topeQuieto) break;
    const u = ultimaVenta.get(id);
    const dias = u ? Math.floor((ahora.getTime() - new Date(u).getTime()) / 86400000) : null;
    usar(id, "QUIETO", dias != null ? `Hace ${dias} días que no se vende` : "No se vendió en el último mes");
  }

  // 4. Nunca contados (o lo más viejo), para completar.
  const resto = vars
    .filter((id) => !reciente(id))
    .sort((a, b) => (ultimoConteo.get(a) ?? "").localeCompare(ultimoConteo.get(b) ?? ""));
  for (const id of resto) {
    if (elegidas.length >= cuantos) break;
    usar(id, "NUNCA", ultimoConteo.has(id) ? "Hace mucho que no se cuenta" : "Nunca se contó");
  }
  return elegidas;
}

/**
 * La tanda que le toca a la persona: la que dejó sin terminar, o una nueva si
 * hoy todavía no tuvo. Se reparte con los que están adentro en ese momento.
 * null = no está vinculada a un local o las tablas no existen todavía.
 */
export async function asegurarConteo(supabase: SupabaseClient, idUsuario: string): Promise<{ idConteo: string } | { error: string } | null> {
  const persona = await personaDeUsuario(supabase, idUsuario);
  if (!persona?.id_local) return null;
  const hoy = fechaHoraArgentina().fecha;

  const { data: suyos, error } = await supabase
    .from("conteos_stock")
    .select("id_conteo, estado, fecha")
    .eq("id_persona", persona.id_persona)
    .order("creado_en", { ascending: false })
    .limit(5);
  if (error) return null; // sin sql/conteos-stock.sql
  const abierto = (suyos ?? []).find((c) => c.estado === "ABIERTO");
  if (abierto) return { idConteo: abierto.id_conteo as string };
  // Ya firmó la de hoy: no hay otra hasta mañana.
  if ((suyos ?? []).some((c) => c.fecha === hoy)) return null;

  const adentro = await adentroEnLocal(supabase, persona.id_local);
  if (!adentro.some((p) => p.id_persona === persona.id_persona)) return { error: "Fichá la entrada para que te toque el conteo del turno." };
  const cuantos = Math.max(1, Math.ceil(POR_TURNO / Math.max(1, adentro.length)));

  const elegidos = await elegirProductos(supabase, persona.id_local, persona, cuantos);
  if (elegidos.length === 0) return null;

  const { data: nuevo, error: e2 } = await supabase
    .from("conteos_stock")
    .insert({ id_local: persona.id_local, id_persona: persona.id_persona, id_usuario: idUsuario, nombre: nombreDe(persona), fecha: hoy })
    .select("id_conteo")
    .single();
  if (e2 || !nuevo) return { error: "No se pudo armar el conteo. Probá de nuevo." };
  await supabase.from("conteos_stock_items").insert(
    elegidos.map((e, i) => ({ id_conteo: nuevo.id_conteo, id_variante: e.idVariante, motivo: e.motivo, detalle_motivo: e.detalle, orden: i }))
  );
  return { idConteo: nuevo.id_conteo as string };
}

/** El nombre de cada variante como se ve en la góndola. */
async function nombresDeVariantes(supabase: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return new Map<string, { nombre: string; idProducto: string; codigo: string | null }>();
  const { data: vars } = await supabase.from("variantes_producto").select("id_variante, id_producto, nombre, codigo_barras").in("id_variante", ids);
  const idsProd = [...new Set((vars ?? []).map((v) => v.id_producto as string))];
  const { data: prods } = await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProd);
  const nombreProd = new Map((prods ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
  return new Map(
    (vars ?? []).map((v) => {
      const base = nombreProd.get(v.id_producto as string) ?? "Producto";
      const sabor = v.nombre && v.nombre !== "Único" ? ` — ${v.nombre}` : "";
      return [v.id_variante as string, { nombre: base + sabor, idProducto: v.id_producto as string, codigo: (v.codigo_barras as string | null) ?? null }];
    })
  );
}

/** El conteo listo para la pantalla del operativo. */
export async function verConteo(
  supabase: SupabaseClient,
  idConteo: string,
  lugarDe: (idProducto: string) => string | null
): Promise<ConteoVista | null> {
  const { data: c } = await supabase.from("conteos_stock").select("id_conteo, id_local, id_persona, fecha, estado").eq("id_conteo", idConteo).maybeSingle();
  if (!c) return null;
  const { data: items } = await supabase.from("conteos_stock_items").select("*").eq("id_conteo", idConteo).order("orden", { ascending: true });
  const nombres = await nombresDeVariantes(supabase, (items ?? []).map((i) => i.id_variante as string));

  // Con quién se repartió: los otros conteos del mismo día y local.
  const { data: otros } = await supabase
    .from("conteos_stock")
    .select("id_conteo, nombre, conteos_stock_items(id_item)")
    .eq("id_local", c.id_local as string)
    .eq("fecha", c.fecha as string)
    .neq("id_conteo", idConteo);

  return {
    idConteo,
    fecha: c.fecha as string,
    estado: c.estado as "ABIERTO" | "FIRMADO",
    deAntes: (c.fecha as string) < fechaHoraArgentina().fecha,
    companeros: (otros ?? []).map((o) => ({
      nombre: (o.nombre as string) ?? "Otra persona",
      cuantos: ((o.conteos_stock_items as unknown[]) ?? []).length,
    })),
    items: (items ?? []).map((i) => {
      const n = nombres.get(i.id_variante as string);
      return {
        idItem: i.id_item as string,
        idVariante: i.id_variante as string,
        producto: n?.nombre ?? "Producto",
        donde: n ? lugarDe(n.idProducto) : null,
        codigo: n?.codigo ?? null,
        motivo: i.motivo as MotivoConteo,
        detalleMotivo: (i.detalle_motivo as string | null) ?? null,
        contado: (i.contado as number | null) ?? null,
        primerConteo: (i.primer_conteo as number | null) ?? null,
        resultado: (i.resultado as "OK" | "DIFERENCIA" | null) ?? null,
        contadoEn: (i.contado_en as string | null) ?? null,
      };
    }),
  };
}

/**
 * Las variantes que alguien tiene que contar y todavía no contó. En «Precio y
 * stock» esas no muestran el número (si lo ven, lo copian): solo Hay / Quedan
 * pocos / No hay. Apenas se cuentan, vuelve el número.
 */
export async function variantesEnConteo(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("conteos_stock_items")
    .select("id_variante, conteos_stock!inner(estado)")
    .eq("conteos_stock.estado", "ABIERTO")
    .is("contado_en", null);
  if (error) return new Set();
  return new Set((data ?? []).map((d) => d.id_variante as string));
}
