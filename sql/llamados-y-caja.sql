-- Llamados de atención por llegada tarde, y caja con sobre de cambio fijo.
-- Se puede correr más de una vez sin romper nada.

-- ============ 1. Llamados de atención y apercibimientos ============
-- Se crean solos cuando un operativo ficha la entrada tarde. Se guarda el
-- texto tal como se le mostró, su firma (o que se negó a firmar) y el motivo
-- que haya escrito. Solo administración puede anularlos (justificar la
-- tardanza): el motivo no anula nada por sí solo.
create table if not exists sanciones (
  id_sancion uuid primary key default gen_random_uuid(),
  id_persona uuid not null references personas (id_persona) on delete cascade,
  id_fichaje uuid,
  tipo text not null check (tipo in ('LLAMADO', 'APERCIBIMIENTO')),
  fecha date not null,
  periodo text not null,               -- AAAA-MM: las tardanzas se cuentan por mes
  numero_en_mes int not null,          -- qué llegada tarde del mes es
  minutos_tarde int,
  hora_ingreso text,
  hora_horario text,
  texto text not null,                 -- la nota completa, tal como la leyó
  motivo text,                         -- lo que escribió ella; lo revisa administración
  firma text,                          -- PNG en base64
  firmado_en timestamptz,
  se_nego boolean not null default false,
  estado text not null default 'VIGENTE' check (estado in ('VIGENTE', 'ANULADA')),
  anulada_por text,
  anulada_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now()
);
create index if not exists idx_sanciones_persona on sanciones (id_persona, fecha desc);
create index if not exists idx_sanciones_periodo on sanciones (periodo);
-- Cerrada como el resto: solo la app (service role) la lee y la escribe.
alter table sanciones enable row level security;

-- ============ 2. Caja con sobre de cambio ============
-- Cada local tiene un fondo de cambio fijo (por ejemplo $20.000). Cada
-- turno abre con ese sobre y al cerrar separa dos sobres: el cambio para el
-- que sigue y la recaudación de su turno, que es lo único que pasa a la Caja
-- Administración. Después administración cuenta el sobre (recuento).
alter table locales add column if not exists fondo_cambio numeric not null default 20000;

alter table turnos add column if not exists id_usuario_apertura uuid;
alter table turnos add column if not exists id_usuario_cierre uuid;
alter table turnos add column if not exists cambio_esperado numeric;   -- lo que tenía que tener el sobre al abrir
alter table turnos add column if not exists conteo_billetes jsonb;     -- {"20000": 5, "10000": 6, ..., "otros": 100}
alter table turnos add column if not exists cambio_dejado numeric;     -- el sobre de cambio para el siguiente
alter table turnos add column if not exists recaudacion numeric;       -- el sobre de recaudación del turno
alter table turnos add column if not exists foto_arqueo text;          -- ruta de la foto en el depósito "arqueos-caja"
alter table turnos add column if not exists firma_cierre text;         -- PNG en base64
alter table turnos add column if not exists recuento numeric;          -- lo que contó administración en el sobre
alter table turnos add column if not exists recuento_por text;
alter table turnos add column if not exists recuento_en timestamptz;

-- Nunca dos cajas abiertas en el mismo local: si pasara, nadie podría cobrar.
create unique index if not exists turnos_un_abierto_por_local on turnos (id_local) where estado = 'ABIERTO';
