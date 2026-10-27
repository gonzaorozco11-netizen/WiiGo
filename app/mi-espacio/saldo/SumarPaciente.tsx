"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sumarPaciente } from "../actions";

// Registrar a un paciente sin armarle un pedido: nombre, apellido y DNI.
export default function SumarPaciente({ meses }: { meses: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState({ nombre: "", apellido: "", dni: "", telefono: "" });
  const [acepta, setAcepta] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);

  function sumar() {
    setError(null);
    setEnviando(true);
    sumarPaciente({ ...datos, acepta })
      .then((r) => {
        if (r.error) return setError(r.error);
        const hasta = r.hasta ? new Date(r.hasta).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
        setListo(`Listo: ${datos.nombre} quedó como tu paciente${hasta ? ` hasta el ${hasta}` : ""}.`);
        setDatos({ nombre: "", apellido: "", dni: "", telefono: "" });
        setAcepta(false);
        setAbierto(false);
        router.refresh();
      })
      .finally(() => setEnviando(false));
  }

  if (!abierto) {
    return (
      <div className="sumar-paciente">
        {listo && <p className="aviso-ok">{listo}</p>}
        <button type="button" className="boton claro" onClick={() => setAbierto(true)}>
          + Sumar paciente
        </button>
      </div>
    );
  }

  return (
    <div className="sumar-paciente">
      <p className="nota">
        Para registrar a alguien sin armarle un pedido. Durante {meses} meses lo que compre en WiiGo suma para vos, aunque no diga el código.
      </p>
      <div className="campos">
        <label className="campo">
          <span>Nombre</span>
          <input value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} />
        </label>
        <label className="campo">
          <span>Apellido</span>
          <input value={datos.apellido} onChange={(e) => setDatos({ ...datos, apellido: e.target.value })} />
        </label>
        <label className="campo">
          <span>DNI</span>
          <input value={datos.dni} inputMode="numeric" onChange={(e) => setDatos({ ...datos, dni: e.target.value })} />
        </label>
        <label className="campo">
          <span>WhatsApp (opcional)</span>
          <input value={datos.telefono} inputMode="tel" onChange={(e) => setDatos({ ...datos, telefono: e.target.value })} />
        </label>
      </div>
      <label className="acepta">
        <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
        <span>{datos.nombre || "Mi paciente"} acepta sumarse a WiiGo Club.</span>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="botones-fila">
        <button type="button" className="boton" disabled={enviando} onClick={sumar}>
          {enviando ? "Sumando..." : "Sumar paciente"}
        </button>
        <button type="button" className="agregar" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
