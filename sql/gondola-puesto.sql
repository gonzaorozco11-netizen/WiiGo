-- Góndola: cada lugar puede estar puesto o solo planificado (Gonzalo, 2026-11-05).
-- Planificado = el lugar está elegido y reservado, pero el producto todavía no
-- está en la góndola (el proveedor no tiene stock, falta fraccionarlo…). La
-- pantalla asesora no manda al cliente a buscarlo ahí.
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.
alter table gondola_lugares add column if not exists puesto boolean not null default true;
alter table gondola_lugares add column if not exists motivo_falta text;
