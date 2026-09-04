-- ============================================================
-- Bandeja de aprobaciones del portal de marcas
-- ============================================================
-- Una sola tabla para todos los tipos de solicitud (precio, foto,
-- producto nuevo, descripción, descuento, baja...) en vez de una tabla por
-- tipo. Así la bandeja es una sola consulta ordenada por fecha, y sumar un
-- tipo nuevo mañana no obliga a crear otra tabla ni otra pantalla.
--
-- Lo que cambia entre un tipo y otro va en `datos` (jsonb): para un cambio
-- de precio es {"precio": 13000}, para una foto {"path": "..."}, etc.
-- Los campos que SÍ son comunes a todos —quién, cuándo, estado, quién
-- resolvió— están como columnas de verdad, porque se filtran y se ordenan.

create table if not exists solicitudes_marca (
  id_solicitud    uuid primary key default gen_random_uuid(),
  id_marca        uuid not null references marcas(id_marca),

  -- PRECIO | COSTO | FOTO | DESCRIPCION | SUBCATEGORIA | PRODUCTO_NUEVO
  -- | BAJA_PRODUCTO | DESCUENTO | IMPORTACION
  tipo            text not null,

  -- Sobre qué producto es. Va nulo en las que no son de un producto
  -- puntual (una subcategoría nueva, una importación masiva).
  id_producto     uuid references productos(id_producto),
  id_variante     uuid references variantes_producto(id_variante),

  -- PENDIENTE | APROBADA | RECHAZADA | APLICADA | CANCELADA
  -- APROBADA y APLICADA son distintas a propósito: un precio puede estar
  -- aprobado hoy y recién aplicarse esta madrugada (ver vigencia_desde).
  estado          text not null default 'PENDIENTE',

  -- Lo que pide la marca y lo que había antes. Guardar el valor anterior
  -- acá —y no solo mirar el producto— es lo que permite auditar después
  -- qué se cambió realmente, aunque el producto haya cambiado diez veces.
  datos           jsonb not null default '{}'::jsonb,
  datos_anteriores jsonb not null default '{}'::jsonb,

  -- Cuándo empieza a regir. Por defecto se programa con el local cerrado
  -- (ver lib/vigenciaPrecios.ts): las etiquetas se cambian al cierre y el
  -- sistema entra de madrugada, así no hay ninguna venta en el medio.
  vigencia_desde  timestamptz,
  vigencia_hasta  timestamptz,  -- solo descuentos

  -- Marcas que pone el sistema al validar, para que la persona que aprueba
  -- vea de una qué mirar: {"variacion_pct": 900, "escala_a_duenio": true}
  alertas         jsonb not null default '{}'::jsonb,

  -- Quién la mandó y quién la resolvió
  solicitada_por  uuid references usuarios(id_usuario),
  solicitada_el   timestamptz not null default now(),
  resuelta_por    uuid references usuarios(id_usuario),
  resuelta_el     timestamptz,
  motivo          text,          -- obligatorio al rechazar
  aplicada_el     timestamptz,

  observaciones   text
);

create index if not exists solicitudes_marca_bandeja_idx
  on solicitudes_marca (estado, solicitada_el desc);
create index if not exists solicitudes_marca_marca_idx
  on solicitudes_marca (id_marca, solicitada_el desc);
-- Para el proceso que aplica los cambios programados
create index if not exists solicitudes_marca_vigencia_idx
  on solicitudes_marca (estado, vigencia_desde)
  where estado = 'APROBADA';


-- ============================================================
-- Tareas de etiqueta
-- ============================================================
-- Separadas de la solicitud a propósito: una promo genera DOS tareas (poner
-- el cartel y sacarlo) y una importación de 45 precios genera 45 etiquetas.
-- No es uno a uno.

create table if not exists tareas_etiqueta (
  id_tarea        uuid primary key default gen_random_uuid(),
  id_solicitud    uuid references solicitudes_marca(id_solicitud),
  id_producto     uuid not null references productos(id_producto),
  id_local        uuid references locales(id_local),

  -- CAMBIO_PRECIO | INICIO_PROMO | FIN_PROMO
  -- FIN_PROMO es la más olvidada y la más riesgosa: un cartel de oferta
  -- que sigue puesto obliga a respetar ese precio.
  tipo            text not null,

  -- PENDIENTE | HECHA | VENCIDA
  estado          text not null default 'PENDIENTE',

  precio_anterior numeric(12,2),
  precio_nuevo    numeric(12,2),

  -- Hasta cuándo hay tiempo. Al pasar esta hora sin hacerse, la tarea
  -- queda VENCIDA y escala a administración: recién ahí el cartel y el
  -- sistema dicen cosas distintas.
  vence_el        timestamptz not null,

  hecha_por       uuid references usuarios(id_usuario),
  hecha_el        timestamptz,
  creada_el       timestamptz not null default now()
);

create index if not exists tareas_etiqueta_pendientes_idx
  on tareas_etiqueta (id_local, estado, vence_el);
create index if not exists tareas_etiqueta_producto_idx
  on tareas_etiqueta (id_producto, estado);


-- ============================================================
-- Historial de precios
-- ============================================================
-- Cada venta ya guarda su propio precio (detalle_ventas.precio_unitario),
-- así que las liquidaciones viejas nunca cambian. Esto es la otra mitad:
-- poder ver la línea de tiempo de un producto y de dónde salió cada cambio.

create table if not exists historial_precios (
  id_historial    uuid primary key default gen_random_uuid(),
  id_producto     uuid not null references productos(id_producto),
  precio_anterior numeric(12,2),
  precio_nuevo    numeric(12,2) not null,
  id_solicitud    uuid references solicitudes_marca(id_solicitud),
  cambiado_por    uuid references usuarios(id_usuario),
  cambiado_el     timestamptz not null default now(),
  motivo          text
);

create index if not exists historial_precios_producto_idx
  on historial_precios (id_producto, cambiado_el desc);


-- ============================================================
-- Avisos a Marketing
-- ============================================================
-- Cola propia y no una notificación suelta: Marketing necesita una lista
-- de trabajo pendiente, no un mail que se pierde.

create table if not exists avisos_marketing (
  id_aviso        uuid primary key default gen_random_uuid(),
  id_marca        uuid references marcas(id_marca),
  id_producto     uuid references productos(id_producto),

  -- PRODUCTO_APROBADO (anticipación, sin fecha) | PRODUCTO_DISPONIBLE
  -- | PROMO_APROBADA | PROMO_TERMINA | PRECIO_CORREGIR | REPUESTO
  -- | ULTIMAS_UNIDADES
  tipo            text not null,

  -- PENDIENTE | PUBLICADO | DESCARTADO
  estado          text not null default 'PENDIENTE',

  datos           jsonb not null default '{}'::jsonb,
  creado_el       timestamptz not null default now(),
  resuelto_por    uuid references usuarios(id_usuario),
  resuelto_el     timestamptz
);

create index if not exists avisos_marketing_pendientes_idx
  on avisos_marketing (estado, creado_el desc);


-- ============================================================
-- Costo de la marca, con vigencia
-- ============================================================
-- El costo va acá y NO en productos.costo_informado (que es de WiiGo, para
-- marca propia): son dos cosas distintas y mezclarlas expondría el costo de
-- la marca en las pantallas internas.
--
-- Con vigencia porque una venta de marzo tiene que calcularse con el costo
-- que regía en marzo, no con el de hoy.

create table if not exists costos_marca (
  id_costo        uuid primary key default gen_random_uuid(),
  id_producto     uuid not null references productos(id_producto),
  id_marca        uuid not null references marcas(id_marca),
  costo           numeric(12,2) not null,
  vigente_desde    date not null,
  cargado_por     uuid references usuarios(id_usuario),
  creado_el       timestamptz not null default now()
);

create index if not exists costos_marca_vigencia_idx
  on costos_marca (id_producto, vigente_desde desc);


-- ============================================================
-- Política de descuentos
-- ============================================================
-- Se define una vez y el sistema la hace cumplir en todos los locales. Es
-- lo que evita que el dueño tenga que aprobar descuento por descuento.
-- Van como parámetros para poder cambiarlos sin tocar código.

insert into configuracion (parametro, valor, descripcion, fecha_actualizacion) values
  ('DESCUENTO_MAX_SIN_CONSULTA', '25',
   'Descuentos: % máximo que puede aprobar administración sin escalar al dueño', now()),
  ('DESCUENTO_COMISION_MINIMA', '10',
   'Descuentos: comisión mínima que le tiene que quedar a WiiGo (%). Si baja de acá, escala', now()),
  ('DESCUENTO_DURACION_MAX_DIAS', '15',
   'Descuentos: duración máxima de una promo en días', now()),
  ('DESCUENTO_MAX_PRODUCTOS_MARCA', '5',
   'Descuentos: cuántos productos puede tener una marca en promo a la vez', now()),
  ('DESCUENTO_DIAS_ENTRE_PROMOS', '30',
   'Descuentos: días de espera entre dos promos del mismo producto', now()),
  ('PRECIO_VARIACION_ALERTA', '30',
   'Precios: a partir de qué % de variación se marca la solicitud en rojo', now()),
  ('ETIQUETA_HORA_APLICACION', '23:00',
   'Cambios de precio: hora (con el local cerrado) en que se aplican los cambios programados', now())
on conflict (parametro) do nothing;
