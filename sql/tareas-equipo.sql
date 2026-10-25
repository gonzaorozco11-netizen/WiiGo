-- Tareas del equipo: las propone la Junta (o el Dueño las carga a mano), el
-- Dueño las aprueba, y recién ahí le aparecen al equipo en Mis Tareas, "de
-- parte de Administración WiiGo".
-- Se puede correr más de una vez sin romper nada.

create table if not exists tareas_equipo (
  id_tarea uuid primary key default gen_random_uuid(),
  titulo text not null,
  detalle text,
  motivo text,                 -- por qué la propuso el encargado (lo ve solo el Dueño)
  propuesta_por text not null default 'admin',   -- encargado de la Junta (lola, bruno, ...) o 'admin'
  id_mensaje uuid,             -- el mensaje de la Junta donde se propuso
  para_tipo text not null default 'TODOS' check (para_tipo in ('TODOS', 'TURNO', 'PERSONA')),
  id_horario uuid,             -- si es para un turno (horarios_trabajo)
  id_persona uuid,             -- si es para una persona
  vence date,                  -- una sola vez: para cuándo
  repite_dia smallint check (repite_dia between 1 and 7),   -- se repite cada semana: 1 = lunes ... 7 = domingo
  estado text not null default 'PROPUESTA' check (estado in ('PROPUESTA', 'ACTIVA', 'DESCARTADA', 'ARCHIVADA')),
  creado timestamptz not null default now(),
  aprobado_en timestamptz,
  aprobado_por text
);
create index if not exists idx_tareas_equipo_estado on tareas_equipo (estado, creado desc);
alter table tareas_equipo enable row level security;

-- Cuándo se hizo. Una fila por vez que tocaba: en las que se repiten, una por
-- semana. Si la tarea es para un turno o para todos, alcanza con que la haga uno.
create table if not exists tareas_equipo_hechas (
  id uuid primary key default gen_random_uuid(),
  id_tarea uuid not null references tareas_equipo (id_tarea) on delete cascade,
  fecha date not null,         -- el día que tocaba
  id_usuario uuid,
  nombre text,
  hecho_en timestamptz not null default now(),
  unique (id_tarea, fecha)
);
alter table tareas_equipo_hechas enable row level security;
