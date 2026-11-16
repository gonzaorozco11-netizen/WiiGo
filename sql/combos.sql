-- Combos (Gonzalo, 2026-11-16). Correr UNA vez en el SQL Editor de Supabase.
--
-- Un combo no es un producto ni tiene stock: es una regla de precio. Si en la
-- compra (caja, tótem o tienda online) están sus productos, el precio baja solo
-- y el stock baja de cada producto. La cuenta está en lib/combos.ts.
--
-- grupos: [{"cantidad": 2, "productos": ["<id_producto>", ...]}, ...]
--   cada grupo pide `cantidad` unidades de cualquiera de esos productos, de
--   cualquier sabor. Ej.: whey (1) + creatina (1).
--
-- Se puede correr de nuevo sin romper nada.

create table if not exists combos (
  id_combo uuid primary key default gen_random_uuid(),
  nombre text not null,
  marca text,
  id_marca uuid references marcas(id_marca),
  precio numeric(12,2) not null check (precio > 0),
  precio_efectivo numeric(12,2) check (precio_efectivo is null or precio_efectivo > 0),
  imagen text,
  grupos jsonb not null,
  orden int not null default 0,
  estado text not null default 'ACTIVO',
  creado timestamptz not null default now()
);

-- Cerrada como el resto: solo la app (service role) la lee.
alter table combos enable row level security;

-- Qué renglones de una venta entraron en un combo: así no suman para la
-- profesional (con combo no hay descuento ni comisión de profesional).
alter table detalle_ventas add column if not exists id_combo uuid references combos(id_combo);

-- Los 5 combos de Animalfit (precios del 16/11). Creatina Star: solo la sin sabor.
insert into combos (id_combo, nombre, marca, id_marca, precio, precio_efectivo, imagen, grupos, orden) values
  ('fee594ba-87ba-4910-8b5f-8ca9285b8a78', 'Star · 2 creatinas 300 g', 'Star Nutrition', '36343ae0-e9b2-4c0b-919a-cd7e373c02e1', 52200, 46000,
   'https://rvzmwoudhijnuxujmbqy.supabase.co/storage/v1/object/public/fotos-productos/combo-star-2-creatinas.webp',
   '[{"cantidad": 2, "productos": ["34687e1a-21be-4989-8e1a-bbc8d205c832"]}]', 1),
  ('7f6210f2-923f-4397-9fa0-c1bdf2dd29c9', 'Star · Whey 2 lb + creatina 300 g', 'Star Nutrition', '36343ae0-e9b2-4c0b-919a-cd7e373c02e1', 117900, 104000,
   'https://rvzmwoudhijnuxujmbqy.supabase.co/storage/v1/object/public/fotos-productos/combo-star-whey-creatina.webp',
   '[{"cantidad": 1, "productos": ["6d5dc13a-707f-42ba-a1e9-8c0f92b94b34"]}, {"cantidad": 1, "productos": ["34687e1a-21be-4989-8e1a-bbc8d205c832"]}]', 2),
  ('9e718503-e043-4278-8118-73e81d466d06', 'Gold · Whey 2 lb + creatina 300 g', 'Gold Nutrition', '36343ae0-e9b2-4c0b-919a-cd7e373c02e1', 112200, 99000,
   null,
   '[{"cantidad": 1, "productos": ["3126d38a-9afa-45ee-83f6-2761a44ee1d8"]}, {"cantidad": 1, "productos": ["5835e4e3-18cd-4a8c-ab5f-5b90366b8037"]}]', 3),
  ('3fba0e2b-0451-412b-b7ce-1d64ac479c36', 'Body Advance · Whey 2 lb + creatina 150 g', 'Body Advance', '36343ae0-e9b2-4c0b-919a-cd7e373c02e1', 52500, 46300,
   'https://rvzmwoudhijnuxujmbqy.supabase.co/storage/v1/object/public/fotos-productos/combo-body-advance-whey-creatina-150.webp',
   '[{"cantidad": 1, "productos": ["2214f842-00f2-47f5-908c-f1cfe5b579de"]}, {"cantidad": 1, "productos": ["01ccaebb-9c2d-4792-93fd-8e2b28e6bea1"]}]', 4),
  ('e0d09649-a844-4533-ad9c-89c73a8cca0e', 'Body Advance · Whey 2 lb + creatina 300 g', 'Body Advance', '36343ae0-e9b2-4c0b-919a-cd7e373c02e1', 58500, 51600,
   'https://rvzmwoudhijnuxujmbqy.supabase.co/storage/v1/object/public/fotos-productos/combo-body-advance-whey-creatina-300.webp',
   '[{"cantidad": 1, "productos": ["2214f842-00f2-47f5-908c-f1cfe5b579de"]}, {"cantidad": 1, "productos": ["bb0a7749-20c5-40b0-a841-5365c0f723ae"]}]', 5)
on conflict (id_combo) do nothing;
