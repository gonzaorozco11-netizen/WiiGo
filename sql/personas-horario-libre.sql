-- Horario libre: el empleado no tiene días ni horario fijos (por ejemplo,
-- la administrativa). Si ficha, se le cuentan las horas, pero no hay
-- tardanzas ni faltas. Distinto de "sin definir" (id_horario vacío y esto en
-- false), que es un pendiente: todavía no se eligió.
-- Se puede correr más de una vez sin romper nada.
alter table personas add column if not exists horario_libre boolean not null default false;
