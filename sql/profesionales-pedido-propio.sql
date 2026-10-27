-- Pedidos que una profesional se arma para ella misma y paga con su saldo (desde "Mi saldo").
-- El local los ve marcados "Para ella"; al cobrarlos, la caja trae su DNI y su saldo, y ella pone su PIN.
-- Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

alter table pedidos_profesional add column if not exists para_profesional boolean not null default false;
