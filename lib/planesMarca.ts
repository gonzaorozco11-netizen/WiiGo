// Los planes del portal de marcas: qué son, en qué orden van y qué incluye
// cada uno.
//
// Vive separado de marcaSesion.ts, que importa `next/headers` para leer la
// cookie y por eso solo puede correr del lado del servidor. Esto son datos
// puros: lo usan tanto los server actions como el tablero, que es un
// componente de cliente. Mismo criterio que lib/estadosOrden.ts.

export const PLANES = ["BRONCE", "METAL", "GOLD"] as const;
export type PlanMarca = (typeof PLANES)[number];

/** Orden de los planes: sirve para preguntar "¿tiene al menos Metal?". */
export const NIVEL: Record<PlanMarca, number> = { BRONCE: 1, METAL: 2, GOLD: 3 };

/**
 * Cómo se llama cada plan para la marca.
 *
 * El del medio se guarda como METAL en la base pero se muestra "Silver":
 * Bronce → Silver → Gold se entiende sin que nadie lo explique, y "Metal" al
 * lado de "Gold" no dice si está arriba o abajo. Se cambia solo la etiqueta y
 * no el valor para no migrar la columna `marcas.plan` por un tema de nombre.
 */
export const ETIQUETA_PLAN: Record<PlanMarca, string> = {
  BRONCE: "Bronce",
  METAL: "Silver",
  GOLD: "Gold",
};

/** La inicial de la medalla. */
export const INICIAL_PLAN: Record<PlanMarca, string> = {
  BRONCE: "B",
  METAL: "S",
  GOLD: "G",
};

/**
 * Por qué le conviene subir, dicho en lo que le cambia a ella y no en qué
 * pantalla se desbloquea. "Ranking de productos" no le mueve la aguja a
 * nadie; "saber qué reponer esta semana", sí.
 */
export const PITCH_PLAN: Partial<Record<PlanMarca, string>> = {
  METAL:
    "Dejás de mirar lo que pasó y empezás a saber qué hacer: qué reponer esta semana, qué producto tira y cuál se quedó dormido.",
  GOLD:
    "Te comparás con el resto de las marcas de WiiGo y sabés en qué día, en qué hora y en qué sucursal conviene estar.",
};

/** ¿El plan de la marca llega al nivel pedido? */
export function planIncluye(plan: PlanMarca, minimo: PlanMarca): boolean {
  return NIVEL[plan] >= NIVEL[minimo];
}

/**
 * Qué suma cada plan, escrito para la marca y no para nosotros.
 *
 * Una sola lista para las dos cosas que ella ve —qué tiene y qué le falta—
 * porque son la misma información leída desde dos lados. Con dos listas
 * separadas, el día que una función cambie de plan hay que acordarse de tocar
 * las dos, y la que queda vieja miente.
 *
 * Acá va solo lo que SUMA ese escalón. Lo que tiene una marca sale de
 * `beneficiosHasta`, que acumula los de abajo.
 */
export const SUMA_EL_PLAN: Record<PlanMarca, string[]> = {
  BRONCE: [
    "Tus ventas y lo que te queda cada mes",
    "Tus productos, su stock y tu margen",
    "Pedir cambios y proponer envíos",
    "Tus pagos y liquidaciones",
  ],
  METAL: [
    "Para hacer esta semana",
    "Ranking de tus productos",
    "Alertas de stock",
    "Objetivo del mes",
  ],
  GOLD: [
    "Cómo rendís frente al resto",
    "Cuándo se vende lo tuyo",
    "Por sucursal",
    "Proyección del mes",
  ],
};

/** Todo lo que incluye un plan, sumando los escalones de abajo. */
export function beneficiosHasta(plan: PlanMarca): string[] {
  return PLANES.filter((p) => NIVEL[p] <= NIVEL[plan]).flatMap((p) => SUMA_EL_PLAN[p]);
}

/** El plan de arriba, o null si ya está en el último. */
export function planSiguiente(plan: PlanMarca): PlanMarca | null {
  return PLANES.find((p) => NIVEL[p] === NIVEL[plan] + 1) ?? null;
}

/** Todos los que están por encima, en orden. Vacío si ya está en el último. */
export function planesPorEncima(plan: PlanMarca): PlanMarca[] {
  return PLANES.filter((p) => NIVEL[p] > NIVEL[plan]);
}
