-- Freezer vertical de Alta en la parte de atrás (Gonzalo, 2026-11-05).
-- Va en la pared izquierda, después del M5. Es un Inelro de 5 estantes; por
-- ahora 4 productos de frente por estante. Hay lugar para 3 freezers: cuando
-- lleguen los otros dos, se agregan con numero 2 y 3 (el 1 es el pegado al M5).
-- Se puede correr más de una vez: no duplica.

insert into gondola_modulos (id_local, orden, titulo, subtitulo, filas, tipo, numero, lado)
select l.id_local,
       coalesce((select max(m.orden) from gondola_modulos m where m.id_local = l.id_local), 0) + 1,
       'Freezer 1',
       'Alta · congelados',
       '[{"altura":"arriba","lugares":4},{"altura":"ojos","lugares":4},{"altura":"manos","lugares":4},{"altura":"manos","lugares":4},{"altura":"abajo","lugares":4}]'::jsonb,
       'FREEZER',
       1,
       null
from (select distinct id_local from gondola_modulos) l
where not exists (
  select 1 from gondola_modulos f where f.id_local = l.id_local and f.tipo = 'FREEZER' and f.numero = 1
);
