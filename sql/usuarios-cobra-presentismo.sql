-- Presentismo opcional por persona.
-- Por defecto todos lo cobran, como hasta ahora. Se apaga desde
-- RR.HH. > Sueldos, al editar el sueldo de la persona.
alter table usuarios add column if not exists cobra_presentismo boolean not null default true;
