"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login } from "./actions";

// Login.
//
// Sin foto de fondo a propósito: es la pantalla que más veces se abre en la
// tablet del mostrador, y una imagen la haría más lenta justo donde hace
// falta que sea rápida. El fondo es el verde salvia de la marca hecho con
// CSS — pesa cero y carga instantáneo.
//
// Acá sí va el logo COMPLETO, con la bajada: es la cara de WiiGo ante alguien
// que todavía no entró. Adentro del sistema va solo el nombre (ver
// app/(app)/layout.tsx).

// Patrón de hojas del fondo. Va acá arriba y no dentro del componente para
// que no se vuelva a armar el string en cada render. La opacidad está metida
// adentro del SVG: tiene que leerse como textura, no competir con el
// formulario. Si alguna vez se quiere más marcado, se sube el `opacity` del
// grupo — arriba de .4 empieza a molestar.
const HOJAS =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='%23a8b49a' stroke-width='1.4' stroke-linecap='round' opacity='.28'%3E%3Cpath d='M30 12c10 8 10 22 0 30-10-8-10-22 0-30z'/%3E%3Cpath d='M30 14v26'/%3E%3Cpath d='M90 72c10 8 10 22 0 30-10-8-10-22 0-30z'/%3E%3Cpath d='M90 74v26'/%3E%3Cpath d='M78 30c8-6 18-4 22 4-8 6-18 4-22-4z'/%3E%3Cpath d='M18 90c8-6 18-4 22 4-8 6-18 4-22-4z'/%3E%3C/g%3E%3C/svg%3E";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const [state, formAction, pending] = useActionState(login, undefined);

  // Más grandes que en el resto del sistema: esto se completa con el dedo en
  // una tablet, muchas veces por día.
  const campo =
    "w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base text-neutral-900 " +
    "focus:outline-none focus:ring-2 focus:ring-[#8a9a78] focus:border-transparent";

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{
        // Dos capas: el patrón de hojas arriba, el degradado abajo. El dibujo
        // es un SVG escrito acá mismo (unos 400 bytes), no un archivo — así
        // el login no espera ninguna descarga para verse completo.
        backgroundImage: `url("${HOJAS}"), radial-gradient(1100px 600px at 50% -10%, #e8eee1 0%, #f3f5f0 45%, #fbfcfa 100%)`,
        backgroundSize: "120px 120px, auto",
      }}
    >
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/wiigo-logo.png"
          alt="WiiGo — Estaciones de Bienestar"
          className="h-11 w-auto mx-auto mb-7"
        />

        <form
          action={formAction}
          className="bg-white rounded-2xl border border-[#e4e8dd] p-7 shadow-[0_1px_3px_rgba(42,47,38,.06)]"
        >
          <h1 className="text-lg font-semibold text-neutral-900 mb-1">Ingresá a tu cuenta</h1>
          <p className="text-sm text-neutral-500 mb-6">Con el mail y la contraseña que te dieron.</p>

          <input type="hidden" name="next" value={next} />

          <label className="block text-sm font-medium text-neutral-700 mb-1.5" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            // En la tablet el teclado arranca en mayúscula y le rompe el mail
            // al que escribe rápido. Estos tres atributos lo evitan, y el
            // autoComplete deja que el navegador lo recuerde.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            inputMode="email"
            className={`${campo} mb-4`}
          />

          <label className="block text-sm font-medium text-neutral-700 mb-1.5" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={`${campo} mb-5`}
          />

          {state?.error && (
            <p
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-4"
              role="alert"
            >
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-[#536243] hover:bg-[#45532f] text-white rounded-xl py-3 text-[15px] font-semibold disabled:opacity-50"
          >
            {pending ? "Ingresando…" : "Ingresar"}
          </button>
        </form>

        {/* La frase va acá abajo y no arriba a propósito: cuando terminás de
            escribir la contraseña, la vista queda justo en esta zona. Es lo
            último que ve el equipo antes de entrar a trabajar. */}
        <div className="mt-8 text-center">
          <p className="text-[13px] font-semibold text-[#6d8058] tracking-wide">
            El futuro del retail se construye acá
          </p>
          <p className="text-[11.5px] text-[#a3aa9b] mt-2.5">
            ¿No podés entrar? Escribile a administración.
          </p>
        </div>
      </div>
    </div>
  );
}
