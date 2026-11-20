"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { urlRemitoRecepcion, adjuntarRemitoRecepcion, type OrigenOrden } from "@/app/(app)/compras/actions";

// El papel que llega con el camión: remito, factura o lo que traiga.
//
// Dos piezas, porque hay dos momentos: sacarle la foto mientras se cuenta la
// mercadería, y buscarla tres meses después cuando alguien pregunta.

/**
 * Al recibir: las dos fotos, con un botón grande que en la tablet abre la cámara
 * (Gonzalo, 19/11: «que le permita sacar la foto» de la mercadería que llegó y
 * del remito con el detalle). Ninguna es obligatoria: la mercadería no espera.
 */
export function FotosRecepcion({
  mercaderia,
  onMercaderia,
  remito,
  onRemito,
}: {
  mercaderia: File | null;
  onMercaderia: (f: File | null) => void;
  remito: File | null;
  onRemito: (f: File | null) => void;
}) {
  return (
    <div>
      <p className="block text-xs font-semibold text-neutral-500 uppercase mb-1.5">Fotos</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <BotonFoto icono="📦" titulo="Lo que llegó" ayuda="La mercadería sobre el mostrador, antes de guardarla" archivo={mercaderia} onElegir={onMercaderia} />
        <BotonFoto icono="📄" titulo="El remito" ayuda="El papel con el detalle que trajeron" archivo={remito} onElegir={onRemito} />
      </div>
      <p className="text-[11px] text-neutral-400 mt-1">Si no hay remito, se recibe igual y se adjunta después.</p>
    </div>
  );
}

function BotonFoto({
  icono,
  titulo,
  ayuda,
  archivo,
  onElegir,
}: {
  icono: string;
  titulo: string;
  ayuda: string;
  archivo: File | null;
  onElegir: (f: File | null) => void;
}) {
  const [vista, setVista] = useState<string | null>(null);
  return (
    <label
      className={`flex items-center gap-3 rounded-xl border-2 px-3 py-3 cursor-pointer ${
        archivo ? "border-emerald-500 bg-emerald-50" : "border-dashed border-neutral-300 bg-white hover:border-accent"
      }`}
    >
      {vista ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={vista} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-neutral-100 text-2xl">{icono}</span>
      )}
      <span className="min-w-0">
        <span className="block text-sm font-bold text-neutral-900">{archivo ? `✓ ${titulo}` : `📷 Sacar foto: ${titulo.toLowerCase()}`}</span>
        <span className="block text-xs text-neutral-500">{archivo ? "Tocá para sacarla de nuevo" : ayuda}</span>
      </span>
      <input
        type="file"
        accept="image/*,application/pdf"
        // En la tablet abre la cámara directamente.
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const crudo = e.target.files?.[0] ?? null;
          // Achicada: dos fotos de la cámara juntas pasan el límite de lo que se puede mandar.
          const f = crudo ? await achicarFoto(crudo) : null;
          onElegir(f);
          setVista(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
        }}
      />
    </label>
  );
}

/** La foto a 1600 px del lado largo, en JPEG: se lee bien el remito y pesa ~300 KB. */
async function achicarFoto(f: File): Promise<File> {
  if (!f.type.startsWith("image/") || f.size < 600_000) return f;
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = mal;
      i.src = URL.createObjectURL(f);
    });
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.82));
    return blob ? new File([blob], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : f;
  } catch {
    return f;
  }
}

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
  tipo = "REMITO",
}: {
  origen: OrigenOrden;
  idRecepcion: string;
  path: string | null;
  compacto?: boolean;
  /** MERCADERIA: la foto de lo que llegó (19/11). */
  tipo?: "REMITO" | "MERCADERIA";
}) {
  const nombre = tipo === "MERCADERIA" ? "la foto de lo que llegó" : "el remito";
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
    const r = await adjuntarRemitoRecepcion(origen, idRecepcion, fd, tipo);
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
        {trabajando ? "Abriendo…" : tipo === "MERCADERIA" ? "📦 Ver lo que llegó" : "📎 Ver el remito"}
      </button>
    );
  }

  return (
    <label className={`${clase} text-neutral-400 hover:text-accent cursor-pointer`}>
      {trabajando ? "Subiendo…" : `+ Adjuntar ${nombre}`}
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
