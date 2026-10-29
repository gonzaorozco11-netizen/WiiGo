-- La góndola del local: los módulos (muebles) y en qué lugar va cada
-- producto. Se ubica desde Precios → Góndola y la pantalla asesora le muestra
-- al cliente, en 3D, en qué módulo y en qué lugar está (Gonzalo, 2026-10-29).
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

create table if not exists gondola_modulos (
  id_modulo   uuid primary key default gen_random_uuid(),
  id_local    uuid not null references locales(id_local),
  -- De izquierda a derecha, como los ve el cliente al entrar.
  orden       int not null,
  -- El cartel: en grande para qué es, abajo chico qué hay.
  titulo      text not null,
  subtitulo   text,
  -- Las filas de arriba hacia abajo: [{"altura":"arriba","lugares":6,"grande":false}, ...]
  filas       jsonb not null,
  creado_el   timestamptz not null default now(),
  unique (id_local, orden)
);

create table if not exists gondola_lugares (
  id_modulo   uuid not null references gondola_modulos(id_modulo) on delete cascade,
  id_local    uuid not null references locales(id_local),
  fila        int not null,
  columna     int not null,
  id_producto uuid not null references productos(id_producto),
  actualizado_el timestamptz not null default now(),
  primary key (id_modulo, fila, columna),
  -- Un producto está en un solo lugar por local.
  unique (id_local, id_producto)
);

alter table gondola_modulos enable row level security;
alter table gondola_lugares enable row level security;

-- Los 5 módulos de cada local activo, con los carteles elegidos el 2026-10-29.
-- El 4 tiene la fila del medio doble (las granolas de 1 kg): 18 lugares.
insert into gondola_modulos (id_local, orden, titulo, subtitulo, filas)
select l.id_local, m.orden, m.titulo, m.subtitulo, m.filas::jsonb
from locales l
cross join (values
  (1, 'Un clásico sano', 'Frutos secos',
   '[{"altura":"arriba","lugares":6},{"altura":"ojos","lugares":6},{"altura":"manos","lugares":6},{"altura":"abajo","lugares":6}]'),
  (2, 'Energía natural', 'Frutas deshidratadas y mix',
   '[{"altura":"arriba","lugares":6},{"altura":"ojos","lugares":6},{"altura":"manos","lugares":6},{"altura":"abajo","lugares":6}]'),
  (3, 'A cualquier hora', 'Cereales',
   '[{"altura":"arriba","lugares":6},{"altura":"ojos","lugares":6},{"altura":"manos","lugares":6},{"altura":"abajo","lugares":6}]'),
  (4, 'Un plus a tus comidas', 'Granolas y semillas',
   '[{"altura":"arriba","lugares":6},{"altura":"ojos","lugares":6,"grande":true},{"altura":"abajo","lugares":6}]'),
  (5, 'Para cocinar', 'Harinas y legumbres',
   '[{"altura":"arriba","lugares":6},{"altura":"ojos","lugares":6},{"altura":"manos","lugares":6},{"altura":"abajo","lugares":6}]')
) as m(orden, titulo, subtitulo, filas)
where l.estado = 'ACTIVO'
on conflict (id_local, orden) do nothing;
