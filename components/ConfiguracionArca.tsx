"use client";

import { useState, useTransition } from "react";
import { guardarConfigArca, guardarDatosFiscales } from "@/app/(app)/configuracion/actions";
import { generarCsrArca, guardarCertificadoArca, probarConexionArca } from "@/app/(app)/facturacion/actions";
import type { DatosEmisor } from "@/lib/arca/emisor-db";
import type { EstadoCredenciales } from "@/lib/arca/credenciales";

// Pantalla de vinculación con ARCA. Está pensada como una guía paso a paso
// porque el trámite tiene varias idas y vueltas con la web de ARCA y es fácil
// perderse: se genera un pedido acá, se sube allá, se baja un certificado, se
// vuelve a subir acá, y falta una autorización que hace el contador.

type Props = {
  emisor: DatosEmisor;
  credenciales: EstadoCredenciales;
  habilitado: boolean;
  autoEfectivo: boolean;
  autoMercadoPago: boolean;
  puntoVenta: number;
  ivaPorcentaje: number;
  montoIdentificacion: number;
};

function Paso({ numero, titulo, hecho, children }: { numero: number; titulo: string; hecho?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 py-3 border-b border-neutral-100 last:border-0">
      <span
        className={`flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
          hecho ? "bg-emerald-600 text-white" : "bg-neutral-200 text-neutral-600"
        }`}
      >
        {hecho ? "✓" : numero}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-800 mb-1">{titulo}</p>
        <div className="text-sm text-neutral-600">{children}</div>
      </div>
    </li>
  );
}

export default function ConfiguracionArca({
  emisor,
  credenciales,
  habilitado: habilitadoInicial,
  autoEfectivo: autoEfectivoInicial,
  autoMercadoPago: autoMpInicial,
  puntoVenta: puntoVentaInicial,
  ivaPorcentaje: ivaInicial,
  montoIdentificacion: montoIdentificacionInicial,
}: Props) {
  const [pendienteFiscal, transFiscal] = useTransition();
  const [okFiscal, setOkFiscal] = useState(false);
  const [errFiscal, setErrFiscal] = useState<string | null>(null);

  const [alias, setAlias] = useState(credenciales.alias ?? "wiigo-sistema");
  const [generando, setGenerando] = useState(false);
  const [errCsr, setErrCsr] = useState<string | null>(null);

  const [subiendo, setSubiendo] = useState(false);
  const [okCert, setOkCert] = useState<string | null>(null);
  const [errCert, setErrCert] = useState<string | null>(null);

  const [habilitado, setHabilitado] = useState(habilitadoInicial);
  const [autoEfectivo, setAutoEfectivo] = useState(autoEfectivoInicial);
  const [autoMp, setAutoMp] = useState(autoMpInicial);
  const [puntoVenta, setPuntoVenta] = useState(puntoVentaInicial);
  const [iva, setIva] = useState(ivaInicial);
  const [montoIdentificacion, setMontoIdentificacion] = useState(montoIdentificacionInicial);
  const [pendienteConfig, transConfig] = useTransition();
  const [okConfig, setOkConfig] = useState(false);
  const [errConfig, setErrConfig] = useState<string | null>(null);

  const [probando, setProbando] = useState(false);
  const [resultadoPrueba, setResultadoPrueba] = useState<string | null>(null);

  function handleFiscal(formData: FormData) {
    setOkFiscal(false);
    setErrFiscal(null);
    transFiscal(async () => {
      const r = await guardarDatosFiscales(formData);
      if (r.error) setErrFiscal(r.error);
      else setOkFiscal(true);
    });
  }

  function handleGenerarCsr() {
    if (
      credenciales.tieneCertificado &&
      !confirm("Ya hay un certificado cargado. Si generás uno nuevo, el actual deja de servir y hay que rehacer el trámite en ARCA. ¿Seguir?")
    ) {
      return;
    }
    setGenerando(true);
    setErrCsr(null);
    generarCsrArca(alias)
      .then((r) => {
        if (r.error || !r.csr) {
          setErrCsr(r.error ?? "No se pudo generar");
          return;
        }
        // Se descarga en el momento: el CSR no se guarda, solo la clave.
        const blob = new Blob([r.csr], { type: "application/x-pem-file" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `pedido-${alias}.csr`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .finally(() => setGenerando(false));
  }

  function handleSubirCert(formData: FormData) {
    setSubiendo(true);
    setOkCert(null);
    setErrCert(null);
    guardarCertificadoArca(formData)
      .then((r) => {
        if (r.error) setErrCert(r.error);
        else setOkCert(r.info ?? "Certificado cargado.");
      })
      .finally(() => setSubiendo(false));
  }

  function handleConfig(formData: FormData) {
    setOkConfig(false);
    setErrConfig(null);
    transConfig(async () => {
      const r = await guardarConfigArca(formData);
      if (r.error) setErrConfig(r.error);
      else setOkConfig(true);
    });
  }

  function handleProbar() {
    setProbando(true);
    setResultadoPrueba(null);
    probarConexionArca()
      .then((r) => setResultadoPrueba(r.error ? `❌ ${r.error}` : `✅ ${r.mensaje}`))
      .finally(() => setProbando(false));
  }

  const input = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent";
  const etiqueta = "block text-sm font-medium text-neutral-700 mb-1";

  return (
    <div className="mt-5">
      <div className="bg-white border border-neutral-200 rounded-xl p-5">
        <h2 className="text-base font-semibold text-neutral-900 mb-1">📄 Facturación electrónica (ARCA)</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Seguí los pasos en orden. El trámite se hace una sola vez; el certificado dura dos años.
        </p>

        <ol className="border border-neutral-200 rounded-lg px-4 bg-neutral-50">
          <Paso numero={1} titulo="Completá tus datos fiscales" hecho={emisor.cuit.replace(/\D/g, "").length === 11}>
            Los de abajo. Se imprimen en la factura y se usan para identificarte ante ARCA.
          </Paso>
          <Paso numero={2} titulo="Generá el pedido de certificado" hecho={credenciales.tieneClave}>
            Con el botón de abajo. Se descarga un archivo <code>.csr</code>. La clave privada queda guardada acá,
            cifrada — no la compartas ni hace falta que la manipules.
          </Paso>
          <Paso numero={3} titulo="Subí ese archivo a ARCA y descargá el certificado">
            Entrá a{" "}
            <a href="https://auth.afip.gob.ar" target="_blank" rel="noopener noreferrer" className="text-accent underline">
              ARCA con tu Clave Fiscal
            </a>{" "}
            → <strong>Administración de Certificados Digitales</strong> → <strong>Agregar alias</strong>. Subí el{" "}
            <code>.csr</code> y descargá el certificado (<code>.crt</code>) que te devuelve.
          </Paso>
          <Paso numero={4} titulo="Autorizá la facturación (lo hace quien tenga la Clave Fiscal de la empresa)">
            En el <strong>Administrador de Relaciones</strong> de la empresa: <strong>Nueva Relación</strong> → servicio{" "}
            <strong>Facturación Electrónica</strong> → representante: el certificado recién creado. Sin este paso ARCA
            rechaza todas las facturas.
          </Paso>
          <Paso numero={5} titulo="Subí el certificado acá" hecho={credenciales.tieneCertificado}>
            El <code>.crt</code> del paso 3, en el recuadro de abajo.
          </Paso>
          <Paso numero={6} titulo="Probá la conexión y recién ahí activá">
            El botón <strong>Probar conexión</strong> no emite nada: solo pregunta el último número autorizado.
          </Paso>
        </ol>
      </div>

      {/* ---- Datos fiscales ---- */}
      <form action={handleFiscal} className="bg-white border border-neutral-200 rounded-xl p-5 mt-4">
        <h3 className="text-sm font-bold text-neutral-900 mb-3">Datos fiscales</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="col-span-2">
            <label className={etiqueta} htmlFor="emisor_razon_social">Razón social</label>
            <input id="emisor_razon_social" name="emisor_razon_social" defaultValue={emisor.razonSocial} className={input} />
          </div>
          <div>
            <label className={etiqueta} htmlFor="emisor_cuit">CUIT</label>
            <input id="emisor_cuit" name="emisor_cuit" defaultValue={emisor.cuit} className={input} />
          </div>
          <div>
            <label className={etiqueta} htmlFor="emisor_condicion_iva">Condición frente al IVA</label>
            <input id="emisor_condicion_iva" name="emisor_condicion_iva" defaultValue={emisor.condicionIva} className={input} />
          </div>
          <div className="col-span-2">
            <label className={etiqueta} htmlFor="emisor_nombre_fantasia">Nombre de fantasía</label>
            <input id="emisor_nombre_fantasia" name="emisor_nombre_fantasia" defaultValue={emisor.nombreFantasia} className={input} />
          </div>
          <div className="col-span-2">
            <label className={etiqueta} htmlFor="emisor_domicilio">Domicilio comercial</label>
            <input id="emisor_domicilio" name="emisor_domicilio" defaultValue={emisor.domicilioComercial} className={input} />
          </div>
          <div>
            <label className={etiqueta} htmlFor="emisor_iibb">Ingresos Brutos</label>
            <input id="emisor_iibb" name="emisor_iibb" defaultValue={emisor.ingresosBrutos} className={input} />
          </div>
          <div>
            <label className={etiqueta} htmlFor="emisor_inicio">Inicio de actividades</label>
            <input id="emisor_inicio" name="emisor_inicio" defaultValue={emisor.inicioActividades} className={input} />
          </div>
        </div>
        {errFiscal && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{errFiscal}</p>}
        {okFiscal && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">Datos guardados.</p>}
        <button type="submit" disabled={pendienteFiscal} className="w-full rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50">
          {pendienteFiscal ? "Guardando..." : "Guardar datos fiscales"}
        </button>
      </form>

      {/* ---- Certificado ---- */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 mt-4">
        <h3 className="text-sm font-bold text-neutral-900 mb-3">Certificado digital</h3>

        {credenciales.tieneCertificado ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">
            Certificado cargado{credenciales.cuitCertificado ? ` (CUIT ${credenciales.cuitCertificado})` : ""}
            {credenciales.vence ? ` · vence el ${new Date(credenciales.vence).toLocaleDateString("es-AR")}` : ""}.
          </p>
        ) : (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            Todavía no hay certificado cargado. No se puede facturar hasta completar los pasos 2, 3 y 5.
          </p>
        )}

        <div className="mb-4">
          <label className={etiqueta} htmlFor="alias">Nombre del certificado (alias)</label>
          <div className="flex gap-2">
            <input id="alias" value={alias} onChange={(e) => setAlias(e.target.value)} className={input} />
            <button
              type="button"
              onClick={handleGenerarCsr}
              disabled={generando}
              className="whitespace-nowrap rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {generando ? "Generando..." : "Generar archivo CSR"}
            </button>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Es solo un nombre para reconocerlo en ARCA. Si ya usaste uno, poné otro distinto.
          </p>
          {errCsr && <p className="text-sm text-red-600 mt-2">{errCsr}</p>}
        </div>

        <form action={handleSubirCert} className="border-t border-neutral-100 pt-4">
          <label className={etiqueta} htmlFor="certificado">Certificado que te dio ARCA (.crt)</label>
          <input id="certificado" name="certificado" type="file" accept=".crt,.pem,.cer" className="w-full text-sm mb-3" />
          {errCert && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{errCert}</p>}
          {okCert && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">{okCert}</p>}
          <button type="submit" disabled={subiendo} className="w-full rounded-lg border border-neutral-300 text-neutral-700 py-2 text-sm font-medium disabled:opacity-50">
            {subiendo ? "Subiendo..." : "Subir certificado"}
          </button>
        </form>
      </div>

      {/* ---- Qué se factura ---- */}
      <form action={handleConfig} className="bg-white border border-neutral-200 rounded-xl p-5 mt-4">
        <h3 className="text-sm font-bold text-neutral-900 mb-3">Qué se factura</h3>

        <label className="flex items-center justify-between mb-4 cursor-pointer">
          <span className="text-sm font-medium text-neutral-700">Facturación electrónica</span>
          <span className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${habilitado ? "text-emerald-700" : "text-neutral-400"}`}>
              {habilitado ? "ACTIVADA" : "DESACTIVADA"}
            </span>
            <input
              type="checkbox"
              name="arca_habilitado"
              checked={habilitado}
              onChange={(e) => setHabilitado(e.target.checked)}
              className="h-5 w-9 rounded-full appearance-none bg-neutral-200 checked:bg-accent relative transition-colors cursor-pointer
                before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform
                checked:before:translate-x-4"
            />
          </span>
        </label>

        <div className="border-t border-neutral-100 pt-4 mb-4">
          <p className="text-sm font-medium text-neutral-700 mb-2">Emitir factura sola cuando el cobro es…</p>
          <label className="flex items-center gap-2 text-sm text-neutral-700 mb-1.5 cursor-pointer">
            <input type="checkbox" name="arca_auto_efectivo" checked={autoEfectivo} onChange={(e) => setAutoEfectivo(e.target.checked)} />
            En efectivo
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
            <input type="checkbox" name="arca_auto_mercado_pago" checked={autoMp} onChange={(e) => setAutoMp(e.target.checked)} />
            Con Mercado Pago
          </label>
          <p className="text-xs text-neutral-400 mt-2">
            Dejalos apagados hasta ver dos o tres facturas manuales correctas en ARCA. Lo que quede apagado se factura a
            mano desde la venta.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={etiqueta} htmlFor="arca_punto_venta">Punto de venta</label>
            <input id="arca_punto_venta" name="arca_punto_venta" type="number" value={puntoVenta} onChange={(e) => setPuntoVenta(Number(e.target.value))} className={input} />
            <p className="text-xs text-neutral-400 mt-1">El habilitado como &quot;Web Services&quot;.</p>
          </div>
          <div>
            <label className={etiqueta} htmlFor="arca_iva_porcentaje">IVA (%)</label>
            <input id="arca_iva_porcentaje" name="arca_iva_porcentaje" type="number" step="0.5" value={iva} onChange={(e) => setIva(Number(e.target.value))} className={input} />
          </div>
        </div>

        <div className="border-t border-neutral-100 pt-4 mb-4">
          <label className={etiqueta} htmlFor="arca_monto_identificacion">
            Pedir DNI en ventas mayores a
          </label>
          <div className="flex items-center gap-2">
            <span className="text-neutral-400 text-sm">$</span>
            <input
              id="arca_monto_identificacion"
              name="arca_monto_identificacion"
              type="number"
              min="0"
              step="1000"
              value={montoIdentificacion}
              onChange={(e) => setMontoIdentificacion(Number(e.target.value))}
              className={input}
            />
          </div>
          <p className="text-xs text-neutral-400 mt-1.5">
            Monto a partir del cual ARCA exige identificar al comprador. Arriba de esto el tótem pide el DNI antes de
            cobrar, y en el POS es obligatorio cargarlo. En <strong>0</strong> no lo pide nunca. Confirmá el monto
            vigente con tu contador — ARCA lo actualiza seguido.
          </p>
        </div>

        <p className="text-xs text-neutral-400 mb-4">
          El tipo de comprobante lo decide el sistema: <strong>Factura B</strong> para consumidor final y{" "}
          <strong>Factura A</strong> solo si en el POS se carga un CUIT. El tótem factura siempre Factura B — no ofrece
          elegir, para que nadie emita el comprobante equivocado sin querer.
        </p>

        {errConfig && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{errConfig}</p>}
        {okConfig && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">Configuración guardada.</p>}
        {resultadoPrueba && (
          <p className="text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 mb-3 break-words">{resultadoPrueba}</p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={pendienteConfig} className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50">
            {pendienteConfig ? "Guardando..." : "Guardar"}
          </button>
          <button type="button" onClick={handleProbar} disabled={probando} className="rounded-lg border border-neutral-300 text-neutral-700 px-4 py-2 text-sm font-medium disabled:opacity-50">
            {probando ? "Probando..." : "Probar conexión"}
          </button>
        </div>
      </form>
    </div>
  );
}
