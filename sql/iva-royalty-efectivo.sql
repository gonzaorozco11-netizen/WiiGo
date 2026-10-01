-- Poder cobrarle a una marca el royalty SIN el IVA cuando el cliente pagó en
-- efectivo, dejando el IVA en las ventas electrónicas.
--
-- Hasta ahora `trasladar_iva_comision` era todo o nada: o se le cobraba el IVA
-- del royalty en todas las ventas, o en ninguna. Esto lo parte en dos para que
-- la decisión pueda depender de cómo pagó el cliente, que es como se negocia
-- en la práctica.
--
-- Default true = exactamente lo que hace hoy el sistema. Ninguna liquidación
-- cambia hasta que alguien destilde la casilla en la ficha de una marca.
--
-- Solo tiene efecto si `trasladar_iva_comision` está en true: esa sigue siendo
-- la llave general, esta es el matiz.

alter table marcas
  add column if not exists trasladar_iva_comision_efectivo boolean not null default true;

comment on column marcas.trasladar_iva_comision_efectivo is
  'Si el IVA del royalty también se le cobra en las ventas cobradas en efectivo. False = en efectivo se le cobra el royalty solo. Requiere trasladar_iva_comision en true.';
