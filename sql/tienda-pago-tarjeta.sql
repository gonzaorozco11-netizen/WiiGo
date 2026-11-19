-- Tienda online: pagar con tarjeta (débito, crédito o dinero en cuenta) por Nave (Galicia).
-- Gonzalo, 18/11. Correr UNA vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.
--
-- 1) El pedido online puede ser «TARJETA» además de transferencia y al retirar.
-- 2) Tres columnas para seguir el cobro en Nave: la intención de pago (la que abre
--    el checkout), el pago cuando entra, y si fue débito o crédito (para la comisión).

alter table public.pedidos_online drop constraint if exists pedidos_online_pago_check;
alter table public.pedidos_online
  add constraint pedidos_online_pago_check check (pago in ('TRANSFERENCIA', 'AL_RETIRAR', 'TARJETA'));

alter table public.pedidos_online add column if not exists nave_pedido_id text;
alter table public.pedidos_online add column if not exists nave_pago_id text;
alter table public.pedidos_online add column if not exists nave_forma text;
