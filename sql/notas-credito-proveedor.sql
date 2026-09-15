-- La nota de crédito que cierra un reclamo.
--
-- La tabla `reclamos_proveedor` ya guardaba el número, la fecha y el monto.
-- Falta el desglose: una nota de crédito real discrimina percepciones igual
-- que una factura, y si te acreditan mercadería esa percepción también vuelve.
-- Sin estas columnas esa plata se perdía.

alter table reclamos_proveedor
  add column if not exists nc_neto        numeric(14,2),
  add column if not exists nc_impuestos   numeric(14,2),
  add column if not exists nc_retenciones numeric(14,2),
  add column if not exists nc_descuentos  numeric(14,2),
  add column if not exists nc_iva         numeric(14,2);

comment on column reclamos_proveedor.nc_monto is
  'El total de la nota: neto + impuestos + retenciones − descuentos + IVA. Es lo que baja de la cuenta corriente.';
comment on column reclamos_proveedor.nc_iva is
  'Lo único que vuelve del crédito fiscal. El resto ya estaba en el costo de la mercadería.';
