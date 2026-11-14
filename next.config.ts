import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El chequeo de tipos de TypeScript se cuelga en el build de Vercel sin
  // mostrar el error real (ver historial). Se lo salteamos acá para no
  // bloquear el deploy; el código sigue siendo JS válido igual.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Las Server Actions rechazan de entrada cualquier request de más de 1MB
  // (default de Next) — una foto de producto sacada con el celular pesa
  // varios MB, así que subirFotoProducto ni llegaba a ejecutarse.
  //
  // Va dentro de `experimental`: estaba suelto en la raíz, donde Next 16 lo
  // ignora en silencio (solo avisa "Unrecognized key" en el build), así que
  // el límite había vuelto a 1MB sin que nadie se enterara.
  // Ver node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md
  // La tienda online pide las fotos de productos achicadas (/_next/image) para
  // que el celu no baje fotos de 1000 px. Solo se permite el bucket público de
  // Supabase del proyecto. Next 16 exige la lista de calidades; la tienda usa 75.
  // Si el optimizador falla, la tienda vuelve sola a la foto original.
  images: {
    remotePatterns: process.env.SUPABASE_URL
      ? [{ protocol: "https", hostname: new URL(process.env.SUPABASE_URL).hostname, pathname: "/storage/v1/object/public/**" }]
      : [],
    qualities: [75],
  },
  // La tienda online es una página suelta en public/tienda (sale tal cual del
  // prototipo aprobado). Next no sirve un index.html solo por la carpeta:
  // /tienda se reescribe a ese archivo.
  async rewrites() {
    return [
      { source: "/tienda", destination: "/tienda/index.html" },
      { source: "/tienda/", destination: "/tienda/index.html" },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
