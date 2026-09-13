-- Reclamos de nota de crédito a proveedores.
--
-- Nace cuando administración costea una entrega y marca que el proveedor
-- facturó algo mal: mandó de menos y facturó todo, se equivocó en un precio,
-- cobró algo bonificado.
--
-- Por qué una tabla y no un texto en la factura: un reclamo tiene un importe
-- y un estado. Sin eso nadie puede abrir una pantalla y ver cuánta plata está
-- esperando que le acrediten, y a los tres meses el reclamo se pierde.
--
-- Lo mal facturado SÍ entra en el total de la factura y en el IVA — la deuda
-- y el libro de IVA tienen que coincidir con lo que el proveedor ya declaró.
-- Lo que NO hace es entrar al costo de los productos: esa mercadería no
-- llegó, así que no puede encarecer lo que sí llegó.

create table if not exists reclamos_proveedor (
  id_reclamo uuid primary key default gen_random_uuid(),
  id_proveedor uuid not null references proveedores(id_proveedor),
  id_factura uuid references facturas_compra_proveedor(id_factura),
  id_recepcion uuid references recepciones_proveedor(id_recepcion),

  -- El desglose de lo mal facturado, con la misma forma que el pie.
  neto numeric(14,2) not null default 0,
  iva numeric(14,2) not null default 0,
  impuestos numeric(14,2) not null default 0,
  retenciones numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,

  motivo text not null,

  -- PENDIENTE: se le reclamó y todavía no acreditó.
  -- ACREDITADO: llegó la nota de crédito.
  -- DESCARTADO: se revisó y el reclamo no correspondía.
  estado text not null default 'PENDIENTE',

  -- Se completan cuando llega la nota de crédito.
  nc_numero text,
  nc_fecha date,
  nc_monto numeric(14,2),
  resuelto_el timestamptz,
  resuelto_por text,

  usuario text,
  fecha timestamptz not null default now()
);

create index if not exists reclamos_proveedor_estado_idx on reclamos_proveedor (estado, fecha desc);
create index if not exists reclamos_proveedor_prov_idx on reclamos_proveedor (id_proveedor);

alter table reclamos_proveedor enable row level security;
