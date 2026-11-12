-- Pagos del equipo (Gonzalo, 2026-11-12): cómo se le paga a cada uno, los
-- pagos de honorarios atados a su persona (con el mes que pagan y su factura)
-- y la firma digital del recibo de sueldo.
--
--   pagos_equipo: las respuestas de «cómo le pagás» de cada persona
--     (empleado o te factura, todos los meses o una vez, monto fijo o
--     variable, qué día, cómo le pagás, si ya empezó). El sueldo de los
--     empleados sigue en usuarios (sueldo_base / valor_hora): acá va lo demás.
--   gastos.id_persona / periodo / factura_path: un pago de honorarios sabe de
--     quién es y qué mes paga (antes se reconocía por el nombre en la
--     descripción), y guarda la factura que mandó.
--   nomina_cierres.firma / firmado_en: el recibo de sueldo firmado con el
--     dedo, desde su usuario o en el momento de pagar.
--
-- Se puede correr más de una vez sin romper nada.

create table if not exists pagos_equipo (
  id_persona uuid primary key references personas(id_persona),
  modalidad text not null default 'EMPLEADO',     -- EMPLEADO | FACTURA
  frecuencia text not null default 'MENSUAL',     -- MENSUAL | UNICA
  monto_fijo boolean not null default true,
  monto numeric,                                  -- los que facturan (el sueldo de los empleados está en usuarios)
  dia_pago int,                                   -- día del mes; null = el 4.º día hábil (sueldos)
  medio_habitual text,                            -- TRANSFERENCIA | EFECTIVO_ADMIN | MERCADO_PAGO
  empezo boolean not null default true,           -- false = todavía no empezó: no suma en los costos
  id_recurrente uuid,                             -- el gasto fijo mensual de los que facturan
  actualizado_en timestamptz not null default now(),
  actualizado_por text
);
-- Solo la app (service role) la lee y la escribe.
alter table pagos_equipo enable row level security;

alter table gastos add column if not exists id_persona uuid;
alter table gastos add column if not exists periodo text;
alter table gastos add column if not exists factura_path text;
create index if not exists gastos_id_persona_idx on gastos (id_persona);

alter table nomina_cierres add column if not exists firma text;
alter table nomina_cierres add column if not exists firmado_en timestamptz;
