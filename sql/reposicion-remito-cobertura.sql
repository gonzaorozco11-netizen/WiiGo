-- Dos cosas chicas de la reposición, en un solo script para correr una vez.
--
-- 1. El remito de lo que llega sin pedido.
--
--    Cuando aparece un bulto que nadie pidió, el único papel que va a existir
--    es el que trajo el flete. Hoy el operativo puede escribir en
--    observaciones que vino con remito, pero no adjuntar la foto — y un
--    remito que no se guardó es un reclamo que después no se puede hacer.
--
--    Va en la orden y no en la recepción porque cuando llega todavía no hay
--    recepción: esa se crea recién cuando administración lo acepta.
--
-- 2. Cuántas semanas de mercadería tener de cada marca.
--
--    La reposición sugerida usa 3 semanas para todas. Está bien de arranque,
--    pero una marca de ticket alto que vende de a poco quiere más cobertura
--    —si se queda sin stock pierde la venta grande— y una que rota rápido
--    quiere menos, para no llenar el depósito de mercadería ajena.
--
-- Correr una vez en el SQL Editor de Supabase. Es seguro correrlo dos veces.

alter table ordenes_reposicion
  add column if not exists remito_path text;

alter table marcas
  add column if not exists semanas_cobertura smallint;

comment on column marcas.semanas_cobertura is
  'Semanas de mercadería a tener en góndola. Nulo = el default del sistema (3).';

-- Comprobar que quedó:
--   select nombre, semanas_cobertura from marcas order by nombre;
