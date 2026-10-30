import { Figtree, Fraunces } from "next/font/google";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { ambosPrecios } from "@/lib/precios";
import { todasLasFilas } from "@/lib/competenciaLeer";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ListaPreciosPdf, { type ProductoLista } from "@/components/ListaPreciosPdf";

export const dynamic = "force-dynamic";

// La lista de precios para clientes (Precios → "Lista de precios (PDF)"):
// todo lo que se vende en el local con lo que cobra hoy la caja, oferta
// incluida. Se guarda en PDF con "Imprimir → Guardar como PDF", como los
// carteles y los códigos (Gonzalo, 2026-10-30: la forma 3, "lista con fotos chicas").

const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--f-lista", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], style: ["italic", "normal"], weight: ["500", "600"], variable: "--f-lista-titulo", display: "swap" });

export default async function ListaPreciosPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "precios")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const [{ data: marcas }, { data: subs }, productos] = await Promise.all([
    supabase.from("marcas").select("id_marca, nombre, tipo_comercializacion").eq("estado", "ACTIVA"),
    supabase.from("subcategorias").select("id_subcategoria, nombre"),
    todasLasFilas<Record<string, unknown>>((desde, hasta) =>
      supabase
        .from("productos")
        .select("id_producto, nombre, id_marca, id_subcategoria, precio_venta, precio_efectivo, descuento_porcentaje, imagen")
        .eq("estado", "ACTIVO")
        .gt("precio_venta", 0)
        .order("nombre")
        .range(desde, hasta)
    ),
  ]);
  const marcaPor = new Map((marcas ?? []).map((m) => [m.id_marca as string, m]));
  const rubroPor = new Map((subs ?? []).map((s) => [s.id_subcategoria as string, s.nombre as string]));

  const lista: ProductoLista[] = productos.flatMap((p) => {
    const m = marcaPor.get(p.id_marca as string);
    if (!m) return [];
    const descuento = Number(p.descuento_porcentaje) || 0;
    const precios = ambosPrecios(
      { precio_venta: Number(p.precio_venta), precio_efectivo: p.precio_efectivo == null ? null : Number(p.precio_efectivo), descuento_porcentaje: descuento },
      null
    );
    return [
      {
        id: p.id_producto as string,
        nombre: p.nombre as string,
        idMarca: m.id_marca as string,
        marca: m.nombre as string,
        propia: m.tipo_comercializacion === "PROPIA",
        rubro: (p.id_subcategoria ? rubroPor.get(p.id_subcategoria as string) : null) ?? "Otros",
        lista: precios.lista,
        efectivo: precios.efectivo,
        antes: descuento > 0 ? Number(p.precio_venta) : null,
        descuento,
        imagen: typeof p.imagen === "string" && p.imagen.startsWith("https://") ? p.imagen : null,
      },
    ];
  });

  const hoy = new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long", year: "numeric" });
  return (
    <div className={`${figtree.variable} ${fraunces.variable}`}>
      <ListaPreciosPdf productos={lista} hoy={hoy} />
    </div>
  );
}
