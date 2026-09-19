import { redirect } from "next/navigation";

// "Abastecimiento (marcas)" se retiró del menú: era la misma pantalla que
// Compras por otra puerta — creaba y recepcionaba pedidos a marcas con las
// mismas funciones y los mismos modales que monta Compras → Recepción.
//
// Lo único propio que tenía, devolverle mercadería fallada a la marca, se
// mudó a esa pantalla, que es el mismo momento y la misma persona.
//
// La ruta queda viva y redirige para que no se rompa ningún link viejo: el
// tablero apuntaba acá, y puede haber un favorito en la máquina de alguien.
//
// Ojo: `app/(app)/reposicion/actions.ts` NO se borra. Ahí viven `crearOrden`,
// `recepcionarOrden` y las dos de devolución, que son las que usa Compras.
export default function ReposicionPage() {
  redirect("/compras/recepcion");
}
