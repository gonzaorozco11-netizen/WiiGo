import { Manrope } from "next/font/google";

const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export default function AsesorLayout({ children }: { children: React.ReactNode }) {
  return <div className={manrope.className}>{children}</div>;
}
