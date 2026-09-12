import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

export const config = {
  // /self-checkout y /asesor quedan públicos (los usan los clientes en el
  // local, sin login). /comprobante también: es lo que abre el cliente en su
  // celular al escanear el QR del totem, y obviamente no está logueado.
  // /api queda pública también — ahí viven los webhooks (ej. Mercado Pago),
  // que llegan sin la cookie de sesión porque no los llama una persona
  // logueada, los llama el servidor de Mercado Pago.
  //
  // El `.*\..*` del final deja pasar cualquier archivo con extensión, o sea
  // todo lo que vive en /public. Antes no estaba y el proxy los mandaba al
  // login igual que a una pantalla: el navegador pedía /wiigo-logo.png y
  // recibía el HTML del login, así que el logo del propio login aparecía
  // roto. Lo mismo el manifest y los íconos, que el celular pide ANTES de
  // que nadie se loguee — sin esto no se puede instalar la app en la tablet.
  //
  // Que sean públicos no filtra nada: son un logo y unos íconos. Los datos
  // no salen por archivos estáticos.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|self-checkout|asesor|comprobante|login|api|.*\\..*).*)",
  ],
};

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Deploy mal configurado — falla cerrado, no abierto.
    return new NextResponse("Falta configurar AUTH_SECRET", { status: 500 });
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, secret);

  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
