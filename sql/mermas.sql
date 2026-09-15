-- La mercadería que se perdió: rota, vencida o robada.
--
-- Existe como tabla aparte y no como un tipo más de movimiento_stock por una
-- razón de plata: con un proveedor que cobra por lo vendido (Alifrut), la
-- merma se le tiene que liquidar igual que una venta. Necesita entonces lo
-- mismo que una línea de venta: un motivo, y una marca de si ya se liquidó.
--
-- `movimientos_stock` igual recibe su fila — es el libro de todo lo que entra
-- y sale, y la merma sale. Pero ese libro no puede decir si algo ya se pagó.

create table if not exists mermas (
  id_merma      uuid primary key default gen_random_uuid(),
  id_variante   uuid not null references variantes_producto(id_variante),
  id_local      uuid not null references locales(id_local),
  cantidad      integer not null check (cantidad > 0),

  -- ROTURA | VENCIMIENTO | ROBO | OTRO
  motivo        text not null,
  -- El texto libre de quien la cargó. Es lo único que explica, seis meses
  -- después, por qué faltaban tres bolsas ese martes.
  detalle       text,

  -- El costo del lote del que salieron, congelado al registrarla. Es el mismo
  -- número que la pantalla mostró antes de confirmar; recalcularlo después
  -- haría que el comprobante y lo que se dijo en el momento no coincidan.
  -- Null cuando el producto no es de un proveedor por liquidación.
  costo_unitario numeric(14,2),

  fecha         timestamptz not null default now(),
  usuario       text,

  -- Se completa cuando la merma entra en una liquidación al proveedor.
  -- Mientras esté en null, sigue pendiente de pagarse — igual que
  -- detalle_ventas.id_liquidacion_proveedor.
  id_liquidacion_proveedor uuid references liquidaciones_proveedor(id_liquidacion)
);

-- Las dos consultas que se hacen de verdad: "qué le debo a este proveedor"
-- (variante + sin liquidar) y "qué pasó con este producto" (la ficha).
create index if not exists mermas_pendientes_idx
  on mermas (id_variante, fecha)
  where id_liquidacion_proveedor is null;

create index if not exists mermas_variante_idx on mermas (id_variante, fecha desc);

comment on table mermas is
  'Mercadería perdida. Con proveedores por liquidación se paga igual que si se hubiera vendido: el acuerdo es que la merma la absorbe WiiGo.';
comment on column mermas.id_liquidacion_proveedor is
  'Null = todavía no se pagó. Es lo que evita liquidar dos veces la misma merma.';
