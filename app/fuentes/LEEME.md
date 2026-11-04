# Letras del sistema

Guardadas en el proyecto (de Google Fonts, subconjunto latin, woff2) y cargadas
con `next/font/local`.

Antes se bajaban de Google en cada build con `next/font/google`, pero a veces
Google responde con un formato de dirección que Next 16 no entiende
("next/font/google queries have exactly one entry") y el build se cae en Vercel
sin haber cambiado nada (2026-11-04, vercel/next.js#99114). Con los archivos acá
el build ya no depende de Google.

Un archivo `.ts` por zona a propósito: next/font precarga todas las letras del
módulo que se importa, y el totem y el asesor corren en placas lentas.

- `sistema.ts`: Archivo (sistema interno, sin precarga).
- `espacio.ts`: Outfit, Manrope y JetBrains Mono (portal de marcas y espacio de las profesionales).
- `asesor.ts`: Bricolage Grotesque y Figtree (pantalla asesora).
- `precios.ts`: IBM Plex Sans y Mono (módulo Precios).
- `lista.ts`: Figtree y Fraunces (lista de precios para imprimir).

Para sumar una letra o un peso: bajar el woff2 latin de Google Fonts a esta
carpeta y declararlo en el `.ts` de su zona. Las letras variables cubren varios
pesos con un solo archivo (por eso `weight: "400 800"`).
