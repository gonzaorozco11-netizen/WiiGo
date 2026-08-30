"use client";

import { useState } from "react";

export default function ModalAnularMovimiento({
  titulo,
  descripcion,
  onConfirmar,
  onClose,
}: {
  titulo: string;
  descripcion: string;
  onConfirmar: (motivo: string) => Promise<{ error: string | null }>;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function confirmar() {
    setError(null);
    setGuardando(true);
    onConfirmar(motivo)
      .then((res) => {
        if (res.error) {
          setError(res.error);
          setGuardando(false);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "No se pudo eliminar");
        setGuardando(false);
      });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">{titulo}</h2>
        <p className="text-sm text-neutral-500 mb-4">{descripcion}</p>
        <label className="block text-sm font-medium text-neutral-700 mb-1">¿Por qué lo eliminás?</label>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej: lo cargué duplicado, monto mal tipeado, etc."
          rows={3}
          className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-3"
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <p className="text-xs text-neutral-400 mb-4">
          No se borra del todo — queda guardado como anulado, con el motivo, por si hay que revisarlo después. Deja de
          sumar en todos los reportes.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 rounded-lg">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={guardando || !motivo.trim()}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg"
          >
            {guardando ? "Eliminando..." : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}
