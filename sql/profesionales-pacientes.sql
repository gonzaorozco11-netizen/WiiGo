-- Pacientes de cada profesional: el paciente tiene el descuento del código solo en su primera compra,
-- y la profesional suma su % por todo lo que compre durante los meses que diga Configuración
-- (6 al empezar), aunque no diga el código. Ver lib/pacientesProfesional.ts.
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

create table if not exists pacientes_profesional (
  id_vinculo        uuid primary key default gen_random_uuid(),
  id_profesional    uuid not null references profesionales(id_profesional) on delete cascade,
  id_cliente        uuid not null references clientes(id_cliente) on delete cascade,
  -- PEDIDO (le armó un pedido) | ESPACIO ("Sumar paciente") | CAJA (dijo el código con su DNI)
  origen            text not null,
  desde             timestamptz not null default now(),
  hasta             timestamptz not null,
  -- Si ya usó el descuento de bienvenida del código.
  bienvenida_usada  boolean not null default false,
  -- Si otra profesional lo registró después, este se cierra.
  cerrado_at        timestamptz
);
create index if not exists pacientes_profesional_cliente on pacientes_profesional(id_cliente) where cerrado_at is null;
create index if not exists pacientes_profesional_profesional on pacientes_profesional(id_profesional, hasta desc);
alter table pacientes_profesional enable row level security;

-- Cuántos meses suma la profesional por cada paciente. Se cambia desde Profesionales → "Profesionales del mes".
insert into configuracion (parametro, valor)
select 'PROFESIONAL_MESES_VINCULO', '6'
where not exists (select 1 from configuracion where parametro = 'PROFESIONAL_MESES_VINCULO');
