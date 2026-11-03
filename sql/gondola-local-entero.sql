-- El local entero en la góndola: además de los 5 módulos de la pared
-- izquierda, las 2 islas del centro (3 pisos, con productos de los dos lados)
-- y la estantería de Animalfit de la pared derecha (2 partes, 6 estantes).
-- Se ubican desde Precios → Góndola y la pantalla asesora lleva al cliente
-- hasta cada una en 3D (Gonzalo, 2026-11-03).
-- Correr una vez en el SQL Editor de Supabase, después de sql/gondola.sql.
-- Se puede correr de nuevo sin romper nada.

-- MODULO = módulo de ganchos de la pared izquierda (los de siempre)
-- ISLA = un lado de una isla: numero = 1 (la de la entrada) o 2 (la del fondo),
--        lado = IZQ (mirando a los módulos) o DER (mirando a Animalfit)
-- ESTANTERIA = una parte de la estantería: numero = 1 (adelante) o 2 (fondo)
alter table gondola_modulos add column if not exists tipo text not null default 'MODULO';
alter table gondola_modulos add column if not exists numero int;
alter table gondola_modulos add column if not exists lado text;

-- Las filas van de arriba hacia abajo, como en los módulos.
-- Isla: estante de arriba, estante del medio y la tapa del mueble bajo.
-- El orden empieza en 101 para no mezclarse con el de los módulos (1 a 5).
insert into gondola_modulos (id_local, orden, titulo, subtitulo, filas, tipo, numero, lado)
select l.id_local, z.orden, z.titulo, z.subtitulo, z.filas::jsonb, z.tipo, z.numero, z.lado
from locales l
cross join (values
  (101, 'Isla 1', 'Lado de los módulos', 'ISLA', 1, 'IZQ',
   '[{"altura":"arriba","lugares":12},{"altura":"manos","lugares":12},{"altura":"abajo","lugares":12}]'),
  (102, 'Isla 1', 'Lado de Animalfit', 'ISLA', 1, 'DER',
   '[{"altura":"arriba","lugares":12},{"altura":"manos","lugares":12},{"altura":"abajo","lugares":12}]'),
  (103, 'Isla 2', 'Lado de los módulos', 'ISLA', 2, 'IZQ',
   '[{"altura":"arriba","lugares":12},{"altura":"manos","lugares":12},{"altura":"abajo","lugares":12}]'),
  (104, 'Isla 2', 'Lado de Animalfit', 'ISLA', 2, 'DER',
   '[{"altura":"arriba","lugares":12},{"altura":"manos","lugares":12},{"altura":"abajo","lugares":12}]'),
  (105, 'Estantería Animalfit', 'Parte de adelante', 'ESTANTERIA', 1, null,
   '[{"altura":"arriba","lugares":12},{"altura":"arriba","lugares":12},{"altura":"ojos","lugares":12},{"altura":"ojos","lugares":12},{"altura":"manos","lugares":12},{"altura":"abajo","lugares":12}]'),
  (106, 'Estantería Animalfit', 'Parte del fondo', 'ESTANTERIA', 2, null,
   '[{"altura":"arriba","lugares":12},{"altura":"arriba","lugares":12},{"altura":"ojos","lugares":12},{"altura":"ojos","lugares":12},{"altura":"manos","lugares":12},{"altura":"abajo","lugares":12}]')
) as z(orden, titulo, subtitulo, tipo, numero, lado, filas)
where l.estado = 'ACTIVO'
on conflict (id_local, orden) do nothing;
