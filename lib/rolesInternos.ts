// Quién es "del equipo de WiiGo" y quién es de afuera.
//
// Va como lista de los roles internos y no como lista de los externos: el
// día que aparezca un rol nuevo, por defecto queda afuera del sistema interno
// hasta que alguien decida lo contrario. Antes se preguntaba `rol === "marca"`
// y cualquier rol nuevo (como el de las profesionales) pasaba como empleado.
//
// Sin imports a propósito: lo usa también proxy.ts, que corre en Edge.

// "" es el rol de los usuarios viejos que tienen el campo vacío: el sistema
// siempre los trató como operativos (ver lib/roles.ts).
const ROLES_INTERNOS = new Set(["admin", "operativo", ""]);

export function esRolInterno(rol: string | null | undefined): boolean {
  return ROLES_INTERNOS.has(rol ?? "");
}

/** La casa de cada rol de afuera: a dónde se lo manda si pide otra cosa. */
export const INICIO_ROL_EXTERNO: Record<string, string> = {
  marca: "/portal",
  profesional: "/mi-espacio",
};
