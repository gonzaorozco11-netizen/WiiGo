import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";

// Reglas de la bandeja de aprobaciones del portal de marcas.
//
// Todo lo que decide "esto pasa / esto se frena / esto va marcado en rojo"
// vive acá y en ningún otro lado. La misma solicitud tiene que validarse
// igual venga del portal de la marca, del importador de Excel o de una
// pantalla interna — si cada entrada tuviera su propia validación, tarde o
// temprano una dejaría pasar algo que la otra frena.

export type TipoSolicitud =
  | "PRECIO"
  | "COSTO"
  | "FOTO"
  | "DESCRIPCION"
  | "NOMBRE"
  | "SUBCATEGORIA"
  | "PRODUCTO_NUEVO"
  | "BAJA_PRODUCTO"
  | "DESCUENTO"
  | "IMPORTACION";

export type EstadoSolicitud = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "APLICADA" | "CANCELADA";

/** Etiquetas para pantalla — un solo lugar, así no se escriben distinto en cada una. */
export const ETIQUETA_TIPO: Record<TipoSolicitud, string> = {
  PRECIO: "Cambio de precio",
  COSTO: "Costo",
  FOTO: "Cambio de foto",
  DESCRIPCION: "Descripción",
  NOMBRE: "Cambio de nombre",
  SUBCATEGORIA: "Subcategoría",
  PRODUCTO_NUEVO: "Producto nuevo",
  BAJA_PRODUCTO: "Baja de producto",
  DESCUENTO: "Descuento",
  IMPORTACION: "Lista de precios",
};

// Las solicitudes se agrupan por el tipo de decisión que hay que tomar, no
// por tipo técnico. Revisar un precio y revisar una foto son dos cabezas
// distintas; separarlas evita el error de aprobar en piloto automático.
//
// A propósito son cuatro y no una por tipo: con ocho pestañas, alguna
// quedaría sin abrir y ahí es donde algo se olvida.
export type GrupoBandeja = "PRECIOS" | "DESCUENTOS" | "PRODUCTOS" | "CONTENIDO";

export const GRUPO_DE_TIPO: Record<TipoSolicitud, GrupoBandeja> = {
  PRECIO: "PRECIOS",
  IMPORTACION: "PRECIOS",
  DESCUENTO: "DESCUENTOS",
  PRODUCTO_NUEVO: "PRODUCTOS",
  BAJA_PRODUCTO: "PRODUCTOS",
  SUBCATEGORIA: "PRODUCTOS",
  DESCRIPCION: "CONTENIDO",
  NOMBRE: "CONTENIDO",
  FOTO: "CONTENIDO",
  // El costo no pasa por aprobación (es dato privado de la marca), pero el
  // tipo existe para poder registrarlo en el historial.
  COSTO: "CONTENIDO",
};

export const ETIQUETA_GRUPO: Record<GrupoBandeja, string> = {
  PRECIOS: "Precios",
  DESCUENTOS: "Descuentos",
  PRODUCTOS: "Altas y bajas",
  CONTENIDO: "Contenido",
};

export type PoliticaDescuentos = {
  maxSinConsulta: number;
  comisionMinima: number;
  duracionMaxDias: number;
  maxProductosPorMarca: number;
  diasEntrePromos: number;
  variacionPrecioAlerta: number;
  horaAplicacion: string;
};

export async function obtenerPolitica(supabase: SupabaseClient): Promise<PoliticaDescuentos> {
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [
      "DESCUENTO_MAX_SIN_CONSULTA",
      "DESCUENTO_COMISION_MINIMA",
      "DESCUENTO_DURACION_MAX_DIAS",
      "DESCUENTO_MAX_PRODUCTOS_MARCA",
      "DESCUENTO_DIAS_ENTRE_PROMOS",
      "PRECIO_VARIACION_ALERTA",
      "ETIQUETA_HORA_APLICACION",
    ]);
  const m = new Map((data ?? []).map((r) => [r.parametro as string, r.valor as string]));
  const num = (clave: string, porDefecto: number) => {
    const v = Number(m.get(clave));
    return Number.isFinite(v) && v > 0 ? v : porDefecto;
  };

  return {
    maxSinConsulta: num("DESCUENTO_MAX_SIN_CONSULTA", 25),
    comisionMinima: num("DESCUENTO_COMISION_MINIMA", 10),
    duracionMaxDias: num("DESCUENTO_DURACION_MAX_DIAS", 15),
    maxProductosPorMarca: num("DESCUENTO_MAX_PRODUCTOS_MARCA", 5),
    diasEntrePromos: num("DESCUENTO_DIAS_ENTRE_PROMOS", 30),
    variacionPrecioAlerta: num("PRECIO_VARIACION_ALERTA", 30),
    horaAplicacion: m.get("ETIQUETA_HORA_APLICACION") || "23:00",
  };
}

/** Lo que devuelve validar: o frena, o pasa (con o sin marcas rojas). */
export type Validacion = {
  /** Si viene, la solicitud no se crea y este es el texto que ve la marca. */
  frena: string | null;
  /** Marcas para que quien aprueba vea de una qué mirar. */
  alertas: {
    variacionPct?: number;
    escalaADuenio?: boolean;
    motivoEscala?: string;
    avisoParaLaMarca?: string;
  };
};

function sinAlertas(): Validacion {
  return { frena: null, alertas: {} };
}

/**
 * Cambio de precio.
 *
 * Frena solo lo imposible (precio en cero o negativo). Un salto grande no se
 * frena: se marca. Un aumento del 900% casi siempre es un cero de más al
 * tipear, pero a veces es real — quien decide es la persona, no la regla.
 */
export function validarPrecio(precioNuevo: number, precioActual: number | null, politica: PoliticaDescuentos): Validacion {
  if (!Number.isFinite(precioNuevo) || precioNuevo <= 0) {
    return { frena: "El precio tiene que ser mayor a cero.", alertas: {} };
  }

  const v = sinAlertas();
  if (precioActual && precioActual > 0) {
    const variacion = ((precioNuevo - precioActual) / precioActual) * 100;
    if (Math.abs(variacion) >= politica.variacionPrecioAlerta) {
      v.alertas.variacionPct = Math.round(variacion);
    }
  }
  return v;
}

/**
 * Producto nuevo. El costo es obligatorio: sin él la marca no puede ver su
 * ganancia desde la primera venta, que es el número por el que entra al portal.
 */
export function validarProductoNuevo(datos: {
  nombre: string;
  precio: number;
  costo: number | null;
  nombresExistentes: string[];
}): Validacion {
  const nombre = datos.nombre.trim();
  if (!nombre) return { frena: "Poné un nombre para el producto.", alertas: {} };

  const normalizado = nombre.toLowerCase();
  if (datos.nombresExistentes.some((n) => n.trim().toLowerCase() === normalizado)) {
    return { frena: `Ya tenés un producto que se llama "${nombre}".`, alertas: {} };
  }
  if (!Number.isFinite(datos.precio) || datos.precio <= 0) {
    return { frena: "El precio tiene que ser mayor a cero.", alertas: {} };
  }
  if (datos.costo === null || !Number.isFinite(datos.costo) || datos.costo <= 0) {
    return { frena: "Cargá el costo del producto: es lo que te permite ver tu ganancia.", alertas: {} };
  }

  const v = sinAlertas();
  // No frena: es su negocio, no el nuestro. Pero puede ser un error de tipeo.
  if (datos.costo >= datos.precio) {
    v.alertas.avisoParaLaMarca = "Con ese precio y ese costo, perdés plata en cada venta. Revisalo.";
  }
  return v;
}

/**
 * Descuento. Acá está el corazón de "el dueño no aprueba caso por caso":
 * la política decide sola si administración puede resolverlo.
 *
 * El límite que importa no es el porcentaje del descuento sino **con cuánta
 * comisión queda WiiGo**: un 30% sobre un producto de royalty alto no es lo
 * mismo que sobre uno de royalty bajo.
 */
export function validarDescuento(
  datos: {
    porcentaje: number;
    desde: string;
    hasta: string;
    royaltyMarca: number;
    productosEnPromo: number;
    diasDesdeUltimaPromo: number | null;
  },
  politica: PoliticaDescuentos
): Validacion {
  if (!Number.isFinite(datos.porcentaje) || datos.porcentaje <= 0 || datos.porcentaje >= 100) {
    return { frena: "El descuento tiene que estar entre 1% y 99%.", alertas: {} };
  }
  if (datos.hasta < datos.desde) {
    return { frena: "La fecha de fin no puede ser anterior a la de inicio.", alertas: {} };
  }

  const dias = Math.round(
    (new Date(`${datos.hasta}T12:00:00Z`).getTime() - new Date(`${datos.desde}T12:00:00Z`).getTime()) / 86400000
  ) + 1;
  if (dias > politica.duracionMaxDias) {
    return { frena: `Las promos pueden durar hasta ${politica.duracionMaxDias} días.`, alertas: {} };
  }
  if (datos.productosEnPromo >= politica.maxProductosPorMarca) {
    return {
      frena: `Ya tenés ${datos.productosEnPromo} productos en promo. El máximo es ${politica.maxProductosPorMarca}.`,
      alertas: {},
    };
  }
  if (datos.diasDesdeUltimaPromo !== null && datos.diasDesdeUltimaPromo < politica.diasEntrePromos) {
    const faltan = politica.diasEntrePromos - datos.diasDesdeUltimaPromo;
    return { frena: `Este producto estuvo en promo hace poco. Podés volver a proponerla en ${faltan} días.`, alertas: {} };
  }

  const v = sinAlertas();

  // Con cuánto queda WiiGo después del descuento. El royalty se cobra sobre
  // el precio final, así que un descuento lo baja en la misma proporción.
  const comisionResultante = datos.royaltyMarca * (1 - datos.porcentaje / 100);
  if (comisionResultante < politica.comisionMinima) {
    v.alertas.escalaADuenio = true;
    v.alertas.motivoEscala =
      `Con este descuento la comisión de WiiGo queda en ${comisionResultante.toFixed(1)}%, ` +
      `por debajo del mínimo de ${politica.comisionMinima}%.`;
  } else if (datos.porcentaje > politica.maxSinConsulta) {
    v.alertas.escalaADuenio = true;
    v.alertas.motivoEscala = `El descuento supera el ${politica.maxSinConsulta}% que puede aprobar administración.`;
  }

  return v;
}

/** Descripción: se frena si no entra en la pantalla del tótem. */
const LARGO_MAX_DESCRIPCION = 280;

export function validarDescripcion(texto: string): Validacion {
  if (texto.trim().length > LARGO_MAX_DESCRIPCION) {
    return {
      frena: `La descripción no puede pasar de ${LARGO_MAX_DESCRIPCION} caracteres: en el tótem se cortaría.`,
      alertas: {},
    };
  }
  return sinAlertas();
}

export function validarSubcategoria(nombre: string, existentes: string[]): Validacion {
  const limpio = nombre.trim();
  if (!limpio) return { frena: "Poné un nombre para la subcategoría.", alertas: {} };
  if (existentes.some((n) => n.trim().toLowerCase() === limpio.toLowerCase())) {
    return { frena: `Ya tenés una subcategoría que se llama "${limpio}".`, alertas: {} };
  }
  return sinAlertas();
}

export function validarBaja(stockActual: number): Validacion {
  if (stockActual > 0) {
    return {
      frena: `Todavía hay ${stockActual} unidades en góndola. Primero hay que retirar la mercadería.`,
      alertas: {},
    };
  }
  return sinAlertas();
}

/**
 * Cuándo entra en vigencia un cambio de precio aprobado.
 *
 * Con el local cerrado, nunca a mitad del día de venta: las etiquetas se
 * cambian al cierre y el sistema entra después. Así no existe el momento en
 * que el cartel diga una cosa y el POS cobre otra.
 *
 * Si ya pasó la hora de hoy, va a la de mañana.
 */
export function proximaVigencia(politica: PoliticaDescuentos): Date {
  const [hh, mm] = politica.horaAplicacion.split(":").map(Number);
  const ahora = fechaHoraArgentina();
  const hoy = new Date(`${ahora.fecha}T00:00:00-03:00`);
  hoy.setHours(hoy.getHours() + (Number.isFinite(hh) ? hh : 23));
  hoy.setMinutes(hoy.getMinutes() + (Number.isFinite(mm) ? mm : 0));

  if (hoy.getTime() <= Date.now()) hoy.setDate(hoy.getDate() + 1);
  return hoy;
}

/** ¿Esta solicitud la puede resolver administración, o escala al dueño? */
export function requiereDuenio(alertas: Validacion["alertas"]): boolean {
  return alertas.escalaADuenio === true;
}
