-- ============================================================
-- Devoluciones (totales y parciales)
-- ============================================================
-- Hasta acá una devolución se guardaba como columnas sueltas en `ventas`,
-- porque se asumía una sola por venta y siempre total. Eso deja de alcanzar:
-- un cliente puede devolver un producto de tres hoy y otro la semana que
-- viene, y cada una lleva su propia nota de crédito y su propia salida de
-- caja.
--
-- Así que la devolución pasa a ser una entidad con nombre propio, y la
-- anulación completa es simplemente una devolución que cubre todas las
-- líneas. Un solo mecanismo: si fueran dos, tarde o temprano uno haría algo
-- que el otro no.

create table if not exists devoluciones (
  id_devolucion   uuid primary key default gen_random_uuid(),
  id_venta        uuid not null references ventas(id_venta),

  -- TOTAL cuando cubre todo lo que quedaba sin devolver, PARCIAL si no.
  -- Se guarda calculado y no se deduce después: lo que importa es qué era
  -- en el momento en que se hizo.
  alcance         text not null,
  fecha           timestamptz not null default now(),
  usuario         text,
  motivo          text not null,
  total           numeric(12,2) not null,

  -- VUELVE | NO_VUELVE. Es la decisión sanitaria: un producto abierto,
  -- vencido o fallado NO puede volver a la góndola, y sin esta marca el
  -- sistema lo repone al stock y se lo vende al cliente siguiente.
  destino         text not null default 'VUELVE',

  -- Cómo volvió la plata. Mismo criterio que en ventas: vuelve por donde
  -- entró, y salirse de eso necesita la firma de un admin.
  medio           text not null,
  monto_devuelto  numeric(12,2) not null default 0,
  id_turno        uuid references turnos(id_turno),
  autorizada_por  text,

  -- Reintegro de Mercado Pago, cuando corresponde.
  mp_refund_id    text,
  mp_error        text,

  -- Nota de crédito de ESTA devolución. Cada una lleva la suya: dos
  -- devoluciones parciales sobre la misma factura son dos notas distintas.
  nc_estado       text,
  nc_cae          text,
  nc_cae_vencimiento text,
  nc_tipo         integer,
  nc_punto_venta  integer,
  nc_numero       integer,
  nc_fecha        date,
  nc_neto         numeric(12,2),
  nc_iva          numeric(12,2),
  nc_total        numeric(12,2),
  nc_error        text
);

create index if not exists devoluciones_venta_idx on devoluciones (id_venta, fecha desc);
create index if not exists devoluciones_turno_idx on devoluciones (id_turno, medio);
create index if not exists devoluciones_nc_pendiente_idx on devoluciones (nc_estado) where nc_estado = 'PENDIENTE';


-- Qué se devolvió, renglón por renglón.
-- El precio se congela acá igual que en detalle_ventas: si mañana cambia el
-- precio del producto, esta devolución tiene que seguir diciendo lo que
-- realmente se devolvió.
create table if not exists detalle_devoluciones (
  id_detalle_dev  uuid primary key default gen_random_uuid(),
  id_devolucion   uuid not null references devoluciones(id_devolucion) on delete cascade,
  id_detalle      uuid references detalle_ventas(id_detalle),
  id_variante     uuid not null references variantes_producto(id_variante),
  id_marca        uuid references marcas(id_marca),
  cantidad        integer not null,
  precio_unitario numeric(12,2) not null,
  subtotal        numeric(12,2) not null,

  -- Cuándo se le entregó físicamente a la marca la mercadería que no volvió a
  -- la góndola. Mientras esté en null, sigue apilada en el local: es lo que
  -- alimenta la lista de Abastecimiento. Sin esto la pila crece y nadie se
  -- acuerda de qué había que devolverle a quién.
  devuelto_a_marca_el  timestamptz,
  devuelto_a_marca_por text
);

create index if not exists detalle_devoluciones_dev_idx on detalle_devoluciones (id_devolucion);
-- Para saber cuánto se devolvió ya de cada línea, y no dejar devolver de más.
create index if not exists detalle_devoluciones_detalle_idx on detalle_devoluciones (id_detalle);


-- Marca en la venta para poder filtrar en pantalla sin recorrer las
-- devoluciones. La venta sigue PAGADA: lo que no se devolvió sigue vendido.
alter table ventas
  add column if not exists devuelta_parcial boolean not null default false;
