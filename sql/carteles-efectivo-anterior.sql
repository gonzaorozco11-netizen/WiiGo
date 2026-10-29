-- El precio en efectivo que dice el cartel puesto, para que en Carteles de
-- góndola se vean los dos precios viejos y los dos nuevos (Gonzalo, 2026-10-29).
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.
alter table tareas_etiqueta add column if not exists efectivo_anterior numeric(14,2);
