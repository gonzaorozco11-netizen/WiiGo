import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { logout } from "@/app/login/actions";
import { obtenerSesionConPantallas } from "@/lib/roles";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { verificarAvisoSalida } from "@/app/(app)/ficha-asistencia/actions";
import AppNav from "@/components/AppNav";
import AvisoSalidaBanner from "@/components/AvisoSalidaBanner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  // Se busca fresco en la base (no en la cookie) para que un rol nuevo o
  // recién cambiado pegue al toque, sin esperar a que la persona reloguee.
  const sesionConPantallas = await obtenerSesionConPantallas();
  // Tesorería y RR.HH. no son "pantallas" del catálogo general — se
  // muestran según los mismos permisos puntuales que ya controlaban estas
  // pestañas dentro de Gastos (ver project-wiigo-permisos).
  const sesionPermisos = await obtenerSesionConPermisos();
  const puedeVerCajaAdmin = tienePermiso(sesionPermisos, PERMISOS.VER_CAJA_ADMIN);
  const puedeGestionarNomina = tienePermiso(sesionPermisos, PERMISOS.GESTIONAR_NOMINA);
  const avisoSalida = session ? await verificarAvisoSalida() : { debeRecordar: false, horaSalida: null };

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-lg font-semibold text-neutral-900">WiiGo</span>
            <AppNav
              pantallas={sesionConPantallas?.pantallas ?? null}
              esAdmin={session?.rol === "admin"}
              puedeVerCajaAdmin={puedeVerCajaAdmin}
              puedeGestionarNomina={puedeGestionarNomina}
            />
          </div>
          <div className="flex items-center gap-3">
            {session && (
              <span className="text-sm text-neutral-500 hidden sm:inline">
                {session.nombre}
                {session.rol && ` · ${session.rol === "admin" ? "Dueño" : "Operativo"}`}
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
      {avisoSalida.debeRecordar && <AvisoSalidaBanner horaSalida={avisoSalida.horaSalida} />}
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
