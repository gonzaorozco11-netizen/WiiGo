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
import { preciosVigentes } from "@/lib/pedidosProfesional";

export const dynamic = "force-dynamic";

// Un pedido de una profesional que se viene a cobrar (botón "Cobrar" de
// Pedidos): los productos, el DNI y el código, y si su precio todavía vale.
async function pedidoParaCobrar(supabase: ReturnType<typeof getSupabaseServerClient>, idPedido: string): Promise<PedidoParaCobrar | null> {
  const { data: p } = await supabase
    .from("pedidos_profesional")
    .select("id_pedido, numero, estado, creado, paciente_nombre, paciente_apellido, paciente_dni, codigo, id_local, id_profesional, pedidos_profesional_items(id_variante, cantidad, precio_lista, precio_efectivo)")
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

export default async function PosPage({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "pos")) return <PantallaBloqueada />;
  const { pedido: idPedido } = await searchParams;

  const supabase = getSupabaseServerClient();
  const pedido = idPedido ? await pedidoParaCobrar(supabase, idPedido).catch(() => null) : null;

  const [localesRes, productosRes, variantesRes, marcasRes, stockRes, configRes] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("productos").select("*").eq("estado", "ACTIVO"),
    supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
    supabase.from("marcas").select("*").eq("estado", "ACTIVA"),
    supabase.from("stock").select("*"),
    supabase.from("configuracion").select("valor").eq("parametro", "IVA_GENERAL_PORCENTAJE").maybeSingle(),
  ]);

  const ivaGeneralPorcentaje = Number(configRes.data?.valor ?? 21);

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
      productos={(productosRes.data ?? []) as Producto[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      stock={(stockRes.data ?? []) as Stock[]}
      ivaGeneralPorcentaje={ivaGeneralPorcentaje}
      pedido={pedido}
      key={pedido?.idPedido ?? "venta"}
    />
  );
}
