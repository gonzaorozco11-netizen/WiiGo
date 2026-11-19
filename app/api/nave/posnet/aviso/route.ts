/**
 * Aviso de Nave para los cobros del posnet (Nave Point) — la «Notification URL»
 * que se cargó en el alta de la integración presencial (Gonzalo, 19/11).
 *
 * Todavía no está conectado a la caja: por ahora solo anota lo que llega (para ver
 * qué manda Nave cuando lleguen las credenciales de prueba) y contesta 200, así
 * Nave no reintenta. Cuando se arme la caja con el posnet, acá se cierra la venta
 * después de preguntarle a Nave por el pago (nunca creyéndole al aviso solo).
 *
 * ?entorno=sandbox es la dirección de prueba: si el sistema ya está en producción,
 * ese aviso se ignora.
 */
export const dynamic = "force-dynamic";

const ok = (cuerpo: Record<string, unknown> = { ok: true }) => Response.json(cuerpo, { headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const url = new URL(req.url);
  const entornoAviso = url.searchParams.get("entorno");
  const entornoActual = process.env.NAVE_ENTORNO === "produccion" ? "produccion" : "sandbox";
  if (entornoAviso && entornoAviso !== entornoActual) return ok({ ok: true, ignorado: "otro_entorno" });

  const texto = await req.text().catch(() => "");
  console.log("[nave/posnet/aviso]", entornoAviso ?? "produccion", texto.slice(0, 2000));
  return ok();
}

// Algunos servicios prueban la dirección con un GET antes de guardarla.
export async function GET() {
  return ok({ ok: true, servicio: "aviso posnet" });
}
