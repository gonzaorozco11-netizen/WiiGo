-- Liquidar solo lo cobrado (Gonzalo, 2026-11-19). Correr UNA vez en el SQL Editor de Supabase.
--
-- La liquidación de una marca queda marcada en cada RENGLÓN de la venta, no en la
-- venta entera: en una venta con productos de dos marcas, liquidar a una dejaba
-- afuera lo de la otra. (Alifrut ya se marcaba por renglón: id_liquidacion_proveedor.)
--
-- Se puede correr de nuevo sin romper nada.

alter table public.detalle_ventas
  add column if not exists id_liquidacion_marca uuid references public.liquidaciones(id_liquidacion);

create index if not exists detalle_ventas_id_liquidacion_marca on public.detalle_ventas (id_liquidacion_marca);
