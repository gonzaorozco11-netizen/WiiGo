-- Inventario general del local (Gonzalo, 2026-11-10): una tanda para cargar
-- el stock de todo el local, contando por módulo. Cada uno elige el módulo,
-- escanea o busca cada producto y pone cuántos hay. Al cerrar, Gonzalo carga
-- el stock con lo contado (menos lo que se vendió después de contarlo).
--
-- Se puede correr más de una vez sin romper nada.

create table if not exists inventarios (
  id_inventario uuid primary key default gen_random_uuid(),
  id_local uuid not null references locales (id_local),
  estado text not null default 'ABIERTO' check (estado in ('ABIERTO', 'CERRADO')),
  creado_por text,
  creado_en timestamptz not null default now(),
  cerrado_por text,
  cerrado_en timestamptz
);
create index if not exists idx_inventarios_local on inventarios (id_local, estado);

create table if not exists inventario_conteos (
  id_conteo uuid primary key default gen_random_uuid(),
  id_inventario uuid not null references inventarios (id_inventario) on delete cascade,
  id_variante uuid not null references variantes_producto (id_variante),
  zona text not null,                 -- «Módulo 1», «Freezer», «Depósito»…
  cantidad integer not null check (cantidad >= 0),  -- unidades; en el granel, gramos
  contado_por text,
  contado_en timestamptz not null default now(),
  unique (id_inventario, id_variante, zona)
);
create index if not exists idx_inventario_conteos on inventario_conteos (id_inventario, zona);

-- «Terminé mi parte»: cada uno firma lo que contó.
create table if not exists inventario_firmas (
  id_firma uuid primary key default gen_random_uuid(),
  id_inventario uuid not null references inventarios (id_inventario) on delete cascade,
  id_usuario uuid,
  nombre text,
  zonas text,                         -- «Animalfit, Depósito»
  productos integer not null default 0,
  firma text not null,                -- PNG en base64
  firmado_en timestamptz not null default now()
);
create index if not exists idx_inventario_firmas on inventario_firmas (id_inventario);

alter table inventarios enable row level security;
alter table inventario_conteos enable row level security;
alter table inventario_firmas enable row level security;
