-- Fraccionado guiado paso a paso (Gonzalo, 2026-11-16). Correr una vez en Supabase.
-- Sin esto la pantalla Fraccionar funciona igual, pero sin lote, sin vencimiento
-- guardado y sin «fraccionado sin terminar».

-- Cada tanda guarda el lote, el vencimiento que escribieron a mano, quién la hizo
-- (id) y lo que quedó a granel al pesarlo. La merma va en merma_gramos (ya existe).
alter table fraccionados add column if not exists lote            text;
alter table fraccionados add column if not exists vencimiento     date;
alter table fraccionados add column if not exists id_usuario      uuid;
alter table fraccionados add column if not exists gramos_quedaron integer;
alter table fraccionados add column if not exists merma_gramos    integer;

-- El paso a paso que quedó por la mitad: el Inicio del operativo lo muestra en
-- rojo hasta que lo termina o lo descarta. No toca el stock.
create table if not exists fraccionados_en_curso (
  id_en_curso        uuid primary key default gen_random_uuid(),
  id_local           uuid not null,
  id_usuario         uuid not null,
  usuario            text,
  id_variante_granel uuid not null,
  id_variante_bolsa  uuid not null,
  paso               integer not null default 2,
  bolsitas           integer,
  se_termino         boolean,
  gramos_quedan      integer,
  vencimiento        date,
  creado             timestamptz not null default now(),
  actualizado        timestamptz not null default now()
);
create index if not exists fraccionados_en_curso_usuario on fraccionados_en_curso (id_usuario, actualizado desc);
alter table fraccionados_en_curso enable row level security;
