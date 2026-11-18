import type { SupabaseClient } from "@supabase/supabase-js";
import { CLAVE_COMISION_COBRO, POSNET_POR_DEFECTO } from "@/lib/formasPago";

// Las tasas y reglas de Rentabilidad — Marca Propia (Configuración). Estaba
// adentro de app/(app)/rentabilidad/actions.ts; se pasó acá (18/11) para que
// «Ventas de hoy» del Inicio calcule con lo mismo, sin exponerlo como acción.

// Coincide con `pagos.forma_pago_cliente` (ver cobros-efectivo/actions.ts)
// y con Configuración → Comisión de Mercado Pago — no hay una sola
// comisión de MP, varía según cómo pagó el cliente.
// Incluye las del posnet (ver lib/formasPago.ts).
const CLAVE_COMISION_MP: Record<string, string> = CLAVE_COMISION_COBRO;

// Qué se descuenta según la forma de pago es configurable — Efectivo y
// Mercado Pago pueden tener reglas distintas (ej. no descontar IVA en
// efectivo), se carga en Configuración → Rentabilidad — Marca Propia.
const CLAVES_DESCUENTOS = [
  "RENT_EFECTIVO_IVA",
  "RENT_EFECTIVO_IIBB",
  "RENT_EFECTIVO_IMP_CREDITOS",
  "RENT_MP_IVA",
  "RENT_MP_IIBB",
  "RENT_MP_IMP_CREDITOS",
  "RENT_MP_COMISION",
] as const;

export type TasasRentabilidad = Awaited<ReturnType<typeof tasasRentabilidad>>;

export async function tasasRentabilidad(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [
      "IVA_GENERAL_PORCENTAJE",
      "IIBB_PORCENTAJE",
      "IMP_CREDITOS_PORCENTAJE",
      ...Object.values(CLAVE_COMISION_MP),
      ...CLAVES_DESCUENTOS,
    ]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, r.valor]));
  const bool = (clave: string, porDefecto: boolean) => (cfg[clave] === undefined ? porDefecto : cfg[clave] === "true");
  return {
    ivaGeneral: Number(cfg.IVA_GENERAL_PORCENTAJE ?? 21),
    iibb: Number(cfg.IIBB_PORCENTAJE ?? 0),
    impCreditos: Number(cfg.IMP_CREDITOS_PORCENTAJE ?? 0),
    mpComisionPorFormaPago: Object.fromEntries(
      Object.entries(CLAVE_COMISION_MP).map(([forma, clave]) => [
        forma,
        Number(cfg[clave] ?? (forma === "POSNET_DEBITO" ? POSNET_POR_DEFECTO.debito : forma === "POSNET_CREDITO" ? POSNET_POR_DEFECTO.credito : 0)),
      ])
    ) as Record<string, number>,
    // Por defecto Efectivo no descuenta nada (no hay rastro bancario) y
    // Mercado Pago descuenta todo — mismo comportamiento que había antes
    // de que esto fuera configurable, hasta que se cambie a mano.
    efectivo: {
      iva: bool("RENT_EFECTIVO_IVA", false),
      iibb: bool("RENT_EFECTIVO_IIBB", false),
      impCreditos: bool("RENT_EFECTIVO_IMP_CREDITOS", false),
      // En efectivo nunca hay comisión de Mercado Pago de por medio — se
      // deja en false siempre, para que ambas ramas (efectivo/MP) tengan
      // la misma forma y "reglas.comision" sea seguro de leer más abajo.
      comision: false,
    },
    mercadoPago: {
      iva: bool("RENT_MP_IVA", true),
      iibb: bool("RENT_MP_IIBB", true),
      impCreditos: bool("RENT_MP_IMP_CREDITOS", true),
      comision: bool("RENT_MP_COMISION", true),
    },
  };
}
