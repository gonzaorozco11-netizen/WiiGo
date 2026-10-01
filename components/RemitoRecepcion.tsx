"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { urlRemitoRecepcion, adjuntarRemitoRecepcion, type OrigenOrden } from "@/app/(app)/compras/actions";

// El papel que llega con el camión: remito, factura o lo que traiga.
//
// Dos piezas, porque hay dos momentos: sacarle la foto mientras se cuenta la
// mercadería, y buscarla tres meses después cuando alguien pregunta.

/** Al recibir: elegir el archivo. No es obligatorio — la mercadería no espera. */
export function CampoRemito({
  archivo,
  onElegir,
}: {
  archivo: File | null;
  onElegir: (f: File | null) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
        Remito o factura
      </label>
      <input
        type="file"
        accept="application/pdf,image/*"
        // En el celular o la tablet abre la cámara directamente: el papel está
        // en la mano de quien recibe, no en un archivo guardado.
        capture="environment"
        onChange={(e) => onElegir(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-neutral-700 hover:file:bg-neutral-200"
      />
      <p className="text-[11px] text-neutral-400 mt-1">
        {archivo
          ? `Se va a guardar ${archivo.name}.`
          : "Sacale una foto al papel que te dieron. Si no hay, se puede recibir igual y adjuntarlo después."}
      </p>
    </div>
  );
}

/**
 * Después: verlo, o adjuntarlo si quedó sin subir.
 *
 * El link se pide al apretar y no al cargar la pantalla: el bucket es privado y
 * la URL firmada vence, así que una guardada de antemano llegaría muerta.
 */
export function VerRemito({
  origen,
  idRecepcion,
  path,
  compacto = false,
}: {
  origen: OrigenOrden;
  idRecepcion: string;
  path: string | null;
  compacto?: boolean;
}) {
  const router = useRouter();
  const [trabajando, setTrabajando] = useState(false);

  async function abrir() {
    if (!path) return;
    setTrabajando(true);
    const r = await urlRemitoRecepcion(path);
    setTrabajando(false);
    if (r.error || !r.url) return window.alert(r.error ?? "No se pudo abrir el comprobante.");
    window.open(r.url, "_blank", "noopener");
  }

  async function subir(f: File) {
    setTrabajando(true);
    const fd = new FormData();
    fd.append("archivo", f);
    const r = await adjuntarRemitoRecepcion(origen, idRecepcion, fd);
    setTrabajando(false);
    if (r.error) return window.alert(r.error);
    router.refresh();
  }

  const clase = compacto ? "text-[12px]" : "text-sm";

  if (path) {
    return (
      <button
        type="button"
        onClick={abrir}
        disabled={trabajando}
        className={`${clase} text-accent hover:underline disabled:opacity-50`}
      >
        {trabajando ? "Abriendo…" : "📎 Ver el remito"}
      </button>
    );
  }

  return (
    <label className={`${clase} text-neutral-400 hover:text-accent cursor-pointer`}>
      {trabajando ? "Subiendo…" : "+ Adjuntar el remito"}
      <input
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        disabled={trabajando}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) subir(f);
        }}
      />
    </label>
  );
}
