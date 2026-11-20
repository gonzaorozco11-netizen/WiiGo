-- El canon mensual de las marcas (Gonzalo, 20/11/2026). Ver lib/abonoMarcas.ts.
--
-- Animalfit $750.000 + IVA y Alta $650.000 + IVA por mes. Se carga solo el 25 de
-- cada mes y se paga del 1 al 5 del mes siguiente (noviembre en diciembre, diciembre
-- en enero…), aparte de la liquidación. El primer mes es proporcional desde el 15/11:
-- noviembre son 16 de 30 días (Animalfit $400.000 + IVA, Alta $346.667 + IVA).
--
-- Se corre una sola vez en el SQL Editor de Supabase. Se puede correr de nuevo sin
-- duplicar nada.

-- Desde qué día se cobra (el primer mes, proporcional).
alter table cargos_recurrentes_marca add column if not exists desde date;

-- Los dos canon, en la categoría que ya existe («Canon Mensual Aliados»).
insert into cargos_recurrentes_marca (id_marca, id_categoria, descripcion, monto_estimado, recurrencia, dia_mes, lleva_iva, activo, desde)
select m.id_marca, c.id_categoria, 'Canon mensual', v.monto, 'MENSUAL', 25, true, true, date '2026-11-15'
from (values ('Animalfit', 750000), ('Alta', 650000)) as v(nombre, monto)
join marcas m on m.nombre = v.nombre
cross join lateral (select id_categoria from categorias_cargo_marca where nombre = 'Canon Mensual Aliados' limit 1) c
where not exists (
  select 1 from cargos_recurrentes_marca r where r.id_marca = m.id_marca and r.descripcion = 'Canon mensual'
);

-- Para ver que quedaron los dos:
select m.nombre, r.monto_estimado, r.dia_mes, r.desde, r.lleva_iva, r.activo
from cargos_recurrentes_marca r join marcas m using (id_marca)
where r.descripcion = 'Canon mensual';
