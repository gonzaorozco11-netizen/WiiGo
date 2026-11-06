-- Opiniones que escribe el propio paciente con un link personal (Gonzalo, 2026-11-06).
-- La profesional le manda el link por WhatsApp desde "Tus pacientes"; el
-- paciente escribe en /opinion/<token>, confirma los últimos 3 números de su
-- DNI y da su permiso. Queda PENDIENTE hasta que Gonzalo la aprueba en
-- Aprobaciones; la profesional la ve desde que llega, con su estado.
-- Correr una vez en el SQL Editor de Supabase. No borra nada.

alter table opiniones_profesional
  -- PROFESIONAL: la cargó ella en Mi ficha · PACIENTE: la escribió el paciente con su link
  add column if not exists origen text not null default 'PROFESIONAL',
  -- Solo las de pacientes esperan: PENDIENTE, APROBADA o DESCARTADA
  add column if not exists estado text not null default 'APROBADA',
  add column if not exists id_cliente uuid references clientes(id_cliente) on delete set null,
  -- Cuándo aceptó el paciente que se muestre en el local
  add column if not exists permiso_at timestamptz;

create index if not exists idx_opiniones_pendientes on opiniones_profesional (estado, creada_el) where origen = 'PACIENTE';

create table if not exists pedidos_opinion (
  id_pedido       uuid primary key default gen_random_uuid(),
  token           text not null unique,
  id_profesional  uuid not null references profesionales(id_profesional) on delete cascade,
  id_cliente      uuid not null references clientes(id_cliente) on delete cascade,
  creado_el       timestamptz not null default now(),
  vence_el        timestamptz not null,
  usado_el        timestamptz,
  -- Veces que pusieron mal los 3 números del DNI: con 5 el link se bloquea
  intentos        int not null default 0
);
create index if not exists idx_pedidos_opinion_paciente on pedidos_opinion (id_profesional, id_cliente, creado_el desc);
alter table pedidos_opinion enable row level security;
