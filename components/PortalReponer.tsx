"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  mandarReposicion,
  type DatosReponer,
  type GondolaReponer,
  type RenglonReponer,
} from "@/app/portal/reponer/actions";

// Lo que la marca tiene que reponer.
//
// La pantalla no es un formulario: es una orden ya armada que se revisa. La
// marca no calcula nada — entra, mira y manda. Las columnas están para que
// pueda DISCUTIR el número, no de adorno: un número que no se puede auditar
// no se obedece, se ignora.

function pesos(v: number) {
  return `$${Math.round(v).toLocaleString("es-AR")}`;
}

export default function PortalReponer({ datos }: { datos: DatosReponer }) {
  const router = useRouter();
  const [cantidades, setCantidades] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ automatica: boolean } | null>(null);
  const [pendiente, empezar] = useTransition();

  const sugeridoDe = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of datos.gondolas) for (const r of g.renglones) m.set(r.idVariante, r.sugerido);
    return m;
  }, [datos]);

  const cantidad = (id: string) => cantidades.get(id) ?? sugeridoDe.get(id) ?? 0;

  function tocar(id: string, n: number) {
    setListo(null);
    setCantidades((previo) => new Map(previo).set(id, Math.max(0, Math.round(n) || 0)));
  }

  const aMandar = useMemo(() => {
    const items: { idVariante: string; cantidad: number }[] = [];
    for (const g of datos.gondolas)
      for (const r of g.renglones) {
        const n = cantidad(r.idVariante);
        if (n > 0) items.push({ idVariante: r.idVariante, cantidad: n });
      }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, cantidades]);

  const unidades = aMandar.reduce((a, i) => a + i.cantidad, 0);

  // Cuántas se pasan del tope. Decirlo ANTES de mandar evita la sorpresa de
  // que la orden quede esperando sin que la marca entienda por qué.
  const sobreTope = useMemo(() => {
    let n = 0;
    for (const g of datos.gondolas)
      for (const r of g.renglones) {
        const c = cantidad(r.idVariante);
        if (c > 0 && r.stock + r.enCamino + c > r.tope) n += c;
      }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, cantidades]);

  function mandar() {
    setError(null);
    empezar(async () => {
      const r = await mandarReposicion(aMandar);
      if (r.error) return setError(r.error);
      setListo({ automatica: Boolean(r.automatica) });
      setCantidades(new Map());
      router.refresh();
    });
  }

  return (
    <main className="portal-lienzo">
      <div className="rep-cab">
        <div>
          <h1 className="rep-titulo">Lo que tenés que reponer</h1>
          <p className="rep-sub">
            Se arma solo con lo que vas vendiendo. No hace falta que lo revises todos los días:
            cuando llegue el día de recepción, mandá lo que diga acá.
          </p>
        </div>
        {datos.proxima && (
          <div className="rep-proxima">
            <span>Próxima recepción</span>
            <b>{datos.proxima.etiqueta} · {datos.proxima.horario} h</b>
            <small>
              {datos.proxima.faltanDias === 0
                ? "es hoy"
                : datos.proxima.faltanDias === 1
                  ? "falta 1 día"
                  : `faltan ${datos.proxima.faltanDias} días`}
            </small>
          </div>
        )}
      </div>

      {datos.yaMandado && (
        <div className="rep-aviso">
          Ya tenés un envío de <b>{datos.yaMandado.unidades} unidades</b> mandado y todavía sin
          recibir. Lo que figura abajo ya lo descuenta, así que no vas a mandar dos veces lo mismo.
        </div>
      )}

      <div className="rep-numeros">
        <div className="rep-num agotado">
          <span>Agotados</span>
          <b>{datos.agotados}</b>
          <small>No se están vendiendo porque no están</small>
        </div>
        <div className="rep-num bajo">
          <span>Por debajo del mínimo</span>
          <b>{datos.bajos}</b>
          <small>No llegan a la próxima recepción</small>
        </div>
        <div className="rep-num total">
          <span>Este envío</span>
          <b>{unidades} u.</b>
          <small>{pesos(datos.valorizado)} a precio de venta</small>
        </div>
      </div>

      {datos.gondolas.length === 0 ? (
        <p className="vacio">Todavía no tenés productos con stock objetivo cargado.</p>
      ) : (
        datos.gondolas.map((g) => (
          <Gondola key={g.nombre} g={g} cantidad={cantidad} tocar={tocar} />
        ))
      )}

      <div className="rep-pie">
        {listo ? (
          <p className="rep-ok">
            ✅ Envío mandado.{" "}
            {listo.automatica
              ? "Entró sin esperar aprobación: ya figura en la recepción de WiiGo."
              : "Queda esperando que WiiGo lo apruebe, porque algo se pasa del tope acordado."}{" "}
            La mercadería entra al stock cuando la reciben en el local y cuentan lo que llegó.
          </p>
        ) : (
          <>
            <div>
              {unidades === 0 ? (
                <p className="rep-nada">No hay nada para mandar. Está todo al día.</p>
              ) : sobreTope > 0 ? (
                <p className="rep-nota">
                  <b>{unidades - sobreTope} de {unidades} unidades</b> entran sin esperar aprobación.
                  Las otras {sobreTope} se pasan del tope acordado, así que esas las revisa WiiGo.
                </p>
              ) : (
                <p className="rep-nota">
                  ✅ Las <b>{unidades} unidades</b> entran sin que esperes aprobación.
                </p>
              )}
              {error && <p className="rep-error">{error}</p>}
            </div>
            <button
              className="boton-portal"
              disabled={unidades === 0 || pendiente}
              onClick={mandar}
            >
              {pendiente ? "Mandando…" : "Mandar este envío"}
            </button>
          </>
        )}
      </div>

      <p className="rep-letra">
        Mandar el envío no mueve el stock: avisa a WiiGo que la mercadería va en camino. Entra a la
        góndola cuando la reciben en el local y cuentan lo que llegó de verdad. Si decía 8 y llegaron
        6, se reciben 6 y lo vas a ver acá.
      </p>
    </main>
  );
}

function Gondola({
  g,
  cantidad,
  tocar,
}: {
  g: GondolaReponer;
  cantidad: (id: string) => number;
  tocar: (id: string, n: number) => void;
}) {
  const hacenFalta = g.renglones.filter((r) => r.sugerido > 0).length;
  // Las góndolas que no necesitan nada arrancan cerradas, pero se muestran:
  // sin ellas la lista parece incompleta y no se ve que el sistema miró todo
  // el catálogo, no solo lo que falta.
  const [abierta, setAbierta] = useState(hacenFalta > 0);

  return (
    <section className="rep-gondola">
      <button className="rep-gon-cab" onClick={() => setAbierta((v) => !v)}>
        <span className="rep-gon-nom">
          {abierta ? "▾" : "▸"} {g.nombre}
        </span>
        <span className="rep-gon-dato">
          {hacenFalta === 0
            ? `${g.renglones.length} productos, ninguno hace falta`
            : `${hacenFalta} de ${g.renglones.length} para reponer`}
        </span>
      </button>

      {abierta && (
        <table className="rep-tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="c">En góndola</th>
              <th className="c">Mín · Objetivo</th>
              <th className="c">Se vende</th>
              <th className="c">Mandar</th>
            </tr>
          </thead>
          <tbody>
            {g.renglones.map((r) => (
              <Fila key={r.idVariante} r={r} valor={cantidad(r.idVariante)} tocar={tocar} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Fila({
  r,
  valor,
  tocar,
}: {
  r: RenglonReponer;
  valor: number;
  tocar: (id: string, n: number) => void;
}) {
  return (
    <tr className={r.estado === "OK" && r.sugerido === 0 ? "ok" : undefined}>
      <td>
        <span className="rep-prod">
          {r.producto}
          {r.variante && r.variante !== "Único" && <span className="rep-var"> · {r.variante}</span>}
        </span>
        {r.estado === "AGOTADO" && <span className="rep-chip agotado">AGOTADO</span>}
        {r.estado === "BAJO" && <span className="rep-chip bajo">BAJO</span>}
        {r.enCamino > 0 && <span className="rep-chip camino">{r.enCamino} en camino</span>}
      </td>
      <td className={`c mono${r.estado === "AGOTADO" ? " rojo" : r.estado === "BAJO" ? " ambar" : ""}`}>
        {r.stock}
      </td>
      <td className="c mono tenue">
        {r.minimo} · {r.objetivo}
      </td>
      <td className="c tenue">{r.porSemana > 0 ? `${r.porSemana} / sem` : "—"}</td>
      <td className="c">
        <div className="rep-cant">
          <button type="button" onClick={() => tocar(r.idVariante, valor - 1)} aria-label="Menos">
            −
          </button>
          <input
            type="number"
            min="0"
            value={valor}
            onChange={(e) => tocar(r.idVariante, Number(e.target.value))}
            aria-label={`Cuántas unidades de ${r.producto}`}
          />
          <button type="button" onClick={() => tocar(r.idVariante, valor + 1)} aria-label="Más">
            +
          </button>
        </div>
      </td>
    </tr>
  );
}
