-- La foto de lo que no cerró.
--
-- «Faltó 1» es una afirmación. La marca tiene que decidir si cree, y esa
-- decisión termina en una llamada. La foto de la caja aplastada es un hecho:
-- la saca la operativa con la caja abierta y el repartidor al lado, y la
-- marca la ve en Mis envíos sin pedirla.
--
-- Protege a las dos partes: a la marca de que le descuenten algo que mandó
-- bien, y a WiiGo de discutir sin nada en la mano tres semanas después.
--
-- Correr una sola vez en el SQL Editor de Supabase. Es seguro repetirlo.

-- El archivo vive en el bucket privado `comprobantes-proveedor`, el mismo
-- que el remito: un solo lugar que asegurar. Acá se guarda solo el nombre.
--
-- El link se firma al abrirlo y vence: una URL guardada en la base llegaría
-- muerta, y una foto de una recepción no tiene que quedar pública para quien
-- adivine la dirección.
alter table detalle_recepciones
  add column if not exists foto_path text;
