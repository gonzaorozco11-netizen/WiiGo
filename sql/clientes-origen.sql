-- Dónde se sumó cada cliente al Club WiiGo (Gonzalo, 21/11/2026): en el local
-- (caja, Club WiiGo) o en la tienda online (se creó la cuenta en la web).
-- Lo usa la ficha «Clientes nuevos» del Inicio. Se corre una vez; se puede repetir.

alter table clientes add column if not exists origen_alta text not null default 'LOCAL'
  check (origen_alta in ('LOCAL', 'ONLINE'));

-- Los que ya están: la tienda crea la cuenta con el mail confirmado ese mismo día;
-- en la caja se suman sin mail confirmado. Así se deduce para los de antes.
update clientes
set origen_alta = 'ONLINE'
where origen_alta = 'LOCAL'
  and email_verificado_en is not null
  and (email_verificado_en at time zone 'America/Argentina/Buenos_Aires')::date = fecha_alta;

-- Para ver cómo quedó:
select origen_alta, count(*) from clientes group by origen_alta;
