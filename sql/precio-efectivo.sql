-- Dos precios por producto: uno para tarjeta / Mercado Pago y otro contado.
--
-- Va como columna propia y no reusando `descuento_porcentaje`, que es el
-- descuento de OFERTA: ese pinta el cartelito rojo "-14%" y mete al producto
-- en la sección Ofertas del catálogo asesor. Todo el catálogo en oferta
-- permanente no es una oferta, es el precio.
--
-- Null = no hay precio de contado y se cobra el de lista en los dos casos.
-- Es lo que pasa hoy con todo lo que ya está cargado, así que nada cambia
-- hasta que alguien complete la columna.

alter table productos          add column if not exists precio_efectivo numeric(12,2);
alter table variantes_producto add column if not exists precio_efectivo numeric(12,2);

comment on column productos.precio_efectivo is
  'Precio pagando en efectivo. Null = se cobra precio_venta en todos los medios.';
comment on column variantes_producto.precio_efectivo is
  'Pisa al del producto, igual que precio_venta. Null = hereda el del producto.';
