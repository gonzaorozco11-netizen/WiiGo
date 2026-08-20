"use client";

import { useActionState } from "react";
import { generarHash } from "./actions";

export default function SetupAdminPage() {
  const [state, formAction, pending] = useActionState(generarHash, undefined);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
        <h1 className="text-lg font-semibold text-neutral-900 mb-1">Generar hash de contraseña</h1>
        <p className="text-sm text-neutral-500 mb-6">
          Página temporal, solo para arreglar el primer login. Escribí la contraseña y copiá el
          resultado — no guarda nada.
        </p>

        <form action={formAction} className="space-y-3">
          <input
            name="password"
            type="text"
            placeholder="Contraseña"
            required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full bg-accent hover:bg-accent-dark text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          >
            {pending ? "Generando..." : "Generar"}
          </button>
        </form>

        {state?.hash && (
          <div className="mt-4">
            <p className="text-sm font-medium text-neutral-700 mb-1">Resultado:</p>
            <textarea
              readOnly
              value={state.hash}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs font-mono"
            />
          </div>
        )}
      </div>
    </div>
  );
}
