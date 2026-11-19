-- Avisos de la tanda de fraccionado paso por paso (Gonzalo, 2026-11-19).
-- Guarda quién imprimió y quién pegó las etiquetas, y cuándo, para que el que
-- entra en el turno siguiente vea qué falta y siga desde ahí.
-- Correr UNA vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

alter table public.fraccionados_en_curso add column if not exists impresas_por text;
alter table public.fraccionados_en_curso add column if not exists impresas_en timestamptz;
alter table public.fraccionados_en_curso add column if not exists pegadas_por text;
alter table public.fraccionados_en_curso add column if not exists pegadas_en timestamptz;
