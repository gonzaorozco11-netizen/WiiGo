import Link from "next/link";
import type { OrdenCompra, RecibidoSinCostear } from "@/lib/compras";

// Las filas de las listas de Compras. Sirven para las tres etapas porque las
// tres muestran lo mismo: a quién, cuándo, cuánto hace, y un botón.
//
// El color del borde izquierdo dice a quién le pediste — violeta una marca,
// azul un proveedor. No es decoración: lo que pasa después es distinto (a la
// marca se le cobra royalty, al proveedor se le paga el costo), y conviene
// verlo antes de abrir nada.

function fechaCorta(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function haceCuanto(dias: number) {
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

export function ChipOrigen({ origen }: { origen: "MARCA" | "PROVEEDOR" }) {
  return (
    <span
      className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
        origen === "MARCA"
          ? "bg-violet-50 text-violet-700 border-violet-200"
          : "bg-accent-tint text-accent border-blue-200"
      }`}
    >
      {origen === "MARCA" ? "Marca" : "Proveedor"}
    </span>
  );
}

export function FilaOrden({
  o,
  href,
  accion,
}: {
  o: OrdenCompra;
  href: string;
  accion: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 flex-wrap border border-neutral-200 border-l-[3px] rounded-xl px-4 py-3 bg-white hover:border-neutral-300 ${
        o.origen === "MARCA" ? "border-l-violet-500" : "border-l-accent"
      }`}
    >
      <span className="flex-1 min-w-[200px]">
        <span className="block font-semibold text-[14.5px] text-neutral-900">{o.contraparte}</span>
        <span className="block text-xs text-neutral-400">
          Pedida el {fechaCorta(o.fecha)} · {o.totalUnidades} unidades · {o.local}
        </span>
      </span>
      <ChipOrigen origen={o.origen} />
      <span className="text-right min-w-[86px]">
        <span className="block text-[13px] font-semibold text-neutral-700">
          {o.estado === "PENDIENTE" ? "Esperando" : o.estado === "RECIBIDA" ? "Recibida" : "Con diferencias"}
        </span>
        <span className="block text-[11px] text-neutral-400">{haceCuanto(o.diasEsperando)}</span>
      </span>
      <span className="text-[13px] font-semibold text-accent whitespace-nowrap">{accion} →</span>
    </Link>
  );
}

const MODO_TEXTO: Record<string, string> = {
  LIQUIDACION_VENTA: "Liquidación mensual",
  REMITO: "Factura por entrega",
  PERIODO: "Factura por período",
};

export function FilaCosteo({ r, href }: { r: RecibidoSinCostear; href: string }) {
  // Más de tres días sin costear ya distorsiona la liquidación del mes: se
  // marca en rojo, no como un aviso más.
  const urgente = r.diasSinCostear > 3;
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 flex-wrap border border-l-[3px] rounded-xl px-4 py-3 hover:border-neutral-300 ${
        urgente ? "border-red-200 border-l-red-500 bg-red-50" : "border-neutral-200 border-l-accent bg-white"
      }`}
    >
      <span className="flex-1 min-w-[200px]">
        <span className="block font-semibold text-[14.5px] text-neutral-900">{r.contraparte}</span>
        <span className="block text-xs text-neutral-400">
          Recibido el {fechaCorta(r.fecha)} · {r.productos} {r.productos === 1 ? "producto" : "productos"} ·{" "}
          {haceCuanto(r.diasSinCostear)}
        </span>
      </span>
      <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full border bg-neutral-50 text-neutral-500 border-neutral-200 whitespace-nowrap">
        {MODO_TEXTO[r.modoFacturacion] ?? r.modoFacturacion}
      </span>
      <span className={`text-[13px] font-semibold whitespace-nowrap ${urgente ? "text-red-700" : "text-accent"}`}>
        Costear →
      </span>
    </Link>
  );
}

export function Vacio({ texto }: { texto: string }) {
  return (
    <p className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-4 text-sm font-medium text-center">
      ✓ {texto}
    </p>
  );
}
