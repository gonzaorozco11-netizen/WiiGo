-- Orden en que aparecen las marcas en el Asesor.
--
-- Hasta ahora salían alfabéticas, que con tres marcas daba igual pero con diez
-- o quince no: la marca propia tiene que ir primero y las demás en el orden que
-- vos decidas, no el que decida el abecedario.
--
-- Número más chico = aparece antes. Las que queden en NULL van al final,
-- ordenadas alfabéticamente entre ellas: una marca nueva no rompe nada, entra
-- last y después le ponés el número que quieras.

alter table marcas add column if not exists orden integer;

comment on column marcas.orden is
  'Posición en el Asesor. Menor primero; NULL va al final por orden alfabético.';

update marcas set orden = 1 where nombre ilike '%dietética%' or nombre ilike '%dietetica%';
update marcas set orden = 2 where nombre ilike 'animal%';
update marcas set orden = 3 where nombre ilike 'alta';

-- Para verificar cómo van a salir:
select nombre, orden, estado
from marcas
where estado = 'ACTIVA'
order by orden nulls last, nombre;
