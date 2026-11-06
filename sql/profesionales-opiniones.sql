-- Opiniones de pacientes en la ficha de la profesional (Gonzalo, 2026-11-05).
-- Las carga ella desde su espacio (Mi ficha → Opiniones) y salen en la pantalla
-- asesora recién cuando Gonzalo las aprueba en Aprobaciones, como todo lo demás.
-- Se puede correr más de una vez.

create table if not exists opiniones_profesional (
  id_opinion      uuid primary key default gen_random_uuid(),
  id_profesional  uuid not null references profesionales(id_profesional) on delete cascade,
  nombre          text,                 -- nombre de pila del paciente («Lucía»)
  detalle         text,                 -- qué hace o qué buscaba («corredora», «quería bajar de peso»)
  texto           text not null,        -- la opinión, corta
  orden           int not null default 0,
  publico         boolean not null default true,
  creada_el       timestamptz not null default now()
);
create index if not exists idx_opiniones_profesional on opiniones_profesional (id_profesional, orden);
alter table opiniones_profesional enable row level security;
