-- El costo de cada renglón vendido, el del momento de la venta (Gonzalo, 2026-11-06:
-- «en el momento que se hace la venta queda el costo del momento; luego si
-- aumenta o baja varía, pero no las ventas ya hechas»).
-- Antes Rentabilidad y el Resumen de ventas calculaban todo con el costo de
-- hoy: cada aumento de Alifrut achicaba la ganancia de los meses pasados.
-- Correr una vez en el SQL Editor de Supabase. No borra nada.

alter table detalle_ventas add column if not exists costo_unitario numeric;

-- Lo vendido hasta hoy no tenía el costo guardado: se completa con el de hoy,
-- salvo que el costo de Alifrut haya cambiado después de esa venta: ahí se usa
-- el anterior (costos_granel guarda el último cambio).
update detalle_ventas d
set costo_unitario = round(
  p.costo_informado * case
    when g.costo_actualizado_el is not null and ve.fecha < g.costo_actualizado_el
         and g.costo_anterior > 0 and g.costo_neto > 0
      then g.costo_anterior / g.costo_neto
    else 1
  end, 2)
from variantes_producto v
join productos p on p.id_producto = v.id_producto
left join costos_granel g on g.id_granel = p.id_granel,
ventas ve
where d.id_variante = v.id_variante
  and ve.id_venta = d.id_venta
  and d.costo_unitario is null
  and p.costo_informado is not null;
