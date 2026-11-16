-- Tienda online, partes 3 y 4 (2026-11-16): la compra online y la pantalla
-- «Pedidos online» del equipo. Correr UNA vez en el SQL Editor de Supabase,
-- ANTES de subir el código. Se puede correr de nuevo sin romper nada.
--
-- Estados: NUEVO (llegó) → ARMANDO (aceptado, lo están juntando) → LISTO
--          (esperando al cliente) → ENTREGADO. También CANCELADO.
-- Pago: TRANSFERENCIA (al alias, precio de góndola; la confirma el equipo) o
--       AL_RETIRAR (en la caja: efectivo, QR o posnet).
-- La venta (ventas, canal ONLINE) se crea recién al entregar, con lo que se
-- llevó de verdad: si faltó algo, la venta y el stock ya salen bien.

create table if not exists pedidos_online (
  id_pedido          uuid primary key default gen_random_uuid(),
  numero             bigint generated always as identity (start with 1001),
  -- El código que dice el cliente al retirar: WG-XXXX.
  codigo             text not null unique,
  id_cliente         uuid not null references clientes(id_cliente),
  id_local           uuid references locales(id_local),
  nombre             text not null,
  dni                text not null,
  email              text,
  pago               text not null check (pago in ('TRANSFERENCIA', 'AL_RETIRAR')),
  -- Cuándo el equipo vio la transferencia en la cuenta, y quién.
  pago_ok_at         timestamptz,
  pago_ok_por        text,
  estado             text not null default 'NUEVO' check (estado in ('NUEVO', 'ARMANDO', 'LISTO', 'ENTREGADO', 'CANCELADO')),
  -- Lo que se pidió (los precios del momento, se respetan hasta que vence).
  total_lista        numeric not null,
  total_efectivo     numeric not null,
  -- Ya transfirió y faltó algo (o se canceló): cuánto hay que devolverle.
  devolver           numeric not null default 0,
  devuelto_at        timestamptz,
  devuelto_por       text,
  motivo_cancelacion text,
  creado             timestamptz not null default now(),
  aceptado_at        timestamptz,
  listo_at           timestamptz,
  entregado_at       timestamptz,
  cancelado_at       timestamptz,
  -- Hasta cuándo se guarda sin pagar: el día siguiente a las 21.
  vence              timestamptz not null,
  id_venta           uuid references ventas(id_venta)
);
create index if not exists pedidos_online_estado on pedidos_online(estado, creado desc);
create index if not exists pedidos_online_cliente on pedidos_online(id_cliente, creado desc);
alter table pedidos_online enable row level security;

create table if not exists pedidos_online_items (
  id_item          uuid primary key default gen_random_uuid(),
  id_pedido        uuid not null references pedidos_online(id_pedido) on delete cascade,
  id_variante      uuid not null references variantes_producto(id_variante),
  id_producto      uuid not null references productos(id_producto),
  id_marca         uuid,
  nombre           text not null,
  variante         text,
  cantidad         integer not null check (cantidad > 0),
  -- Si al armarlo faltó: cuántos se encontraron (null = estaban todos).
  hay              integer check (hay is null or hay >= 0),
  precio_lista     numeric not null,
  precio_efectivo  numeric not null,
  armado           boolean not null default false
);
create index if not exists pedidos_online_items_pedido on pedidos_online_items(id_pedido);
create index if not exists pedidos_online_items_variante on pedidos_online_items(id_variante);
alter table pedidos_online_items enable row level security;

-- Las ventas de la tienda se guardan con canal ONLINE. Si la columna tiene una
-- lista cerrada de valores, se le suma ONLINE (lo que ya hay es POS y SELF_CHECKOUT).
do $$
declare
  r record;
  habia boolean := false;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'ventas' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%canal%'
  loop
    execute format('alter table public.ventas drop constraint %I', r.conname);
    habia := true;
  end loop;
  if habia then
    alter table public.ventas add constraint ventas_canal_check check (canal in ('POS', 'SELF_CHECKOUT', 'ONLINE')) not valid;
  end if;
end $$;
