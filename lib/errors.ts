// Traduce errores comunes de Postgres/Supabase a mensajes que un usuario
// sin conocimientos técnicos pueda entender.

export function friendlyDbError(error: { code?: string; message: string }): string {
  if (error.code === "23503") {
    return "No se puede borrar: tiene otros registros asociados (productos, ventas, stock, etc.). Probá desactivarlo en vez de borrarlo.";
  }
  if (error.code === "23505") {
    return "Ya existe un registro con ese mismo valor.";
  }
  return error.message;
}
