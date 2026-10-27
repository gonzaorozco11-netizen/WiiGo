"use server";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase";
import { precioDe } from "@/lib/precios";
import { obtenerSesionProfesional, registrarActividad } from "@/lib/profesionalSesion";
import { clientePorDni, registrarPaciente } from "@/lib/pacientesProfesional";
import {
  CAMPOS_DATOS,
  CAMPOS_NUMERICOS,
  QUE_HIZO,
  limpiarNombre,
  mismoNombre,
  ordenarPorAnio,
  type CampoDatos,
  type TipoCambio,
  type ItemFormacion,
  type ItemTrayectoria,
  type ItemVideo,
  type ItemFortaleza,
} from "@/lib/cambiosProfesional";
import { leerRedes, mismasRedes, normalizarRedes } from "@/lib/redesProfesional";

// Acciones del espacio de cada profesional.
//
// Regla de este archivo: ninguna función recibe el id de la profesional. Sale
// siempre de la sesión (obtenerSesionProfesional), así una no puede tocar lo
// de otra aunque conozca su id. Y no se importan acá acciones del sistema
// interno: todo lo que este archivo exporta queda al alcance de su usuario.
//
// Lo que sale en la pantalla del local no se guarda directo: queda en
// cambios_profesional hasta que Gonzalo lo aprueba (lib/cambiosProfesional.ts).

type Resultado = { error: string | null };
const SESION_CERRADA = "Tu sesión se cerró. Volvé a entrar.";
const FALTA_SQL = "Todavía no se puede guardar: WiiGo tiene que terminar de prepararlo. Probá más tarde.";

/** La primera vez que entra acepta que WiiGo muestre su foto, textos y matrícula. */
export async function aceptarAutorizacion(): Promise<Resultado> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };
  if (sesion.autorizoImagenAt) return { error: null };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("profesionales")
    .update({ autorizo_imagen_at: new Date().toISOString() })
    .eq("id_profesional", sesion.idProfesional);
  if (error) return { error: "No se pudo guardar. Probá de nuevo en un rato." };

  await registrarActividad(supabase, sesion.idProfesional, "Entró por primera vez y aceptó la autorización de imagen");
  revalidatePath("/mi-espacio", "layout");
  return { error: null };
}

// ---------- Cambios que esperan aprobación ----------

/**
 * Deja el cambio esperando a Gonzalo. Hay uno solo por tipo (salvo las fotos,
 * que van de a una): si ya había uno esperando o para corregir, se reemplaza
 * por el nuevo, así no se juntan versiones viejas en la bandeja.
 */
async function dejarPendiente(
  supabase: SupabaseClient,
  idProfesional: string,
  tipo: TipoCambio,
  valorNuevo: unknown,
  valorAnterior: unknown
): Promise<Resultado> {
  if (tipo !== "FOTO") {
    const { data: previo, error: errorPrevio } = await supabase
      .from("cambios_profesional")
      .select("id_cambio")
      .eq("id_profesional", idProfesional)
      .eq("tipo", tipo)
      .in("estado", ["PENDIENTE", "CORREGIR"])
      .maybeSingle();
    if (errorPrevio) return { error: FALTA_SQL };
    if (previo) {
      const { error } = await supabase
        .from("cambios_profesional")
        .update({ valor_nuevo: valorNuevo, valor_anterior: valorAnterior, estado: "PENDIENTE", nota: null, fecha: new Date().toISOString() })
        .eq("id_cambio", previo.id_cambio);
      if (error) return { error: FALTA_SQL };
      return { error: null };
    }
  }
  const { error } = await supabase
    .from("cambios_profesional")
    .insert({ id_profesional: idProfesional, tipo, valor_nuevo: valorNuevo, valor_anterior: valorAnterior });
  if (error) return { error: FALTA_SQL };
  return { error: null };
}

async function terminar(supabase: SupabaseClient, idProfesional: string, tipo: TipoCambio): Promise<Resultado> {
  await registrarActividad(supabase, idProfesional, QUE_HIZO[tipo], true);
  revalidatePath("/mi-espacio", "layout");
  return { error: null };
}

const LARGO_MAXIMO: Partial<Record<CampoDatos, number>> = { bio: 320, biografia_completa: 1500 };

/** Textos y precios de su ficha. Solo se guarda lo que de verdad cambió. */
export async function enviarDatos(campos: Partial<Record<CampoDatos, string | number | null>>): Promise<Resultado> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };
  const supabase = getSupabaseServerClient();

  const nuevos: Record<string, string | number | null> = {};
  for (const campo of Object.keys(CAMPOS_DATOS) as CampoDatos[]) {
    if (!(campo in campos)) continue;
    const crudo = campos[campo];
    if (CAMPOS_NUMERICOS.includes(campo)) {
      if (crudo === null || crudo === "") nuevos[campo] = null;
      else {
        const n = Number(String(crudo).replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(n) || n < 0) return { error: `Revisá el ${CAMPOS_DATOS[campo].toLowerCase()}: tiene que ser un número.` };
        nuevos[campo] = Math.round(n);
      }
    } else {
      const texto = String(crudo ?? "").trim();
      const maximo = LARGO_MAXIMO[campo] ?? 120;
      if (texto.length > maximo) return { error: `${CAMPOS_DATOS[campo]}: como mucho ${maximo} letras.` };
      nuevos[campo] = texto || null;
    }
  }

  const { data: actual } = await supabase
    .from("profesionales")
    .select(Object.keys(CAMPOS_DATOS).join(","))
    .eq("id_profesional", sesion.idProfesional)
    .maybeSingle();
  const actuales = (actual ?? {}) as unknown as Record<string, string | number | null>;

  // Si ya había datos esperando, se suman a estos: puede haber mandado la
  // presentación ayer y la historia hoy.
  const { data: previo } = await supabase
    .from("cambios_profesional")
    .select("valor_nuevo")
    .eq("id_profesional", sesion.idProfesional)
    .eq("tipo", "DATOS")
    .in("estado", ["PENDIENTE", "CORREGIR"])
    .maybeSingle();
  const juntos: Record<string, string | number | null> = { ...((previo?.valor_nuevo as Record<string, string | number | null>) ?? {}), ...nuevos };

  const cambiados: Record<string, string | number | null> = {};
  const antes: Record<string, string | number | null> = {};
  for (const [campo, valor] of Object.entries(juntos)) {
    if ((actuales[campo] ?? null) === valor) continue;
    cambiados[campo] = valor;
    antes[campo] = actuales[campo] ?? null;
  }
  if (Object.keys(cambiados).length === 0) {
    // Lo que había mandado coincide con lo que ya está: no queda nada esperando.
    if (previo) {
      await supabase
        .from("cambios_profesional")
        .delete()
        .eq("id_profesional", sesion.idProfesional)
        .eq("tipo", "DATOS")
        .in("estado", ["PENDIENTE", "CORREGIR"]);
      revalidatePath("/mi-espacio", "layout");
    }
    return { error: "No cambiaste nada: ya está así en tu ficha." };
  }

  const r = await dejarPendiente(supabase, sesion.idProfesional, "DATOS", cambiados, antes);
  if (r.error) return r;
  return terminar(supabase, sesion.idProfesional, "DATOS");
}

/** Achica la foto (la pantalla del local no necesita más) y la sube aparte, sin tocar la ficha. */
async function subirFoto(supabase: SupabaseClient, idProfesional: string, archivo: File | null): Promise<{ error: string | null; url?: string }> {
  if (!archivo || archivo.size === 0) return { error: "Elegí una foto primero." };
  if (!archivo.type.startsWith("image/")) return { error: "Eso no es una foto. Probá con un JPG o PNG." };
  try {
    const original = Buffer.from(await archivo.arrayBuffer());
    const chica = await sharp(original).rotate().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    const path = `pendiente-${idProfesional}-${Date.now()}.webp`;
    const { error } = await supabase.storage.from("fotos-profesionales").upload(path, chica, { contentType: "image/webp" });
    if (error) return { error: "No se pudo subir la foto. Probá de nuevo." };
    return { error: null, url: supabase.storage.from("fotos-profesionales").getPublicUrl(path).data.publicUrl };
  } catch {
    return { error: "No se pudo leer la foto. Probá con otra." };
  }
}

export async function enviarFotoPerfil(formData: FormData): Promise<Resultado> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };
  const supabase = getSupabaseServerClient();
  const subida = await subirFoto(supabase, sesion.idProfesional, formData.get("archivo") as File | null);
  if (subida.error || !subida.url) return { error: subida.error };
  const r = await dejarPendiente(supabase, sesion.idProfesional, "FOTO_PERFIL", { url: subida.url }, { url: sesion.foto });
  if (r.error) return r;
  return terminar(supabase, sesion.idProfesional, "FOTO_PERFIL");
}

export async function enviarFotoGaleria(formData: FormData): Promise<Resultado> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };
  const supabase = getSupabaseServerClient();
  const titulo = String(formData.get("titulo") ?? "").trim().slice(0, 80) || null;
  const subida = await subirFoto(supabase, sesion.idProfesional, formData.get("archivo") as File | null);
  if (subida.error || !subida.url) return { error: subida.error };
  const r = await dejarPendiente(supabase, sesion.idProfesional, "FOTO", { url: subida.url, titulo }, null);
  if (r.error) return r;
  return terminar(supabase, sesion.idProfesional, "FOTO");
}

/**
 * Mostrar u ocultar en la pantalla una foto que ya está aprobada. No espera a
 * nadie: ocultar solo saca, y volver a mostrar es una foto que WiiGo ya vio.
 */
export async function cambiarVisibilidadFoto(idFoto: string, publico: boolean): Promise<Resultado> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };
  const supabase = getSupabaseServerClient();
  const { data: foto } = await supabase
    .from("galeria_profesional")
    .select("id_foto, titulo")
    .eq("id_foto", idFoto)
    .eq("id_profesional", sesion.idProfesional)
    .maybeSingle();
  if (!foto) return { error: "No encontré esa foto." };
  const { error } = await supabase.from("galeria_profesional").update({ publico }).eq("id_foto", idFoto);
  if (error) return { error: "No se pudo guardar. Probá de nuevo." };
  const nombre = foto.titulo ? `«${foto.titulo}»` : "una foto";
  await registrarActividad(supabase, sesion.idProfesional, publico ? `Volvió a mostrar en la pantalla ${nombre}` : `Ocultó de la pantalla ${nombre}`);
  revalidatePath("/mi-espacio", "layout");
  return { error: null };
}

const texto = (v: unknown, maximo: number) => String(v ?? "").trim().slice(0, maximo) || null;
const anio = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1950 && n <= 2100 ? n : null;
};

type ListaTipo = "FORMACION" | "TRAYECTORIA" | "VIDEOS" | "FORTALEZAS" | "OBJETIVOS";

/** Las listas (formación, recorrido, videos, en qué se destaca, en qué ayuda) se mandan enteras. */
export async function enviarLista(tipo: ListaTipo, items: unknown[]): Promise<Resultado> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };
  if (!Array.isArray(items) || items.length > 30) return { error: "Son demasiados. Dejá los más importantes." };
  const supabase = getSupabaseServerClient();
  const id = sesion.idProfesional;
  let valor: unknown;

  // Formación y recorrido se guardan ya ordenados por año, que es como los
  // lee el cliente: arriba lo primero que hizo, abajo lo de hoy.
  if (tipo === "FORMACION") {
    const lista: ItemFormacion[] = [];
    for (const i of items as Record<string, unknown>[]) {
      const titulo = texto(i.titulo, 120);
      if (!titulo) continue;
      lista.push({ titulo, institucion: texto(i.institucion, 120), anio: anio(i.anio) });
    }
    valor = ordenarPorAnio(lista, (f) => f.anio);
  } else if (tipo === "TRAYECTORIA") {
    const lista: ItemTrayectoria[] = [];
    for (const i of items as Record<string, unknown>[]) {
      const titulo = texto(i.titulo, 120);
      if (!titulo) continue;
      const desde = anio(i.anio_desde);
      const hasta = desde ? anio(i.anio_hasta) : null;
      if (desde && hasta && hasta < desde) return { error: `«${titulo}»: el año de «hasta» es anterior al de «desde».` };
      lista.push({ titulo, lugar: texto(i.lugar, 120), anio_desde: desde, anio_hasta: hasta });
    }
    valor = ordenarPorAnio(lista, (t) => t.anio_desde);
  } else if (tipo === "VIDEOS") {
    const lista: ItemVideo[] = [];
    for (const i of items as Record<string, unknown>[]) {
      const url = texto(i.url, 300);
      if (!url) continue;
      if (!/^https:\/\/(www\.)?(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|vimeo\.com)\//i.test(url)) {
        return { error: "Los videos tienen que ser links de Instagram, YouTube, TikTok o Vimeo." };
      }
      lista.push({ titulo: texto(i.titulo, 80), url });
    }
    valor = lista;
  } else if (tipo === "FORTALEZAS") {
    const pedidas = (items as Record<string, unknown>[])
      .map((i) => ({ id: i.id_fortaleza ? String(i.id_fortaleza) : null, nuevo: limpiarNombre(i.nuevo), principal: i.principal === true }))
      .filter((p) => p.id || p.nuevo);
    if (pedidas.length > 3) return { error: "Elegí hasta 3." };
    if (pedidas.some((p) => !p.id && p.nuevo.length < 3)) return { error: "Escribí un poco más en la que sumaste." };
    const { data: catalogo } = await supabase.from("fortalezas_profesional").select("id_fortaleza, nombre").eq("estado", "ACTIVA");
    const lista: ItemFortaleza[] = [];
    for (const p of pedidas) {
      // Si escribió una que ya está en la lista, va la de la lista.
      const deLista = p.id
        ? (catalogo ?? []).find((c) => c.id_fortaleza === p.id)
        : (catalogo ?? []).find((c) => mismoNombre(c.nombre as string, p.nuevo));
      const item: ItemFortaleza = deLista
        ? { id_fortaleza: deLista.id_fortaleza as string, principal: p.principal }
        : p.id
          ? { id_fortaleza: null, principal: p.principal }
          : { id_fortaleza: null, nuevo: p.nuevo, principal: p.principal };
      if (!item.id_fortaleza && !item.nuevo) continue;
      const repetida = lista.some((x) => (item.id_fortaleza ? x.id_fortaleza === item.id_fortaleza : x.nuevo && mismoNombre(x.nuevo, item.nuevo ?? "")));
      if (!repetida) lista.push(item);
    }
    // Una sola principal: si marcó más de una, queda la primera.
    let hayPrincipal = false;
    for (const f of lista) {
      if (f.principal && !hayPrincipal) hayPrincipal = true;
      else f.principal = false;
    }
    valor = lista;
  } else if (tipo === "OBJETIVOS") {
    return enviarObjetivos((items as unknown[]).map(String), []);
  } else {
    return { error: "No se puede cambiar eso desde acá." };
  }

  const r = await dejarPendiente(supabase, id, tipo, valor, null);
  if (r.error) return r;
  return terminar(supabase, id, tipo);
}

/**
 * En qué ayuda: los objetivos de la lista y hasta 3 que escriba ella. Los que
 * escribe esperan a Gonzalo como todo lo demás; si ya hay uno con ese nombre,
 * se usa ese y no se crea otro igual.
 */
export async function enviarObjetivos(ids: string[], nuevos: string[]): Promise<Resultado> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };
  if (!Array.isArray(ids) || !Array.isArray(nuevos) || ids.length > 30) return { error: "Son demasiados. Dejá los más importantes." };
  const supabase = getSupabaseServerClient();

  const { data: catalogo } = await supabase.from("objetivos").select("id_objetivo, nombre").eq("estado", "ACTIVO");
  const lista = catalogo ?? [];
  const elegidos = new Set(ids.map(String).filter((i) => lista.some((o) => o.id_objetivo === i)));
  const propios: string[] = [];
  for (const crudo of nuevos) {
    const nombre = limpiarNombre(crudo);
    if (!nombre) continue;
    if (nombre.length < 3) return { error: `«${nombre}» es muy corto. Escribí un poco más.` };
    const igual = lista.find((o) => mismoNombre(o.nombre as string, nombre));
    if (igual) elegidos.add(igual.id_objetivo as string);
    else if (!propios.some((p) => mismoNombre(p, nombre))) propios.push(nombre);
  }
  if (propios.length > 3) return { error: "Sumá hasta 3 objetivos nuevos por vez." };

  const r = await dejarPendiente(supabase, sesion.idProfesional, "OBJETIVOS", { ids: [...elegidos], nuevos: propios }, null);
  if (r.error) return r;
  return terminar(supabase, sesion.idProfesional, "OBJETIVOS");
}

/** Sus redes: salen en la pantalla con un QR, así que también esperan a Gonzalo. */
export async function enviarRedes(escritas: Record<string, string>): Promise<Resultado> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };
  const { redes, error } = normalizarRedes(escritas ?? {});
  if (error) return { error };
  const supabase = getSupabaseServerClient();

  // Sin sql/profesionales-redes.sql corrido no hay dónde aplicarlas.
  const { data: actual, error: errorActual } = await supabase.from("profesionales").select("redes").eq("id_profesional", sesion.idProfesional).maybeSingle();
  if (errorActual) return { error: FALTA_SQL };
  const antes = leerRedes(actual?.redes);

  if (mismasRedes(redes, antes)) {
    // Lo que había mandado coincide con lo que ya está: no queda nada esperando.
    await supabase.from("cambios_profesional").delete().eq("id_profesional", sesion.idProfesional).eq("tipo", "REDES").in("estado", ["PENDIENTE", "CORREGIR"]);
    revalidatePath("/mi-espacio", "layout");
    return { error: "No cambiaste nada: ya está así en tu ficha." };
  }

  const r = await dejarPendiente(supabase, sesion.idProfesional, "REDES", redes, antes);
  if (r.error) return r;
  return terminar(supabase, sesion.idProfesional, "REDES");
}

// ---------- Pedidos para sus pacientes ----------

/**
 * Manda al local el pedido que armó en la consulta. Los precios no se toman
 * de la pantalla: se calculan acá con los de hoy, y son los que se respetan
 * 24 horas. El paciente queda como cliente de WiiGo (si ya estaba por su
 * DNI, se usa ese, sin pisarle los datos).
 */
export async function enviarPedido(datos: {
  items: { idVariante: string; cantidad: number }[];
  paciente: { nombre: string; apellido: string; dni: string; telefono: string };
  acepta: boolean;
  idLocal: string;
}): Promise<{ error: string | null; numero?: number }> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };

  const nombre = datos.paciente.nombre.trim().slice(0, 60);
  const apellido = datos.paciente.apellido.trim().slice(0, 60);
  const dni = datos.paciente.dni.replace(/\D/g, "");
  const telefono = datos.paciente.telefono.trim().slice(0, 30) || null;
  if (!nombre || !apellido) return { error: "Poné el nombre y el apellido del paciente." };
  if (dni.length < 7 || dni.length > 9) return { error: "Revisá el DNI: tiene que tener 7 u 8 números." };
  if (!datos.acepta) return { error: "Falta que el paciente acepte sumarse a WiiGo Club y que le avisen por WhatsApp." };

  const pedidos = new Map<string, number>();
  for (const i of datos.items ?? []) {
    const cantidad = Math.floor(Number(i.cantidad));
    if (!i.idVariante || !Number.isFinite(cantidad) || cantidad < 1 || cantidad > 20) continue;
    pedidos.set(i.idVariante, (pedidos.get(i.idVariante) ?? 0) + cantidad);
  }
  if (pedidos.size === 0) return { error: "Agregá al menos un producto." };
  if (pedidos.size > 40) return { error: "Son demasiados productos para un pedido." };

  const supabase = getSupabaseServerClient();
  const [varRes, localesRes, codigoRes] = await Promise.all([
    supabase.from("variantes_producto").select("id_variante, id_producto, nombre, precio_venta, precio_efectivo, estado").in("id_variante", [...pedidos.keys()]),
    supabase.from("locales").select("id_local").eq("estado", "ACTIVO").order("nombre"),
    supabase.from("codigos_profesionales").select("codigo").eq("id_profesional", sesion.idProfesional).eq("estado", "ACTIVO").limit(1),
  ]);
  const variantes = (varRes.data ?? []).filter((v) => v.estado === "ACTIVO");
  if (variantes.length !== pedidos.size) return { error: "Algún producto ya no está disponible. Actualizá la página y armalo de nuevo." };
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre, precio_venta, precio_efectivo, descuento_porcentaje, estado")
    .in("id_producto", [...new Set(variantes.map((v) => v.id_producto as string))]);
  const productoPorId = new Map((productos ?? []).filter((p) => p.estado === "ACTIVO").map((p) => [p.id_producto as string, p]));

  const idsLocales = (localesRes.data ?? []).map((l) => l.id_local as string);
  const idLocal = idsLocales.includes(datos.idLocal) ? datos.idLocal : idsLocales[0] ?? null;

  // El paciente como cliente de WiiGo, y como paciente de ella: desde hoy
  // suma para ella lo que compre, durante los meses que diga Configuración.
  const idCliente = await clientePorDni(supabase, { nombre, apellido, dni, telefono });
  if (idCliente) await registrarPaciente(supabase, { idProfesional: sesion.idProfesional, idCliente, origen: "PEDIDO" });

  const { data: pedido, error } = await supabase
    .from("pedidos_profesional")
    .insert({
      id_profesional: sesion.idProfesional,
      id_local: idLocal,
      id_cliente: idCliente,
      paciente_nombre: nombre,
      paciente_apellido: apellido,
      paciente_dni: dni,
      paciente_telefono: telefono,
      acepto_at: new Date().toISOString(),
      codigo: (codigoRes.data?.[0]?.codigo as string | undefined) ?? null,
    })
    .select("id_pedido, numero")
    .single();
  if (error || !pedido) return { error: FALTA_SQL };

  const filas = variantes.map((v) => {
    const p = productoPorId.get(v.id_producto as string);
    const conNombreVariante = v.nombre && !/^(únic[oa]|unic[oa]|default|estándar|estandar)$/i.test(String(v.nombre).trim());
    return {
      id_pedido: pedido.id_pedido,
      id_variante: v.id_variante,
      nombre: p ? (conNombreVariante ? `${p.nombre} · ${v.nombre}` : (p.nombre as string)) : String(v.nombre),
      cantidad: pedidos.get(v.id_variante as string) ?? 1,
      precio_lista: p ? precioDe(p, v, "OTRO") : Number(v.precio_venta ?? 0),
      precio_efectivo: p ? precioDe(p, v, "EFECTIVO") : Number(v.precio_efectivo ?? v.precio_venta ?? 0),
    };
  });
  const { error: errorItems } = await supabase.from("pedidos_profesional_items").insert(filas);
  if (errorItems) {
    await supabase.from("pedidos_profesional").delete().eq("id_pedido", pedido.id_pedido);
    return { error: "No se pudo guardar el pedido. Probá de nuevo." };
  }

  await registrarActividad(supabase, sesion.idProfesional, `Armó el pedido N.º ${pedido.numero} para ${nombre} ${apellido.charAt(0)}.`);
  revalidatePath("/mi-espacio/pedidos");
  return { error: null, numero: Number(pedido.numero) };
}

/**
 * "Sumar paciente": registrar a un paciente sin armarle un pedido. Desde ese
 * día, lo que compre en WiiGo suma para ella aunque no diga el código, y en su
 * primera compra tiene el beneficio del código.
 */
export async function sumarPaciente(datos: { nombre: string; apellido: string; dni: string; telefono: string; acepta: boolean }): Promise<{ error: string | null; hasta?: string }> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };
  const nombre = datos.nombre.trim().slice(0, 60);
  const apellido = datos.apellido.trim().slice(0, 60);
  const dni = datos.dni.replace(/\D/g, "");
  const telefono = datos.telefono.trim().slice(0, 30) || null;
  if (!nombre || !apellido) return { error: "Poné el nombre y el apellido del paciente." };
  if (dni.length < 7 || dni.length > 9) return { error: "Revisá el DNI: tiene que tener 7 u 8 números." };
  if (!datos.acepta) return { error: "Falta que el paciente acepte sumarse a WiiGo Club." };

  const supabase = getSupabaseServerClient();
  const idCliente = await clientePorDni(supabase, { nombre, apellido, dni, telefono });
  if (!idCliente) return { error: "No se pudo registrar. Probá de nuevo." };
  const r = await registrarPaciente(supabase, { idProfesional: sesion.idProfesional, idCliente, origen: "ESPACIO" });
  if (r.error) return { error: r.error === "sin-tabla" ? FALTA_SQL : "No se pudo registrar. Probá de nuevo." };
  await registrarActividad(supabase, sesion.idProfesional, `Sumó como paciente a ${nombre} ${apellido.charAt(0)}.`);
  revalidatePath("/mi-espacio", "layout");
  return { error: null, hasta: r.hasta };
}

/** Su teléfono y su mail de contacto: son suyos y no salen en la pantalla, así que se guardan directo. */
export async function guardarContacto(telefono: string, email: string): Promise<Resultado> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: SESION_CERRADA };
  const tel = telefono.trim().slice(0, 30) || null;
  const mail = email.trim().toLowerCase().slice(0, 120) || null;
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { error: "Revisá el mail: no parece un mail válido." };
  const supabase = getSupabaseServerClient();
  const { data: antes } = await supabase.from("profesionales").select("telefono, email").eq("id_profesional", sesion.idProfesional).maybeSingle();
  const { error } = await supabase.from("profesionales").update({ telefono: tel, email: mail }).eq("id_profesional", sesion.idProfesional);
  if (error) return { error: "No se pudo guardar. Probá de nuevo." };
  const que = [antes?.telefono !== tel ? "su teléfono" : null, antes?.email !== mail ? "su mail de contacto" : null].filter(Boolean);
  if (que.length > 0) await registrarActividad(supabase, sesion.idProfesional, `Cambió ${que.join(" y ")}`);
  revalidatePath("/mi-espacio", "layout");
  return { error: null };
}
