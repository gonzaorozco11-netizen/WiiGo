"use client";

import { useEffect } from "react";

// Ventana chica pero real: cuando el pago se acredita, el sistema marca la
// venta como pagada y recién después pide el CAE a ARCA. Si el cliente
// escanea el QR justo en ese intervalo, ve el comprobante sin la factura.
// Esto vuelve a pedir la página hasta que aparezca, con un tope para no
// dejarlo recargando para siempre si ARCA falló.
export default function RecargarComprobante({ intentos = 6, cadaMs = 4000 }: { intentos?: number; cadaMs?: number }) {
  useEffect(() => {
    const clave = "wiigo-espera-factura";
    const hechos = Number(sessionStorage.getItem(clave) ?? "0");
    if (hechos >= intentos) return;

    const id = setTimeout(() => {
      sessionStorage.setItem(clave, String(hechos + 1));
      location.reload();
    }, cadaMs);
    return () => clearTimeout(id);
  }, [intentos, cadaMs]);

  return null;
}
