-- Usuario propio para cada profesional (su espacio en app.wiigo.com.ar/mi-espacio).
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

-- 1) El usuario sabe de qué profesional es. Una profesional tiene un solo usuario.
alter table usuarios add column if not exists id_profesional uuid references profesionales(id_profesional) on delete set null;
create unique index if not exists usuarios_id_profesional_unico on usuarios(id_profesional) where id_profesional is not null;

-- 2) Cuándo entró por última vez (lo ve Gonzalo en la ficha).
alter table usuarios add column if not exists ultimo_ingreso timestamptz;

-- 3) La autorización para mostrar su foto, textos y matrícula: se guarda con fecha y hora
--    la primera vez que entra.
alter table profesionales add column if not exists autorizo_imagen_at timestamptz;

-- 4) Todo lo que hace desde su espacio, para que Gonzalo lo vea en su ficha.
create table if not exists actividad_profesional (
  id_actividad    uuid primary key default gen_random_uuid(),
  id_profesional  uuid not null references profesionales(id_profesional) on delete cascade,
  accion          text not null,
  espera_aprobacion boolean not null default false,
  fecha           timestamptz not null default now()
);
create index if not exists actividad_profesional_por_fecha on actividad_profesional(id_profesional, fecha desc);
alter table actividad_profesional enable row level security;

-- 5) Los cambios que manda y que esperan la aprobación de Gonzalo antes de salir en la pantalla.
create table if not exists cambios_profesional (
  id_cambio       uuid primary key default gen_random_uuid(),
  id_profesional  uuid not null references profesionales(id_profesional) on delete cascade,
  tipo            text not null,          -- DATOS (textos de su perfil) o FOTO (una foto nueva de la galería)
  valor_anterior  jsonb,
  valor_nuevo     jsonb not null,
  estado          text not null default 'PENDIENTE',  -- PENDIENTE, APROBADO, CORREGIR
  nota            text,                   -- lo que le pide Gonzalo si toca "Pedir que lo cambie"
  fecha           timestamptz not null default now(),
  resuelto_por    uuid references usuarios(id_usuario),
  fecha_resuelto  timestamptz
);
create index if not exists cambios_profesional_pendientes on cambios_profesional(estado, fecha);
alter table cambios_profesional enable row level security;
