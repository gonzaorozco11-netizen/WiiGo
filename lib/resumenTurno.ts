import { getSupabaseServerClient } from "@/lib/supabase";
import { enviarMail, plantilla } from "@/lib/mail";
import { baseUrlPublica } from "@/lib/urlPublica";
import { fechaHoraArgentina } from "@/lib/horarios";
import { etiquetaMedio } from "@/lib/formasPago";

// El resumen de ventas que le llega al dueño al cierre de cada turno (13 y 21).
//
// Pedido de Gonzalo (2026-11-12): enterarse de las ventas sin entrar al
// sistema. Se eligió un mail por turno y no uno por venta: con treinta ventas
// por día, un mail por venta llena la casilla y se deja de leer.
//
// Lo que cubre cada mail: desde donde terminó el anterior hasta ahora
// (RESUMEN_TURNO_HASTA), así no se pierde la venta de las 21:30 ni se cuenta
// dos veces la de las 13:02, aunque el proceso automático corra unos minutos
// tarde. El total del día del mail de la noche se cuenta entero de nuevo:
// es el número que tiene que coincidir con la caja.

export const PARAMETRO_MAILS_RESUMEN = "RESUMEN_TURNO_MAILS";
export const PARAMETRO_ULTIMO_RESUMEN = "RESUMEN_TURNO_ULTIMO";
const PARAMETRO_HASTA = "RESUMEN_TURNO_HASTA";
export const MAX_MAILS_RESUMEN = 3;

export type TurnoResumen = "manana" | "tarde";

const NOMBRE_TURNO: Record<TurnoResumen, string> = { manana: "turno mañana", tarde: "turno tarde" };

/** Las direcciones guardadas, separadas por coma. Las que no parecen un mail se descartan. */
export function leerMailsResumen(valor: string | null | undefined): string[] {
  return (valor ?? "")
    .split(/[,;\s]+/)
    .map((m) => m.trim().toLowerCase())
    .filter((m) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m));
}

/** Lo que dejó el último intento, para mostrarlo en Configuración. */
export type UltimoResumen = { fecha: string; ok: boolean; turno: TurnoResumen; ventas: number; error: string | null };

export function leerUltimoResumen(valor: string | null | undefined): UltimoResumen | null {
  try {
    const v = valor ? JSON.parse(valor) : null;
    return v && typeof v === "object" && typeof v.fecha === "string" ? (v as UltimoResumen) : null;
  } catch {
    return null;
  }
}

function pesos(v: number) {
  return `$${Math.round(v).toLocaleString("es-AR")}`;
}

// Si el proceso automático dejó de correr unos días, el mail no arrastra una
// semana entera: cubre como mucho día y medio hacia atrás.
const TOPE_HACIA_ATRAS_MS = 36 * 60 * 60 * 1000;
// Vercel a veces repite un proceso automático. Dos mails seguidos, el segundo
// casi vacío, harían pensar que no se vendió nada.
const MINIMO_ENTRE_MAILS_MS = 60 * 60 * 1000;

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function canalDe(canal: string | null): string {
  if (canal === "SELF_CHECKOUT") return "Tótem";
  if (canal === "ONLINE") return "Tienda online";
  return "Caja";
}

type Fila = { etiqueta: string; ventas: number; monto: number };

function tabla(titulo: string, filas: { izquierda: string; derecha: string }[]): string {
  if (filas.length === 0) return "";
  return `<p style="margin:18px 0 6px;font-size:13px;font-weight:bold;color:#5e6659;text-transform:uppercase;letter-spacing:0.5px">${titulo}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${filas
    .map(
      (f) =>
        `<tr><td style="padding:7px 0;border-top:1px solid #eef1e9">${f.izquierda}</td><td style="padding:7px 0;border-top:1px solid #eef1e9;text-align:right;white-space:nowrap">${f.derecha}</td></tr>`
    )
    .join("")}</table>`;
}

function agrupar<T>(items: T[], clave: (x: T) => string, monto: (x: T) => number): Fila[] {
  const m = new Map<string, Fila>();
  for (const it of items) {
    const k = clave(it);
    const f = m.get(k) ?? { etiqueta: k, ventas: 0, monto: 0 };
    f.ventas += 1;
    f.monto += monto(it);
    m.set(k, f);
  }
  return [...m.values()].sort((a, b) => b.monto - a.monto);
}

type Venta = { id_venta: string; fecha: string; total: number | null; medio_pago: string | null; canal: string | null };

/**
 * Arma el resumen del turno y, salvo `soloArmar`, lo manda.
 *
 * `prueba` (el botón de Configuración) manda lo de hoy hasta ahora sin
 * correr la marca: el resumen de verdad de ese turno sale igual completo.
 *
 * Nunca tira: el resultado dice qué pasó y queda anotado en
 * RESUMEN_TURNO_ULTIMO para que Configuración lo muestre.
 */
export async function mandarResumenDeTurno(
  turno: TurnoResumen,
  opciones: { soloArmar?: boolean; prueba?: boolean; ahora?: Date } = {}
): Promise<{ ok: boolean; motivo: string; asunto?: string; html?: string }> {
  const supabase = getSupabaseServerClient();
  const ahora = opciones.ahora ?? new Date();
  const sinMarca = Boolean(opciones.soloArmar || opciones.prueba);

  try {
    const { data: config } = await supabase
      .from("configuracion")
      .select("parametro, valor")
      .in("parametro", [PARAMETRO_MAILS_RESUMEN, PARAMETRO_HASTA]);
    const valores = new Map((config ?? []).map((c) => [c.parametro as string, c.valor as string]));
    const mails = leerMailsResumen(valores.get(PARAMETRO_MAILS_RESUMEN));
    if (mails.length === 0 && !opciones.soloArmar) return { ok: false, motivo: "No hay ningún mail cargado." };

    const hoy = fechaHoraArgentina(ahora);
    const inicioDelDia = new Date(`${hoy.fecha}T00:00:00-03:00`);

    // Desde dónde: donde terminó el último mail que salió bien. Sin ninguno
    // (el primero), desde que empezó el día.
    const hastaAnterior = new Date(valores.get(PARAMETRO_HASTA) ?? "");
    let desde = inicioDelDia;
    if (!opciones.prueba && !Number.isNaN(hastaAnterior.getTime())) {
      if (!sinMarca && ahora.getTime() - hastaAnterior.getTime() < MINIMO_ENTRE_MAILS_MS) {
        return { ok: true, motivo: "Ya salió uno hace menos de una hora." };
      }
      if (ahora.getTime() - hastaAnterior.getTime() <= TOPE_HACIA_ATRAS_MS) desde = hastaAnterior;
    }
    const desdeConsulta = desde < inicioDelDia ? desde : inicioDelDia;

    // Tres consultas a la par: las ventas (para el día y el turno), sus
    // renglones y las devoluciones del turno.
    const [ventasRes, renglonesRes, devolucionesRes] = await Promise.all([
      supabase
        .from("ventas")
        .select("id_venta, fecha, total, medio_pago, canal")
        .eq("estado", "PAGADA")
        .gt("fecha", desdeConsulta.toISOString())
        .lte("fecha", ahora.toISOString()),
      supabase
        .from("detalle_ventas")
        .select("cantidad, subtotal, id_variante, marcas(tipo_comercializacion), variantes_producto(nombre, productos(nombre)), ventas!inner(estado, fecha)")
        .eq("ventas.estado", "PAGADA")
        .gt("ventas.fecha", desde.toISOString())
        .lte("ventas.fecha", ahora.toISOString()),
      supabase
        .from("devoluciones")
        .select("monto_devuelto")
        .gt("fecha", desde.toISOString())
        .lte("fecha", ahora.toISOString()),
    ]);
    if (ventasRes.error) throw new Error(ventasRes.error.message);

    const todas = (ventasRes.data ?? []) as Venta[];
    const delTurno = todas.filter((v) => new Date(v.fecha) > desde);
    const delDia = todas.filter((v) => new Date(v.fecha) >= inicioDelDia);
    const total = delTurno.reduce((a, v) => a + Number(v.total ?? 0), 0);
    const totalDia = delDia.reduce((a, v) => a + Number(v.total ?? 0), 0);
    const cantidad = delTurno.length;

    // Lo más vendido y cuánto fue de lo propio contra lo de las marcas: en lo
    // propio WiiGo gana todo el margen, en una marca solo la comisión.
    type Renglon = {
      cantidad: number | null;
      subtotal: number | null;
      id_variante: string;
      marcas: { tipo_comercializacion?: string | null } | null;
      variantes_producto: { nombre?: string | null; productos?: { nombre?: string | null } | null } | null;
    };
    const renglones = (renglonesRes.data ?? []) as unknown as Renglon[];
    let propio = 0;
    let marcas = 0;
    const productos = new Map<string, { nombre: string; unidades: number; monto: number }>();
    for (const r of renglones) {
      const sub = Number(r.subtotal ?? 0);
      if (r.marcas?.tipo_comercializacion === "PROPIA") propio += sub;
      else marcas += sub;
      const prod = r.variantes_producto?.productos?.nombre ?? "Producto";
      const vari = r.variantes_producto?.nombre ?? "";
      const nombre = vari && vari !== "Único" ? `${prod} — ${vari}` : prod;
      const p = productos.get(r.id_variante) ?? { nombre, unidades: 0, monto: 0 };
      p.unidades += Number(r.cantidad ?? 0);
      p.monto += sub;
      productos.set(r.id_variante, p);
    }
    const masVendidos = [...productos.values()].sort((a, b) => b.unidades - a.unidades || b.monto - a.monto).slice(0, 5);
    const devoluciones = devolucionesRes.data ?? [];
    const devuelto = devoluciones.reduce((a, d) => a + Number(d.monto_devuelto ?? 0), 0);

    // ===== El mail =====
    const nombreTurno = NOMBRE_TURNO[turno];
    const diaSemana = DIAS[hoy.diaSemanaISO % 7];
    const [, mes, dia] = hoy.fecha.split("-");
    const fechaCorta = `${diaSemana} ${Number(dia)}/${Number(mes)}`;
    const desdeAyer = desde < inicioDelDia;
    const bajada = desdeAyer
      ? `${fechaCorta[0].toUpperCase()}${fechaCorta.slice(1)} · desde ayer ${fechaHoraArgentina(desde).hora} hasta las ${hoy.hora}`
      : `${fechaCorta[0].toUpperCase()}${fechaCorta.slice(1)} · hasta las ${hoy.hora}`;

    const asunto =
      (opciones.prueba ? "Prueba · " : "") +
      (cantidad === 0
        ? `Cierre del ${nombreTurno}: sin ventas`
        : `Cierre del ${nombreTurno}: ${pesos(total)} en ${cantidad} ${cantidad === 1 ? "venta" : "ventas"}`);

    const detalle: string[] = [];
    if (cantidad > 0) {
      detalle.push(
        `<strong style="color:#2a2f26">${cantidad} ${cantidad === 1 ? "venta" : "ventas"}</strong> · ticket promedio ${pesos(total / cantidad)}`
      );
      if (propio + marcas > 0) {
        const pctPropio = Math.round((propio / (propio + marcas)) * 100);
        detalle.push(
          pctPropio === 100
            ? "Todo en productos WiiGo"
            : pctPropio === 0
              ? "Todo en productos de marcas"
              : `Productos WiiGo ${pctPropio}% · Marcas ${100 - pctPropio}%`
        );
      }
    } else {
      detalle.push("No entró ninguna venta en este turno.");
    }

    const porMedio = agrupar(delTurno, (v) => etiquetaMedio(v.medio_pago), (v) => Number(v.total ?? 0));
    const porCanal = agrupar(delTurno, (v) => canalDe(v.canal), (v) => Number(v.total ?? 0));
    const cuantas = (n: number) => `${n} ${n === 1 ? "venta" : "ventas"}`;

    const cuerpo = [
      tabla(
        "Cómo pagaron",
        porMedio.map((f) => ({ izquierda: `${f.etiqueta} <span style="color:#8d9587">· ${cuantas(f.ventas)}</span>`, derecha: pesos(f.monto) }))
      ),
      // Con un solo lugar de venta la tabla repetiría el total: solo si hubo de los dos.
      porCanal.length > 1
        ? tabla(
            "Dónde",
            porCanal.map((f) => ({ izquierda: `${f.etiqueta} <span style="color:#8d9587">· ${cuantas(f.ventas)}</span>`, derecha: pesos(f.monto) }))
          )
        : "",
      tabla(
        "Lo más vendido",
        masVendidos.map((p) => ({ izquierda: p.nombre, derecha: `${p.unidades} u. · ${pesos(p.monto)}` }))
      ),
      devoluciones.length > 0
        ? `<p style="margin:16px 0 0;padding:10px 14px;background:#fdf8ef;border:1px solid #efe4cf;border-radius:10px;font-size:14px;color:#6b5420">↩ ${devoluciones.length} ${devoluciones.length === 1 ? "devolución" : "devoluciones"}: se devolvieron ${pesos(devuelto)}.</p>`
        : "",
    ].join("");

    const base = baseUrlPublica();
    const html = plantilla({
      base,
      tono: cantidad > 0 ? "verde" : "ambar",
      titulo: `Cierre del ${nombreTurno}`,
      bajada,
      destacado: pesos(total),
      detalle,
      // A la noche, el día entero: es el número que se compara con la caja.
      franja:
        turno === "tarde"
          ? { titulo: `Hoy en total: ${pesos(totalDia)}`, texto: `${cuantas(delDia.length)} entre los dos turnos.` }
          : undefined,
      cuerpo,
      boton: { texto: "Ver el resumen de ventas", url: `${base}/resumen-ventas` },
      pie: `Te llega porque tu mail está en Configuración → Resumen de ventas por mail. WiiGo, Mendoza`,
    });
    const texto =
      `${asunto}.` +
      (turno === "tarde" ? ` Hoy en total: ${pesos(totalDia)} en ${cuantas(delDia.length)}.` : "") +
      (porMedio.length ? ` ${porMedio.map((f) => `${f.etiqueta}: ${pesos(f.monto)}`).join(" · ")}.` : "");

    if (opciones.soloArmar) return { ok: true, motivo: "Armado sin mandar.", asunto, html };

    const r = await enviarMail({ para: mails, asunto, html, texto });
    if (opciones.prueba) return { ok: r.ok, motivo: r.ok ? `Prueba mandada a ${mails.join(", ")}.` : (r.error ?? "No salió.") };
    const marca = new Date().toISOString();
    const ultimo: UltimoResumen = { fecha: marca, ok: r.ok, turno, ventas: cantidad, error: r.error };
    const filas = [
      { parametro: PARAMETRO_ULTIMO_RESUMEN, valor: JSON.stringify(ultimo), descripcion: "Resumen de ventas por mail: cómo salió el último", fecha_actualizacion: marca },
    ];
    // Solo se corre la marca si el mail salió: si falló, el próximo cubre
    // también este tramo y no se pierde nada.
    if (r.ok) {
      filas.push({ parametro: PARAMETRO_HASTA, valor: ahora.toISOString(), descripcion: "Resumen de ventas por mail: hasta dónde cubrió el último que salió", fecha_actualizacion: marca });
    }
    await supabase.from("configuracion").upsert(filas, { onConflict: "parametro" });
    return { ok: r.ok, motivo: r.ok ? `Mandado a ${mails.join(", ")}.` : (r.error ?? "No salió.") };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "No se pudo armar el resumen.";
    if (!sinMarca) {
      const marca = new Date().toISOString();
      const ultimo: UltimoResumen = { fecha: marca, ok: false, turno, ventas: 0, error: motivo };
      await supabase
        .from("configuracion")
        .upsert(
          [{ parametro: PARAMETRO_ULTIMO_RESUMEN, valor: JSON.stringify(ultimo), descripcion: "Resumen de ventas por mail: cómo salió el último", fecha_actualizacion: marca }],
          { onConflict: "parametro" }
        );
    }
    return { ok: false, motivo };
  }
}

/** El GET de las dos rutas del proceso automático (13 y 21), con la clave de Vercel. */
export function rutaResumenDeTurno(turno: TurnoResumen) {
  return async function GET(req: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { "content-type": "application/json" } });
    }
    const resultado = await mandarResumenDeTurno(turno);
    console.log(`Cron resumen del ${NOMBRE_TURNO[turno]}:`, resultado.motivo);
    return new Response(JSON.stringify({ ok: resultado.ok, motivo: resultado.motivo }), { headers: { "content-type": "application/json" } });
  };
}
