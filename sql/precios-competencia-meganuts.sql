-- Mega Nuts como competidor, y el motivo de las ofertas ("VENCE 4 NOV") (Gonzalo, 2026-10-29).
-- Correr una vez en el SQL Editor de Supabase, después de sql/precios-competencia.sql. Se puede correr de nuevo.
alter table competencia_items drop constraint if exists competencia_items_comercio_check;
alter table competencia_items add constraint competencia_items_comercio_check
  check (comercio in ('BELAVITA', 'MEGANUTS', 'REGIO', 'MARDEGAN', 'JUMBO'));
alter table competencia_items add column if not exists nota text;
