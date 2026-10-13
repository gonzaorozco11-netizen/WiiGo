import Link from "next/link";
import type { CanastaPortal } from "@/app/portal/canasta/actions";

// "Con qué se vende junto lo tuyo".
//
// Los números solos no mueven a nadie: "41% proteína" se mira y se olvida. Lo
// que vale es la lectura —"un combo tuyo de creatina más proteína se vende
// solo"— y por eso el bloque de abajo no es decoración, es el producto.
//
// Todo agregado y sin nombres: nunca quién compró, y nunca de qué marca era
// lo que se llevó además.

function fechaCorta(iso: string) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

/** En el gráfico va abreviado por el ancho; en una frase se lee entero. */
const DIA_ENTERO: Record<string, string> = {
  Lun: "lunes",
  Mar: "martes",
  Mié: "miércoles",
  Jue: "jueves",
  Vie: "viernes",
  Sáb: "sábado",
  Dom: "domingo",
};

export default function PortalCanasta({ datos }: { datos: CanastaPortal }) {
  if (!datos.habilitada) {
    return (
      <main className="portal-lienzo">
        <div className="can-cab">
          <h1>Con qué se vende junto lo tuyo</h1>
          <p>Qué se llevan los que compran tus productos, qué día y a qué hora.</p>
        </div>
        <div className="can-gold">
          <span className="medalla">Gold</span>
          <h2>Esto es del plan Gold</h2>
          <p>
            Son datos del local que no tenés de ningún otro lado: qué más había en la bolsa del que
            compró lo tuyo, y qué día se vende. Sirven para decidir un combo, una promo o el día de
            una degustación.
          </p>
          <Link className="can-btn" href="/portal">
            Ver qué incluye Gold
          </Link>
        </div>
      </main>
    );
  }

  const maxDia = Math.max(1, ...datos.porDia.map((d) => d.unidades));
  const mejorDia = datos.porDia.reduce((a, b) => (b.unidades > a.unidades ? b : a), datos.porDia[0]);
  const peorDia = datos.porDia.reduce((a, b) => (b.unidades < a.unidades ? b : a), datos.porDia[0]);
  const primero = datos.acompanantes[0];
  const shaker = datos.acompanantes.find((a) => /shaker|botella|accesor/i.test(a.etiqueta));

  return (
    <main className="portal-lienzo">
      <div className="can-cab">
        <h1>Con qué se vende junto lo tuyo</h1>
        <p>
          {datos.ventas === 0
            ? "Todavía no hay ventas con tus productos."
            : `De las ${datos.ventas} ventas que incluyeron un producto tuyo, entre el ${fechaCorta(datos.desde)} y el ${fechaCorta(datos.hasta)}.`}
        </p>
      </div>

      {datos.ventas === 0 ? (
        <p className="vacio">
          Cuando empiecen a venderse tus productos, acá vas a ver qué más se lleva el que los compra
          y qué día se venden.
        </p>
      ) : (
        <>
          {/* Con pocas ventas los porcentajes dicen cualquier cosa, y una
              decisión tomada con ruido es peor que ninguna. */}
          {datos.pocasVentas && (
            <div className="can-pocas">
              Son pocas ventas todavía ({datos.ventas}). Mirá los números como una primera señal, no
              como para decidir: con un mes más van a ser confiables.
            </div>
          )}

          <div className="can-grid">
            <section className="can-caja">
              <h2>Qué se llevan además</h2>
              <p className="sub">De cada 100 ventas con algo tuyo.</p>

              {datos.acompanantes.length === 0 ? (
                <p className="vacio">Por ahora se llevan solo lo tuyo.</p>
              ) : (
                <div className="can-barras">
                  {datos.acompanantes.map((a) => (
                    <div key={a.etiqueta}>
                      <div className="rot">
                        <span>{a.etiqueta}</span>
                        <b className="mono">{a.porcentaje}%</b>
                      </div>
                      <span className="riel">
                        <span style={{ width: `${a.porcentaje}%` }} />
                      </span>
                    </div>
                  ))}
                  <div>
                    <div className="rot">
                      <span>Nada más, solo lo tuyo</span>
                      <b className="mono">{datos.soloLoTuyo}%</b>
                    </div>
                    <span className="riel">
                      <span className="gris" style={{ width: `${datos.soloLoTuyo}%` }} />
                    </span>
                  </div>
                </div>
              )}
            </section>

            <section className="can-caja">
              <h2>Qué día se vende lo tuyo</h2>
              <p className="sub">Unidades por día de la semana.</p>

              <div className="can-dias">
                {datos.porDia.map((d) => (
                  <div className="col" key={d.dia}>
                    <span className={`n mono${d.dia === mejorDia.dia ? " fuerte" : ""}`}>
                      {d.unidades}
                    </span>
                    <span
                      className={`barra${d.dia === mejorDia.dia ? " fuerte" : ""}`}
                      style={{ height: `${(d.unidades / maxDia) * 100}%` }}
                    />
                    <span className={`d${d.dia === mejorDia.dia ? " fuerte" : ""}`}>{d.dia}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* La lectura, que es lo que de verdad se lleva la marca. */}
          <section className="can-lectura">
            <p className="et">Qué haría yo con esto</p>
            <ul>
              {mejorDia.unidades > 0 && mejorDia.unidades >= peorDia.unidades * 2 && (
                <li>
                  El <b>{DIA_ENTERO[mejorDia.dia] ?? mejorDia.dia}</b> se vende lo tuyo mucho más que el resto. Si
                  vas a hacer una promo o una degustación, es ese día.
                </li>
              )}
              {primero && primero.porcentaje >= 20 && (
                <li>
                  {primero.porcentaje} de cada 100 que compran lo tuyo se llevan también{" "}
                  <b>{primero.etiqueta.toLowerCase()}</b>. Un combo tuyo de los dos se vende solo.
                </li>
              )}
              {shaker && (
                <li>
                  El <b>{shaker.porcentaje}%</b> se lleva {shaker.etiqueta.toLowerCase()}. Si regalás
                  uno con tu marca impresa, se va a la casa del cliente y vuelve a la vista cada día.
                </li>
              )}
              {datos.soloLoTuyo >= 50 && (
                <li>
                  Más de la mitad se lleva <b>solo lo tuyo</b>. Son clientes que vienen puntualmente
                  por tu marca: es el mejor momento para ofrecerles algo más.
                </li>
              )}
            </ul>
          </section>

          <p className="can-pie">
            Son datos del local, agregados y sin nombres: nunca ves quién compró ni de qué marca era
            lo que se llevó además. Se actualizan solos con cada venta.
          </p>
        </>
      )}
    </main>
  );
}
