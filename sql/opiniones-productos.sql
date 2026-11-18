-- Opiniones de los clientes sobre los productos (Gonzalo, 18/11).
--
-- Solo opina quien lo compró: cada opinión cuelga de una venta del cliente
-- (online o en la estación con su DNI). Las estrellas se publican solas; el
-- comentario espera que un operativo lo apruebe en «Comentarios». Solo el
-- dueño puede borrar. Las marcas las leen en su portal.
--
-- Correr una vez en el SQL Editor de Supabase.

create table if not exists opiniones_producto (
  id_opinion uuid primary key default gen_random_uuid(),
  id_producto uuid not null references productos (id_producto) on delete cascade,
  id_cliente uuid not null references clientes (id_cliente) on delete cascade,
  id_venta uuid not null references ventas (id_venta) on delete cascade,
  estrellas smallint not null check (estrellas between 1 and 5),
  comentario text,
  -- SIN = no escribió nada; PENDIENTE = espera a un operativo; PUBLICADO / OCULTO = ya lo revisaron.
  comentario_estado text not null default 'SIN' check (comentario_estado in ('SIN', 'PENDIENTE', 'PUBLICADO', 'OCULTO')),
  revisado_por text,
  revisado_el timestamptz,
  creado timestamptz not null default now(),
  unique (id_cliente, id_producto, id_venta)
);

create index if not exists opiniones_producto_producto_idx on opiniones_producto (id_producto);
create index if not exists opiniones_producto_pendientes_idx on opiniones_producto (creado) where comentario_estado = 'PENDIENTE';

-- Cerrada a todos menos al sistema (que entra con la service role).
alter table opiniones_producto enable row level security;

comment on table opiniones_producto is 'Estrellas (1 a 5) y comentario de un cliente sobre un producto que compró. El comentario se publica cuando lo aprueba un operativo en Comentarios.';
