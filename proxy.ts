import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

export const config = {
  // /self-checkout queda público (lo usan los clientes en el local, sin login).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|self-checkout|login).*)"],
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
