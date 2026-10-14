// Disparar los avisos de una venta desde la pantalla, sin esperarlos.
//
// `keepalive` es lo que hace que el pedido sobreviva aunque el cajero cierre
// la pantalla o pase a otra en el mismo segundo: el navegador lo termina de
// mandar igual. Sin eso, un clic rápido en "Nueva venta" cancelaría el aviso.
//
// No devuelve nada ni tira: si falla, falló un mail, y la venta ya está
// cobrada. Lo que pasó queda registrado del lado del servidor en
// `avisos_enviados`, que es donde se mira cuando una marca dice que no le
// llegó nada.

export function dispararAvisosDeVenta(idVenta: string): void {
  if (!idVenta) return;
  try {
    void fetch("/api/avisos/venta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idVenta }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Un navegador sin keepalive no puede romper una venta.
  }
}
