-- Por qué faltó, y qué se hizo con lo que sobró.
--
-- Hoy la recepción guarda cuánto llegó y nada más. Con eso la marca ve
-- "faltan 6" y "sobran 4", que es exactamente lo que genera la llamada:
--
--   "Faltan 6" lo lee como «no lo mandaste». Lo mandó, y tiene razón: estaba
--   dañado y volvió con su repartidor. Son dos cosas distintas y se ven igual.
--
--   "Sobran 4" no le dice si esas 4 quedaron en consignación —y se liquidan
--   cuando se vendan— o si las tiene que ir a buscar. Es su plata: necesita
--   saberlo.
--
-- Correr una sola vez en el SQL Editor de Supabase. Es seguro repetirlo.

-- Por qué entró menos de lo anunciado. Null = no se cargó motivo (las
-- recepciones viejas quedan así, y la pantalla lo muestra como antes).
-- Valores: NO_LLEGO | DANADO | VENCIDO | NO_ES_LO_PEDIDO — ver
-- lib/recepcionDiferencias.ts, que es donde vive el vocabulario.
alter table detalle_recepciones
  add column if not exists motivo_faltante text;

-- Qué se hizo con lo que llegó de más.
-- PENDIENTE | SE_QUEDA | A_DEVOLVER.
--
-- Sin default a propósito: null es "este renglón no tiene excedente", y
-- PENDIENTE es "sobró y todavía nadie lo resolvió". Con default 'PENDIENTE'
-- todos los renglones completos aparecerían esperando una decisión que no
-- existe, y la bandeja de WiiGo mostraría trabajo inventado.
alter table detalle_recepciones
  add column if not exists resolucion_excedente text;

-- Quién lo resolvió y cuándo. Mismo criterio que el resto del sistema: toda
-- decisión que mueve mercadería deja firma.
alter table detalle_recepciones
  add column if not exists resuelto_el timestamptz;

alter table detalle_recepciones
  add column if not exists resuelto_por text;

-- La bandeja busca por acá: los excedentes sin resolver de todas las marcas.
-- Parcial porque los renglones con excedente son una minoría del total.
create index if not exists idx_detalle_recepciones_excedente_pendiente
  on detalle_recepciones (resolucion_excedente)
  where resolucion_excedente = 'PENDIENTE';
