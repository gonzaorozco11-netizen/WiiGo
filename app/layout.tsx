import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WiiGo",
  description: "Gestión interna WiiGo",
  // Para el ícono de "agregar a inicio" en iPhone y iPad: iOS no lee el
  // manifest, se guía por esto (el archivo es app/apple-icon.png).
  appleWebApp: { capable: true, title: "WiiGo", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Pinta la barra de estado del celular con el azul del sistema.
  themeColor: "#2563eb",
  // La tablet del mostrador se usa con los dedos y con guantes: que un doble
  // toque no haga zoom evita que la pantalla quede torcida a mitad de una
  // venta. `maximumScale` sin `user-scalable: no` deja que quien necesite
  // agrandar pueda hacerlo desde el navegador.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
