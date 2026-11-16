-- Tablets del local (2026-11-16): los operativos fichan, cobran y venden solo
-- en un aparato registrado por el Dueño (lib/aparatoLocal.ts, pantalla /aparatos).
-- Correr UNA vez en el SQL Editor de Supabase, ANTES de subir el código.

create table if not exists aparatos_local (
  id_aparato     uuid primary key default gen_random_uuid(),
  nombre         text not null,
  registrado_por uuid,
  registrado_en  timestamptz not null default now(),
  baja_en        timestamptz
);

-- Cerrada como las demás: solo la app (service role) la lee y la escribe.
alter table aparatos_local enable row level security;
