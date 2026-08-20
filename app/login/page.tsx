"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login } from "./actions";

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <form
        action={formAction}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-neutral-200 p-8"
      >
        <h1 className="text-xl font-semibold text-neutral-900 mb-1">WiiGo</h1>
        <p className="text-sm text-neutral-500 mb-6">Ingresá con tu usuario para continuar.</p>

        <input type="hidden" name="next" value={next} />

        <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-accent"
        />

        <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-accent"
        />

        {state?.error && (
          <p className="text-sm text-red-600 mb-4" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full bg-accent hover:bg-accent-dark text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
