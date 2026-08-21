"use client";

import { useState, useTransition } from "react";
import type { Marca } from "@/lib/supabase";
import { createMarca, updateMarca } from "@/app/(app)/marcas/actions";

export default function MarcaFormModal({
  marca,
  onClose,
}: {
  marca: Marca | null;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tipoComercializacion, setTipoComercializacion] = useState(marca?.tipo_comercializacion ?? "CONSIGNACION");
  const isEditing = Boolean(marca);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        if (marca) {
          await updateMarca(marca.id_marca, formData);
        } else {
          await createMarca(formData);
        }
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">
            {isEditing ? "Editar marca" : "Nueva marca"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form action={handleSubmit} className="space-y-6">
          <fieldset>
            <legend className="text-sm font-semibold text-neutral-900 mb-1">Tipo de comercialización</legend>
            <p className="text-xs text-neutral-500 mb-3">
              Consignación: la mercadería es de la marca, WiiGo retiene su comisión y le rinde el resto (define las
              condiciones comerciales de abajo). Propia: es WiiGo Dietética — sin rendición a terceros, se calcula
              rentabilidad real con el costo de cada producto.
            </p>
            <select
              name="tipo_comercializacion"
              value={tipoComercializacion}
              onChange={(e) => setTipoComercializacion(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="CONSIGNACION">Consignación (marca externa)</option>
              <option value="PROPIA">Propia (WiiGo Dietética)</option>
            </select>
          </fieldset>

          <Section title="Datos generales">
            <Field label="Nombre *" name="nombre" defaultValue={marca?.nombre} required />
            <Field label="CUIT" name="cuit" defaultValue={marca?.cuit ?? ""} />
            <Field label="Contacto" name="contacto" defaultValue={marca?.contacto ?? ""} />
            <Field label="Teléfono" name="telefono" defaultValue={marca?.telefono ?? ""} type="tel" />
            <Field label="Email" name="email" defaultValue={marca?.email ?? ""} type="email" />
            <Field label="Dirección" name="direccion" defaultValue={marca?.direccion ?? ""} />
            <Field
              label="Fecha de ingreso"
              name="fecha_ingreso"
              defaultValue={marca?.fecha_ingreso ?? ""}
              type="date"
            />
            <SelectField
              label="Estado"
              name="estado"
              defaultValue={marca?.estado ?? "ACTIVA"}
              options={["ACTIVA", "INACTIVA"]}
            />
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-neutral-700 mb-1">Observaciones</label>
              <textarea
                name="observaciones"
                defaultValue={marca?.observaciones ?? ""}
                rows={2}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </Section>

          {tipoComercializacion === "CONSIGNACION" && (
          <>
          <Section title="Condiciones comerciales">
            <Field
              label="Fee de ingreso"
              name="fee_ingreso"
              defaultValue={marca?.fee_ingreso ?? ""}
              type="number"
              step="0.01"
            />
            <Field
              label="Royalty (%)"
              name="royalty_porcentaje"
              defaultValue={marca?.royalty_porcentaje ?? ""}
              type="number"
              step="0.001"
            />
            <Field
              label="IVA sobre royalty (%)"
              name="iva_royalty_porcentaje"
              defaultValue={marca?.iva_royalty_porcentaje ?? ""}
              type="number"
              step="0.001"
            />
            <Field
              label="Frecuencia de liquidación"
              name="frecuencia_liquidacion"
              defaultValue={marca?.frecuencia_liquidacion ?? ""}
              placeholder="Ej: MENSUAL, QUINCENAL"
            />
          </Section>

          <Section title="Costos de cobro a trasladar a la marca">
            <Checkbox
              label="Comisión de cobro"
              name="trasladar_comision_cobro"
              defaultChecked={marca?.trasladar_comision_cobro}
            />
            <Checkbox
              label="IVA de la comisión"
              name="trasladar_iva_comision"
              defaultChecked={marca?.trasladar_iva_comision}
            />
            <Checkbox
              label="SIRCREB"
              name="trasladar_sircreb"
              defaultChecked={marca?.trasladar_sircreb}
            />
            <Checkbox
              label="Impuesto a los créditos"
              name="trasladar_imp_creditos"
              defaultChecked={marca?.trasladar_imp_creditos}
            />
            <Checkbox
              label="Otras retenciones"
              name="trasladar_otras_retenciones"
              defaultChecked={marca?.trasladar_otras_retenciones}
            />
            <Checkbox
              label="Otros costos de cobro"
              name="trasladar_otros_costos_cobro"
              defaultChecked={marca?.trasladar_otros_costos_cobro}
            />
            <Field
              label="Impuesto a los débitos (%)"
              name="imp_debitos_porcentaje"
              defaultValue={marca?.imp_debitos_porcentaje ?? ""}
              type="number"
              step="0.001"
            />
            <Checkbox
              label="Trasladar impuesto a los débitos"
              name="trasladar_imp_debitos"
              defaultChecked={marca?.trasladar_imp_debitos}
            />
          </Section>
          </>
          )}

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-neutral-900 mb-3">{title}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
  step,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  step?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: string[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor={name}>
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function Checkbox({
  label,
  name,
  defaultChecked,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-700">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="rounded border-neutral-300 text-accent focus:ring-accent"
      />
      {label}
    </label>
  );
}
