// El totem de autopedido (Android con WebView 83, de 2020 — no se puede
// actualizar ni cambiar en ese hardware) ignora dos cosas que Tailwind 4
// genera por defecto, y al ignorarlas descarta TODA la hoja de estilos:
//   - @layer (capas de cascada), soportado recién desde Chrome 99
//   - oklch() en los colores, soportado recién desde Chrome 111
// Estos dos plugins los traducen a CSS clásico después de que Tailwind
// compila. En navegadores modernos el resultado se ve igual; sin ellos, el
// totem muestra la página sin ningún estilo (texto pelado sobre blanco).
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    "@csstools/postcss-oklab-function": { preserve: false },
    "@csstools/postcss-cascade-layers": {},
  },
};

export default config;
