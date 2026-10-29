-- La competencia de Mendoza en Precios (Gonzalo, 2026-10-29).
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

-- Lo que venden los otros comercios, leído solo cada semana de sus páginas:
-- Bela Vita, Regio Mendoza, Mardegan y Jumbo (la sucursal de Mendoza).
create table if not exists competencia_items (
  id_item      uuid primary key default gen_random_uuid(),
  comercio     text not null check (comercio in ('BELAVITA', 'REGIO', 'MARDEGAN', 'JUMBO')),
  clave        text not null,           -- el id del producto en su página
  nombre       text not null,
  gramos       numeric(10,2),           -- lo que trae; vacío si no se sabe
  por_kilo     boolean not null default false,
  precio       numeric(14,2) not null,  -- el de hoy (con su oferta, si tiene)
  precio_antes numeric(14,2),           -- el de lista, si está en oferta
  disponible   boolean not null default true,
  visto_el     timestamptz not null default now(),
  unique (comercio, clave)
);
alter table competencia_items enable row level security;

-- Qué producto de cada comercio se compara con cada producto de WiiGo. El
-- sistema lo propone y Gonzalo lo confirma una vez; lo que rechaza no se le
-- vuelve a proponer.
create table if not exists competencia_vinculos (
  id_producto    uuid not null references productos(id_producto) on delete cascade,
  comercio       text not null,
  id_item        uuid references competencia_items(id_item) on delete set null,
  estado         text not null default 'PROPUESTO' check (estado in ('PROPUESTO', 'CONFIRMADO')),
  rechazados     uuid[] not null default '{}',
  actualizado_el timestamptz not null default now(),
  primary key (id_producto, comercio)
);
alter table competencia_vinculos enable row level security;
