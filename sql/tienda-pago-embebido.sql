-- Pagar con tarjeta DENTRO de la tienda (Gonzalo, 24/11).
-- Los pedidos con tarjeta nacen en estado PAGANDO mientras el cliente paga: no los ve
-- nadie, no reservan stock y no mandan mails. Al aprobarse el pago pasan a NUEVO.
-- Ver lib/pedidosOnline.ts y lib/pagoTarjetaOnline.ts.
-- Se corre una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin problema.

do $$
declare r record;
begin
  -- Saca la regla vieja de estados (la que no conoce PAGANDO), sea cual sea su nombre.
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'pedidos_online'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%estado%'
  loop
    execute format('alter table public.pedidos_online drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.pedidos_online
  add constraint pedidos_online_estado_check
  check (estado in ('PAGANDO', 'NUEVO', 'ARMANDO', 'LISTO', 'ENTREGADO', 'CANCELADO'));

-- Para comprobar: tiene que aparecer la regla nueva con PAGANDO.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.pedidos_online'::regclass and contype = 'c';
