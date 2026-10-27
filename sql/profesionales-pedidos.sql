-- Pedidos que arma una profesional para su paciente y que el equipo prepara en el local.
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.
--
-- Estados: NUEVO (llegó, hay que armarlo) → LISTO (armado, esperando al paciente, se guarda 3 días)
--          → ENTREGADO (se cobró en la caja). También CANCELADO y DEVUELTO (no lo retiró y volvió a la góndola).

create table if not exists pedidos_profesional (
  id_pedido          uuid primary key default gen_random_uuid(),
  numero             bigint generated always as identity,
  id_profesional     uuid not null references profesionales(id_profesional),
  id_local           uuid references locales(id_local),
  id_cliente         uuid references clientes(id_cliente),
  paciente_nombre    text not null,
  paciente_apellido  text not null,
  paciente_dni       text not null,
  paciente_telefono  text,
  -- Cuándo aceptó el paciente quedar como cliente de WiiGo y que le escriban por su pedido.
  acepto_at          timestamptz not null,
  -- El código de la profesional en el momento del pedido: se aplica solo al cobrarlo.
  codigo             text,
  estado             text not null default 'NUEVO',
  -- Si al armarlo faltó algo, lo que le avisó el equipo a la profesional.
  nota_falta         text,
  creado             timestamptz not null default now(),
  listo_at           timestamptz,
  guardar_hasta      timestamptz,
  entregado_at       timestamptz,
  id_venta           uuid references ventas(id_venta)
);
create index if not exists pedidos_profesional_estado on pedidos_profesional(estado, creado desc);
create index if not exists pedidos_profesional_por_profesional on pedidos_profesional(id_profesional, creado desc);
alter table pedidos_profesional enable row level security;

create table if not exists pedidos_profesional_items (
  id_item          uuid primary key default gen_random_uuid(),
  id_pedido        uuid not null references pedidos_profesional(id_pedido) on delete cascade,
  id_variante      uuid not null references variantes_producto(id_variante),
  nombre           text not null,
  cantidad         integer not null check (cantidad > 0),
  -- Los dos precios del momento del pedido: se respetan 24 horas.
  precio_lista     numeric not null,
  precio_efectivo  numeric not null,
  armado           boolean not null default false
);
create index if not exists pedidos_profesional_items_pedido on pedidos_profesional_items(id_pedido);
alter table pedidos_profesional_items enable row level security;
