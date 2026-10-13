-- Calendario de eventos del local.
--
-- Hoy una marca se entera del Black Friday cuando lo ve en la vidriera. Para
-- entonces ya es tarde: no mandó stock, no preparó promo y el día más fuerte
-- del año se vende con la góndola de un martes cualquiera. El que pierde esa
-- venta es WiiGo tanto como la marca.
--
-- Tres cosas distintas viven en la misma tabla porque las tres son "algo que
-- pasa un día en el local" y la marca las quiere ver juntas:
--
--   EVENTO     — lo organiza WiiGo (Black Friday, Semana de la Proteína).
--   COMERCIAL  — no lo organiza nadie, pero cambia lo que se vende (Navidad).
--   HORARIO    — feriado con horario especial.
--   CERRADO    — feriado sin venta. Sin esto, la marca ve un martes en cero y
--                piensa que algo anda mal.
--
-- Correr una vez en el SQL Editor de Supabase.

create table if not exists eventos (
  id_evento         uuid primary key default gen_random_uuid(),

  nombre            text not null,
  -- EVENTO | COMERCIAL | HORARIO | CERRADO
  tipo              text not null default 'EVENTO',
  -- Escrito en lo que le cambia a la marca, no en lo que hacemos nosotros:
  -- es lo que decide si se anota.
  descripcion       text,

  fecha_desde       date not null,
  fecha_hasta       date not null,

  -- Quiénes participan:
  --   AVISO       — nadie se anota. Feriados, Navidad, cualquier cosa que
  --                 queremos que todas sepan.
  --   ABIERTO     — se anotan las que quieran, hasta llenar el cupo.
  --   INVITACION  — WiiGo elige las marcas y les llega la invitación.
  alcance           text not null default 'AVISO',

  -- Solo para ABIERTO. Null = sin límite.
  cupo              integer,
  -- GOLD_PRIMERO | LLEGADA | SOLO_GOLD
  --
  -- El cupo de góndola es finito, así que alguien queda afuera igual. Que las
  -- Gold entren primero convierte ese límite en el argumento de venta del
  -- plan, sin tener que explicar nada.
  orden_entrada     text not null default 'GOLD_PRIMERO',

  -- Con INVITACION: si las que no fueron invitadas lo ven igual (sin poder
  -- anotarse). Conviene dejarlo en true — ver que a otra la invitaron es lo
  -- que hace querer estar.
  visible_para_todas boolean not null default true,

  -- BORRADOR | PUBLICADO | CANCELADO | PROPUESTO | RECHAZADO
  --
  -- PROPUESTO es el evento que propuso una marca y todavía no aprobamos.
  -- Mismo criterio que todo el portal: nada se publica hasta que WiiGo dice
  -- que sí.
  estado            text not null default 'BORRADOR',

  -- Quién lo propuso, si lo propuso una marca. Null si lo armó WiiGo.
  id_marca_propone  uuid references marcas(id_marca),
  -- Lo que la marca pide del local: una mesa, las pantallas, una promotora.
  necesita          text,
  -- Obligatorio al rechazar: un rechazo sin motivo se vuelve a proponer igual
  -- la semana que viene.
  motivo_rechazo    text,

  creado_el         timestamptz not null default now(),
  creado_por        uuid references usuarios(id_usuario),
  resuelto_el       timestamptz,
  resuelto_por      uuid references usuarios(id_usuario)
);

-- El calendario siempre se lee por fecha y hacia adelante.
create index if not exists eventos_fecha_idx on eventos (fecha_desde, fecha_hasta);
create index if not exists eventos_estado_idx on eventos (estado, fecha_desde);
create index if not exists eventos_propone_idx on eventos (id_marca_propone)
  where id_marca_propone is not null;


-- ============================================================
-- Quién participa de cada evento
-- ============================================================
-- Tabla aparte y no un arreglo en `eventos` porque cada marca tiene su propio
-- estado: una puede estar invitada y no haber contestado mientras otra ya está
-- confirmada. Con un arreglo eso no se puede guardar.

create table if not exists eventos_marcas (
  id_evento   uuid not null references eventos(id_evento) on delete cascade,
  id_marca    uuid not null references marcas(id_marca) on delete cascade,

  -- INVITADA    — WiiGo la invitó y todavía no contestó.
  -- ANOTADA     — se anotó sola, esperando que WiiGo la confirme.
  -- CONFIRMADA  — tiene su lugar. Las Gold quedan así de una.
  -- RECHAZADA   — WiiGo no le dio lugar (no entró en el cupo).
  -- NO_VA       — la marca dijo que no.
  estado      text not null default 'ANOTADA',
  -- Por qué no entró. Lo ve la marca.
  motivo      text,

  creado_el   timestamptz not null default now(),
  resuelto_el timestamptz,

  primary key (id_evento, id_marca)
);

create index if not exists eventos_marcas_marca_idx on eventos_marcas (id_marca, estado);

-- Comprobar que quedó:
--   select tipo, alcance, estado, count(*) from eventos group by 1,2,3;
