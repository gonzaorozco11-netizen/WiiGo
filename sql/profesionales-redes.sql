-- Las redes de cada profesional (Instagram, TikTok, Facebook, YouTube, LinkedIn y página web).
-- Se guarda el link de cada perfil; la pantalla del local muestra el usuario y un QR.
-- Ver lib/redesProfesional.ts. Correr una vez en el SQL Editor de Supabase. Se puede correr de nuevo sin romper nada.

alter table profesionales add column if not exists redes jsonb;
