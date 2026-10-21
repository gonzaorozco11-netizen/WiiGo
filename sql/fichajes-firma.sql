-- Firma al fichar: el operativo firma con el dedo en la tablet cuando ficha
-- la entrada y la salida. La firma (una imagen PNG chica, como texto
-- data:image/png;base64,...) queda pegada a ese fichaje y sale en la
-- planilla de asistencia del mes, al lado de la hora.
-- Las salidas cargadas a mano desde Asistencia no tienen firma.
-- Se puede correr más de una vez sin romper nada.
alter table fichajes add column if not exists firma text;
