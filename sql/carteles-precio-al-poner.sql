-- El precio nuevo de la marca propia entra en la caja, el tótem y el asesor
-- recién cuando el operativo pone el cartel en la góndola (Gonzalo, 2026-10-29).
-- Así nunca se cobra distinto de lo que dice el cartel.
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

-- El precio de efectivo que va a quedar, y la marca de "aplicarlo al poner el cartel".
alter table tareas_etiqueta add column if not exists efectivo_anterior numeric(14,2);
alter table tareas_etiqueta add column if not exists efectivo_nuevo numeric(14,2);
alter table tareas_etiqueta add column if not exists aplicar_al_poner boolean not null default false;

-- Si el operativo se va sin poder ponerlo (por ejemplo, no anda la impresora):
-- por qué, quién y cuándo. Le aparece a administración en el Inicio.
alter table tareas_etiqueta add column if not exists postergada_motivo text;
alter table tareas_etiqueta add column if not exists postergada_por text;
alter table tareas_etiqueta add column if not exists postergada_el timestamptz;
