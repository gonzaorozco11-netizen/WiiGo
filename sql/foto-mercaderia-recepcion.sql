-- Foto de la mercadería que llegó, al recibir (Gonzalo, 2026-11-19): va junto a
-- la del remito. Correr UNA vez en el SQL Editor de Supabase. Se puede correr de nuevo.

alter table public.recepciones add column if not exists foto_mercaderia_path text;
alter table public.recepciones_proveedor add column if not exists foto_mercaderia_path text;
