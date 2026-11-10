-- Granel y fraccionado (Gonzalo, 2026-11-10).
--
-- WiiGo le pide a Alifrut a granel (1 o 2 kg) y lo embolsa en el local. El
-- granel de cada producto es un producto interno con estado 'GRANEL' y stock
-- en GRAMOS: se pide, se recibe y se liquida con el mismo circuito de siempre
-- (orden de compra, recepción, lotes FIFO), pero no se vende ni sale en el
-- tótem, la góndola, los carteles ni el conteo (todos filtran estado ACTIVO).
--
-- Registrar un fraccionado pasa gramos del granel a bolsitas: baja los lotes
-- de granel del más viejo al más nuevo y crea un lote de bolsitas con ese
-- costo exacto, así lo que se vende se le liquida a Alifrut al precio del día
-- en que mandó esa mercadería. Lo que sobra al terminar un granel es merma de
-- fraccionado y se le paga (acuerdo con Alifrut: la merma es de WiiGo).
--
-- Se puede correr más de una vez sin romper nada.

-- 1) El estado 'GRANEL' para los productos internos de granel.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'productos'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%estado%'
  loop
    execute format('alter table productos drop constraint %I', c.conname);
  end loop;
end $$;
alter table productos add constraint productos_estado_check check (estado in ('ACTIVO', 'INACTIVO', 'GRANEL'));
-- Un solo granel por costo de compra.
create unique index if not exists productos_un_granel_por_costo on productos (id_granel) where estado = 'GRANEL';

-- 2) El movimiento de stock «FRACCIONADO» (si el tipo tenía una lista cerrada, se abre).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'movimientos_stock'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%tipo%'
  loop
    execute format('alter table movimientos_stock drop constraint %I', c.conname);
  end loop;
end $$;

-- 3) Cada fraccionado (o cierre de un granel con su merma).
create table if not exists fraccionados (
  id_fraccionado uuid primary key default gen_random_uuid(),
  id_local uuid not null references locales (id_local),
  id_variante_granel uuid not null references variantes_producto (id_variante),
  id_variante_bolsa uuid references variantes_producto (id_variante),
  tipo text not null default 'FRACCIONADO' check (tipo in ('FRACCIONADO', 'CIERRE')),
  bolsitas integer not null default 0,
  gramos integer not null default 0,        -- lo que salió del granel
  merma_gramos integer not null default 0,  -- en un CIERRE: lo que se perdió
  costo_total numeric,                      -- lo que costaron esos gramos (de los lotes de Alifrut)
  usuario text,
  fecha timestamptz not null default now()
);
create index if not exists idx_fraccionados_granel on fraccionados (id_variante_granel, fecha desc);
create index if not exists idx_fraccionados_local on fraccionados (id_local, fecha desc);
alter table fraccionados enable row level security;

-- 4) Los lotes de bolsitas que nacen de un fraccionado (cuelgan de la recepción
--    del granel del que salieron). Se marcan para no mostrarlos como
--    mercadería recibida en Compras.
alter table detalle_recepcion_proveedor add column if not exists id_fraccionado uuid references fraccionados (id_fraccionado) on delete set null;
