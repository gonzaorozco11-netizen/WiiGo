-- Aprender: el equipo estudia los productos que vende.
-- Las explicaciones las escribe la inteligencia artificial a partir de lo
-- cargado de cada producto, quedan como borrador, y Gonzalo las aprueba antes
-- de que las vea el equipo.
-- Se puede correr más de una vez sin romper nada.

-- Una ficha por producto (tipo PRODUCTO) y una por tema = subcategoría (tipo TEMA).
create table if not exists aprender_fichas (
  id_ficha uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('PRODUCTO', 'TEMA')),
  id_producto uuid references productos (id_producto) on delete cascade,
  id_subcategoria uuid,
  aprobado jsonb,            -- lo que ve el equipo
  borrador jsonb,            -- lo último que escribió la IA, esperando aprobación
  huella text,               -- con qué datos del producto se escribió (para saber si quedó vieja)
  generado_en timestamptz,
  aprobado_por text,
  aprobado_en timestamptz,
  error text                 -- si la IA falló, por qué
);
create unique index if not exists aprender_ficha_producto on aprender_fichas (id_producto) where tipo = 'PRODUCTO';
create unique index if not exists aprender_ficha_tema on aprender_fichas (id_subcategoria) where tipo = 'TEMA';
alter table aprender_fichas enable row level security;

-- Qué productos repasó cada uno.
create table if not exists aprender_progreso (
  id_usuario uuid not null,
  id_producto uuid not null references productos (id_producto) on delete cascade,
  repasado_en timestamptz not null default now(),
  primary key (id_usuario, id_producto)
);
alter table aprender_progreso enable row level security;

-- Cómo le fue en las preguntas de repaso.
create table if not exists aprender_respuestas (
  id_respuesta uuid primary key default gen_random_uuid(),
  id_usuario uuid not null,
  id_producto uuid references productos (id_producto) on delete cascade,
  correcta boolean not null,
  fecha timestamptz not null default now()
);
create index if not exists idx_aprender_respuestas_usuario on aprender_respuestas (id_usuario, fecha desc);
alter table aprender_respuestas enable row level security;
