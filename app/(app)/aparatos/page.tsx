import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase";
import { COOKIE_APARATO, leerAparato } from "@/lib/aparatoLocal";
import { registrarEsteAparato, darDeBajaAparato } from "./actions";

// Tablets del local (Gonzalo, 2026-11-16): los operativos fichan, cobran y
// venden solo en un aparato registrado acá. Desde su celular les queda la
// góndola, sus recibos y Aprender (lib/aparatoLocal.ts). Solo el Dueño.
export const dynamic = "force-dynamic";

const ERRORES: Record<string, string> = {
  permiso: "Solo el Dueño puede registrar tablets.",
  config: "La app no está configurada (falta AUTH_SECRET).",
  sql: "Falta correr sql/aparatos-local.sql en Supabase.",
  guardar: "No se pudo guardar. Probá de nuevo.",
};

const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default async function AparatosPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const cookieStore = await cookies();
  const sesion = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (sesion?.rol !== "admin") {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-1">No tenés permiso para ver esta pantalla</p>
        <p className="text-sm text-neutral-500">Las tablets del local las maneja solo el Dueño.</p>
      </div>
    );
  }

  const { error: codigoError, ok } = await searchParams;
  const este = await leerAparato(cookieStore.get(COOKIE_APARATO)?.value, process.env.AUTH_SECRET ?? "");
  const { data, error } = await getSupabaseServerClient()
    .from("aparatos_local")
    .select("id_aparato, nombre, registrado_en, baja_en")
    .order("registrado_en", { ascending: false });
  const faltaSql = Boolean(error);
  const aparatos = (data ?? []) as { id_aparato: string; nombre: string; registrado_en: string; baja_en: string | null }[];
  const activos = aparatos.filter((a) => !a.baja_en);
  const esteActivo = este ? activos.find((a) => a.id_aparato === este.id) : undefined;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-neutral-900">Tablets del local</h1>
      <p className="text-sm text-neutral-500 mt-1 mb-6 max-w-prose">
        Los operativos fichan, abren la caja, venden y cobran <b>solo en estas tablets</b>. Desde su celular les queda la góndola, sus recibos y
        Aprender. Vos entrás desde cualquier lado.
      </p>

      {(faltaSql || codigoError) && (
        <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {faltaSql ? ERRORES.sql : ERRORES[codigoError ?? ""] ?? ERRORES.guardar}
        </p>
      )}
      {ok && esteActivo && (
        <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Listo: este aparato quedó como <b>{esteActivo.nombre}</b>. Ya podés salir y que el equipo entre con su usuario.
        </p>
      )}

      {/* Este aparato: el que tenés en la mano. */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 mb-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">Este aparato</h2>
        {esteActivo ? (
          <p className="text-[15px] text-neutral-800">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-2 align-middle" aria-hidden="true" />
            Es <b>{esteActivo.nombre}</b>: acá el equipo puede fichar y cobrar.
          </p>
        ) : (
          <form action={registrarEsteAparato} className="grid gap-3">
            <p className="text-[15px] text-neutral-800">
              No está registrado. Si es la tablet del local, ponele un nombre y registrala <b>desde la misma tablet</b>.
            </p>
            <div className="flex flex-wrap gap-2">
              <label htmlFor="nombre" className="sr-only">
                Nombre de la tablet
              </label>
              <input
                id="nombre"
                name="nombre"
                defaultValue="Tablet mostrador"
                maxLength={60}
                className="flex-1 min-w-[200px] rounded-xl border border-neutral-300 px-4 py-2.5 text-[15px]"
              />
              <button type="submit" disabled={faltaSql} className="rounded-xl bg-neutral-900 px-5 py-2.5 text-[15px] font-semibold text-white disabled:opacity-40">
                Registrar como tablet del local
              </button>
            </div>
          </form>
        )}
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">Registradas · {activos.length}</h2>
        {activos.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-neutral-200 px-5 py-6 text-center text-sm text-neutral-500">
            Todavía ninguna. Mientras tanto, los operativos no pueden fichar ni cobrar en ningún lado.
          </p>
        ) : (
          <ul className="rounded-2xl border border-neutral-200 bg-white divide-y divide-neutral-100">
            {activos.map((a) => (
              <li key={a.id_aparato} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-neutral-900">
                    {a.nombre}
                    {a.id_aparato === este?.id && <span className="ml-2 text-xs font-bold text-emerald-700">· esta</span>}
                  </span>
                  <span className="block text-xs text-neutral-500">Registrada el {fecha(a.registrado_en)}</span>
                </span>
                <form action={darDeBajaAparato}>
                  <input type="hidden" name="id" value={a.id_aparato} />
                  <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-700 hover:border-red-300 hover:text-red-700">
                    Dar de baja
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-neutral-500 mt-3 max-w-prose">
          Si se pierde o se cambia una tablet, dala de baja: deja de abrir el sistema al toque. Si se borran los datos del navegador de la tablet, hay
          que registrarla de nuevo.
        </p>
      </section>
    </div>
  );
}
