-- Avisos por mail a las marcas.
--
-- Hasta ahora todo lo del portal se ve solo si la marca entra. Si no entra no
-- se entera de nada: ni de que se agotó un producto, ni de que le aprobaron
-- un precio. Y una marca entra cada dos semanas.
--
-- Las preferencias van en jsonb y no en ocho columnas booleanas porque la
-- lista de avisos va a cambiar: agregar uno nuevo no tiene que ser una
-- migración. Lo que falta en el json cuenta como apagado, salvo los que el
-- código marca como prendidos de fábrica.
--
-- Correr una vez en el SQL Editor de Supabase.

-- { "venta": true, "agotado": true, "solicitud": true, ... }
alter table marcas add column if not exists avisos jsonb not null default '{}'::jsonb;

-- A dónde se escribe. Vacío = no se le manda nada, aunque tenga avisos
-- prendidos: sin dirección no hay a quién.
alter table marcas add column if not exists avisos_mails text[] not null default '{}';


-- ============================================================
-- Lo que se mandó
-- ============================================================
-- Tres cosas distintas al mismo tiempo:
--
--   1. El tope diario. Un sábado con quince ventas no puede ser quince mails;
--      el aviso que cansa termina en spam, y ahí se pierden también los que
--      importan.
--   2. No repetir. Que no le llegue dos veces que se agotó lo mismo.
--   3. Poder mirar qué salió cuando una marca dice que no le llegó nada.

create table if not exists avisos_enviados (
  id_aviso      uuid primary key default gen_random_uuid(),
  id_marca      uuid not null references marcas(id_marca) on delete cascade,
  -- venta | agotado | solicitud | liquidacion | evento | resumen
  tipo          text not null,
  -- Sobre qué fue, para no repetir: el id de la venta, del producto, etc.
  referencia    text,
  asunto        text,
  destinatarios text[],
  ok            boolean not null default true,
  error         text,
  enviado_el    timestamptz not null default now()
);

create index if not exists avisos_enviados_marca_idx
  on avisos_enviados (id_marca, tipo, enviado_el desc);

-- Comprobar que quedó:
--   select nombre, avisos, avisos_mails from marcas order by nombre;
--   select tipo, count(*) from avisos_enviados group by 1;
