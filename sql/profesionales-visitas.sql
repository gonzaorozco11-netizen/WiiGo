-- Visitas a las fichas de las profesionales en la pantalla del local, y los avisos que reciben.
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

-- 1) Lo que se mira de cada profesional en la pantalla. Sin datos de quién toca.
--    FICHA = abrió su ficha · CONOCEME_FIN = vio su Conóceme hasta el final · RESERVAR = tocó "Reservar turno"
create table if not exists visitas_asesor (
  id_visita       uuid primary key default gen_random_uuid(),
  id_local        uuid references locales(id_local) on delete set null,
  id_profesional  uuid not null references profesionales(id_profesional) on delete cascade,
  evento          text not null,
  fecha           timestamptz not null default now()
);
create index if not exists visitas_asesor_por_profesional on visitas_asesor(id_profesional, fecha desc);
create index if not exists visitas_asesor_por_fecha on visitas_asesor(fecha desc);
alter table visitas_asesor enable row level security;

-- 2) Los mails que se les mandan a las profesionales (uso del código, resumen de los lunes).
--    Igual que avisos_enviados de las marcas: registra también los que fallaron, con el motivo.
create table if not exists avisos_profesional (
  id_aviso        uuid primary key default gen_random_uuid(),
  id_profesional  uuid not null references profesionales(id_profesional) on delete cascade,
  tipo            text not null,      -- CODIGO | SEMANAL
  referencia      text,               -- el id de la venta o la semana, para no repetir
  asunto          text,
  para            text,
  ok              boolean not null default true,
  error           text,
  enviado_el      timestamptz not null default now()
);
create index if not exists avisos_profesional_idx on avisos_profesional(id_profesional, tipo, enviado_el desc);
alter table avisos_profesional enable row level security;
