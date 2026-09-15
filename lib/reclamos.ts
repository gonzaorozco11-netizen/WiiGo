import { getSupabaseServerClient } from "@/lib/supabase";

// Los reclamos a proveedores: plata que te deben y todavía no te devolvieron.
//
// Hay varias formas de que un proveedor te quede debiendo — te facturó de
// más, no mandó lo que ya te había cobrado, le devolviste mercadería — y una
// sola de que te la devuelva: la nota de crédito. Por eso todas terminan en
// la misma lista.
//
// Los reclamos NO se cargan a mano: nacen de lo que ya se hace en Costeo, al
// cerrar un pedido incompleto y al devolver mercadería. Si hubiera que
// acordarse de anotarlos, la mitad se perdería.

export type EstadoReclamo = "PENDIENTE" | "ACREDITADO" | "DESCARTADO";

export type Reclamo = {
  idReclamo: string;
  idProveedor: string;
  proveedor: string;
  idFactura: string | null;
  numeroFactura: string | null;
  idRecepcion: string | null;
  idOrden: string | null;
  neto: number;
  iva: number;
  impuestos: number;
  retenciones: number;
  total: number;
  motivo: string;
  estado: EstadoReclamo;
  fecha: string;
  dias: number;
  /** Cuando ya se acreditó. */
  ncNumero: string | null;
  ncFecha: string | null;
  ncMonto: number | null;
};

function dias(iso: string) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export async function listarReclamos(): Promise<Reclamo[]> {
  const supabase = getSupabaseServerClient();

  const { data } = await supabase
    .from("reclamos_proveedor")
    .select("*")
    .order("fecha", { ascending: false })
    .limit(200);
  const filas = data ?? [];
  if (filas.length === 0) return [];

  const [proveedoresRes, facturasRes, recepcionesRes] = await Promise.all([
    supabase
      .from("proveedores")
      .select("id_proveedor, nombre")
      .in("id_proveedor", Array.from(new Set(filas.map((r) => r.id_proveedor as string)))),
    supabase
      .from("facturas_compra_proveedor")
      .select("id_factura, numero_factura")
      .in(
        "id_factura",
        Array.from(new Set(filas.map((r) => r.id_factura as string | null).filter(Boolean))) as string[]
      ),
    supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, id_orden")
      .in(
        "id_recepcion",
        Array.from(new Set(filas.map((r) => r.id_recepcion as string | null).filter(Boolean))) as string[]
      ),
  ]);

  const nombre = new Map((proveedoresRes.data ?? []).map((p) => [p.id_proveedor as string, p.nombre as string]));
  const factura = new Map(
    (facturasRes.data ?? []).map((f) => [f.id_factura as string, (f.numero_factura as string | null) ?? null])
  );
  const orden = new Map(
    (recepcionesRes.data ?? []).map((r) => [r.id_recepcion as string, (r.id_orden as string | null) ?? null])
  );

  return filas.map((r) => ({
    idReclamo: r.id_reclamo as string,
    idProveedor: r.id_proveedor as string,
    proveedor: nombre.get(r.id_proveedor as string) ?? "Proveedor",
    idFactura: (r.id_factura as string | null) ?? null,
    numeroFactura: r.id_factura ? factura.get(r.id_factura as string) ?? null : null,
    idRecepcion: (r.id_recepcion as string | null) ?? null,
    idOrden: r.id_recepcion ? orden.get(r.id_recepcion as string) ?? null : null,
    neto: (r.neto as number) ?? 0,
    iva: (r.iva as number) ?? 0,
    impuestos: (r.impuestos as number) ?? 0,
    retenciones: (r.retenciones as number) ?? 0,
    total: (r.total as number) ?? 0,
    motivo: (r.motivo as string) ?? "",
    estado: ((r.estado as string) ?? "PENDIENTE") as EstadoReclamo,
    fecha: r.fecha as string,
    dias: dias(r.fecha as string),
    ncNumero: (r.nc_numero as string | null) ?? null,
    ncFecha: (r.nc_fecha as string | null) ?? null,
    ncMonto: (r.nc_monto as number | null) ?? null,
  }));
}
