-- Permiso del paciente para que su profesional vea lo que compra en WiiGo
-- mientras lo acompaña (Gonzalo, 2026-11-02). Lo que se compra en una
-- dietética dice mucho de la salud: sin este permiso la profesional no ve nada.
-- El permiso es para ESA profesional (va en el vínculo), y se puede retirar.
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

alter table pacientes_profesional add column if not exists comparte_compras boolean not null default false;
-- Desde cuándo: se le muestran las compras desde ese momento, no las de antes.
alter table pacientes_profesional add column if not exists comparte_compras_at timestamptz;
-- Dónde lo dio o lo retiró: PEDIDO | ESPACIO | CAJA.
alter table pacientes_profesional add column if not exists comparte_compras_donde text;
