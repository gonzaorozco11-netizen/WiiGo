"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionMarca } from "@/lib/marcaSesion";
import {
  obtenerPolitica,
  validarPrecio,
  validarDescripcion,
  validarDescuento,
  validarProductoNuevo,
  validarBaja,
  ETIQUETA_TIPO,
  type TipoSolicitud,
  type Validacion,
} from "@/lib/solicitudesMarca";

// Portal de marcas — el lado que pide.
//
// Regla de oro del módulo: **la marca nunca escribe en `productos`**. Todo lo
// que manda entra como una solicitud y espera aprobación. Es lo que permite
// darles acceso sin que un error de tipeo de un tercero cambie un precio de
// góndola.
//
// Segunda regla: el id de marca sale SIEMPRE de la sesión, nunca de lo que
// mande el navegador — y cada producto se verifica contra esa marca antes de
// tocarlo. Si no, cambiando un id una marca pediría cambios sobre productos
// de otra.

async function sesionOError() {
  const sesion = await obtenerSesionMarca();
  if (!sesion) throw new Error("Sesión no válida");
  return sesion;
}

/** Trae el producto solo si es de la marca logueada. Null si no lo es. */
async function productoPropio(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  idProducto: string,
  idMarca: string
) {
  const { data } = await supabase
    .from("productos")
    .select("id_producto, id_marca, nombre, descripcion, precio_venta, estado")
    .eq("id_producto", idProducto)
    .eq("id_marca", idMarca)
    .maybeSingle();
  return data ?? null;
}

/** ¿Ya hay algo del mismo tipo esperando para este producto? */
async function yaHayPendiente(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  idMarca: string,
  tipo: TipoSolicitud,
  idProducto: string | null
): Promise<boolean> {
  let consulta = supabase
    .from("solicitudes_marca")
    .select("id_solicitud", { count: "exact", head: true })
    .eq("id_marca", idMarca)
    .eq("tipo", tipo)
    .eq("estado", "PENDIENTE");
  consulta = idProducto ? consulta.eq("id_producto", idProducto) : consulta.is("id_producto", null);
  const { count } = await consulta;
  return (count ?? 0) > 0;
}

type Resultado = { error: string | null; aviso?: string };

/** Crea la solicitud. Un solo lugar para insertar, así ninguna se guarda distinto. */
async function crear(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  campos: {
    idMarca: string;
    idUsuario: string;
    tipo: TipoSolicitud;
    idProducto: string | null;
    datos: Record<string, unknown>;
    datosAnteriores: Record<string, unknown>;
    validacion: Validacion;
  }
): Promise<Resultado> {
  const { error } = await supabase.from("solicitudes_marca").insert({
    id_marca: campos.idMarca,
    tipo: campos.tipo,
    id_producto: campos.idProducto,
    estado: "PENDIENTE",
    datos: campos.datos,
    datos_anteriores: campos.datosAnteriores,
    alertas: campos.validacion.alertas,
    solicitada_por: campos.idUsuario,
  });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/portal/cambios");
  revalidatePath("/aprobaciones");
  return { error: null, aviso: campos.validacion.alertas.avisoParaLaMarca };
}

// ===================== LO QUE VE LA MARCA =====================

export type ProductoPropio = {
  idProducto: string;
  nombre: string;
  descripcion: string | null;
  precio: number | null;
  stock: number;
  /** Tipos que ya tienen una solicitud esperando: se deshabilitan en pantalla. */
  esperando: TipoSolicitud[];
};

export async function misProductos(): Promise<ProductoPropio[]> {
  const sesion = await sesionOError();
  const supabase = getSupabaseServerClient();

  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre, descripcion, precio_venta")
    .eq("id_marca", sesion.idMarca)
    .eq("estado", "ACTIVO")
    .order("nombre", { ascending: true });

  if (!productos || productos.length === 0) return [];
  const ids = productos.map((p) => p.id_producto as string);

  // El stock se suma por variante: la baja de un producto no se puede pedir
  // con mercadería todavía en góndola.
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto")
    .in("id_producto", ids);
  const productoDeVariante = new Map(
    (variantes ?? []).map((v) => [v.id_variante as string, v.id_producto as string])
  );

  const stockPorProducto = new Map<string, number>();
  if (productoDeVariante.size > 0) {
    const { data: stock } = await supabase
      .from("stock")
      .select("id_variante, cantidad")
      .in("id_variante", [...productoDeVariante.keys()]);
    (stock ?? []).forEach((s) => {
      const idProducto = productoDeVariante.get(s.id_variante as string);
      if (!idProducto) return;
      stockPorProducto.set(idProducto, (stockPorProducto.get(idProducto) ?? 0) + ((s.cantidad as number) ?? 0));
    });
  }

  const { data: pendientes } = await supabase
    .from("solicitudes_marca")
    .select("tipo, id_producto")
    .eq("id_marca", sesion.idMarca)
    .eq("estado", "PENDIENTE")
    .in("id_producto", ids);
  const esperandoPorProducto = new Map<string, TipoSolicitud[]>();
  (pendientes ?? []).forEach((s) => {
    const id = s.id_producto as string;
    esperandoPorProducto.set(id, [...(esperandoPorProducto.get(id) ?? []), s.tipo as TipoSolicitud]);
  });

  return productos.map((p) => ({
    idProducto: p.id_producto as string,
    nombre: p.nombre as string,
    descripcion: (p.descripcion as string | null) ?? null,
    precio: (p.precio_venta as number | null) ?? null,
    stock: stockPorProducto.get(p.id_producto as string) ?? 0,
    esperando: esperandoPorProducto.get(p.id_producto as string) ?? [],
  }));
}

export type SolicitudPropia = {
  idSolicitud: string;
  tipo: TipoSolicitud;
  tipoEtiqueta: string;
  producto: string | null;
  estado: string;
  datos: Record<string, unknown>;
  datosAnteriores: Record<string, unknown>;
  motivo: string | null;
  solicitadaEl: string;
  vigenciaDesde: string | null;
  /** Marcado por la política: se lo lleva el dueño, no administración. */
  escalada: boolean;
};

/** Todo lo que mandó esta marca, lo último arriba. */
export async function misSolicitudes(): Promise<SolicitudPropia[]> {
  const sesion = await sesionOError();
  const supabase = getSupabaseServerClient();

  const { data } = await supabase
    .from("solicitudes_marca")
    .select("*")
    .eq("id_marca", sesion.idMarca)
    .order("solicitada_el", { ascending: false })
    .limit(60);

  if (!data || data.length === 0) return [];

  const ids = [...new Set(data.map((s) => s.id_producto as string).filter(Boolean))];
  const { data: productos } = ids.length
    ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", ids)
    : { data: [] };
  const nombre = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));

  return data.map((s) => {
    const alertas = (s.alertas as Record<string, unknown>) ?? {};
    const datos = (s.datos as Record<string, unknown>) ?? {};
    return {
      idSolicitud: s.id_solicitud as string,
      tipo: s.tipo as TipoSolicitud,
      tipoEtiqueta: ETIQUETA_TIPO[s.tipo as TipoSolicitud] ?? (s.tipo as string),
      // Un producto nuevo todavía no existe en la tabla: el nombre está en los datos.
      producto: s.id_producto ? nombre.get(s.id_producto as string) ?? "—" : (datos.nombre as string) ?? null,
      estado: s.estado as string,
      datos,
      datosAnteriores: (s.datos_anteriores as Record<string, unknown>) ?? {},
      motivo: (s.motivo as string | null) ?? null,
      solicitadaEl: s.solicitada_el as string,
      vigenciaDesde: (s.vigencia_desde as string | null) ?? null,
      escalada: alertas.escalaADuenio === true,
    };
  });
}

// ===================== LO QUE PIDE LA MARCA =====================

export async function pedirCambioPrecio(idProducto: string, precio: number): Promise<Resultado> {
  const sesion = await sesionOError();
  const supabase = getSupabaseServerClient();

  const producto = await productoPropio(supabase, idProducto, sesion.idMarca);
  if (!producto) return { error: "Ese producto no es tuyo." };

  const actual = (producto.precio_venta as number | null) ?? null;
  if (actual !== null && Number(precio) === actual) {
    return { error: "Ese ya es el precio que tiene el producto." };
  }
  if (await yaHayPendiente(supabase, sesion.idMarca, "PRECIO", idProducto)) {
    return { error: "Ya mandaste un cambio de precio para este producto y todavía está esperando respuesta." };
  }

  const politica = await obtenerPolitica(supabase);
  const validacion = validarPrecio(precio, actual, politica);
  if (validacion.frena) return { error: validacion.frena };

  return crear(supabase, {
    idMarca: sesion.idMarca,
    idUsuario: sesion.idUsuario,
    tipo: "PRECIO",
    idProducto,
    datos: { precio },
    datosAnteriores: { precio: actual },
    validacion,
  });
}

export async function pedirCambioTexto(
  idProducto: string,
  tipo: "NOMBRE" | "DESCRIPCION",
  texto: string
): Promise<Resultado> {
  const sesion = await sesionOError();
  const supabase = getSupabaseServerClient();

  const producto = await productoPropio(supabase, idProducto, sesion.idMarca);
  if (!producto) return { error: "Ese producto no es tuyo." };

  const limpio = texto.trim();
  if (!limpio) return { error: tipo === "NOMBRE" ? "Escribí el nombre nuevo." : "Escribí la descripción." };

  const campo = tipo === "NOMBRE" ? "nombre" : "descripcion";
  const anterior = (producto[campo] as string | null) ?? null;
  if ((anterior ?? "").trim() === limpio) return { error: "El texto es igual al que ya tiene." };

  if (await yaHayPendiente(supabase, sesion.idMarca, tipo, idProducto)) {
    return { error: "Ya mandaste un cambio de ese tipo para este producto y todavía está esperando respuesta." };
  }

  const validacion = tipo === "DESCRIPCION" ? validarDescripcion(limpio) : { frena: null, alertas: {} };
  if (validacion.frena) return { error: validacion.frena };

  return crear(supabase, {
    idMarca: sesion.idMarca,
    idUsuario: sesion.idUsuario,
    tipo,
    idProducto,
    datos: { [campo]: limpio },
    datosAnteriores: { [campo]: anterior },
    validacion,
  });
}

export async function pedirPromo(
  idProducto: string,
  porcentaje: number,
  desde: string,
  hasta: string
): Promise<Resultado> {
  const sesion = await sesionOError();
  const supabase = getSupabaseServerClient();

  const producto = await productoPropio(supabase, idProducto, sesion.idMarca);
  if (!producto) return { error: "Ese producto no es tuyo." };
  if (!desde || !hasta) return { error: "Poné desde y hasta cuándo va la promo." };

  if (await yaHayPendiente(supabase, sesion.idMarca, "DESCUENTO", idProducto)) {
    return { error: "Ya propusiste una promo para este producto y todavía está esperando respuesta." };
  }

  const politica = await obtenerPolitica(supabase);

  const { data: marca } = await supabase
    .from("marcas")
    .select("royalty_porcentaje")
    .eq("id_marca", sesion.idMarca)
    .maybeSingle();

  // Cuántas promos tiene la marca activas o esperando, y hace cuánto fue la
  // última de este producto: las dos cosas las limita la política.
  const { data: promos } = await supabase
    .from("solicitudes_marca")
    .select("id_producto, solicitada_el, estado")
    .eq("id_marca", sesion.idMarca)
    .eq("tipo", "DESCUENTO")
    .in("estado", ["PENDIENTE", "APROBADA", "APLICADA"])
    .order("solicitada_el", { ascending: false })
    .limit(100);

  const productosEnPromo = new Set((promos ?? []).map((p) => p.id_producto as string)).size;
  const ultima = (promos ?? []).find((p) => p.id_producto === idProducto);
  const diasDesdeUltima = ultima
    ? Math.floor((Date.now() - new Date(ultima.solicitada_el as string).getTime()) / 86400000)
    : null;

  const validacion = validarDescuento(
    {
      porcentaje,
      desde,
      hasta,
      royaltyMarca: (marca?.royalty_porcentaje as number) ?? 0,
      productosEnPromo,
      diasDesdeUltimaPromo: diasDesdeUltima,
    },
    politica
  );
  if (validacion.frena) return { error: validacion.frena };

  const precio = (producto.precio_venta as number | null) ?? null;
  return crear(supabase, {
    idMarca: sesion.idMarca,
    idUsuario: sesion.idUsuario,
    tipo: "DESCUENTO",
    idProducto,
    datos: {
      porcentaje,
      desde,
      hasta,
      precio: precio !== null ? Math.round(precio * (1 - porcentaje / 100) * 100) / 100 : null,
    },
    datosAnteriores: { precio },
    validacion,
  });
}

export async function pedirProductoNuevo(datos: {
  nombre: string;
  precio: number;
  costo: number;
  descripcion?: string;
}): Promise<Resultado> {
  const sesion = await sesionOError();
  const supabase = getSupabaseServerClient();

  // Se compara contra los nombres que ya tiene la marca para que no entren dos
  // veces el mismo producto escrito distinto.
  const { data: existentes } = await supabase
    .from("productos")
    .select("nombre")
    .eq("id_marca", sesion.idMarca);

  const validacion = validarProductoNuevo({
    nombre: datos.nombre,
    precio: datos.precio,
    costo: datos.costo,
    nombresExistentes: (existentes ?? []).map((p) => p.nombre as string),
  });
  if (validacion.frena) return { error: validacion.frena };

  const descripcion = (datos.descripcion ?? "").trim();
  if (descripcion) {
    const v = validarDescripcion(descripcion);
    if (v.frena) return { error: v.frena };
  }

  return crear(supabase, {
    idMarca: sesion.idMarca,
    idUsuario: sesion.idUsuario,
    tipo: "PRODUCTO_NUEVO",
    idProducto: null,
    datos: {
      nombre: datos.nombre.trim(),
      precio: datos.precio,
      costo: datos.costo,
      descripcion: descripcion || null,
    },
    datosAnteriores: {},
    validacion,
  });
}

export async function pedirBaja(idProducto: string): Promise<Resultado> {
  const sesion = await sesionOError();
  const supabase = getSupabaseServerClient();

  const producto = await productoPropio(supabase, idProducto, sesion.idMarca);
  if (!producto) return { error: "Ese producto no es tuyo." };

  if (await yaHayPendiente(supabase, sesion.idMarca, "BAJA_PRODUCTO", idProducto)) {
    return { error: "Ya pediste la baja de este producto y todavía está esperando respuesta." };
  }

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante")
    .eq("id_producto", idProducto);
  const ids = (variantes ?? []).map((v) => v.id_variante as string);

  let stock = 0;
  if (ids.length > 0) {
    const { data } = await supabase.from("stock").select("cantidad").in("id_variante", ids);
    stock = (data ?? []).reduce((t, s) => t + ((s.cantidad as number) ?? 0), 0);
  }

  const validacion = validarBaja(stock);
  if (validacion.frena) return { error: validacion.frena };

  return crear(supabase, {
    idMarca: sesion.idMarca,
    idUsuario: sesion.idUsuario,
    tipo: "BAJA_PRODUCTO",
    idProducto,
    datos: { estado: "INACTIVO" },
    datosAnteriores: { estado: producto.estado ?? "ACTIVO" },
    validacion,
  });
}

/**
 * La marca se arrepiente antes de que lo miren.
 *
 * Existe para que un error no obligue a escribirle a nadie: mientras esté
 * PENDIENTE se cancela y se manda de nuevo bien. Una vez resuelta, no.
 */
export async function cancelarSolicitud(idSolicitud: string): Promise<{ error: string | null }> {
  const sesion = await sesionOError();
  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from("solicitudes_marca")
    .update({ estado: "CANCELADA", resuelta_el: new Date().toISOString() })
    .eq("id_solicitud", idSolicitud)
    // Las dos condiciones importan: que sea de esta marca y que nadie la haya
    // resuelto todavía.
    .eq("id_marca", sesion.idMarca)
    .eq("estado", "PENDIENTE");

  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/portal/cambios");
  revalidatePath("/aprobaciones");
  return { error: null };
}
