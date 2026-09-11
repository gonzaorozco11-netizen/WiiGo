-- ============================================================
-- Anulación de ventas: nota de crédito y devolución de la plata
-- ============================================================
-- Dos cosas que faltaban al anular una venta:
--
-- 1) Si la venta estaba facturada, la factura seguía viva en ARCA. Una factura
--    autorizada no se borra: se deja sin efecto con una nota de crédito, que
--    es otro comprobante con su propio CAE. Estas columnas la guardan.
--
-- 2) Nadie registraba cómo volvió la plata al cliente. Sin eso el arqueo de
--    caja no cierra cuando la devolución no es del mismo día y del mismo medio
--    que la venta (ver resumenTurno en app/(app)/turnos/actions.ts).
--
-- Todo va como columnas de `ventas` y no en una tabla aparte porque es uno a
-- uno: una venta se anula una sola vez y lleva una sola nota de crédito.

alter table ventas
  -- NO_CORRESPONDE (no estaba facturada) | EMITIDA | PENDIENTE (ARCA falló)
  add column if not exists nc_estado          text,
  add column if not exists nc_cae             text,
  add column if not exists nc_cae_vencimiento text,
  -- 3 para las notas de crédito A, 8 para las B: misma letra que la factura
  add column if not exists nc_tipo            integer,
  add column if not exists nc_punto_venta     integer,
  add column if not exists nc_numero          integer,
  add column if not exists nc_fecha           date,
  add column if not exists nc_neto            numeric(12,2),
  add column if not exists nc_iva             numeric(12,2),
  add column if not exists nc_total           numeric(12,2),
  -- Qué contestó ARCA cuando no se pudo emitir. Se muestra en Ventas.
  add column if not exists nc_error           text,

  -- EFECTIVO_TURNO | MERCADO_PAGO | PENDIENTE | NO_CORRESPONDE
  add column if not exists devolucion_medio   text,
  add column if not exists devolucion_monto   numeric(12,2),
  -- A qué turno se le descuenta la salida de caja. Es el turno ABIERTO al
  -- momento de devolver, no el de la venta: la plata sale del cajón de hoy
  -- aunque la venta sea de la semana pasada.
  add column if not exists devolucion_turno   uuid references turnos(id_turno),
  add column if not exists devolucion_fecha   timestamptz,
  -- Solo se llena cuando se devolvió por un medio distinto al del cobro. Esa
  -- excepción necesita la contraseña de un admin y queda firmada acá.
  add column if not exists devolucion_autorizada_por text;

-- Para el arqueo: buscar las devoluciones en efectivo de un turno.
create index if not exists ventas_devolucion_turno_idx
  on ventas (devolucion_turno, devolucion_medio)
  where devolucion_turno is not null;

-- Para el aviso de notas de crédito pendientes.
create index if not exists ventas_nc_pendiente_idx
  on ventas (nc_estado)
  where nc_estado = 'PENDIENTE';
