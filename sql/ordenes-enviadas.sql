-- ============================================================
-- Cuándo se le mandó la orden a la marca o al proveedor
-- ============================================================
-- Compras funciona como una cinta: cada pedido está en una sola etapa a la
-- vez. Órdenes muestra lo emitido y todavía sin mandar; al marcarlo como
-- enviado, sale de ahí y aparece en Recepción; al recibirlo, sale de
-- Recepción y aparece en Costeo.
--
-- Estas dos columnas son la bisagra entre la primera y la segunda etapa.
-- Sin ellas, una orden creada y una orden ya enviada se ven idénticas — y
-- ese es el pedido que nunca llega porque nadie lo mandó, y nadie se entera.
--
-- En null = emitida pero sin enviar. Los pedidos que ya existían quedan así,
-- y hay que marcarlos a mano una vez. Con pocos pedidos es un minuto, y es
-- preferible a asumir que se enviaron y que después falte uno.

alter table ordenes_reposicion
  add column if not exists enviada_el  timestamptz,
  add column if not exists enviada_por text;

alter table ordenes_compra_proveedor
  add column if not exists enviada_el  timestamptz,
  add column if not exists enviada_por text;

-- Las dos etapas consultan por esto en cada carga de pantalla.
create index if not exists ordenes_reposicion_envio_idx
  on ordenes_reposicion (estado, enviada_el);

create index if not exists ordenes_compra_envio_idx
  on ordenes_compra_proveedor (estado, enviada_el);
