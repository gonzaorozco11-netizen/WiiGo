-- Rótulo de lo que fraccionamos nosotros y precio por kilo en la góndola.
--
-- La etiqueta de la bolsita (Códigos de barras) pasa a llevar peso neto,
-- envasado, vencimiento, lote, alérgenos y el pie con el nombre y la dirección
-- del local. El cartel de góndola suma el peso al lado del nombre y el precio
-- por kilo, que es lo que pide la norma de exhibición de precios para lo que
-- se vende por peso.
--
-- Todo va en el producto y no en la variante: el cartel de góndola es por
-- producto, y si dos tamaños compartieran producto el precio por kilo de uno
-- de los dos saldría mal. Cada tamaño es su propio producto.
--
-- Todas las columnas son opcionales. Sin peso, el cartel sale como antes; sin
-- días cargados, el vencimiento se calcula con una duración sugerida según el
-- tipo de producto (ver lib/rotulado.ts) y la pantalla avisa cuáles son.

alter table productos add column if not exists peso_neto_g numeric(10,2);
alter table productos add column if not exists dias_vida_util integer;
alter table productos add column if not exists alergenos text;
alter table productos add column if not exists trazas text;

comment on column productos.peso_neto_g is
  'Contenido neto en gramos (o ml). Sale en la etiqueta de la bolsa y en el cartel de góndola, y con él se calcula el precio por kilo.';
comment on column productos.dias_vida_util is
  'Cuántos días dura desde que se fracciona. El vencimiento de la etiqueta es envasado + estos días, sin pasarse nunca del vencimiento de la bolsa grande.';
comment on column productos.alergenos is
  'Lo que contiene y es alérgeno, tal como va en la etiqueta. Ej: "almendras (frutos de cáscara)".';
comment on column productos.trazas is
  'Lo que puede contener por fraccionar en el mismo lugar. Ej: "maní y otros frutos secos".';

-- El pie de la etiqueta: quién lo fraccionó y dónde. Una línea por renglón.
insert into configuracion (parametro, valor, descripcion)
values (
  'ETIQUETA_PIE',
  E'WiiGo\nEstaciones de Bienestar\nArístides Villanueva 256\nMendoza',
  'Pie de la etiqueta de las bolsitas fraccionadas: nombre y dirección del local, un renglón por línea.'
)
on conflict (parametro) do nothing;
