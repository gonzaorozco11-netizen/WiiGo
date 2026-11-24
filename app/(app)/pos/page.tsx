import {
  getSupabaseServerClient,
  type Local,
  type Marca,
  type Producto,
  type VarianteProducto,
  type Stock,
} from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import PosApp, { type PedidoParaCobrar } from "@/components/PosApp";
import { traerCombos } from "@/lib/combosServidor";
import { preciosVigentes } from "@/lib/pedidosProfesional";
import { COLUMNAS_PEDIDO, cuantosHay, itemsDe, type FilaPedidoOnline } from "@/lib/pedidosOnline";
import { cargarMarcasFabrica, nombresConMarca } from "@/lib/marcaFabrica";
import { ponerPreciosAlDia } from "@/lib/preciosAlDia";
import { CLAVES_POSNET, leerPosnets } from "@/lib/navePosnet";

export const dynamic = "force-dynamic";

// Un pedido de una profesional que se viene a cobrar (botón "Cobrar" de
// Pedidos): los productos, el DNI y el código, y si su precio todavía vale.
// Con "*" porque para_profesional puede no estar todavía.
async function pedidoParaCobrar(supabase: ReturnType<typeof getSupabaseServerClient>, idPedido: string): Promise<PedidoParaCobrar | null> {
  const { data: p } = await supabase
    .from("pedidos_profesional")
    .select("*, pedidos_profesional_items(id_variante, cantidad, precio_lista, precio_efectivo)")
    .eq("id_pedido", idPedido)
    .in("estado", ["NUEVO", "LISTO"])
    .maybeSingle();
  if (!p) return null;
  const { data: prof } = await supabase.from("profesionales").select("nombre, apellido").eq("id_profesional", p.id_profesional).maybeSingle();
  return {
    idPedido: p.id_pedido as string,
    numero: Number(p.numero),
    profesional: prof ? [prof.nombre, prof.apellido].filter(Boolean).join(" ") : "la profesional",
    paciente: `${p.paciente_nombre} ${p.paciente_apellido}`,
    paraProfesional: p.para_profesional === true,
    dni: p.paciente_dni as string,
    codigo: (p.codigo as string | null) ?? null,
    idLocal: (p.id_local as string | null) ?? null,
    preciosVigentes: preciosVigentes(p.creado as string),
    items: ((p.pedidos_profesional_items as Record<string, unknown>[] | null) ?? []).map((i) => ({
      idVariante: i.id_variante as string,
      cantidad: Number(i.cantidad),
      precioLista: Number(i.precio_lista),
      precioEfectivo: Number(i.precio_efectivo),
    })),
  };
}

// Un pedido de la tienda online que se paga al retirar (Pedidos online →
// Entregar → Cobrar en la caja): lo que se encontró, el DNI y sus precios.
// Los precios del pedido valen hasta que vence (el día siguiente a las 21).
async function pedidoOnlineParaCobrar(supabase: ReturnType<typeof getSupabaseServerClient>, idPedido: string): Promise<PedidoParaCobrar | null> {
  const { data } = await supabase.from("pedidos_online").select(COLUMNAS_PEDIDO).eq("id_pedido", idPedido).eq("estado", "LISTO").maybeSingle();
  const p = data as FilaPedidoOnline | null;
  if (!p || p.pago !== "AL_RETIRAR") return null;
  return {
    idPedido: p.id_pedido,
    numero: Number(p.numero),
    profesional: "",
    paciente: p.nombre,
    paraProfesional: false,
    dni: p.dni,
    codigo: null,
    idLocal: p.id_local,
    preciosVigentes: new Date(p.vence).getTime() > Date.now(),
    items: itemsDe(p)
      .filter((i) => cuantosHay(i) > 0)
      .map((i) => ({ idVariante: i.idVariante, cantidad: cuantosHay(i), precioLista: i.precioLista, precioEfectivo: i.precioEfectivo })),
    online: { codigo: p.codigo },
  };
}

export default async function PosPage({ searchParams }: { searchParams: Promise<{ pedido?: string; online?: string }> }) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "pos")) return <PantallaBloqueada />;
  const { pedido: idPedido, online: idOnline } = await searchParams;

  const supabase = getSupabaseServerClient();
  // Pasado el cambio de turno, la caja arranca con los precios nuevos ya aprobados.
  await ponerPreciosAlDia();
  const pedido = idPedido
    ? await pedidoParaCobrar(supabase, idPedido).catch(() => null)
    : idOnline
      ? await pedidoOnlineParaCobrar(supabase, idOnline).catch(() => null)
      : null;

  const [localesRes, productosRes, variantesRes, marcasRes, stockRes, configRes, marcasFabrica, combos] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    // Sin precio todavía (lo pone la marca y lo aprueba WiiGo) no se vende.
    supabase.from("productos").select("*").eq("estado", "ACTIVO").gt("precio_venta", 0),
    supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
    supabase.from("marcas").select("*").eq("estado", "ACTIVA"),
    supabase.from("stock").select("*"),
    supabase.from("configuracion").select("parametro, valor").in("parametro", ["IVA_GENERAL_PORCENTAJE", "MP_ALIAS_TRANSFERENCIA", ...CLAVES_POSNET]),
    // «(Entre Nuts)» después del nombre, igual que lo ve el cliente (lib/marcaFabrica.ts).
    cargarMarcasFabrica(supabase).catch(() => new Map<string, string>()),
    // Los combos: se aplican solos en el carrito (lib/combos.ts).
    traerCombos(supabase),
  ]);

  const config = new Map((configRes.data ?? []).map((c) => [c.parametro as string, c.valor as string | null]));
  const ivaGeneralPorcentaje = Number(config.get("IVA_GENERAL_PORCENTAJE") ?? 21);
  // El alias de Mercado Pago para cobrar por transferencia (Configuración).
  const aliasTransferencia = config.get("MP_ALIAS_TRANSFERENCIA")?.trim() || null;
  // Los posnets de Nave conectados a la caja (lib/navePosnet.ts). Sin ninguno, se marca a mano.
  const posnets = leerPosnets(config).map((p) => ({ numero: p.numero, prueba: p.entorno === "sandbox" }));

  const error = localesRes.error || productosRes.error || variantesRes.error || marcasRes.error || stockRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudo cargar el POS</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  if ((localesRes.data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">Todavía no hay locales cargados</p>
        <p className="text-sm text-neutral-500">Andá a la sección "Locales" y creá al menos uno.</p>
      </div>
    );
  }

  // La key hace que al entrar a un pedido (o salir de uno) la caja arranque de cero.
  return (
    <PosApp
      locales={(localesRes.data ?? []) as Local[]}
      productos={nombresConMarca((productosRes.data ?? []) as Producto[], marcasFabrica)}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      stock={(stockRes.data ?? []) as Stock[]}
      ivaGeneralPorcentaje={ivaGeneralPorcentaje}
      pedido={pedido}
      aliasTransferencia={aliasTransferencia}
      combos={combos}
      posnets={posnets}
      key={pedido?.idPedido ?? "venta"}
    />
  );
}
