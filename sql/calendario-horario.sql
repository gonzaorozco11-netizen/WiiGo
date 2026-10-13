-- Horario del evento, y qué trae la marca.
--
-- 1. HORARIO. Un evento de un día sin hora no se puede preparar: la marca
--    manda a la promotora y el operativo no sabe a qué hora despejarle la
--    mesa. "Sábado 7" y "sábado 7 de 11 a 17" son dos cosas distintas para el
--    que tiene que estar ahí.
--
--    Van nulas en lo que dura todo el día: un feriado, una semana temática,
--    una fecha comercial. Solo se completan cuando el evento pasa en un rato.
--
-- 2. `necesita` pasa a llamarse `trae`. El campo nació al revés: preguntaba
--    qué le tenía que dar WiiGo a la marca, cuando lo que hace falta saber es
--    qué va a meter la marca adentro del local —promotora, muestras,
--    cartelería, una mesa propia— para poder autorizarlo o no. WiiGo no
--    provee nada; aprueba lo que entra.
--
-- Correr una vez en el SQL Editor de Supabase, después de calendario-eventos.sql.

alter table eventos add column if not exists hora_desde time;
alter table eventos add column if not exists hora_hasta time;

-- `rename column` no acepta IF EXISTS, así que se pregunta antes: de otro modo
-- correr esto dos veces tira error.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'eventos' and column_name = 'necesita'
  ) then
    alter table eventos rename column necesita to trae;
  end if;
end $$;

alter table eventos add column if not exists trae text;

-- Comprobar que quedó:
--   select nombre, fecha_desde, fecha_hasta, hora_desde, hora_hasta, trae from eventos;
