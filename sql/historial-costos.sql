-- Historial de costos (Gonzalo, 19/11): cada vez que cambia el costo de un producto
-- (por ejemplo, al traer la lista nueva de Alifrut en Precios) queda anotado: cuándo,
-- de cuánto a cuánto y quién. Correr UNA vez en el SQL Editor de Supabase.

create table if not exists public.historial_costos (
  id            uuid primary key default gen_random_uuid(),
  id_producto   uuid references public.productos(id_producto) on delete cascade,
  id_granel     uuid,
  nombre        text not null,
  unidad        text,
  costo_anterior numeric,
  costo_nuevo    numeric not null,
  origen        text not null default 'LISTA_PROVEEDOR',
  cambiado_por  text,
  cambiado_el   timestamptz not null default now()
);
create index if not exists historial_costos_producto on public.historial_costos(id_producto, cambiado_el desc);
create index if not exists historial_costos_granel on public.historial_costos(id_granel, cambiado_el desc);
alter table public.historial_costos enable row level security;

-- Arranca con el último cambio que ya estaba guardado en cada costo de Alifrut.
insert into public.historial_costos (id_granel, nombre, unidad, costo_anterior, costo_nuevo, origen, cambiado_el)
select g.id_granel, g.nombre, g.unidad, g.costo_anterior, g.costo_neto, 'LISTA_PROVEEDOR', g.costo_actualizado_el
from public.costos_granel g
where g.costo_anterior is not null and g.costo_actualizado_el is not null
  and not exists (select 1 from public.historial_costos h where h.id_granel = g.id_granel and h.cambiado_el = g.costo_actualizado_el);
