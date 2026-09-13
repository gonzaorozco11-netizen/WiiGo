-- Recepción parcial: un pedido puede llegar en varias entregas.
--
-- No hay columnas nuevas. Los dos estados que aparecen (RECIBIDA_PARCIAL y
-- CERRADA_INCOMPLETA) van en la columna `estado` que ya existe y es texto
-- libre, y las tablas de recepciones ya soportaban varias filas por pedido.
--
-- Lo único que hace falta son índices: ahora las tres pantallas de Compras
-- leen el historial de entregas por fecha, y sin esto Postgres recorre la
-- tabla entera cada vez que alguien abre Recepción.

-- Historial de entregas, filtrado por fecha (bloque "Ya recibidas").
create index if not exists recepciones_proveedor_fecha_idx
  on recepciones_proveedor (fecha desc);

create index if not exists recepciones_fecha_idx
  on recepciones (fecha desc);

-- Buscar las entregas de un pedido puntual, para numerarlas "2ª de 3".
create index if not exists recepciones_proveedor_orden_idx
  on recepciones_proveedor (id_orden);

create index if not exists recepciones_orden_idx
  on recepciones (id_orden);

-- Los contadores y el tablero preguntan por los estados abiertos.
create index if not exists ordenes_compra_estado_idx
  on ordenes_compra_proveedor (estado);

create index if not exists ordenes_reposicion_estado_idx
  on ordenes_reposicion (estado);
