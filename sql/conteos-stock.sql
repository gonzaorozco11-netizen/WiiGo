-- Conteo de stock en el turno (Gonzalo, 2026-11-07).
--
-- Cada turno el sistema le da a cada operativo unos productos para contar
-- (10 por turno, repartidos entre los que están). Cuentan sin ver lo que dice
-- el sistema, cada producto queda guardado con su hora, y al final firman.
-- Si no coincide, el stock se ajusta en el momento y la diferencia queda
-- abierta hasta que Gonzalo la resuelve.
--
-- Se puede correr más de una vez sin romper nada.

-- Un conteo = la tanda de una persona en un turno.
create table if not exists conteos_stock (
  id_conteo uuid primary key default gen_random_uuid(),
  id_local uuid not null references locales (id_local),
  id_persona uuid references personas (id_persona) on delete set null,
  id_usuario uuid,
  nombre text,                          -- quién contó, como se ve en pantalla
  fecha date not null,                  -- el día del turno, hora de Argentina
  estado text not null default 'ABIERTO' check (estado in ('ABIERTO', 'FIRMADO')),
  firma text,                           -- PNG en base64
  firmado_en timestamptz,
  creado_en timestamptz not null default now()
);
create index if not exists idx_conteos_stock_persona on conteos_stock (id_persona, estado);
create index if not exists idx_conteos_stock_local on conteos_stock (id_local, fecha desc);

-- Cada producto de la tanda. `esperado` es lo que decía el sistema en el
-- momento exacto de contar: no se le muestra a quien cuenta.
create table if not exists conteos_stock_items (
  id_item uuid primary key default gen_random_uuid(),
  id_conteo uuid not null references conteos_stock (id_conteo) on delete cascade,
  id_variante uuid not null references variantes_producto (id_variante),
  motivo text not null check (motivo in ('SEGUIMIENTO', 'ROTA', 'QUIETO', 'NUNCA')),
  detalle_motivo text,                  -- «Se vendió mucho: 14 desde el último conteo»
  primer_conteo integer,                -- lo que contó la primera vez, si no coincidía
  contado integer,
  esperado integer,
  contado_en timestamptz,
  resultado text check (resultado in ('OK', 'DIFERENCIA')),
  orden integer not null default 0
);
create index if not exists idx_conteos_items_conteo on conteos_stock_items (id_conteo, orden);
create index if not exists idx_conteos_items_variante on conteos_stock_items (id_variante, contado_en desc);

-- Las diferencias: quedan abiertas hasta que Gonzalo dice qué pasó.
create table if not exists diferencias_stock (
  id_diferencia uuid primary key default gen_random_uuid(),
  id_local uuid not null references locales (id_local),
  id_variante uuid not null references variantes_producto (id_variante),
  id_item uuid references conteos_stock_items (id_item) on delete set null,
  esperado integer not null,
  contado integer not null,
  diferencia integer not null,          -- contado − esperado (negativo = faltan)
  contado_por text,
  contado_en timestamptz not null default now(),
  -- ABIERTA: falta que otra persona lo vuelva a contar.
  -- CONFIRMADA: otro conteo dio lo mismo, no fue un error de conteo.
  -- RESUELTA: Gonzalo eligió la causa.
  estado text not null default 'ABIERTA' check (estado in ('ABIERTA', 'CONFIRMADA', 'RESUELTA')),
  recuento integer,
  recontado_por text,
  recontado_en timestamptz,
  causa text check (causa in ('CONTARON_MAL', 'FALTANTE', 'RECEPCION')),
  resuelto_por text,
  resuelto_en timestamptz,
  nota text,
  creado_en timestamptz not null default now()
);
create index if not exists idx_diferencias_stock_abiertas on diferencias_stock (id_local, estado);
create index if not exists idx_diferencias_stock_variante on diferencias_stock (id_variante, estado);

-- Cerradas como el resto: solo la app (service role) las lee y las escribe.
alter table conteos_stock enable row level security;
alter table conteos_stock_items enable row level security;
alter table diferencias_stock enable row level security;
