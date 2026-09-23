"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lee el código de barras de un envase con la cámara.
 *
 * Usa el lector que Chrome en Android ya trae de fábrica (`BarcodeDetector`):
 * cero librerías, cero peso extra de descarga y anda fluido en la tablet de la
 * operativa, que es una Samsung Tab A11. Si el navegador no lo trae —Safari en
 * iPad, por ejemplo— lo dice con todas las letras y ofrece cargarlo a mano, en
 * vez de quedarse mirando una cámara que nunca va a reconocer nada.
 *
 * Es para cargar el código UNA VEZ por producto, no para la venta: el totem
 * tiene su propio lector físico. Por eso no hace falta que sea instantáneo.
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
}: {
  onLeido: (codigo: string) => void;
  onCerrar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<"abriendo" | "leyendo" | "sin-soporte" | "sin-permiso">("abriendo");
  const [manual, setManual] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelado = false;
    let cuadro = 0;

    async function arrancar() {
      const Detector = (window as unknown as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector;
      if (!Detector) {
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
          if (valor) {
            cancelado = true;
            // Un pitido corto para confirmar sin tener que mirar la pantalla.
            navigator.vibrate?.(80);
            onLeido(valor);
          }
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
          <p className="text-sm font-semibold">Escanear el código del envase</p>
          <button type="button" onClick={onCerrar} className="text-neutral-400 text-lg px-1">
            ✕
          </button>
        </div>

        {estado === "sin-soporte" || estado === "sin-permiso" ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-neutral-600">
              {estado === "sin-soporte"
                ? "Este navegador no puede leer códigos con la cámara. Desde Chrome en Android funciona; si no, escribí los números que están debajo de las rayitas."
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
                : "Apuntá al código de barras del envase. Se carga solo."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
