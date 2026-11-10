import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ConteoStockApp from "@/components/ConteoStockApp";
import { asegurarConteo, personaDeUsuario, verConteo } from "@/lib/conteoStock";
import { cargarGondola, nombreCortoZona, ubicacionDe, NOMBRE_ALTURA } from "@/lib/gondola";
import { marcasFabricaParaPantalla, conMarca } from "@/lib/marcaFabrica";

export const dynamic = "force-dynamic";

// Contar stock en el turno: los productos que le tocaron a esta persona.
export default async function ConteoPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "conteo") || !sesion) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const persona = await personaDeUsuario(supabase, sesion.idUsuario);
  if (!persona?.id_local) {
    // El dueño no cuenta por turno: ve lo que contó el equipo (Gonzalo, 2026-11-10).
    if (sesion.rol === "admin") {
      return (
        <div className="max-w-md mx-auto text-center py-12">
          <p className="text-2xl mb-2" aria-hidden="true">
            📋
          </p>
          <p className="text-neutral-700">
            Contar stock es para el equipo del local: a cada uno le tocan 10 productos por turno. Lo que contaron y las diferencias las ves en
            Conteos y diferencias.
          </p>
          <Link href="/stock/conteos" className="inline-block mt-4 rounded-xl bg-accent text-white px-4 py-2.5 text-sm font-semibold">
            Ir a Conteos y diferencias →
          </Link>
        </div>
      );
    }
    return <Aviso texto="Tu usuario no está vinculado a una persona con local en Organización. Pedile a Gonzalo que lo vincule." />;
  }

  const r = await asegurarConteo(supabase, sesion.idUsuario);
  if (r && "error" in r) return <Aviso texto={r.error} />;
  if (!r) return <ConteoStockApp conteo={null} />;

  const [gondola, marcas] = await Promise.all([
    cargarGondola(supabase, persona.id_local).catch(() => null),
    marcasFabricaParaPantalla(supabase),
  ]);
  const lugarDe = (idProducto: string) => {
    if (!gondola) return null;
    const u = ubicacionDe(gondola, idProducto);
    if (!u) return null;
    const altura = u.modulo.filas[u.fila]?.altura;
    return `${nombreCortoZona(gondola, u.modulo)}${altura ? ` · ${NOMBRE_ALTURA[altura]}` : ""}`;
  };
  const conteo = await verConteo(supabase, r.idConteo, lugarDe);
  if (conteo) {
    // «(Entre Nuts)» al lado de lo envasado, igual que en el resto de las pantallas.
    const { data: vars } = await supabase
      .from("variantes_producto")
      .select("id_variante, id_producto")
      .in("id_variante", conteo.items.map((i) => i.idVariante));
    const prodDe = new Map((vars ?? []).map((v) => [v.id_variante as string, v.id_producto as string]));
    conteo.items = conteo.items.map((i) => ({ ...i, producto: conMarca(i.producto, marcas[prodDe.get(i.idVariante) ?? ""]) }));
  }
  return <ConteoStockApp conteo={conteo} />;
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="max-w-md mx-auto text-center py-12">
      <p className="text-2xl mb-2" aria-hidden="true">
        📋
      </p>
      <p className="text-neutral-700">{texto}</p>
    </div>
  );
}
