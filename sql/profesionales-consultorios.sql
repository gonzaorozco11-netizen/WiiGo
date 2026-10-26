-- Consultorios: profesionales que atienden juntas y comparten la agenda de
-- turnos. Cada una sigue teniendo su propia ficha (foto, presentación,
-- formación, ventas), pero el botón "Reservar turno" abre el link del
-- consultorio, el mismo para todas.
-- Se puede correr más de una vez sin romper nada.

create table if not exists consultorios (
  id_consultorio uuid primary key default gen_random_uuid(),
  nombre text not null,
  link_reserva text,          -- turnos presenciales
  link_reserva_online text,   -- turnos por videollamada
  estado text not null default 'ACTIVO',
  fecha_creacion timestamptz not null default now()
);
alter table consultorios enable row level security;

alter table profesionales
  add column if not exists id_consultorio uuid references consultorios (id_consultorio) on delete set null;
create index if not exists idx_profesionales_consultorio on profesionales (id_consultorio);
