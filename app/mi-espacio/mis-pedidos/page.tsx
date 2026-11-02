import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import type { EstadoPedido } from "@/lib/pedidosProfesional";
import MisPedidos, { type PedidoConItems } from "./MisPedidos";

export const dynamic = "force-dynamic";

// Los pedidos que armó ella, con lo que llevó cada uno. Antes estaban al pie
// de "Armar pedido"; Gonzalo pidió que fueran una solapa aparte (2026-11-02).
//
// Solo los pedidos que armó ella: no lo que el paciente compró solo en el
// local. Eso sería su historial de compras, y para mostrárselo a la
// profesional haría falta el permiso del paciente.
export default async function MisPedidosEspacio() {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) redirect("/login?next=/mi-espacio/mis-pedidos");
  const supabase = getSupabaseServerClient();

  // Con "*": la columna para_profesional puede no estar (sql/profesionales-pedido-propio.sql).
  const { data, error } = await supabase
    .from("pedidos_profesional")
    .select("*, pedidos_profesional_items(nombre, cantidad, precio_lista)")
    .eq("id_profesional", sesion.idProfesional)
    .order("creado", { ascending: false })
    .limit(300);

  const pedidos: PedidoConItems[] = (data ?? []).map((p) => {
    const items = ((p.pedidos_profesional_items as { nombre: string; cantidad: number; precio_lista: number }[] | null) ?? []).map((i) => ({
      nombre: i.nombre,
      cantidad: Number(i.cantidad),
      precio: Number(i.precio_lista),
    }));
    const paraVos = p.para_profesional === true;
    return {
      idPedido: p.id_pedido as string,
      numero: Number(p.numero),
      paciente: paraVos ? "Para vos" : [p.paciente_nombre, p.paciente_apellido].filter(Boolean).join(" "),
      // Para agrupar por paciente: el DNI si está, si no el nombre.
      clavePaciente: paraVos ? "para-vos" : String(p.paciente_dni ?? `${p.paciente_nombre} ${p.paciente_apellido}`).toLowerCase(),
      estado: p.estado as EstadoPedido,
      creado: p.creado as string,
      notaFalta: (p.nota_falta as string | null) ?? null,
      items,
      total: items.reduce((t, i) => t + i.precio * i.cantidad, 0),
    };
  });

  return (
    <main className="esp-lienzo">
      <MisPedidos pedidos={pedidos} disponible={!error} />
    </main>
  );
}
