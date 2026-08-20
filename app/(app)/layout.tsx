import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { logout } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold text-neutral-900">WiiGo</span>
            <nav className="flex items-center gap-4">
              <Link href="/marcas" className="text-sm text-neutral-600 hover:text-neutral-900">
                Marcas
              </Link>
              <Link href="/productos" className="text-sm text-neutral-600 hover:text-neutral-900">
                Productos
              </Link>
              <Link href="/catalogo-asesor" className="text-sm text-neutral-600 hover:text-neutral-900">
                Catálogo asesor
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {session && (
              <span className="text-sm text-neutral-500 hidden sm:inline">
                {session.nombre}
                {session.rol && ` · ${session.rol}`}
              </span>
            )}
            <form action={logout}>
              <button className="text-sm text-neutral-500 hover:text-neutral-900" type="submit">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
