import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { ambosPrecios } from "@/lib/precios";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import CartelesApp, { type ItemCartel } from "@/components/CartelesApp";
import { cargarMarcasFabrica } from "@/lib/marcaFabrica";
import { ponerPreciosAlDia } from "@/lib/preciosAlDia";
import { productosQueEntraron } from "@/lib/entradas";
import { PARAMETRO_CARTELES_IMPRESOS, cargarImpresos } from "@/lib/codigosImpresos";

export const dynamic = "force-dynamic";

export default async function CartelesPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "carteles")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  // Si ya pasó el cambio de turno, los precios aprobados entran antes de armar los carteles.
  await ponerPreciosAlDia();

  const BASE_PRODUCTO = "id_producto,nombre,id_marca,precio_venta,precio_efectivo,descuento_porcentaje,subcategorias(nombre)";
  const traerProductos = (columnas: string) =>
    supabase.from("productos").select(columnas).eq("estado", "ACTIVO");
  const traerTareas = (columnas: string) =>
    supabase.from("tareas_etiqueta").select(columnas).in("estado", ["PENDIENTE", "VENCIDA"]).limit(500);

  const [productosConPeso, marcasRes, tareasCompletas, fichasRes, lugaresRes, modulosRes, marcasFabrica, entraron, cartelesImpresos] = await Promise.all([
    traerProductos(`${BASE_PRODUCTO},peso_neto_g`),
    supabase.from("marcas").select("id_marca,nombre").eq("estado", "ACTIVA"),
    // Los carteles que quedaron con el precio viejo. La cuenta ya la lleva el
    // circuito de solicitudes de marca; acá solo se lee para poder reimprimir
    // justo esos y no toda la góndola.
    traerTareas("id_tarea,id_producto,precio_anterior,efectivo_anterior,precio_nuevo,efectivo_nuevo,aplicar_al_poner,tipo,vence_el,creada_el"),
    // El país de origen de la ficha del asesor: sale chiquito en el cartel.
    supabase.from("ficha_producto").select("id_producto,origen"),
    // Dónde está cada producto en la góndola: en los ganchos de la pared el
    // portaprecio del blistero es de 65 × 40; en el resto, de 60 × 30 (2026-11-11).
    supabase.from("gondola_lugares").select("id_producto,id_modulo"),
    supabase.from("gondola_modulos").select("id_modulo,tipo"),
    // «(Entre Nuts)» después del nombre y el peso de lo que viene envasado de fábrica (lib/marcaFabrica.ts).
    cargarMarcasFabrica(supabase).catch(() => new Map<string, string>()),
    // Lo que entró en la semana y todavía no tiene su cartel: «Entraron nuevos».
    productosQueEntraron().catch(() => new Map<string, string>()),
    cargarImpresos(supabase, PARAMETRO_CARTELES_IMPRESOS).catch(() => ({}) as Record<string, string>),
  ]);
  const tipoModulo = new Map(((modulosRes.data ?? []) as { id_modulo: string; tipo: string | null }[]).map((m) => [m.id_modulo, m.tipo ?? "MODULO"]));
  const lugarDe = new Map<string, "GANCHO" | "ESTANTE">();
  for (const l of (lugaresRes.data ?? []) as { id_producto: string; id_modulo: string }[]) {
    const tipo = tipoModulo.get(l.id_modulo);
    if (!tipo) continue;
    // Si está en más de un local, con que esté en un gancho alcanza: ese cartel tiene que entrar en el blistero.
    if (tipo === "MODULO") lugarDe.set(l.id_producto, "GANCHO");
    else if (!lugarDe.has(l.id_producto)) lugarDe.set(l.id_producto, "ESTANTE");
  }
  // Sin sql/rotulado.sql corrido, el cartel sale como antes, sin precio por kilo.
  const productosRes = productosConPeso.error ? await traerProductos(BASE_PRODUCTO) : productosConPeso;
  // Sin sql/carteles-precio-al-poner.sql (o sin el del efectivo de antes) se
  // lee lo que haya: el cartel sale con el precio de la caja, como antes.
  let tareasRes = tareasCompletas;
  if (tareasRes.error) tareasRes = await traerTareas("id_tarea,id_producto,precio_anterior,efectivo_anterior,precio_nuevo,tipo,vence_el,creada_el");
  if (tareasRes.error) tareasRes = await traerTareas("id_tarea,id_producto,precio_anterior,precio_nuevo,tipo,vence_el,creada_el");

  const error = productosRes.error || marcasRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los carteles</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  type FilaProducto = {
    id_producto: string;
    nombre: string;
    id_marca: string;
    precio_venta: number | null;
    precio_efectivo: number | null;
    descuento_porcentaje: number | null;
    peso_neto_g?: number | null;
    subcategorias?: { nombre: string | null } | { nombre: string | null }[] | null;
  };
  const subDe = (p: FilaProducto) => (Array.isArray(p.subcategorias) ? p.subcategorias[0] : p.subcategorias)?.nombre ?? null;

  const origenes = new Map(
    ((fichasRes.data ?? []) as { id_producto: string; origen: string | null }[])
      .filter((f) => f.origen?.trim())
      .map((f) => [f.id_producto, (f.origen as string).trim()])
  );

  const marcas = new Map(
    ((marcasRes.data ?? []) as { id_marca: string; nombre: string }[]).map((m) => [m.id_marca, m.nombre])
  );

  // Los que cambiaron de precio y todavía tienen el cartel viejo puesto.
  const ahora = Date.now();
  type Abierta = {
    idTarea: string;
    vencida: boolean;
    tipo: string;
    pedidoEl: string | null;
    antes: { lista: number | null; efectivo: number | null };
    todas: string[];
    /** El precio que espera este cartel para entrar en la caja (marca propia). */
    espera: { lista: number; efectivo: number } | null;
    /** Precio de una marca aprobado para más tarde (las 23:00): hasta esa hora el cartel saldría con el viejo. */
    entraEl: string | null;
  };
  const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const tareas = new Map<string, Abierta>();
  for (const t of (tareasRes.data ?? []) as unknown as {
    id_tarea: string;
    id_producto: string;
    tipo: string;
    vence_el: string;
    creada_el: string | null;
    precio_anterior: number | null;
    efectivo_anterior?: number | null;
    precio_nuevo: number | null;
    efectivo_nuevo?: number | null;
    aplicar_al_poner?: boolean;
  }[]) {
    const nuevo = num(t.precio_nuevo);
    const espera = t.aplicar_al_poner && nuevo ? { lista: nuevo, efectivo: num(t.efectivo_nuevo) ?? nuevo } : null;
    // Si un producto tiene varias tareas abiertas alcanza con reimprimirlo una
    // vez: se queda con la más urgente. La fecha y los precios "de antes" son
    // los del pedido más viejo: es lo que dice el cartel que sigue puesto.
    const vencida = new Date(t.vence_el).getTime() < ahora;
    const entra = !t.aplicar_al_poner && !vencida ? t.vence_el : null;
    const previa = tareas.get(t.id_producto);
    const entraEl = [previa?.entraEl, entra].filter(Boolean).sort().pop() ?? null;
    const masVieja = !previa?.pedidoEl || (t.creada_el != null && t.creada_el < previa.pedidoEl);
    const datosViejos = masVieja
      ? { pedidoEl: t.creada_el ?? previa?.pedidoEl ?? null, antes: { lista: num(t.precio_anterior), efectivo: num(t.efectivo_anterior) } }
      : { pedidoEl: previa!.pedidoEl, antes: previa!.antes };
    // Al poner el cartel nuevo se cierran todas juntas: si quedara una abierta,
    // el producto volvería a aparecer como pendiente.
    const todas = [...(previa?.todas ?? []), t.id_tarea];
    if (!previa || (vencida && !previa.vencida)) {
      tareas.set(t.id_producto, { idTarea: t.id_tarea, vencida, tipo: t.tipo, ...datosViejos, todas, espera: espera ?? previa?.espera ?? null, entraEl });
    } else {
      Object.assign(previa, datosViejos, { todas, espera: espera ?? previa.espera, entraEl });
    }
  }

  const items: ItemCartel[] = ((productosRes.data ?? []) as unknown as FilaProducto[])
    .map((p) => {
      // La cuenta de los dos precios —oferta incluida— vive en lib/precios.ts y
      // la comparten el POS, el tótem y el asesor. Un cartel que diga otra cosa
      // que la caja es peor que no tener cartel.
      // Si el precio espera este cartel para entrar en la caja, el cartel sale
      // con ese: la caja lo cobra apenas lo marcan como puesto.
      const t = tareas.get(p.id_producto);
      const { lista, efectivo } = ambosPrecios(
        {
          precio_venta: t?.espera?.lista ?? p.precio_venta,
          precio_efectivo: t?.espera?.efectivo ?? p.precio_efectivo,
          descuento_porcentaje: p.descuento_porcentaje,
        },
        null
      );
      return {
        idProducto: p.id_producto,
        nombre: p.nombre,
        marca: marcas.get(p.id_marca) ?? null,
        marcaFabrica: marcasFabrica.get(p.id_producto) ?? null,
        subcategoria: subDe(p),
        lista,
        efectivo,
        // Sin precio de efectivo cargado el cartel mentiría a medias, así que
        // esos no se pueden imprimir hasta que la marca lo cargue.
        tienePrecioEfectivo: (t?.espera?.efectivo ?? p.precio_efectivo) != null,
        enOferta: (p.descuento_porcentaje ?? 0) > 0,
        descuento: p.descuento_porcentaje ?? 0,
        idTarea: t?.idTarea ?? null,
        otrasTareas: t ? t.todas.filter((id) => id !== t.idTarea) : [],
        vencida: t?.vencida ?? false,
        pedidoEl: t?.pedidoEl ?? null,
        antes: t?.antes ?? null,
        entraEl: t?.entraEl ?? null,
        // Entró en la semana y no se le imprimió el cartel después de entrar.
        nuevoEl: (() => {
          const entro = entraron.get(p.id_producto);
          const impreso = cartelesImpresos[p.id_producto];
          return entro && !(impreso && impreso >= entro) ? entro : null;
        })(),
        pesoG: p.peso_neto_g && p.peso_neto_g > 0 ? p.peso_neto_g : null,
        origen: origenes.get(p.id_producto) ?? null,
        lugar: lugarDe.get(p.id_producto) ?? null,
      };
    })
    .filter((i) => i.lista > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return <CartelesApp items={items} />;
}
