"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ComentarioParaRevisar } from "@/lib/opinionesProducto";
import { borrarOpinion, revisarComentario } from "@/app/(app)/comentarios/actions";

// Comentarios de los clientes (Gonzalo, 18/11): Publicar u Ocultar. Las
// estrellas ya se ven solas en la tienda; esto es solo el texto.

const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

function Estrellas({ n }: { n: number }) {
  return (
    <span className="text-amber-500 tracking-wider" aria-label={`${n} de 5 estrellas`}>
      {"★".repeat(n)}
      <span className="text-neutral-300">{"★".repeat(5 - n)}</span>
    </span>
  );
}

export default function ComentariosApp({
  pendientes,
  revisados,
  sinTabla,
  esAdmin,
}: {
  pendientes: ComentarioParaRevisar[];
  revisados: ComentarioParaRevisar[];
  sinTabla: boolean;
  esAdmin: boolean;
}) {
  const router = useRouter();
  const [guardando, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function hacer(f: () => Promise<{ error?: string }>) {
    setError(null);
    empezar(async () => {
      const r = await f();
      if (r.error) setError(r.error);
      router.refresh();
    });
  }

  if (sinTabla) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-1">Falta crear la tabla de opiniones</p>
        <p className="text-sm text-neutral-500">Corré sql/opiniones-productos.sql en el SQL Editor de Supabase.</p>
      </div>
    );
  }

  const tarjeta = (c: ComentarioParaRevisar, revisando: boolean) => (
    <li key={c.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-bold text-neutral-900">{c.producto}</span>
        <span className="text-xs text-neutral-500">
          {c.marca ? `${c.marca} · ` : ""}
          {cuando(c.creado)}
        </span>
      </div>
      <p className="mt-1 text-sm">
        <Estrellas n={c.estrellas} /> <span className="text-neutral-500">· {c.cliente} · compra verificada</span>
      </p>
      <p className="mt-2 text-[15px] text-neutral-800">«{c.comentario}»</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {revisando ? (
          <>
            <button type="button" disabled={guardando} onClick={() => hacer(() => revisarComentario(c.id, true))} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white disabled:opacity-50">
              Publicar
            </button>
            <button type="button" disabled={guardando} onClick={() => hacer(() => revisarComentario(c.id, false))} className="rounded-xl border-2 border-neutral-200 bg-white px-4 py-2 text-sm font-extrabold text-neutral-800 disabled:opacity-50">
              Ocultar
            </button>
          </>
        ) : (
          <>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${c.estado === "PUBLICADO" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"}`}>
              {c.estado === "PUBLICADO" ? "Publicado" : "Oculto"}
            </span>
            <button type="button" disabled={guardando} onClick={() => hacer(() => revisarComentario(c.id, c.estado !== "PUBLICADO"))} className="text-xs font-semibold text-neutral-500 underline underline-offset-4">
              {c.estado === "PUBLICADO" ? "Ocultarlo" : "Publicarlo"}
            </button>
          </>
        )}
        {esAdmin && (
          <button
            type="button"
            disabled={guardando}
            onClick={() => {
              if (window.confirm("¿Borrar esta opinión? Se borran también sus estrellas y no se puede deshacer.")) hacer(() => borrarOpinion(c.id));
            }}
            className="ml-auto text-xs font-semibold text-red-700 underline underline-offset-4"
          >
            Borrar
          </button>
        )}
      </div>
    </li>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Comentarios</h1>
      <p className="text-sm text-neutral-500 mt-0.5 mb-4">
        Lo que escriben los clientes sobre lo que compraron. Las estrellas se ven solas en la tienda; el comentario, recién cuando lo publicás. Ocultá lo que sea
        ofensivo, no tenga que ver con el producto o tenga datos personales.
      </p>
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">Para revisar · {pendientes.length}</h2>
      {pendientes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">No hay comentarios nuevos.</p>
      ) : (
        <ul className="grid gap-2.5">{pendientes.map((c) => tarjeta(c, true))}</ul>
      )}

      {revisados.length > 0 && (
        <>
          <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mt-8 mb-2">Ya revisados</h2>
          <ul className="grid gap-2.5">{revisados.map((c) => tarjeta(c, false))}</ul>
        </>
      )}
    </div>
  );
}
