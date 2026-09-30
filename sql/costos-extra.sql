-- Lo que cuesta poner el producto en la góndola además de la mercadería: la
-- bolsita, la etiqueta, el precinto.
--
-- Va aparte de `costo_informado` a propósito. Ese campo es lo que te cobra el
-- proveedor y lo usan la liquidación y el costeo de lotes; si le sumáramos la
-- bolsita adentro, la liquidación de Alifrut le estaría pagando el envase.
--
-- El caso que lo motivó: las almendras vienen a $14.508,74 el kilo y se venden
-- en paquetes de 250 g. La mercadería de un paquete es $3.627,19 y la bolsita
-- $300 — una entera por paquete, no un cuarto. Prorratear la bolsita en el
-- costo del kilo dejaba el costo de cada paquete $225 por debajo del real.
--
-- Solo en productos: las variantes no tienen costo propio, heredan el del
-- producto (ver costo_informado).
--
-- Default 0 para que nada cambie en lo que ya está cargado.

alter table productos add column if not exists costos_extra numeric(12,2) not null default 0;

comment on column productos.costos_extra is
  'Costos por unidad que no son mercadería (bolsita, etiqueta). Se suman al costo_informado solo para calcular el precio de venta, nunca para liquidarle al proveedor.';
