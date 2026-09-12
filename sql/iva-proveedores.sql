-- ============================================================
-- IVA en el costeo y en la liquidación de proveedores
-- ============================================================
-- Faltaban dos cosas, y las dos son plata:
--
-- 1) La alícuota de IVA de cada producto. Se asumía 21% en todos lados, pero
--    en alimentos no es así: frutos secos, harinas y varios otros van al
--    10,5%. Con la alícuota mal puesta, el crédito fiscal queda mal.
--
-- 2) La factura del proveedor en modo LIQUIDACION_VENTA (caso Alifrut).
--    La liquidación guardaba un solo número sin IVA, y ese IVA no aparecía
--    en ningún lado de "IVA a pagar" (ver contabilidad/actions.ts, que solo
--    lee facturas_compra_proveedor y gastos). Resultado: el crédito fiscal
--    de todo lo que se vende de Alifrut se estaba perdiendo entero.

-- ---------- Alícuota por producto ----------
-- 21 por defecto porque es la general: los que van al 10,5% son la
-- excepción y hay que marcarlos a mano, no al revés.
alter table productos
  add column if not exists iva_porcentaje numeric(5,2) not null default 21;

comment on column productos.iva_porcentaje is
  'Alícuota de IVA del producto (21 / 10,5 / 0). Se usa para el crédito fiscal del costo y para sacar la venta neta del precio de góndola.';

-- ---------- La factura del proveedor contra la liquidación ----------
-- Van en la liquidación y no en facturas_compra_proveedor porque en este
-- modo la factura nace DE la liquidación: es una por período, por el monto
-- de lo vendido. Mezclarla con las facturas por remito confundiría los dos
-- circuitos.
alter table liquidaciones_proveedor
  add column if not exists neto              numeric(12,2),
  add column if not exists iva               numeric(12,2),
  -- Lo que dice la factura de papel. Puede no coincidir con lo calculado, y
  -- si no coincide manda esto: el sistema muestra la diferencia en vez de
  -- taparla.
  add column if not exists factura_numero    text,
  add column if not exists factura_neto      numeric(12,2),
  add column if not exists factura_iva       numeric(12,2),
  add column if not exists factura_total     numeric(12,2),
  add column if not exists factura_fecha     date,
  add column if not exists factura_archivo   text,
  add column if not exists factura_cargada_el timestamptz,
  add column if not exists factura_cargada_por text;

-- Para el cálculo de IVA a pagar: las liquidaciones con factura del período.
create index if not exists liq_proveedor_factura_fecha_idx
  on liquidaciones_proveedor (factura_fecha)
  where factura_fecha is not null;
