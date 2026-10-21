"use client";

import { useEffect, useRef, useState } from "react";

// Recuadro para firmar con el dedo (o el mouse). Devuelve la firma como una
// imagen PNG chica (data:image/png;base64,...) o null si se borró.
//
// La imagen se achica a 360×120 antes de mandarla: alcanza para verla en la
// planilla y pesa pocos KB, así no engorda la base con cada fichaje.

const ANCHO_FINAL = 360;
const ALTO_FINAL = 120;
/** Trazo mínimo para que cuente como firma (en píxeles recorridos): un toque suelto no firma. */
const TRAZO_MINIMO = 60;

export default function PadFirma({ onCambio }: { onCambio: (firma: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const recorrido = useRef(0);
  const [hayFirma, setHayFirma] = useState(false);

  // El canvas se dibuja a la resolución real de la pantalla para que el trazo
  // no se vea pixelado en la tablet.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const escala = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * escala);
    canvas.height = Math.round(rect.height * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(escala, escala);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = "#111827";
  }, []);

  function punto(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function empezar(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dibujando.current = true;
    ultimo.current = punto(e);
  }

  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current || !ultimo.current) return;
    e.preventDefault();
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = punto(e);
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    recorrido.current += Math.hypot(p.x - ultimo.current.x, p.y - ultimo.current.y);
    ultimo.current = p;
  }

  function terminar() {
    if (!dibujando.current) return;
    dibujando.current = false;
    ultimo.current = null;
    if (recorrido.current >= TRAZO_MINIMO) {
      setHayFirma(true);
      onCambio(exportar());
    }
  }

  function exportar(): string | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const chico = document.createElement("canvas");
    chico.width = ANCHO_FINAL;
    chico.height = ALTO_FINAL;
    const ctx = chico.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ANCHO_FINAL, ALTO_FINAL);
    ctx.drawImage(canvas, 0, 0, ANCHO_FINAL, ALTO_FINAL);
    return chico.toDataURL("image/png");
  }

  function borrar() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    recorrido.current = 0;
    setHayFirma(false);
    onCambio(null);
  }

  return (
    <div className="w-full">
      <div className="relative rounded-xl border-2 border-dashed border-neutral-300 bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={empezar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerCancel={terminar}
          onPointerLeave={terminar}
          className="block w-full h-36 touch-none cursor-crosshair rounded-xl"
          aria-label="Recuadro para firmar"
        />
        {!hayFirma && (
          <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-neutral-300">Firmá acá con el dedo</span>
        )}
        <span className="pointer-events-none absolute left-6 right-6 bottom-9 border-b border-neutral-200" />
      </div>
      <div className="flex justify-end mt-1.5">
        <button type="button" onClick={borrar} className="text-xs font-semibold text-neutral-400 hover:text-neutral-600">
          Borrar y firmar de nuevo
        </button>
      </div>
    </div>
  );
}
