import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { esRolInterno, INICIO_ROL_EXTERNO } from "@/lib/rolesInternos";
import { obtenerSesionConPantallas } from "@/lib/roles";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { verificarAvisoSalida } from "@/app/(app)/ficha-asistencia/actions";
import { contarPendientes } from "@/app/(app)/aprobaciones/actions";
import AppNav, { MigaDePan } from "@/components/AppNav";
import AvisoSalidaBanner from "@/components/AvisoSalidaBanner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");

  // Los usuarios de marca no entran acá bajo ningún concepto: este árbol es
  // el sistema interno (caja, costos, sueldos, todas las marcas). Se los
  // manda a su portal. Es la contracara del control que hace el layout de
  // /portal, que sí exige rol "marca" — cada lado cierra su puerta. Las
  // profesionales, igual: a su espacio (proxy.ts ya las frena antes). Se
  // pregunta por los roles internos y no por los de afuera, así un rol nuevo
  // queda afuera hasta que alguien decida lo contrario.
  if (session && !esRolInterno(session.rol)) redirect(INICIO_ROL_EXTERNO[session.rol] ?? "/login");
  // Se busca fresco en la base (no en la cookie) para que un rol nuevo o
  // recién cambiado pegue al toque, sin esperar a que la persona reloguee.
  const sesionConPantallas = await obtenerSesionConPantallas();
  // Tesorería y RR.HH. no son "pantallas" del catálogo general — se
  // muestran según los mismos permisos puntuales que ya controlaban estas
  // pestañas dentro de Gastos (ver project-wiigo-permisos).
  const sesionPermisos = await obtenerSesionConPermisos();
  const puedeVerCajaAdmin = tienePermiso(sesionPermisos, PERMISOS.VER_CAJA_ADMIN);
  const puedeGestionarNomina = tienePermiso(sesionPermisos, PERMISOS.GESTIONAR_NOMINA);
  // Misma regla que app/(app)/configuracion/page.tsx: si la pantalla no la
  // deja entrar, el menú no se la muestra.
  const puedeEditarConfiguracion = tienePermiso(sesionPermisos, PERMISOS.EDITAR_CONFIGURACION);
  const avisoSalida = session ? await verificarAvisoSalida() : { debeRecordar: false, horaSalida: null };
  // Contador del menú: lo que las marcas mandaron y las etiquetas vencidas.
  const pendientes = session ? await contarPendientes() : { solicitudes: 0, etiquetas: 0, etiquetasVencidas: 0 };

  return (
    // Menú a la izquierda y la pantalla a la derecha (en la computadora; en
    // la tablet y el celular el menú es un cajón). Al imprimir el menú no
    // existe (`print:hidden` adentro de AppNav): las páginas pensadas para
    // imprimir (el pedido al proveedor, el recibo) viven adentro de este
    // layout, y ese papel se lo mandás al proveedor.
    <div className="app-shell min-h-screen bg-fondo-app lg:flex print:block">
      <AppNav
        pantallas={sesionConPantallas?.pantallas ?? null}
        esAdmin={session?.rol === "admin"}
        puedeVerCajaAdmin={puedeVerCajaAdmin}
        puedeGestionarNomina={puedeGestionarNomina}
        puedeEditarConfiguracion={puedeEditarConfiguracion}
        pendientesAprobacion={pendientes.solicitudes}
        etiquetasVencidas={pendientes.etiquetasVencidas}
        nombre={sesionConPantallas?.nombre ?? session?.nombre ?? null}
      />
      <div className="flex-1 min-w-0">
        {avisoSalida.debeRecordar && (
          <div className="print:hidden">
            <AvisoSalidaBanner horaSalida={avisoSalida.horaSalida} />
          </div>
        )}
        {/* Sin márgenes ni ancho máximo al imprimir: la hoja define los suyos. */}
        <main className="max-w-6xl mx-auto px-4 lg:px-6 py-6 print:max-w-none print:p-0">
          <MigaDePan />
          {children}
        </main>
      </div>
    </div>
  );
}
