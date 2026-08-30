"use client";

import { useEffect, useRef, useState } from "react";
import type { PersonaConPuestos, DocumentoLegajo } from "@/app/(app)/organizacion/actions";
import {
  actualizarLegajo,
  listarDocumentosLegajo,
  subirDocumentoLegajo,
  obtenerUrlDocumentoLegajo,
  eliminarDocumentoLegajo,
} from "@/app/(app)/organizacion/actions";

const TIPOS_DOCUMENTO: { clave: string; label: string; icono: string }[] = [
  { clave: "DNI", label: "DNI", icono: "🪪" },
  { clave: "ALTA_AFIP", label: "Alta temprana AFIP", icono: "📋" },
  { clave: "APTO_MEDICO", label: "Apto médico", icono: "🩺" },
  { clave: "CBU", label: "CBU", icono: "🏦" },
  { clave: "CONTRATO", label: "Contrato", icono: "📄" },
];

function formatearFecha(fechaISO: string) {
  return new Date(fechaISO).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ModalLegajo({
  persona,
  onClose,
  onGuardado,
}: {
  persona: PersonaConPuestos;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [dni, setDni] = useState(persona.dni ?? "");
  const [cuil, setCuil] = useState(persona.cuil ?? "");
  const [fechaNacimiento, setFechaNacimiento] = useState(persona.fecha_nacimiento ?? "");
  const [domicilio, setDomicilio] = useState(persona.domicilio ?? "");
  const [fechaIngreso, setFechaIngreso] = useState(persona.fecha_ingreso ?? "");
  const [convenioColectivo, setConvenioColectivo] = useState(persona.convenio_colectivo ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [documentos, setDocumentos] = useState<DocumentoLegajo[]>([]);
  const [cargandoDocs, setCargandoDocs] = useState(true);
  const [subiendoTipo, setSubiendoTipo] = useState<string | null>(null);
  const inputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  function recargarDocumentos() {
    setCargandoDocs(true);
    listarDocumentosLegajo(persona.id_persona)
      .then(setDocumentos)
      .finally(() => setCargandoDocs(false));
  }

  useEffect(recargarDocumentos, [persona.id_persona]);

  function handleGuardarDatos() {
    setError(null);
    setGuardando(true);
    const fd = new FormData();
    fd.append("dni", dni);
    fd.append("cuil", cuil);
    fd.append("fecha_nacimiento", fechaNacimiento);
    fd.append("domicilio", domicilio);
    fd.append("fecha_ingreso", fechaIngreso);
    fd.append("convenio_colectivo", convenioColectivo);
    actualizarLegajo(persona.id_persona, fd)
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  function handleSubirArchivo(tipo: string, archivo: File | undefined) {
    if (!archivo) return;
    setSubiendoTipo(tipo);
    const fd = new FormData();
    fd.append("archivo", archivo);
    subirDocumentoLegajo(persona.id_persona, tipo, fd)
      .then((res) => {
        if (res.error) alert(res.error);
        else recargarDocumentos();
      })
      .finally(() => setSubiendoTipo(null));
  }

  function handleVerDocumento(path: string) {
    obtenerUrlDocumentoLegajo(path).then((url) => window.open(url, "_blank"));
  }

  function handleEliminarDocumento(doc: DocumentoLegajo) {
    if (!confirm(`¿Eliminar "${doc.nombre_archivo}"? No se puede deshacer.`)) return;
    eliminarDocumentoLegajo(doc.id_documento, doc.path).then((res) => {
      if (res.error) alert(res.error);
      else recargarDocumentos();
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              Legajo — {persona.nombre} {persona.apellido ?? ""}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}

        <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2">Datos personales</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-1">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">DNI</label>
            <input value={dni} onChange={(e) => setDni(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">CUIL</label>
            <input value={cuil} onChange={(e) => setCuil(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Fecha de nacimiento</label>
            <input type="date" value={fechaNacimiento} onChange={(e) => setFechaNacimiento(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Fecha de ingreso</label>
            <input type="date" value={fechaIngreso} onChange={(e) => setFechaIngreso(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-neutral-600 mb-1">Domicilio</label>
            <input value={domicilio} onChange={(e) => setDomicilio(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-neutral-600 mb-1">Convenio colectivo</label>
            <input
              value={convenioColectivo}
              onChange={(e) => setConvenioColectivo(e.target.value)}
              placeholder="Ej: Empleados de Comercio"
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end mb-5">
          <button
            type="button"
            onClick={handleGuardarDatos}
            disabled={guardando}
            className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-4 py-1.5 rounded-lg text-sm"
          >
            {guardando ? "Guardando..." : "Guardar datos"}
          </button>
        </div>

        <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2">Documentos</h3>
        {cargandoDocs ? (
          <p className="text-sm text-neutral-400 text-center py-4">Cargando...</p>
        ) : (
          <div className="space-y-2.5">
            {TIPOS_DOCUMENTO.map((t) => {
              const docsDeTipo = documentos.filter((d) => d.tipo === t.clave);
              return (
                <div key={t.clave} className="border border-neutral-200 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold text-neutral-800">
                      {t.icono} {t.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => inputsRef.current[t.clave]?.click()}
                      disabled={subiendoTipo === t.clave}
                      className="text-[11px] font-bold text-accent bg-accent-tint border border-dashed border-accent rounded-full px-3 py-1 disabled:opacity-50"
                    >
                      {subiendoTipo === t.clave ? "Subiendo..." : "+ Subir nuevo"}
                    </button>
                    <input
                      ref={(el) => {
                        inputsRef.current[t.clave] = el;
                      }}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        handleSubirArchivo(t.clave, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {docsDeTipo.length === 0 ? (
                    <p className="text-xs text-neutral-400 italic">Todavía no se subió ningún archivo.</p>
                  ) : (
                    docsDeTipo.map((d) => (
                      <div key={d.id_documento} className="flex items-center justify-between text-xs py-1 border-t border-dashed border-neutral-100 first:border-0">
                        <button type="button" onClick={() => handleVerDocumento(d.path)} className="text-accent font-medium hover:underline text-left truncate mr-2">
                          {d.nombre_archivo}
                        </button>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-neutral-400">{formatearFecha(d.fecha_subida)}</span>
                          <button type="button" onClick={() => handleEliminarDocumento(d)} className="text-red-400 hover:text-red-600">
                            ✕
                          </button>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
