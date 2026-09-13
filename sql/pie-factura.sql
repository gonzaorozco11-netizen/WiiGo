-- Pie de la factura: los conceptos que están en el comprobante pero no en
-- ningún renglón.
--
-- Hasta ahora la factura guardaba solo neto / iva / monto. Con eso no se
-- podía explicar por qué el total no coincidía con la suma de los ítems, y
-- las percepciones quedaban sin lugar donde vivir.
--
-- Los tres entran al costo del producto (los descuentos restando); el IVA no,
-- porque vuelve como crédito fiscal.

alter table facturas_compra_proveedor
  add column if not exists impuestos numeric(14,2),
  add column if not exists retenciones numeric(14,2),
  add column if not exists descuentos numeric(14,2);

comment on column facturas_compra_proveedor.impuestos is
  'Percepciones, IIBB y similares. Se prorratean al costo de cada producto.';
comment on column facturas_compra_proveedor.retenciones is
  'Igual que impuestos: se prorratean al costo.';
comment on column facturas_compra_proveedor.descuentos is
  'Descuento al pie. Se prorratea restando del costo.';
