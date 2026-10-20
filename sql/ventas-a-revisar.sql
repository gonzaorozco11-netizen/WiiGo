-- Una venta que alguien tiene que ir a mirar.
--
-- El caso que la crea: el mostrador vende un producto que el sistema tenía
-- en cero. La venta sale igual —el producto estaba en la mano del cliente—
-- pero el número de stock estaba mal, y alguien tiene que ir a la góndola y
-- corregirlo. Sin esta marca, eso no lo ve nadie y el stock sigue mal.
--
-- Texto libre y no un booleano: dice qué producto y cuánto, que es lo que
-- necesita quien va a revisar. Null = nada pendiente.
--
-- Correr una sola vez en el SQL Editor de Supabase. Es seguro repetirlo.
alter table ventas
  add column if not exists a_revisar text;

-- La pantalla de Ventas busca por acá las que tienen algo pendiente. Parcial
-- porque son una minoría.
create index if not exists idx_ventas_a_revisar
  on ventas (fecha desc)
  where a_revisar is not null;
