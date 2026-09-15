-- De qué entrega salió cada renglón de la factura.
--
-- Hace falta para poder CORREGIR un costeo sin ensuciar: al recostear una
-- entrega hay que borrar sus renglones viejos antes de poner los nuevos, y
-- sin esta columna no había forma de saber cuáles eran suyos. Cada corrección
-- dejaba el detalle duplicado.
--
-- Importa además porque una factura puede cubrir varias entregas: borrar por
-- producto borraría también los de la otra.

alter table detalle_factura_compra
  add column if not exists id_recepcion uuid references recepciones_proveedor(id_recepcion);

create index if not exists detalle_factura_recepcion_idx
  on detalle_factura_compra (id_recepcion);
