"use client";

import { useEffect, useState } from "react";
import { resumenNomina } from "@/app/(app)/gastos/actions";
import { actualizarSueldoBase } from "@/app/(app)/usuarios/actions";

type UsuarioMin = { id_usuario: string; nombre: string; sueldo_base: number | null };
type NominaFila = { idUsuario: string; nombre: string; sueldoBase: number; adelantado: number; aPagar: number };

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function mesActualISO() {
  return new Date().toISOString().slice(0, 7);
}

export default function RrhhApp({ usuarios }: { usuarios: UsuarioMin[] }) {
  const [mes, setMes] = useState(mesActualISO());
  const [filas, setFilas] = useState<NominaFila[]>([]);
  const [cargando, setCargando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [valorEdit, setValorEdit] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    setCargando(true);
    resumenNomina(mes).then(setFilas).finally(() => setCargando(false));
  }

  useEffect(recargar, [mes]);

  function handleGuardarSueldo(idUsuario: string) {
    const monto = Number(valorEdit.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setGuardando(true);
    actualizarSueldoBase(idUsuario, monto)
      .then((res) => {
        if (res.error) {
          setError(res.error);
          return;
        }
        setEditando(null);
        recargar();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">RR.HH.</h1>
      <p className="text-sm text-neutral-500 mb-5 max-w-2xl">
        👥 Sueldo simplificado por empleado — sueldo base − adelantos del mes = a pagar. No reemplaza un módulo de
        RR.HH. completo (legajos, vacaciones, licencias) — eso se arma aparte, más adelante.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="mb-4">
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Sueldos del mes</h2>
          <span className="text-xs text-neutral-400">Sueldo base − adelantos del mes = a pagar</span>
        </div>
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : usuarios.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">No hay usuarios activos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Empleado</th>
                  <th className="p-3 text-right">Sueldo base</th>
                  <th className="p-3 text-right">Adelantos del mes</th>
                  <th className="p-3 text-right">A pagar</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.idUsuario} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3">{f.nombre}</td>
                    <td className="p-3 text-right tabular-nums">
                      {editando === f.idUsuario ? (
                        <input
                          autoFocus
                          value={valorEdit}
                          onChange={(e) => setValorEdit(e.target.value)}
                          className="w-28 border border-neutral-300 rounded-lg px-2 py-1 text-sm text-right"
                        />
                      ) : (
                        `$${formatearMonto(f.sueldoBase)}`
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums text-red-600">{f.adelantado > 0 ? `-$${formatearMonto(f.adelantado)}` : "—"}</td>
                    <td className="p-3 text-right tabular-nums font-bold">${formatearMonto(f.aPagar)}</td>
                    <td className="p-3 text-right">
                      {editando === f.idUsuario ? (
                        <button onClick={() => handleGuardarSueldo(f.idUsuario)} disabled={guardando} className="text-xs font-semibold text-accent">
                          {guardando ? "..." : "Guardar"}
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setEditando(f.idUsuario);
                            setValorEdit(String(f.sueldoBase));
                          }}
                          className="text-xs font-semibold text-neutral-500 hover:text-accent"
                        >
                          Editar sueldo base
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
