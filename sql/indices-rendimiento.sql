-- ============================================================
-- Índices que faltaban
-- ============================================================
-- Postgres crea el índice de la clave primaria solo, pero NO crea nada para
-- las claves foráneas ni para las columnas por las que uno filtra. Sin
-- índice, cada consulta recorre la tabla entera: con 50 filas no se nota, con
-- 50.000 la pantalla tarda segundos. Como el local todavía no abrió, este es
-- el momento barato para ponerlos.
--
-- Todos van con `if not exists`, así que correrlo dos veces no hace nada.
-- Cada uno tarda milisegundos con el volumen actual.

-- ---------- El más importante: escanear en el POS ----------
-- Cada vez que se pasa un producto por el lector se busca por código de
-- barras, y hoy eso recorre toda la tabla de variantes. Es la consulta que
-- más veces por día va a correr el sistema, y la que se hace con un cliente
-- esperando.
create index if not exists variantes_codigo_barras_idx
  on variantes_producto (codigo_barras)
  where codigo_barras is not null;

create index if not exists variantes_sku_idx
  on variantes_producto (sku)
  where sku is not null;

-- ---------- Liquidaciones y portal de marcas ----------
-- calcularRendicion arranca con "todas las líneas de venta de esta marca",
-- sin más filtro. Sin índice eso lee detalle_ventas entero, y esa tabla crece
-- con cada producto de cada venta para siempre.
create index if not exists detalle_ventas_id_marca_idx
  on detalle_ventas (id_marca);

-- Las ventas todavía no rendidas a la marca.
create index if not exists ventas_id_liquidacion_idx
  on ventas (id_liquidacion);

-- ---------- Cuenta corriente de las marcas ----------
-- El saldo se calcula sumando TODOS los movimientos de la marca, y eso se
-- hace en cada movimiento nuevo para guardar el saldo anterior. Sin índice,
-- cada cargo lee la tabla completa.
create index if not exists mov_cuenta_comercial_marca_idx
  on movimientos_cuenta_comercial_marca (id_marca);

create index if not exists mov_retencion_marca_idx
  on movimientos_retencion_marca (id_marca);

-- ---------- Arqueo de caja ----------
-- Cerrar un turno suma los gastos y los pagos a proveedor de ese turno.
create index if not exists gastos_turno_idx on gastos (id_turno);
create index if not exists gastos_fecha_idx on gastos (fecha);
create index if not exists mov_cuenta_proveedor_turno_idx on movimientos_cuenta_proveedor (id_turno);

-- ---------- Mostrador ----------
-- Buscar al cliente por DNI para sumarle puntos.
create index if not exists clientes_dni_idx on clientes (dni) where dni is not null;

-- ---------- Profesionales ----------
create index if not exists mov_profesional_marca_venta_idx on movimientos_profesional_marca (id_venta);
create index if not exists mov_profesional_marca_prof_idx on movimientos_profesional_marca (id_profesional);

-- ---------- Ventas por estado y fecha ----------
-- Es la combinación que usan casi todas las pantallas (ventas pagadas de tal
-- período). El índice de fecha solo ya ayuda, pero el compuesto le evita a
-- Postgres tener que descartar las anuladas una por una.
create index if not exists ventas_estado_fecha_idx on ventas (estado, fecha desc);

-- ---------- Dashboard y resultado del mes ----------
create index if not exists ingresos_fecha_idx on ingresos (fecha);
create index if not exists mov_caja_admin_fecha_idx on movimientos_caja_admin (fecha);
