import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

export const config = {
  // /self-checkout y /asesor quedan públicos (los usan los clientes en el
  // local, sin login). /api queda pública también — ahí viven los webhooks
  // (ej. Mercado Pago), que llegan sin la cookie de sesión porque no los
  // llama una persona logueada, los llama el servidor de Mercado Pago.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|self-checkout|asesor|login|api).*)"],
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
