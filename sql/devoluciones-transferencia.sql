-- Devoluciones por transferencia (2026-11-16): el operativo confirma que ya le
-- mandó la plata al cliente. Mientras no lo confirma, la caja del local no se
-- puede cerrar (lib/transferenciasPendientes.ts). Correr una vez en Supabase.

alter table devoluciones add column if not exists transferencia_enviada_en  timestamptz;
alter table devoluciones add column if not exists transferencia_enviada_por text;
