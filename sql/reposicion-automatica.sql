-- Aprobación automática de lo que proponen las marcas.
--
-- Hasta ahora toda propuesta de una marca esperaba a que administración la
-- mirara. Con nueve marcas reponiendo cada quince días eso son unas veinte
-- aprobaciones por mes, y casi todas dicen lo mismo: la marca manda lo que el
-- sistema ya le había sugerido. Aprobar a mano algo que el sistema calculó es
-- trabajo que no agrega criterio.
--
-- La regla nueva: si después de recibir la mercadería la góndola no supera el
-- objetivo del producto —el número que sale de sus propias ventas, con piso en
-- el mínimo cargado a mano— la orden se aprueba sola. Lo que pasa el tope
-- sigue esperando, que es donde sí hace falta decidir.
--
-- Esta columna es el freno de mano: una marca que abusa queda de nuevo con
-- todo a revisión, sin tocar la regla para las demás.
--
-- Correr una vez en el SQL Editor de Supabase.

alter table marcas
  add column if not exists aprobacion_automatica boolean not null default true;

comment on column marcas.aprobacion_automatica is
  'Si sus propuestas de reposición se aprueban solas cuando no pasan el tope.';

-- Comprobar que quedó:
--   select nombre, plan, aprobacion_automatica from marcas order by nombre;
