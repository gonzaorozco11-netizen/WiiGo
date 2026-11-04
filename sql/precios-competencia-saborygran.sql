-- Sabor y Gran (saborygran.com.ar, dietética de Mendoza) en Competencia (Gonzalo, 2026-11-04).
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.
alter table competencia_items drop constraint if exists competencia_items_comercio_check;
alter table competencia_items add constraint competencia_items_comercio_check
  check (comercio in ('BELAVITA', 'MEGANUTS', 'REGIO', 'MARDEGAN', 'JUMBO', 'ALIFRUT', 'SABORYGRAN'));
