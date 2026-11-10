-- Dónde está cada producto, confirmado en el inventario (Gonzalo, 2026-11-10).
-- CONFIRMADO: estaba donde dice el plano. NUEVO: no tenía lugar y quedó
-- ubicado. MOVIDO: está en otro lugar que el plano; queda PENDIENTE hasta que
-- Gonzalo elige dejarlo ahí (se actualiza el plano) o que lo muevan.
--
-- Se puede correr más de una vez sin romper nada.

create table if not exists inventario_ubicaciones (
  id_ubicacion uuid primary key default gen_random_uuid(),
  id_inventario uuid references inventarios (id_inventario) on delete set null,
  id_local uuid not null references locales (id_local),
  id_producto uuid not null references productos (id_producto),
  accion text not null check (accion in ('CONFIRMADO', 'NUEVO', 'MOVIDO')),
  desde text,                 -- «Módulo 2 · Ojos · lugar 2» (el del plano)
  hacia text,                 -- dónde está de verdad
  id_modulo uuid,             -- el lugar donde está de verdad
  fila integer,
  columna integer,
  estado text not null default 'APLICADA' check (estado in ('PENDIENTE', 'APLICADA', 'DESCARTADA')),
  quien text,
  cuando timestamptz not null default now()
);
create index if not exists idx_inventario_ubicaciones on inventario_ubicaciones (id_local, estado);
alter table inventario_ubicaciones enable row level security;
