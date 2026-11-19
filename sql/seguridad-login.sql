-- Seguridad del ingreso (Gonzalo, 19/11). Correr UNA vez en el SQL Editor de Supabase.
--  · login_fallidos / bloqueado_hasta: con 5 contraseñas mal seguidas, ese usuario
--    queda bloqueado 15 minutos (Gonzalo lo puede desbloquear desde Usuarios).
--  · sesiones_desde: «Cerrar sesión en todos los aparatos». Toda sesión abierta
--    antes de esa hora deja de servir.
alter table public.usuarios add column if not exists login_fallidos integer not null default 0;
alter table public.usuarios add column if not exists bloqueado_hasta timestamptz;
alter table public.usuarios add column if not exists sesiones_desde timestamptz;
