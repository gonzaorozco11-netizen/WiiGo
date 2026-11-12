"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { sumarClienteAlClub, type ClienteClub } from "@/app/(app)/club/actions";

// El alta rápida de WiiGo Club: DNI, nombre y apellido alcanzan para que sume
// puntos desde ya. Se usa adentro de la caja (compacto, con el DNI que ya
// escribió el operativo) y sola en /club/sumar, el acceso directo del Inicio.

const campo = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent";
const etiqueta = "block text-xs font-semibold text-neutral-600 mb-1";

export default function SumarClienteClub({
  dniInicial = "",
  compacto = false,
  onListo,
  onCancelar,
}: {
  dniInicial?: string;
  compacto?: boolean;
  onListo?: (cliente: ClienteClub, yaEstaba: boolean) => void;
  onCancelar?: () => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ cliente: ClienteClub; yaEstaba: boolean } | null>(null);
  const [vuelta, setVuelta] = useState(0);

  function enviar(form: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await sumarClienteAlClub({
        dni: String(form.get("dni") ?? dniInicial),
        nombre: String(form.get("nombre") ?? ""),
        apellido: String(form.get("apellido") ?? ""),
        email: String(form.get("email") ?? ""),
        telefono: String(form.get("telefono") ?? ""),
      });
      if (res.error || !res.cliente) {
        setError(res.error ?? "No se pudo sumar el cliente.");
        return;
      }
      if (onListo) onListo(res.cliente, Boolean(res.yaEstaba));
      else setListo({ cliente: res.cliente, yaEstaba: Boolean(res.yaEstaba) });
    });
  }

  // Sola (acceso directo): la confirmación, y a sumar el siguiente.
  if (listo) {
    const { cliente, yaEstaba } = listo;
    return (
      <div className="space-y-4 text-center">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-5">
          <p className="text-3xl mb-1">⭐</p>
          <p className="text-base font-bold text-emerald-800">
            {cliente.nombre} {cliente.apellido ?? ""} {yaEstaba ? "ya estaba en WiiGo Club" : "ya es WiiGo Club"}
          </p>
          <p className="text-sm text-emerald-700 mt-1">
            {yaEstaba ? `Tiene ${cliente.puntos} puntos.` : "Desde ahora, cada compra con su DNI suma puntos."} DNI {cliente.dni}.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setListo(null);
              setVuelta((v) => v + 1);
            }}
            className="flex-1 rounded-lg border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700"
          >
            Sumar otro
          </button>
          <Link href="/pos" className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2.5 text-sm font-semibold">
            Ir a vender
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form key={vuelta} action={enviar} className={compacto ? "space-y-2 mt-2 bg-emerald-50/60 border border-emerald-200 rounded-lg p-3" : "space-y-3"}>
      {compacto ? (
        <p className="text-xs font-bold text-emerald-800">Sumarlo a WiiGo Club · DNI {dniInicial.replace(/\D/g, "")}</p>
      ) : (
        <div>
          <label className={etiqueta} htmlFor="club-dni">
            DNI
          </label>
          <input id="club-dni" name="dni" defaultValue={dniInicial} required inputMode="numeric" autoFocus placeholder="Sin puntos" className={campo} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={etiqueta} htmlFor="club-nombre">
            Nombre
          </label>
          <input id="club-nombre" name="nombre" required autoFocus={compacto} autoComplete="off" className={campo} />
        </div>
        <div>
          <label className={etiqueta} htmlFor="club-apellido">
            Apellido
          </label>
          <input id="club-apellido" name="apellido" required autoComplete="off" className={campo} />
        </div>
      </div>
      <div className={compacto ? "grid grid-cols-2 gap-2" : "space-y-3"}>
        <div>
          <label className={etiqueta} htmlFor="club-email">
            Mail <span className="font-normal text-neutral-400">(para mandarle sus puntos)</span>
          </label>
          <input id="club-email" name="email" type="email" inputMode="email" autoComplete="off" className={campo} />
        </div>
        <div>
          <label className={etiqueta} htmlFor="club-telefono">
            Celular <span className="font-normal text-neutral-400">(opcional)</span>
          </label>
          <input id="club-telefono" name="telefono" type="tel" inputMode="tel" autoComplete="off" className={campo} />
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-600 font-semibold" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        {onCancelar && (
          <button type="button" onClick={onCancelar} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700">
            Cancelar
          </button>
        )}
        <button type="submit" disabled={pendiente} className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white py-2 text-sm font-bold disabled:opacity-50">
          {pendiente ? "Sumando..." : compacto ? "Sumar y seguir con la venta" : "Sumar al Club"}
        </button>
      </div>
    </form>
  );
}
