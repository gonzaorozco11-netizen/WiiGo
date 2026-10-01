-- Guardar el PDF o la foto de la nota de crédito junto al reclamo.
--
-- Hasta ahora del reclamo quedaba el número y el importe, pero el papel no.
-- Cuando el contador pide el comprobante tres meses después, el número suelto
-- no alcanza: hay que ir a buscarlo al mail o pedírselo de nuevo al proveedor.
--
-- Guarda solo la ruta dentro del bucket privado `comprobantes-proveedor` — el
-- mismo que ya usan los pagos y los costeos. Nunca una URL pública: el archivo
-- se ve con un link firmado que vence.

alter table reclamos_proveedor
  add column if not exists nc_comprobante_path text;

comment on column reclamos_proveedor.nc_comprobante_path is
  'Ruta dentro del bucket privado comprobantes-proveedor del PDF/foto de la nota de crédito. Null = se cargó sin adjunto.';
