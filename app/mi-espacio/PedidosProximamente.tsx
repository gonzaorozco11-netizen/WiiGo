import Link from "next/link";

// Lo que ve la profesional en «Pedidos» mientras el módulo está cerrado
// (PEDIDOS_ABIERTOS_PROFESIONALES en lib/pedidosProfesional.ts).
export default function PedidosProximamente() {
  return (
    <main className="esp-lienzo">
      <section className="tarjeta proximamente">
        <span className="proximamente-emoji" aria-hidden="true">
          🛍️
        </span>
        <span className="chip-pronto">¡Próximamente!</span>
        <h1>Pedidos para tus pacientes</h1>
        <p>Muy pronto vas a poder armarle el pedido a tu paciente en la consulta y mandarlo al local, para que lo retire ya preparado.</p>
        <p className="nota">Mientras tanto, tus pacientes suman igual: dicen tu código en la caja junto con su DNI, o los sumás vos desde Mi saldo.</p>
        <Link className="boton claro chico" href="/mi-espacio/saldo">
          Ir a Mi saldo
        </Link>
      </section>
    </main>
  );
}
