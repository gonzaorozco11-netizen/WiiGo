-- El papel que llega con la mercadería, subido por quien la recibe.
--
-- Va aparte del `comprobante_path` que ya existía en recepciones_proveedor:
-- ese lo sube administración en el Costeo y es la FACTURA. Este es el remito
-- —o la factura, o el papelito escrito a mano— que vino con el camión, y lo
-- saca la operativa con la tablet en el momento en que cuenta las cajas.
--
-- Son dos papeles distintos y en momentos distintos. Con una sola columna, el
-- segundo pisaba al primero y nadie se enteraba.
--
-- También en `recepciones` (las de marcas), que no tenía ninguna: ahí no hay
-- costeo, así que el remito de la entrega es el único comprobante que existe.

alter table recepciones_proveedor
  add column if not exists comprobante_recepcion_path text;

alter table recepciones
  add column if not exists comprobante_recepcion_path text;

comment on column recepciones_proveedor.comprobante_recepcion_path is
  'Remito/factura que trajo el camión, subido por la operativa al recibir. Bucket privado comprobantes-proveedor. Distinto de comprobante_path, que es la factura que carga administración al costear.';
comment on column recepciones.comprobante_recepcion_path is
  'Remito que trajo la marca, subido por la operativa al recibir. Bucket privado comprobantes-proveedor.';
