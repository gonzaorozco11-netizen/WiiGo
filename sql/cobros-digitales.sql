-- Cobros digitales (Gonzalo, 2026-11-17). Correr UNA vez en el SQL Editor de Supabase.
--
-- Cada movimiento que informan los medios de pago (hoy Mercado Pago, con MODO
-- adentro; después Nave) queda guardado tal cual, con lo que descontaron de
-- verdad: comisión, impuestos, SIRCREB cuando lo hubo. Nunca se recalcula: es
-- lo que pasó. La cuenta y el cruce con las ventas están en lib/cobrosDigitales.ts.
--
-- Se puede correr de nuevo sin romper nada.

create table if not exists cobros_digitales (
  id_cobro uuid primary key default gen_random_uuid(),
  proveedor text not null,                  -- MERCADO_PAGO | NAVE
  id_externo text not null,                 -- el número del movimiento en el medio de pago (SOURCE_ID)
  tipo text not null,                       -- payment, refund, tax_..., etc. (DESCRIPTION)
  fecha timestamptz not null,               -- cuándo impactó en la cuenta
  fecha_operacion timestamptz,              -- cuándo pagó el cliente
  referencia text,                          -- EXTERNAL_REFERENCE (en el QR es el id de la venta)
  id_venta text,                            -- la venta del sistema, si se cruzó
  medio text,                               -- PAYMENT_METHOD
  medio_tipo text,                          -- PAYMENT_METHOD_TYPE
  billetera text,                           -- MODO u otra billetera que pagó por QR
  bruto numeric(14,2) not null default 0,
  comision numeric(14,2) not null default 0,     -- comisión del medio de pago, con su IVA
  financiacion numeric(14,2) not null default 0,
  impuestos numeric(14,2) not null default 0,    -- total de impuestos y retenciones
  detalle_impuestos jsonb,                        -- cada impuesto con su monto, como lo informó
  credito numeric(14,2) not null default 0,      -- lo que entró a la cuenta
  debito numeric(14,2) not null default 0,       -- lo que salió de la cuenta
  crudo jsonb not null,                           -- la fila completa del reporte
  reporte text,                                   -- de qué archivo salió
  creado_el timestamptz not null default now(),
  unique (proveedor, id_externo, tipo, fecha)
);

create index if not exists cobros_digitales_fecha on cobros_digitales (fecha);
create index if not exists cobros_digitales_venta on cobros_digitales (id_venta);
create index if not exists cobros_digitales_externo on cobros_digitales (proveedor, id_externo);

-- Los reportes que ya se leyeron, para no leerlos dos veces.
create table if not exists cobros_digitales_reportes (
  nombre text primary key,
  proveedor text not null,
  filas int not null default 0,
  leido_el timestamptz not null default now()
);

-- Cerradas como el resto: solo la app (service role) las lee.
alter table cobros_digitales enable row level security;
alter table cobros_digitales_reportes enable row level security;
