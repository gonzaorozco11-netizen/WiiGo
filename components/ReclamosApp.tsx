"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Reclamo } from "@/lib/reclamos";
import { cargarNotaCredito, descartarReclamo } from "@/app/(app)/compras/reclamos/actions";

// Reclamos: la plata que un proveedor te debe y todavía no devolvió.
//
// Una sola salida — la nota de crédito — porque una sola cosa cierra esto de
// verdad. Descartar está para cuando se revisó y no correspondía, y también
// deja rastro.

function monto(v: number) {
  return v.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function fechaCorta(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** De dónde salió el reclamo, leído del motivo que dejó quien lo generó. */
function origen(motivo: string): { icono: string; etiqueta: string } {
  const m = motivo.toLowerCase();
  if (m.includes("no entr") || m.includes("cerrado incompleto") || m.includes("faltante")) {
    return { icono: "📦", etiqueta: "Pedido cerrado incompleto" };
  }
  if (m.includes("devol")) return { icono: "↩️", etiqueta: "Devolución" };
  return { icono: "🧾", etiqueta: "Facturó de más" };
}

type Filtro = "PENDIENTE" | "ACREDITADO" | "DESCARTADO" | "TODOS";

export default function ReclamosApp({ reclamos }: { reclamos: Reclamo[] }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("PENDIENTE");
  const [abierto, setAbierto] = useState<Reclamo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const pendientes = reclamos.filter((r) => r.estado === "PENDIENTE");
  const aFavor = pendientes.reduce((a, r) => a + r.total, 0);

  const visibles = useMemo(
    () => (filtro === "TODOS" ? reclamos : reclamos.filter((r) => r.estado === filtro)),
    [reclamos, filtro]
  );

  const filtros: { clave: Filtro; texto: string }[] = [
    { clave: "PENDIENTE", texto: `Sin resolver (${pendientes.length})` },
    { clave: "ACREDITADO", texto: "Acreditados" },
    { clave: "DESCARTADO", texto: "Descartados" },
    { clave: "TODOS", texto: "Todos" },
  ];

  function descartar(r: Reclamo) {
    const motivo = window.prompt(
      `Vas a descartar el reclamo a ${r.proveedor} por $${monto(r.total)}.\n\n` +
        "Usalo cuando revisaste y estaba bien facturado, o se arregló de otra forma.\n\n" +
        "¿Por qué lo descartás?",
      ""
    );
    if (motivo === null) return;
    setError(null);
    setTrabajando(r.idReclamo);
    descartarReclamo(r.idReclamo, motivo)
      .then((res) => {
        if (res.error) setError(res.error);
        else router.refresh();
      })
      .finally(() => setTrabajando(null));
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold text-neutral-900">⚠️ Reclamos</h1>
        {pendientes.length > 0 && (
          <p className="text-sm text-neutral-500 tabular-nums">
            {pendientes.length} sin resolver ·{" "}
            <b className="tipo-titulo text-lg text-red-600">${monto(aFavor)}</b> a favor tuyo
          </p>
        )}
      </div>
      <p className="text-sm text-neutral-500 mt-1 mb-4">
        Plata que un proveedor te debe. Nacen solos desde Costeo, al cerrar un pedido incompleto y al devolver
        mercadería — no se cargan a mano.
      </p>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
      )}

      <div className="flex gap-1.5 flex-wrap mb-4">
        {filtros.map((f) => (
          <button
            key={f.clave}
            onClick={() => setFiltro(f.clave)}
            className={`text-xs font-semibold rounded-lg px-2.5 py-1 border ${
              filtro === f.clave
                ? "bg-neutral-800 text-white border-neutral-800"
                : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {f.texto}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-6 text-sm font-medium text-center">
          ✓ {filtro === "PENDIENTE" ? "No hay nada para reclamar. Todo al día." : "No hay reclamos en este estado."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visibles.map((r) => {
            const o = origen(r.motivo);
            const cerrado = r.estado !== "PENDIENTE";
            return (
              <div
                key={r.idReclamo}
                className={`border border-l-[3px] rounded-xl px-4 py-3 flex gap-3 items-start flex-wrap ${
                  cerrado ? "border-neutral-200 border-l-neutral-300 bg-neutral-50" : "border-amber-200 border-l-amber-500 bg-white"
                }`}
              >
                <span className="text-lg shrink-0" aria-hidden="true">
                  {r.estado === "ACREDITADO" ? "✓" : r.estado === "DESCARTADO" ? "—" : o.icono}
                </span>

                <span className="flex-1 min-w-[210px]">
                  <span className="block font-semibold text-[14.5px] text-neutral-900">
                    {r.proveedor}
                    <span
                      className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        r.estado === "ACREDITADO"
                          ? "bg-emerald-50 text-emerald-700"
                          : r.estado === "DESCARTADO"
                            ? "bg-neutral-100 text-neutral-500"
                            : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {r.estado === "ACREDITADO" ? "Acreditado" : r.estado === "DESCARTADO" ? "Descartado" : o.etiqueta}
                    </span>
                  </span>
                  <span className="block text-xs text-neutral-400">
                    {r.numeroFactura ? `Factura ${r.numeroFactura} · ` : ""}
                    {r.idOrden ? `pedido #${r.idOrden.slice(0, 6).toUpperCase()} · ` : ""}
                    {r.estado === "ACREDITADO"
                      ? `NC ${r.ncNumero} del ${fechaCorta(r.ncFecha)}`
                      : r.dias === 0
                        ? "hoy"
                        : `hace ${r.dias} días`}
                  </span>
                  {/* El motivo en las palabras de quien lo escribió: dentro de
                      un mes es lo único que explica por qué se reclamó. */}
                  <span className="block text-xs text-neutral-600 italic mt-1 whitespace-pre-line">{r.motivo}</span>
                </span>

                <span className="text-right tabular-nums shrink-0">
                  <span
                    className={`tipo-titulo block text-xl font-bold ${
                      r.estado === "ACREDITADO" ? "text-emerald-700" : cerrado ? "text-neutral-400" : "text-amber-700"
                    }`}
                  >
                    ${monto(r.estado === "ACREDITADO" ? r.ncMonto ?? r.total : r.total)}
                  </span>
                  <span className="block text-[10.5px] text-neutral-400">
                    neto ${monto(r.neto)} + IVA ${monto(r.iva)}
                  </span>
                </span>

                {!cerrado && (
                  <span className="flex items-center gap-2 self-center shrink-0">
                    <button
                      onClick={() => descartar(r)}
                      disabled={trabajando === r.idReclamo}
                      className="text-xs font-semibold text-neutral-500 border border-neutral-300 rounded-lg px-2.5 py-1.5 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Descartar
                    </button>
                    <button
                      onClick={() => setAbierto(r)}
                      className="text-xs font-bold text-white bg-accent hover:bg-accent-dark rounded-lg px-3 py-1.5"
                    >
                      Cargar nota de crédito
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-neutral-400 mt-5">
        La nota de crédito baja la cuenta corriente y el crédito fiscal, pero <b>no le baja el costo al producto</b>:
        esa plata ya se repartió en la mercadería que entró, y puede estar vendida o liquidada.{" "}
        <Link href="/proveedores" className="text-accent hover:underline">
          Ver cuentas corrientes
        </Link>
      </p>

      {abierto && (
        <NotaCreditoModal
          reclamo={abierto}
          onClose={() => {
            setAbierto(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function NotaCreditoModal({ reclamo, onClose }: { reclamo: Reclamo; onClose: () => void }) {
  // Precargado con lo que se reclamó, pero editable: manda lo que dice el
  // papel, igual que con la factura.
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [neto, setNeto] = useState(String(reclamo.neto || ""));
  const [impuestos, setImpuestos] = useState(String(reclamo.impuestos || ""));
  const [retenciones, setRetenciones] = useState(String(reclamo.retenciones || ""));
  const [descuentos, setDescuentos] = useState("");
  const [iva, setIva] = useState(String(reclamo.iva || ""));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = (v: string) => Number(v) || 0;
  const total = n(neto) + n(impuestos) + n(retenciones) - n(descuentos) + n(iva);

  function guardar() {
    setError(null);
    setGuardando(true);
    cargarNotaCredito({
      idReclamo: reclamo.idReclamo,
      numero,
      fecha,
      neto: n(neto),
      impuestos: n(impuestos),
      retenciones: n(retenciones),
      descuentos: n(descuentos),
      iva: n(iva),
    })
      .then((r) => {
        if (r.error) setError(r.error);
        else {
          if (r.aviso) window.alert(r.aviso);
          onClose();
        }
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200">
          <p className="text-xs font-semibold tracking-wide text-accent uppercase">WiiGo</p>
          <h2 className="text-xl font-semibold text-neutral-900">Nota de crédito de {reclamo.proveedor}</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            {reclamo.numeroFactura ? `Contra la factura ${reclamo.numeroFactura} · ` : ""}reclamo por $
            {monto(reclamo.total)}
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo etiqueta="Nº de nota de crédito *">
              <input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="B-0001-00000012"
                className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </Campo>
            <Campo etiqueta="Fecha *">
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </Campo>
            <Campo etiqueta="Neto">
              <Numero valor={neto} onCambio={setNeto} />
            </Campo>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2 pt-3 border-t border-neutral-100">
              Al pie de la nota
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo etiqueta="Impuestos ($)">
                <Numero valor={impuestos} onCambio={setImpuestos} />
              </Campo>
              <Campo etiqueta="Retenciones ($)">
                <Numero valor={retenciones} onCambio={setRetenciones} />
              </Campo>
              <Campo etiqueta="Descuentos ($)">
                <Numero valor={descuentos} onCambio={setDescuentos} />
              </Campo>
              <Campo etiqueta="IVA ($)">
                <Numero valor={iva} onCambio={setIva} resaltado />
              </Campo>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1.5">
              Si te facturaron una percepción y ahora te acreditan la mercadería, esa percepción también vuelve.
            </p>
          </div>

          <div className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3">
            <div className="flex justify-between text-base font-bold">
              <span>Total de la nota</span>
              <span className="tabular-nums">${monto(total)}</span>
            </div>
          </div>

          <div className="bg-accent-tint rounded-xl px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1.5">
              Qué va a pasar al guardar
            </p>
            <div className="flex justify-between text-sm tabular-nums py-0.5">
              <span className="text-accent-dark">Cuenta corriente de {reclamo.proveedor}</span>
              <b className="text-emerald-700">−${monto(total)}</b>
            </div>
            <div className="flex justify-between text-sm tabular-nums py-0.5">
              <span className="text-accent-dark">Crédito fiscal del mes</span>
              <b className="text-emerald-700">−${monto(n(iva))}</b>
            </div>
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-accent-dark">El reclamo</span>
              <b className="text-accent-dark">queda acreditado</b>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando || !numero.trim() || total <= 0}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {guardando ? "Guardando..." : "Guardar nota de crédito"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-neutral-500 mb-1">{etiqueta}</label>
      {children}
    </div>
  );
}

function Numero({
  valor,
  onCambio,
  resaltado,
}: {
  valor: string;
  onCambio: (v: string) => void;
  resaltado?: boolean;
}) {
  return (
    <input
      type="number"
      min={0}
      step="0.01"
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      placeholder="0,00"
      className={`w-full rounded-lg px-2.5 py-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent ${
        resaltado ? "border border-accent bg-accent-tint font-semibold" : "border border-neutral-300"
      }`}
    />
  );
}
