import { redirect } from "next/navigation";
import { logout } from "@/app/login/actions";
import { obtenerSesionMarca, ETIQUETA_PLAN, sesionIncluye } from "@/lib/marcaSesion";
import PortalNav from "@/components/PortalNav";

// Portal de marcas: árbol de rutas separado del sistema interno a propósito.
//
// Acá adentro nadie puede consultar nada que no sea de su propia marca. El
// control es este layout (rol "marca" o afuera) más el filtrado por
// sesión de cada consulta — nunca esconder cosas en pantalla, porque los
// datos igual habrían viajado al navegador.
export const dynamic = "force-dynamic";

const COLOR_PLAN: Record<string, string> = {
  BRONCE: "bg-amber-50 text-amber-800 border-amber-200",
  METAL: "bg-slate-100 text-slate-700 border-slate-300",
  GOLD: "bg-yellow-50 text-yellow-800 border-yellow-300",
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesionMarca();
  // Sin sesión de marca no hay portal: ni admin, ni empleado, ni deslogueado.
  if (!sesion) redirect("/login?next=/portal");

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {sesion.logoMarca && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={sesion.logoMarca} alt="" className="h-8 w-8 rounded object-contain shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-semibold text-neutral-900 truncate">{sesion.nombreMarca}</p>
                <p className="text-xs text-neutral-400">Portal de marcas · WiiGo</p>
              </div>
              <span
                className={`text-[11px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 shrink-0 ${
                  COLOR_PLAN[sesion.plan] ?? COLOR_PLAN.BRONCE
                }`}
              >
                {ETIQUETA_PLAN[sesion.plan]}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-neutral-500 hidden sm:inline">{sesion.nombreUsuario}</span>
              <form action={logout}>
                <button className="text-sm text-neutral-500 hover:text-neutral-900" type="submit">
                  Salir
                </button>
              </form>
            </div>
          </div>

          <PortalNav
            verAnalisis={sesionIncluye(sesion, "METAL")}
            verInteligencia={sesionIncluye(sesion, "GOLD")}
          />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
