"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lee el código de barras de un envase con la cámara.
 *
 * Usa el lector que Chrome en Android ya trae de fábrica (`BarcodeDetector`):
 * cero peso extra de descarga y anda fluido en la tablet de la operativa, que
 * es una Samsung Tab A11. Safari (iPhone, iPad) no lo trae: ahí se baja, solo
 * en ese momento, un lector hecho en JavaScript (@zxing/browser), para que los
 * chicos escaneen desde cualquier celular (Gonzalo, 2026-11-07). Si igual no
 * lee, siempre se puede escribir el número a mano.
 *
 * Se usa para cargar el código de un producto y en Góndola, para encontrarlo:
 * el totem tiene su propio lector físico para la venta.
 */

type Detectado = { rawValue: string };
type DetectorBarras = { detect: (fuente: CanvasImageSource) => Promise<Detectado[]> };
type ConstructorDetector = new (opciones?: { formats?: string[] }) => DetectorBarras;

// Los formatos que traen los envases del rubro: EAN-13 es el estándar acá,
// EAN-8 el de los paquetes chicos, UPC el de lo importado de EEUU y Code 128
// el de las etiquetas que imprimimos nosotros.
const FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];

export default function EscanerCodigo({
  onLeido,
  onCerrar,
  titulo = "Escanear el código del envase",
}: {
  onLeido: (codigo: string) => void;
  onCerrar: () => void;
  titulo?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<"abriendo" | "leyendo" | "sin-soporte" | "sin-permiso">("abriendo");
  const [manual, setManual] = useState("");
  const [aMano, setAMano] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelado = false;
    let cuadro = 0;
    let pararZxing: (() => void) | null = null;

    const leido = (valor: string) => {
      if (cancelado) return;
      cancelado = true;
      // Un pitido corto para confirmar sin tener que mirar la pantalla.
      navigator.vibrate?.(80);
      onLeido(valor);
    };

    async function arrancar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setEstado("sin-soporte");
        return;
      }
      try {
        // `environment` es la cámara de atrás: la de adelante apuntaría a la
        // cara de quien está escaneando.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch {
        setEstado("sin-permiso");
        return;
      }
      if (cancelado || !videoRef.current) return;

      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
      setEstado("leyendo");

      const Detector = (window as unknown as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector;
      if (!Detector) {
        // iPhone / iPad: el lector en JavaScript, bajado recién ahora.
        try {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
          if (cancelado || !videoRef.current || !stream) return;
          const pistas = new Map();
          pistas.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
          ]);
          const lector = new BrowserMultiFormatReader(pistas, { delayBetweenScanAttempts: 150 });
          const controles = await lector.decodeFromStream(stream, videoRef.current, (resultado) => {
            const valor = resultado?.getText()?.trim();
            if (valor) leido(valor);
          });
          pararZxing = () => controles.stop();
          if (cancelado) pararZxing();
        } catch {
          setEstado("sin-soporte");
        }
        return;
      }

      const detector = new Detector({ formats: FORMATOS });

      // Se mira un cuadro cada tanto y no todos: en la placa de una tablet,
      // analizar 60 cuadros por segundo la calienta sin leer más rápido.
      let ultimo = 0;
      const mirar = async (ahora: number) => {
        if (cancelado) return;
        cuadro = requestAnimationFrame(mirar);
        if (ahora - ultimo < 180) return;
        ultimo = ahora;
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        try {
          const encontrados = await detector.detect(video);
          const valor = encontrados[0]?.rawValue?.trim();
          if (valor) leido(valor);
        } catch {
          // Un cuadro borroso tira error: se ignora y se prueba el siguiente.
        }
      };
      cuadro = requestAnimationFrame(mirar);
    }

    arrancar();
    return () => {
      cancelado = true;
      cancelAnimationFrame(cuadro);
      pararZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onLeido]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(20,17,13,.8)" }}
      onClick={onCerrar}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 flex items-center justify-between border-b border-neutral-200">
          <p className="text-sm font-semibold">{titulo}</p>
          <button type="button" onClick={onCerrar} className="text-neutral-400 text-lg px-1">
            ✕
          </button>
        </div>

        {estado === "sin-soporte" || estado === "sin-permiso" || aMano ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-neutral-600">
              {aMano
                ? "Escribí los números que están debajo de las rayitas."
                : estado === "sin-soporte"
                  ? "Este navegador no puede leer códigos con la cámara. Escribí los números que están debajo de las rayitas."
                  : "No se pudo abrir la cámara. Revisá que le hayas dado permiso, o escribí los números que están debajo de las rayitas."}
            </p>
            <input
              autoFocus
              value={manual}
              onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
              // Este modal vive dentro del formulario del producto: un Enter
              // acá lo guardaría antes de tiempo.
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (manual.length >= 6) onLeido(manual);
              }}
              inputMode="numeric"
              placeholder="7798123456789"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              disabled={manual.length < 6}
              onClick={() => onLeido(manual)}
              className="w-full rounded-lg bg-neutral-900 text-white text-sm font-semibold py-2.5 disabled:opacity-40"
            >
              Usar este código
            </button>
          </div>
        ) : (
          <>
            <div className="relative bg-black aspect-[4/3]">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              {/* La ventanita guía: apuntar al centro es más fácil que "en algún
                  lado de la pantalla". */}
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="w-[76%] h-[38%] rounded-xl border-2 border-white/90" />
              </div>
            </div>
            <p className="px-4 py-3 text-xs text-neutral-500 text-center">
              {estado === "abriendo"
                ? "Abriendo la cámara…"
                : "Apuntá al código de barras del envase. Se carga solo."}{" "}
              <button type="button" onClick={() => setAMano(true)} className="underline text-neutral-700">
                ¿No lo lee? Escribilo
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
