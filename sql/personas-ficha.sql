-- Ficha de cada persona en RR.HH. > Personal.
-- Datos que no existían: el acuerdo, si está registrado, la próxima revisión
-- de sueldo, el seguro de accidentes personales, la cobertura, el contacto
-- de emergencia y dónde pagarle. Más una tabla de notas con fecha.
-- Se puede correr más de una vez sin romper nada.

alter table personas add column if not exists acuerdo text;
alter table personas add column if not exists en_blanco boolean not null default false;
alter table personas add column if not exists revision_sueldo date;
alter table personas add column if not exists seguro_ap_compania text;
alter table personas add column if not exists seguro_ap_poliza text;
alter table personas add column if not exists seguro_ap_vence date;
alter table personas add column if not exists art text;
alter table personas add column if not exists obra_social text;
alter table personas add column if not exists contacto_emergencia_nombre text;
alter table personas add column if not exists contacto_emergencia_telefono text;
alter table personas add column if not exists contacto_emergencia_relacion text;
alter table personas add column if not exists cbu_alias text;
alter table personas add column if not exists banco text;

create table if not exists persona_notas (
  id_nota uuid primary key default gen_random_uuid(),
  id_persona uuid not null references personas (id_persona) on delete cascade,
  fecha timestamptz not null default now(),
  texto text not null,
  usuario text
);
create index if not exists idx_persona_notas_persona on persona_notas (id_persona, fecha desc);
-- Cerrada como el resto: solo la app (service role) la lee y la escribe.
alter table persona_notas enable row level security;
