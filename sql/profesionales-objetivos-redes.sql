-- Objetivos en redes de las profesionales: historias y reels que mencionan a @wiigo.arg.
-- Ella avisa desde su espacio ("Ya lo subí") con la captura o el link; Gonzalo lo verifica en
-- Aprobaciones y recién ahí suma puntos para el ranking del mes.
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

-- 1) Lo que avisó cada profesional.
--    HISTORIA = con captura (duran 24 h) · REEL = con el link
--    PENDIENTE = esperando a Gonzalo · VERIFICADA = suma puntos · RECHAZADA = no cumple, con el motivo
create table if not exists publicaciones_profesional (
  id_publicacion  uuid primary key default gen_random_uuid(),
  id_profesional  uuid not null references profesionales(id_profesional) on delete cascade,
  tipo            text not null check (tipo in ('HISTORIA', 'REEL')),
  captura         text,               -- ruta en el bucket capturas-profesionales
  link            text,
  menciono        boolean not null default false,
  estado          text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'VERIFICADA', 'RECHAZADA')),
  motivo          text,
  creada_el       timestamptz not null default now(),
  revisada_el     timestamptz,
  revisada_por    text
);
create index if not exists publicaciones_profesional_idx on publicaciones_profesional(id_profesional, creada_el desc);
create index if not exists publicaciones_profesional_estado on publicaciones_profesional(estado, creada_el);
alter table publicaciones_profesional enable row level security;

-- 2) Las capturas: privadas (solo las ve WiiGo, con un link que vence).
insert into storage.buckets (id, name, public)
values ('capturas-profesionales', 'capturas-profesionales', false)
on conflict (id) do nothing;

-- 3) Las reglas de los puntos (se cambian en Profesionales → Profesionales del mes).
insert into configuracion (parametro, valor, descripcion) values
  ('PROFESIONAL_PTS_PACIENTE', '10', 'Profesionales: puntos por cada paciente que compra con ella en el mes'),
  ('PROFESIONAL_PTS_HISTORIA', '5', 'Profesionales: puntos por historia verificada que menciona a WiiGo'),
  ('PROFESIONAL_HISTORIAS_SEMANA', '2', 'Profesionales: cuántas historias por semana suman puntos'),
  ('PROFESIONAL_PTS_REEL', '15', 'Profesionales: puntos por reel verificado'),
  ('PROFESIONAL_REEL_CADA_DIAS', '15', 'Profesionales: cada cuántos días suma un reel')
on conflict (parametro) do nothing;
