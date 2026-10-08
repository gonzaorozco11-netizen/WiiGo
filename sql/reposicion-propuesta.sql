-- Reposición: de dónde salió cada orden, y las que todavía nadie aprobó.
--
-- Hasta ahora toda orden de reposición nacía en Compras, de WiiGo para la
-- marca. Faltaban dos casos que en la práctica pasan todas las semanas:
--
--   1. La marca quiere mandar algo que no se le pidió — un lanzamiento, una
--      promo, temporada. Hoy eso se resuelve por WhatsApp y llega sin papel.
--   2. Llega mercadería que nadie pidió. El operativo la tiene adelante y no
--      tiene contra qué contarla, así que o la rechaza o la mete al stock sin
--      registro. Las dos salidas son malas: en consignación, lo que entra sin
--      registro no se puede liquidar.
--
-- Las dos se resuelven con lo mismo: la orden existe desde el principio, pero
-- en un estado donde todavía no puede entrar mercadería. Administración la
-- aprueba y recién ahí sigue el circuito de siempre.
--
-- Correr una vez en el SQL Editor de Supabase.

-- De dónde salió la orden.
--   WIIGO       — la armó administración desde Compras (lo de siempre).
--   MARCA       — la propuso la marca desde su portal.
--   SIN_PEDIDO  — llegó mercadería que nadie había pedido.
alter table ordenes_reposicion
  add column if not exists origen text not null default 'WIIGO';

-- Quién la aprobó y cuándo. Nulo mientras está esperando.
alter table ordenes_reposicion
  add column if not exists aprobada_por text;
alter table ordenes_reposicion
  add column if not exists aprobada_el timestamptz;

-- Por qué se rechazó, si se rechazó. Lo ve la marca en su portal: un rechazo
-- sin motivo se vuelve a mandar igual la semana que viene.
alter table ordenes_reposicion
  add column if not exists motivo_rechazo text;

-- Las que esperan decisión no entran en ESTADOS_ABIERTOS, así que no aparecen
-- en Recepción ni suman al pendiente del sugerido hasta que se aprueban.
--
-- No hace falta tocar ningún CHECK: la columna `estado` es texto libre. Si
-- alguna vez se le pone restricción, acordarse de sumar PROPUESTA y
-- RECHAZADA.

-- Para que la pantalla de pendientes no recorra la tabla entera.
create index if not exists idx_ordenes_reposicion_origen_estado
  on ordenes_reposicion (origen, estado);

-- Comprobar que quedó:
--   select origen, estado, count(*) from ordenes_reposicion group by 1,2;
