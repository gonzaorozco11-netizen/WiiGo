-- Poder corregir un costeo sin volver a tipear todo.
--
-- El problema: el lote guardaba solo `costo_unitario`, que es el costo REAL
-- con las percepciones ya prorrateadas adentro. Al abrir "Corregir" no había
-- de dónde sacar el número que decía el renglón de la factura — y volver a
-- usar el costo con impuestos se los sumaría por segunda vez, inflando el
-- costo en cada corrección.
--
-- Así que ahora se guardan los dos: el del papel y el real.

alter table detalle_recepcion_proveedor
  add column if not exists costo_neto_factura numeric(14,2);

comment on column detalle_recepcion_proveedor.costo_neto_factura is
  'Lo que dice el renglón de la factura, sin prorrateo. costo_unitario es el real, con el pie repartido.';

-- Qué factura cubre esta entrega. Hasta ahora el vínculo era implícito por
-- id_orden, y con dos entregas y dos facturas sobre el mismo pedido no había
-- forma de saber cuál era cuál.
alter table recepciones_proveedor
  add column if not exists id_factura uuid references facturas_compra_proveedor(id_factura);

create index if not exists recepciones_proveedor_factura_idx
  on recepciones_proveedor (id_factura);
