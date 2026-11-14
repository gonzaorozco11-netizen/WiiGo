-- Tienda online, parte 2: la cuenta WiiGo Club desde el celular.
--
-- El cliente entra con su DNI y un código de 6 números que le llega al mail
-- (sin contraseña). Es la misma fila de `clientes` que usan la caja y el
-- tótem: los puntos y las compras son los mismos en todos lados.
--
-- Correr una sola vez en el SQL Editor de Supabase. Es seguro repetirlo.

-- Cuándo confirmó el mail con el código. Null = el mail lo cargó la caja y
-- nadie lo confirmó todavía (no se le mandan promociones).
alter table clientes add column if not exists email_verificado_en timestamptz;

-- Novedades y promos por mail: solo si lo tildó él (ley de datos personales),
-- con la fecha en que lo eligió. Se puede dar de baja cuando quiera.
alter table clientes add column if not exists acepta_novedades boolean not null default false;
alter table clientes add column if not exists acepta_novedades_en timestamptz;

-- Los códigos que se mandan por mail. Se guarda la huella del código, nunca
-- el código. Vence a los 15 minutos, sirve una sola vez y aguanta 5 intentos.
-- `datos` guarda lo que completó (nombre, apellido, cumpleaños, novedades)
-- hasta que confirma: recién ahí se crea o se completa el cliente.
create table if not exists codigos_tienda (
  id_codigo uuid primary key default gen_random_uuid(),
  dni text not null,
  email text not null,
  codigo_hash text not null,
  datos jsonb,
  intentos int not null default 0,
  vence_en timestamptz not null,
  usado_en timestamptz,
  creado_en timestamptz not null default now()
);
create index if not exists idx_codigos_tienda_dni on codigos_tienda (dni, creado_en desc);

-- Cerrada para todos menos el servidor de la app (que usa la clave de servicio).
alter table codigos_tienda enable row level security;
