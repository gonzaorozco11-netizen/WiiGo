import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { rolAtadoALaTablet } from "@/lib/aparatoLocal";
import { estadoAparato } from "@/lib/aparatoLocalServidor";
import { logout, salirParaRegistrarTablet } from "@/app/login/actions";

// Lo que ve un operativo cuando quiere abrir el sistema fuera de la tablet del
// local (lib/aparatoLocal.ts). Va afuera de app/(app) a propósito: ese layout
// manda acá a las tablets dadas de baja, y adentro sería un ida y vuelta.
export const dynamic = "force-dynamic";

export default async function SoloTabletPage({ searchParams }: { searchParams: Promise<{ baja?: string }> }) {
  const cookieStore = await cookies();
  const sesion = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (!sesion) redirect("/login");
  if (!rolAtadoALaTablet(sesion.rol)) redirect("/");
  const { estado } = await estadoAparato();
  if (estado === "local") redirect("/");
  const deBaja = estado === "baja" || (await searchParams).baja === "1";

  const opcion = "flex items-center justify-between rounded-xl border border-[#e4e8dd] bg-white px-4 py-3.5 text-[15px] font-semibold text-neutral-900 hover:border-[#8a9a78]";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-[#f3f5f0]">
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/wiigo-logo.png" alt="WiiGo — Estaciones de Bienestar" className="h-10 w-auto mx-auto mb-7" />

        <div className="bg-white rounded-2xl border border-[#e4e8dd] p-6 shadow-[0_1px_3px_rgba(42,47,38,.06)]">
          <div className="w-12 h-12 rounded-2xl bg-[#e8eee1] text-[#536243] grid place-items-center mb-4" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
              <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
              <path d="M11 18.5h2" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-neutral-900 mb-1 text-balance">
            {deBaja ? "Esta tablet ya no es del local" : "Esto se usa en la tablet del local"}
          </h1>
          <p className="text-sm text-neutral-500 mb-5">
            {deBaja
              ? "El Dueño la dio de baja. Si es un error, pedile que la registre de nuevo."
              : "Fichar, la caja, las ventas y los cobros se hacen solo en la tablet del local."}
          </p>

          {!deBaja && (
            <>
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">Desde acá podés usar</p>
              <div className="grid gap-2 mb-5">
                <Link href="/gondola" className={opcion}>
                  Góndola <span className="text-neutral-400 text-sm font-medium">cuánto hay y dónde va</span>
                </Link>
                <Link href="/mis-recibos" className={opcion}>
                  Mis recibos <span aria-hidden="true" className="text-neutral-400">→</span>
                </Link>
                <Link href="/aprender" className={opcion}>
                  Aprender <span aria-hidden="true" className="text-neutral-400">→</span>
                </Link>
              </div>
            </>
          )}

          <form action={logout}>
            <button type="submit" className="w-full rounded-xl border border-neutral-300 py-3 text-[15px] font-semibold text-neutral-700 hover:bg-neutral-50">
              Salir
            </button>
          </form>
        </div>

        {/* Para el Dueño, la primera vez en una tablet nueva: sale el operativo y entra él. */}
        <form action={salirParaRegistrarTablet} className="mt-6 text-center">
          <button type="submit" className="text-[12.5px] text-[#6d8058] underline underline-offset-4">
            ¿Es la tablet del local? El Dueño la registra acá
          </button>
        </form>
      </div>
    </div>
  );
}
