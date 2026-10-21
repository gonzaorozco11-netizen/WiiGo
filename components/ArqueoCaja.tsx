"use client";

import { useEffect, useState } from "react";
import { cerrarTurno, resumenTurnoAbierto } from "@/app/(app)/turnos/actions";
import PadFirma from "@/components/PadFirma";

// El arqueo de cierre de caja: todo el turno, el conteo por billete, los dos
// sobres (cambio para el que sigue y recaudación), la foto de la plata
// contada y la firma. Se usa al fichar la salida y en Operaciones → Turnos.

const BILLETES = [20000, 10000, 2000, 1000, 500, 200];

type Resumen = Awaited<ReturnType<typeof resumenTurnoAbierto>>;

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const numero = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

/** Achica la foto de la cámara (pueden ser varios MB) a 1280 px en JPEG. */
async function achicarFoto(archivo: File): Promise<string> {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75);
}

export default function ArqueoCaja({
  idTurno,
  fondo,
  exigirFotoYFirma,
  textoBoton,
  onCerrado,
  onCancelar,
}: {
  idTurno: string;
  /** El sobre de cambio que queda para el turno siguiente. */
  fondo: number;
  /** El operativo tiene que sacar la foto y firmar; administración puede cerrar sin eso. */
  exigirFotoYFirma: boolean;
  textoBoton: string;
  onCerrado: (firma: string | null) => void;
  onCancelar?: () => void;
}) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [otros, setOtros] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [procesandoFoto, setProcesandoFoto] = useState(false);
  const [firma, setFirma] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => {
    resumenTurnoAbierto(idTurno)
      .then(setResumen)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el turno."));
  }, [idTurno]);

  const contado = BILLETES.reduce((a, b) => a + b * numero(cantidades[b] ?? ""), 0) + numero(otros);
  const algoContado = contado > 0 || Object.values(cantidades).some((v) => v !== "") || otros !== "";
  const diferencia = resumen ? contado - resumen.efectivoEsperado : 0;
  const cambio = Math.min(fondo, contado);
  const recaudacion = contado - cambio;
  const falta =
    !algoContado ? "Contá la plata" : diferencia !== 0 && !observaciones.trim() ? "Escribí qué pasó con la diferencia" : exigirFotoYFirma && !foto ? "Falta la foto" : exigirFotoYFirma && !firma ? "Falta tu firma" : null;

  async function elegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setProcesandoFoto(true);
    try {
      setFoto(await achicarFoto(archivo));
    } catch {
      setError("No se pudo leer la foto. Probá sacarla de nuevo.");
    } finally {
      setProcesandoFoto(false);
    }
  }

  function cerrar() {
    if (falta || !resumen) return;
    setError(null);
    setCerrando(true);
    const billetes: Record<string, number> = { otros: numero(otros) };
    for (const b of BILLETES) billetes[String(b)] = numero(cantidades[b] ?? "");
    cerrarTurno(idTurno, contado, observaciones, { billetes, cambioDejado: cambio, foto, firma })
      .then((res) => {
        if (res.error) setError(res.error);
        else onCerrado(firma);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cerrar la caja."))
      .finally(() => setCerrando(false));
  }

  if (!resumen) return <p className="text-sm text-neutral-400 text-center py-6">{error ?? "Cargando tu turno..."}</p>;

  const fila = "flex justify-between gap-3";
  return (
    <div className="space-y-3 text-left">
      <section className="border border-neutral-200 rounded-xl p-4 bg-white">
        <p className="text-sm font-bold text-neutral-900 mb-2">Tu turno</p>
        <div className="space-y-1 text-[13px] tabular-nums">
          <div className={fila}>
            <span>Cambio con el que abriste</span>
            <b>{pesos(resumen.montoInicial)}</b>
          </div>
          <div className={fila}>
            <span>
              Ventas en efectivo <span className="text-neutral-400">({resumen.cantidadVentas} ventas en total)</span>
            </span>
            <b>+{pesos(resumen.totalEfectivo)}</b>
          </div>
          <div className={`${fila} text-neutral-400`}>
            <span>Mercado Pago (no entra a la caja)</span>
            <span>{pesos(resumen.totalMercadoPago)}</span>
          </div>
          {resumen.totalGastosEfectivo > 0 && (
            <div className={fila}>
              <span>Gastos en efectivo</span>
              <b className="text-red-600">−{pesos(resumen.totalGastosEfectivo)}</b>
            </div>
          )}
          {resumen.totalPagosProveedorEfectivo > 0 && (
            <div className={fila}>
              <span>Pagos a proveedores</span>
              <b className="text-red-600">−{pesos(resumen.totalPagosProveedorEfectivo)}</b>
            </div>
          )}
          {resumen.totalDevolucionesEfectivo > 0 && (
            <div className={fila}>
              <span>Devoluciones en efectivo</span>
              <b className="text-red-600">−{pesos(resumen.totalDevolucionesEfectivo)}</b>
            </div>
          )}
          <div className={`${fila} border-t border-neutral-200 pt-1.5 mt-1 text-[14px]`}>
            <b>Tendría que haber</b>
            <b>{pesos(resumen.efectivoEsperado)}</b>
          </div>
        </div>
      </section>

      <section className="border border-neutral-200 rounded-xl p-4 bg-white">
        <p className="text-sm font-bold text-neutral-900 mb-2">Contá por billete</p>
        <div className="space-y-1.5">
          {BILLETES.map((b) => (
            <label key={b} className="flex items-center gap-2 text-[13px] tabular-nums">
              <span className="w-20 font-semibold">{pesos(b)}</span>
              <span className="text-neutral-400">×</span>
              <input
                inputMode="numeric"
                value={cantidades[b] ?? ""}
                onChange={(e) => setCantidades((c) => ({ ...c, [b]: e.target.value.replace(/[^\d]/g, "") }))}
                className="w-16 border border-neutral-300 rounded-lg px-2 py-1 text-right"
                aria-label={`Billetes de ${b}`}
              />
              <span className="ml-auto text-neutral-500">{pesos(b * numero(cantidades[b] ?? ""))}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-[13px] tabular-nums">
            <span className="w-20 font-semibold leading-tight">$100 y monedas</span>
            <span className="text-neutral-400">$</span>
            <input
              inputMode="numeric"
              value={otros}
              onChange={(e) => setOtros(e.target.value.replace(/[^\d]/g, ""))}
              className="w-24 border border-neutral-300 rounded-lg px-2 py-1 text-right"
              aria-label="Billetes de 100 y monedas, en pesos"
            />
          </label>
        </div>
        {algoContado && (
          <div
            className={`flex justify-between items-center rounded-lg px-3 py-2 mt-3 text-sm font-bold ${
              diferencia === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            <span>Contaste {pesos(contado)}</span>
            <span>{diferencia === 0 ? "Cuadra ✓" : diferencia > 0 ? `Sobran ${pesos(diferencia)}` : `Faltan ${pesos(-diferencia)}`}</span>
          </div>
        )}
        {algoContado && diferencia !== 0 && (
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            placeholder="¿Qué pasó? Por ejemplo: di mal un vuelto"
            className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm mt-2"
          />
        )}
      </section>

      {algoContado && (
        <section className="border border-neutral-200 rounded-xl p-4 bg-white">
          <p className="text-sm font-bold text-neutral-900 mb-2">Separá la plata en dos sobres</p>
          <div className="space-y-1 text-[13px] tabular-nums">
            <div className={fila}>
              <span>Sobre de cambio, para el que sigue (billetes chicos)</span>
              <b>{pesos(cambio)}</b>
            </div>
            <div className={`${fila} text-[14px]`}>
              <b>Sobre de recaudación de tu turno</b>
              <b>{pesos(recaudacion)}</b>
            </div>
          </div>
          <p className="text-xs text-neutral-400 mt-1.5">En el sobre de recaudación escribí tu nombre, la fecha y el monto, y cerralo.</p>
        </section>
      )}

      <section className="border border-neutral-200 rounded-xl p-4 bg-white">
        <p className="text-sm font-bold text-neutral-900 mb-1">Foto de la plata contada y los dos sobres{exigirFotoYFirma ? "" : " (opcional)"}</p>
        <div className="flex items-center gap-3">
          {foto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto} alt="Foto del arqueo" className="w-24 h-16 object-cover rounded-lg border border-neutral-200" />
          )}
          <label className="inline-flex items-center rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 cursor-pointer hover:bg-neutral-50">
            {procesandoFoto ? "Procesando..." : foto ? "Sacar otra" : "📷 Sacar la foto"}
            <input type="file" accept="image/*" capture="environment" onChange={elegirFoto} className="hidden" />
          </label>
        </div>
      </section>

      <section className="border border-neutral-200 rounded-xl p-4 bg-white">
        <p className="text-sm font-bold text-neutral-900 mb-2">Firmo este arqueo{exigirFotoYFirma ? "" : " (opcional)"}</p>
        <PadFirma onCambio={setFirma} />
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={cerrar}
        disabled={Boolean(falta) || cerrando}
        className="w-full rounded-xl bg-accent hover:bg-accent-dark disabled:opacity-40 text-white font-bold py-3 text-sm"
      >
        {cerrando ? "Cerrando..." : falta ?? textoBoton}
      </button>
      {onCancelar && (
        <button type="button" onClick={onCancelar} className="block mx-auto text-xs font-semibold text-neutral-400 hover:text-neutral-600">
          Volver
        </button>
      )}
    </div>
  );
}
