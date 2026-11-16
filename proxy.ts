import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { COOKIE_APARATO, RENOVAR_CADA_MS, firmarAparato, leerAparato, opcionesCookieAparato, rolAtadoALaTablet, sePuedeEnElCelular } from "@/lib/aparatoLocal";

// Las profesionales solo pueden estar en su espacio. Se corta acá y no en
// cada pantalla porque también frena las server actions del sistema interno:
// cuando una acción no está en la página desde donde se la llama, Next la
// reenvía con un pedido nuevo a la dirección de su propia página, y ese
// pedido vuelve a pasar por este proxy con una dirección del sistema interno.
function esDelEspacioProfesional(pathname: string) {
  return pathname === "/mi-espacio" || pathname.startsWith("/mi-espacio/");
}

export const config = {
  // /self-checkout y /asesor quedan públicos (los usan los clientes en el
  // local, sin login). /comprobante también: es lo que abre el cliente en su
  // celular al escanear el QR del totem, y obviamente no está logueado.
  // /opinion/<token> igual: la abre el paciente desde el WhatsApp de su
  // profesional para dejar su opinión (app/opinion; todo depende del token).
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
    // /tienda también: es la tienda online, para cualquiera (public/tienda; los datos
    // salen de /api/tienda/catalogo, con lo mismo que se ve en el local).
    "/((?!_next/static|_next/image|favicon.ico|self-checkout|asesor|comprobante|opinion/|login|api|tienda(?:/|$)|.*\\..*).*)",
  ],
};

// La tienda en su propio dominio (Gonzalo, 2026-11-16: «que no diga /tienda»):
// wiigo.com.ar muestra la tienda en «/». Cualquier otra página pedida por ese
// dominio vuelve a la tienda, NUNCA al sistema de los empleados (Gonzalo: «si un
// cliente se equivoca, que no lo lleve a la app»). Lo que la tienda
// necesita (/tienda/*, /api/tienda/*, logos) no pasa por acá: el matcher lo
// deja pasar. El dominio sale de TIENDA_URL si está cargada en Vercel.
function hostsTienda(): Set<string> {
  const propia = process.env.TIENDA_URL?.trim();
  const host = propia ? propia.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase() : "wiigo.com.ar";
  const sinWww = host.replace(/^www\./, "");
  return new Set([sinWww, `www.${sinWww}`]);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  if (hostsTienda().has(host)) {
    if (pathname === "/") return NextResponse.rewrite(new URL(`/tienda/index.html${req.nextUrl.search}`, req.url));
    return NextResponse.redirect(new URL(`/${req.nextUrl.search}`, req.url));
  }

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

  if (session.rol === "profesional" && !esDelEspacioProfesional(pathname)) {
    return NextResponse.redirect(new URL("/mi-espacio", req.url));
  }

  // Los operativos usan el sistema solo en la tablet del local (lib/aparatoLocal.ts).
  // En otro aparato quedan la góndola, sus recibos y Aprender; lo demás (fichar,
  // caja, ventas, cobros…) va a /solo-tablet. Se corta acá y no en cada pantalla
  // por lo mismo que lo de las profesionales: también frena las server actions.
  if (rolAtadoALaTablet(session.rol)) {
    const aparato = await leerAparato(req.cookies.get(COOKIE_APARATO)?.value, secret);
    if (!aparato) {
      if (!sePuedeEnElCelular(pathname)) {
        // Una acción (POST) no se redirige: se rechaza, así no se ejecuta en otro lado.
        if (req.method !== "GET" && req.method !== "HEAD") return new NextResponse("Esto se usa solo en la tablet del local", { status: 403 });
        return NextResponse.redirect(new URL("/solo-tablet", req.url));
      }
    } else if (Date.now() - aparato.iat > RENOVAR_CADA_MS) {
      // La tablet se sigue usando: se le renueva la cookie para que no venza nunca.
      const res = NextResponse.next();
      res.cookies.set(COOKIE_APARATO, await firmarAparato(aparato, secret), opcionesCookieAparato);
      return res;
    }
  }

  return NextResponse.next();
}
