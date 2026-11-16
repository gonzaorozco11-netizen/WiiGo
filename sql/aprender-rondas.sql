-- Aprender (2026-11-16): «Las 5 de hoy» y la evaluación de la semana.
-- Cada ronda guarda las preguntas que le tocaron a esa persona (con la
-- respuesta correcta, que nunca viaja al navegador antes de contestar) y lo
-- que fue contestando. Una por persona, por tipo y por período: no se repite.
-- Se puede correr más de una vez sin romper nada.

create table if not exists aprender_rondas (
  id_ronda   uuid primary key default gen_random_uuid(),
  id_usuario uuid not null,
  tipo       text not null check (tipo in ('DIA', 'SEMANA')),
  periodo    date not null,               -- el día (DIA) o el lunes de la semana (SEMANA)
  preguntas  jsonb not null,
  respuestas jsonb not null default '[]'::jsonb,
  bien       integer not null default 0,
  empezada   timestamptz not null default now(),
  terminada  timestamptz
);
create unique index if not exists aprender_rondas_unica on aprender_rondas (id_usuario, tipo, periodo);
create index if not exists aprender_rondas_periodo on aprender_rondas (tipo, periodo);
alter table aprender_rondas enable row level security;
