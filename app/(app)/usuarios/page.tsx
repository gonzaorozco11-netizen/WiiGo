import { redirect } from "next/navigation";

// Usuarios se movió a vivir como pestaña dentro de Configuración — este
// redirect es solo para que links/marcadores viejos sigan funcionando.
export default function UsuariosPage() {
  redirect("/configuracion");
}
