-- Reportes de la Junta: el diario (cada mañana, cómo fue ayer) y el semanal
-- (los lunes, cómo fue la semana y qué harían). Se mandan por mail y quedan
-- guardados acá para volver a leerlos desde la Junta.
-- Se puede correr más de una vez sin romper nada.

create table if not exists junta_reportes (
  id_reporte uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('DIARIO', 'SEMANAL')),
  fecha date not null,          -- el día en que se armó (el diario habla del día anterior)
  titulo text not null,
  titular text,
  datos jsonb,                  -- los números
  redaccion jsonb,              -- lo que escribieron los encargados
  html text,                    -- el mail tal cual se mandó
  enviado_a text,
  error text,                   -- si el mail no salió, por qué
  creado timestamptz not null default now()
);
create index if not exists idx_junta_reportes_fecha on junta_reportes (fecha desc, tipo);
alter table junta_reportes enable row level security;

-- A quién le llegan (varios, separados por coma).
insert into configuracion (parametro, valor, descripcion)
values ('JUNTA_REPORTE_MAIL', 'gonzaorozco11@gmail.com', 'A qué mail llegan los reportes de la Junta (diario y semanal). Varios, separados por coma.')
on conflict (parametro) do nothing;
