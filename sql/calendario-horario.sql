-- Horario del evento.
--
-- Un evento de un día sin hora no se puede preparar: la marca manda a la
-- promotora y el operativo no sabe a qué hora despejarle la mesa. "Sábado 7"
-- y "sábado 7 de 11 a 17" son dos cosas distintas para el que tiene que estar
-- ahí.
--
-- Van nulas en lo que dura todo el día: un feriado, una semana temática, una
-- fecha comercial. Solo se completan cuando el evento pasa en un rato.
--
-- Correr una vez en el SQL Editor de Supabase, después de calendario-eventos.sql.

alter table eventos add column if not exists hora_desde time;
alter table eventos add column if not exists hora_hasta time;

-- Comprobar que quedó:
--   select nombre, fecha_desde, fecha_hasta, hora_desde, hora_hasta from eventos;
