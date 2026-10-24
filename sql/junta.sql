-- Junta: lo que se habla con los encargados de IA queda guardado, así la
-- conversación sigue donde quedó y la próxima vez se acuerdan.
-- Se puede correr más de una vez sin romper nada.

create table if not exists junta_mensajes (
  id_mensaje uuid primary key default gen_random_uuid(),
  hilo text not null,        -- 'junta' o el encargado con el que se habló a solas (lola, bruno, ...)
  autor text not null,       -- 'gonzalo', un encargado o 'resumen'
  texto text not null,
  puntos jsonb,              -- solo el resumen: lo que conviene hacer
  lamina jsonb,              -- lo que mostró la pantalla del fondo
  creado timestamptz not null default now()
);
create index if not exists idx_junta_mensajes_hilo on junta_mensajes (hilo, creado desc);
alter table junta_mensajes enable row level security;
