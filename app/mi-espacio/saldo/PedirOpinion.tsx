"use client";

import { useState } from "react";
import { pedirOpinionPaciente } from "../actions";
import { linkWhatsApp } from "@/lib/pedidosProfesional";
import { mensajePedidoOpinion } from "@/lib/opinionesPacientes";

// "Pedirle su opinión" al lado de cada paciente. Primero arma el link y después
// muestra el botón de WhatsApp: abrir WhatsApp recién después de esperar al
// servidor lo bloquean algunos navegadores, un link tocado no.
export default function PedirOpinion({ idVinculo, pedidoEl }: { idVinculo: string; pedidoEl: string | null }) {
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ wa: string; link: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  function armar() {
    setError(null);
    setTrabajando(true);
    pedirOpinionPaciente(idVinculo)
      .then((r) => {
        if (r.error || !r.camino) return setError(r.error ?? "No se pudo armar el link.");
        const link = `${window.location.origin}${r.camino}`;
        setListo({ wa: linkWhatsApp(r.telefono ?? null, mensajePedidoOpinion(r.nombre ?? "", r.profesional ?? "", link)), link });
      })
      .finally(() => setTrabajando(false));
  }

  function copiar() {
    if (!listo) return;
    navigator.clipboard
      ?.writeText(listo.link)
      .then(() => setCopiado(true))
      .catch(() => setCopiado(false));
  }

  if (listo) {
    return (
      <div className="pedir-opinion">
        <a className="boton-wa" href={listo.wa} target="_blank" rel="noopener noreferrer">
          Mandar por WhatsApp
        </a>
        <button type="button" className="agregar" onClick={copiar}>
          {copiado ? "✓ Link copiado" : "Copiar el link"}
        </button>
      </div>
    );
  }

  return (
    <div className="pedir-opinion">
      <button type="button" className="boton-wa" disabled={trabajando} onClick={armar}>
        {trabajando ? "Armando..." : pedidoEl ? "Pedírsela de nuevo" : "Pedirle su opinión"}
      </button>
      {pedidoEl && !error && (
        <span className="estado-opinion espera">Se la pediste el {new Date(pedidoEl).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}</span>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
