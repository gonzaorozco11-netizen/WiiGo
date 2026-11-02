-- Guía WiiGo: las preguntas que no encontraron respuesta en la guía.
-- Las manda cualquiera (equipo, marcas, profesionales) desde "¿Alguna duda?";
-- Gonzalo las responde desde el mismo panel. Si la marca como "para todos",
-- queda en Preguntas frecuentes de esa guía.
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

create table if not exists preguntas_guia (
  id_pregunta     uuid primary key default gen_random_uuid(),
  audiencia       text not null check (audiencia in ('interno', 'marca', 'profesional')),
  id_usuario      uuid,               -- quién preguntó (para mostrarle su respuesta)
  quien           text,               -- nombre que se ve en la bandeja de Gonzalo
  pregunta        text not null,
  pantalla        text,               -- dónde estaba cuando preguntó
  respuesta       text,
  publica         boolean not null default false,
  estado          text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'RESPONDIDA', 'DESCARTADA')),
  creada_el       timestamptz not null default now(),
  respondida_el   timestamptz
);
create index if not exists preguntas_guia_estado on preguntas_guia(estado, creada_el);
create index if not exists preguntas_guia_usuario on preguntas_guia(id_usuario, creada_el desc);
alter table preguntas_guia enable row level security;
