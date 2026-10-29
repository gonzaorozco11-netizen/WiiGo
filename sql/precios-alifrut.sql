-- La lista de Alifrut adentro de Precios (Gonzalo, 2026-10-29).
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

-- Lo que vende el proveedor, con los precios exclusivos de WiiGo (la lista que
-- Gonzalo ve con su usuario). Se rehace cada vez que se trae la lista: lo que
-- cambió guarda el costo anterior y la fecha.
create table if not exists catalogo_proveedor (
  id_item          uuid primary key default gen_random_uuid(),
  id_proveedor     uuid not null references proveedores(id_proveedor),
  -- nombre + marca en minúsculas y sin acentos: así se reconoce el mismo
  -- producto en la lista siguiente.
  clave            text not null,
  categoria        text,
  nombre           text not null,
  marca            text,
  presentacion     text,
  -- KG: el costo es por kilo. BOLSA: el de la bolsa, que trae `cantidad` kg.
  -- CAJA: el de la caja, que trae `cantidad` unidades. UNIDAD: una sola.
  unidad           text not null default 'KG' check (unidad in ('KG', 'BOLSA', 'CAJA', 'UNIDAD')),
  cantidad         numeric(10,3),
  unidad_revisada  boolean not null default false,
  costo_neto       numeric(14,2) not null,
  precio_final     numeric(14,2),
  costo_anterior   numeric(14,2),
  costo_cambio_el  timestamptz,
  visto_el         timestamptz not null default now(),
  creado_el        timestamptz not null default now(),
  unique (id_proveedor, clave)
);
alter table catalogo_proveedor enable row level security;

-- Lo que WiiGo usa para calcular (costos_granel) queda unido a su producto de
-- la lista. La diferencia entre los dos es el aviso de "cambió el precio".
alter table costos_granel add column if not exists id_item uuid references catalogo_proveedor(id_item) on delete set null;
-- costos_granel.unidad ahora también puede ser CAJA: kg_bulto guarda cuántas unidades trae.
