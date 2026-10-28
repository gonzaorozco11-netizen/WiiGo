-- Módulo Precios: el precio al público de lo que compra WiiGo (marcas PROPIAS).
-- Ver lib/calculoPrecio.ts. Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

-- Lo que se compra a granel (Alifrut): el costo de la lista, sin IVA, por kg o por bolsa.
-- Cada tamaño que se vende (100 g, 250 g…) es un producto que apunta acá.
create table if not exists costos_granel (
  id_granel             uuid primary key default gen_random_uuid(),
  nombre                text not null,
  id_proveedor          uuid references proveedores(id_proveedor),
  costo_neto            numeric(14,2) not null,
  -- KG: el costo es por kilo. BULTO: es el de la bolsa entera, que trae kg_bulto kilos.
  unidad                text not null default 'KG',
  kg_bulto              numeric(10,3),
  costo_anterior        numeric(14,2),
  costo_actualizado_el  timestamptz not null default now(),
  estado                text not null default 'ACTIVO'
);
alter table costos_granel enable row level security;

-- Bolsitas y etiquetas: se cambia el precio una vez y se recalcula todo lo que la usa.
create table if not exists envases (
  id_envase  uuid primary key default gen_random_uuid(),
  nombre     text not null,
  costo      numeric(12,2) not null default 0,
  estado     text not null default 'ACTIVO'
);
alter table envases enable row level security;
insert into envases (nombre, costo)
select v.nombre, v.costo
from (values ('Doypack chica (100 a 250 g) + etiqueta', 300), ('Doypack grande (500 g a 1 kg) + etiqueta', 380)) as v(nombre, costo)
where not exists (select 1 from envases);

-- Lo de cada producto. Lo que no se carga, se toma del rubro o de Configuración.
alter table productos add column if not exists id_granel uuid references costos_granel(id_granel);
alter table productos add column if not exists id_envase uuid references envases(id_envase);
alter table productos add column if not exists margen_objetivo numeric(6,2);
alter table productos add column if not exists descuento_efectivo numeric(6,2);
alter table productos add column if not exists precio_competencia numeric(12,2);
alter table productos add column if not exists costo_actualizado_el timestamptz;

-- Margen y descuento por efectivo de todo un rubro.
alter table subcategorias add column if not exists margen_objetivo numeric(6,2);
alter table subcategorias add column if not exists descuento_efectivo numeric(6,2);
