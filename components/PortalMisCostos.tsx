"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarMiCosto, type MisCostosPortal, type ProductoConMargen } from "@/app/portal/actions";

// "Cuánto gano": lo único del portal que la marca escribe sobre sí misma.
//
// El resto del tablero cuenta lo que pasó. Esto necesita un dato que solo ella
// tiene — cuánto le cuesta producir — y sin él WiiGo puede decir "te
// transferimos X" pero nunca "ganás Y".
//
// Toda la redacción evita el vocabulario contable. Quien lee esto fabrica
// frappés, no lleva libros: si tiene que buscar qué significa "contribución
// marginal", la pantalla falló.

function pesos(v: number) {
  return v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function enteros(v: number) {
  return Math.round(v).toLocaleString("es-AR");
}
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fechaCorta(iso: string | null) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

export default function PortalMisCostos({ datos }: { datos: MisCostosPortal }) {
  const [cargando, setCargando] = useState<ProductoConMargen | null>(null);
  const [elegido, setElegido] = useState<string | null>(
    datos.productos.find((p) => p.costo != null)?.idProducto ?? datos.productos[0]?.idProducto ?? null
  );

  const producto = useMemo(
    () => datos.productos.find((p) => p.idProducto === elegido) ?? null,
    [datos.productos, elegido]
  );

  return (
    <>
      {/* ===== Los costos ===== */}
      <section className="modulo">
        <div className="modulo-cab">
          <h2>Mis costos</h2>
          <p className="desc">Cuánto te cuesta a vos cada producto. Solo lo ven WiiGo y vos.</p>
        </div>

        {datos.productos.length === 0 ? (
          <p className="vacio">Todavía no tenés productos cargados.</p>
        ) : (
          <table className="tabla-costos">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Precio al público</th>
                <th>Mi costo</th>
                <th>Desde</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {datos.productos.map((p) => (
                <tr key={p.idProducto}>
                  <td>{p.nombre}</td>
                  <td className="mono">${enteros(p.precio)}</td>
                  <td className={`mono ${p.costo == null ? "sin-costo" : "con-costo"}`}>
                    {p.costo == null ? "falta" : `$${enteros(p.costo)}`}
                  </td>
                  <td className="tenue">{fechaCorta(p.vigenteDesde)}</td>
                  <td>
                    <button className="enlace" onClick={() => setCargando(p)}>
                      {p.costo == null ? "Cargar" : "Editar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {datos.sinCosto > 0 && (
          <div className="nota-ocre">
            Te faltan <b>{datos.sinCosto}</b> de {datos.productos.length}{" "}
            {datos.productos.length === 1 ? "producto" : "productos"}. Hasta que los cargues no te
            podemos decir cuánto ganás con ellos — solo cuánto cobrás.
          </div>
        )}
      </section>

      {/* ===== Cuánto gano ===== */}
      {producto && producto.porMedio.length > 0 && (
        <CuantoGano producto={producto} productos={datos.productos} onElegir={setElegido} />
      )}

      {cargando && <ModalCosto producto={cargando} onCerrar={() => setCargando(null)} />}
    </>
  );
}

/** El desglose, contado como una historia y no como una liquidación. */
function CuantoGano({
  producto,
  productos,
  onElegir,
}: {
  producto: ProductoConMargen;
  productos: ProductoConMargen[];
  onElegir: (id: string) => void;
}) {
  // El escenario que se muestra en detalle. Arranca en crédito a propósito: es
  // el peor caso y el que la marca no tiene en la cabeza.
  const [medio, setMedio] = useState("CREDITO");
  const linea = producto.porMedio.find((m) => m.medio === medio) ?? producto.porMedio[0];
  const mejor = producto.porMedio.find((m) => m.medio === "EFECTIVO");

  // De cada $100 que paga el cliente, en pedazos que SUMAN 100.
  //
  // Sin una porción de IVA: `leQueda` todavía lo tiene adentro, así que
  // mostrarlo aparte contaba la misma plata dos veces y la barra se pasaba del
  // 100% (con estos números daba 112). El IVA de la marca es de la marca, y lo
  // dice la nota de abajo — en la barra no entra.
  const costosWiigo = linea.comisionWiigo + linea.ivaComision;
  const costosBanco = linea.comisionMp + linea.impCreditos + linea.impDebitos;
  const pedazo = (v: number) => (producto.precio > 0 ? (v / producto.precio) * 100 : 0);
  const suyo = producto.costo != null ? linea.leQueda ?? 0 : 0;

  return (
    <section className="modulo">
      <div className="modulo-cab">
        <h2>Cuánto gano</h2>
        <p className="desc">De cada venta, qué parte termina siendo tuya y qué parte no.</p>
      </div>

      {productos.length > 1 && (
        <select className="selector" value={producto.idProducto} onChange={(e) => onElegir(e.target.value)}>
          {productos.map((p) => (
            <option key={p.idProducto} value={p.idProducto}>
              {p.nombre}
            </option>
          ))}
        </select>
      )}

      {producto.costo == null ? (
        <div className="nota-ocre" style={{ marginTop: 14 }}>
          Cargá el costo de <b>{producto.nombre}</b> y acá te mostramos cuánto ganás con cada venta.
          Por ahora solo sabemos cuánto te transferimos: <b>${pesos(linea.leTransferimos)}</b>.
        </div>
      ) : (
        <>
          <p className="et-barra">
            De cada $100 que paga el cliente · pagando con {linea.etiqueta.toLowerCase()}
          </p>
          <div className="barra100" aria-hidden="true">
            <span className="b-prod" style={{ flexBasis: `${pedazo(producto.costo)}%` }}>
              ${Math.round(pedazo(producto.costo))}
            </span>
            <span className="b-wiigo" style={{ flexBasis: `${pedazo(costosWiigo)}%` }}>
              ${Math.round(pedazo(costosWiigo))}
            </span>
            <span className="b-banco" style={{ flexBasis: `${pedazo(costosBanco)}%` }}>
              ${Math.round(pedazo(costosBanco))}
            </span>
            {linea.sircreb > 0 && (
              <span className="b-sircreb" style={{ flexBasis: `${pedazo(linea.sircreb)}%` }}>
                ${Math.round(pedazo(linea.sircreb))}
              </span>
            )}
            <span className="b-queda" style={{ flexBasis: `${pedazo(suyo)}%` }}>
              ${Math.round(pedazo(suyo))}
            </span>
          </div>
          <div className="leyenda100">
            <span><i className="llave b-prod" /> tu producto</span>
            <span><i className="llave b-wiigo" /> comisión WiiGo</span>
            <span><i className="llave b-banco" /> Mercado Pago y el banco</span>
            {linea.sircreb > 0 && <span><i className="llave b-sircreb" /> retenido, vuelve</span>}
            <span><i className="llave b-queda" /> <b>te quedan a vos</b></span>
          </div>

          <ul className="cuenta" style={{ marginTop: 18 }}>
            <li>
              <span className="k">El cliente pagó</span>
              <span className="v mono">${pesos(linea.precio)}</span>
            </li>
            <li>
              <span className="k">
                Comisión de WiiGo
                <small>por vender tu producto</small>
              </span>
              <span className="v resta mono">-${pesos(linea.comisionWiigo)}</span>
            </li>
            {linea.ivaComision > 0 && (
              <li>
                <span className="k">
                  IVA de esa comisión
                  <small>no se cobra si te pagan en efectivo</small>
                </span>
                <span className="v resta mono">-${pesos(linea.ivaComision)}</span>
              </li>
            )}
            {linea.comisionMp > 0 && (
              <li>
                <span className="k">
                  Comisión de Mercado Pago
                  <small>la cobra Mercado Pago, no WiiGo</small>
                </span>
                <span className="v resta mono">-${pesos(linea.comisionMp)}</span>
              </li>
            )}
            {linea.impCreditos > 0 && (
              <li>
                <span className="k">
                  Impuesto al cheque
                  <small>lo cobra el banco</small>
                </span>
                <span className="v resta mono">-${pesos(linea.impCreditos)}</span>
              </li>
            )}
            {linea.sircreb > 0 && (
              <li>
                <span className="k">
                  SIRCREB retenido
                  <small>no es un costo: se te devuelve</small>
                </span>
                <span className="v vuelve mono">-${pesos(linea.sircreb)}</span>
              </li>
            )}
            <li>
              <span className="k">Te transferimos</span>
              <span className="v mono">${pesos(linea.leTransferimos)}</span>
            </li>
            <li>
              <span className="k">Tu producto te costó</span>
              <span className="v resta mono">-${pesos(producto.costo)}</span>
            </li>
            <li className="total">
              <span className="k">Te queda</span>
              <span className="v mono">${pesos(linea.leQueda ?? 0)}</span>
            </li>
          </ul>

          <div className="nota-verde">
            Es el <b>{Math.round(linea.porcentaje ?? 0)}%</b> de lo que pagó el cliente, antes de tus
            propios impuestos. El IVA y los Ingresos Brutos tuyos los ve tu contador — WiiGo no los
            calcula.
          </div>

          <p className="et-barra" style={{ marginTop: 22 }}>Cambia según cómo te paguen</p>
          <table className="tabla-medios">
            <thead>
              <tr>
                <th>El cliente paga con</th>
                <th>Te transferimos</th>
                <th>Te queda</th>
                <th>De la venta</th>
              </tr>
            </thead>
            <tbody>
              {producto.porMedio.map((m) => (
                <tr
                  key={m.medio}
                  className={m.medio === medio ? "elegido" : ""}
                  onClick={() => setMedio(m.medio)}
                >
                  <td>{m.etiqueta}</td>
                  <td className="mono">${enteros(m.leTransferimos)}</td>
                  <td className={`mono ${m.medio === "EFECTIVO" ? "bien" : m.medio === "CREDITO" ? "flojo" : ""}`}>
                    ${enteros(m.leQueda ?? 0)}
                  </td>
                  <td className={`mono ${m.medio === "EFECTIVO" ? "bien" : m.medio === "CREDITO" ? "flojo" : ""}`}>
                    {Math.round(m.porcentaje ?? 0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {mejor && linea.medio !== "EFECTIVO" && (mejor.leQueda ?? 0) > (linea.leQueda ?? 0) && (
            <div className="nota-ocre">
              Entre efectivo y {linea.etiqueta.toLowerCase()} hay{" "}
              <b>${enteros((mejor.leQueda ?? 0) - (linea.leQueda ?? 0))} de diferencia</b> en el mismo
              producto. Por eso conviene tener un precio de contado más barato: el cliente paga menos
              y a vos te queda más.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ModalCosto({ producto, onCerrar }: { producto: ProductoConMargen; onCerrar: () => void }) {
  const router = useRouter();
  const [costo, setCosto] = useState(producto.costo != null ? String(producto.costo) : "");
  const [desde, setDesde] = useState(hoyISO());
  const [error, setError] = useState<string | null>(null);
  const [guardando, empezar] = useTransition();

  function guardar() {
    setError(null);
    empezar(async () => {
      const r = await guardarMiCosto({
        idProducto: producto.idProducto,
        costo: Number(costo) || 0,
        vigenteDesde: desde,
      });
      if (r.error) setError(r.error);
      else {
        router.refresh();
        onCerrar();
      }
    });
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal-caja" onClick={(e) => e.stopPropagation()}>
        <h3>{producto.nombre}</h3>
        <p className="desc">Lo que te sale a vos producir una unidad, sin IVA.</p>

        <label className="campo">
          <span className="et">Mi costo por unidad</span>
          <input
            className="inp mono"
            type="number"
            step="0.01"
            value={costo}
            onChange={(e) => setCosto(e.target.value)}
            autoFocus
          />
        </label>
        <label className="campo">
          <span className="et">Rige desde</span>
          <input className="inp" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>

        <p className="tenue" style={{ fontSize: 12 }}>
          Si más adelante te cambia el costo, cargás uno nuevo con su fecha. El viejo no se borra: las
          ventas de antes se siguen calculando con el que regía.
        </p>

        {error && <div className="nota-roja">{error}</div>}

        <div className="modal-pie">
          <button className="enlace" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button className="boton" onClick={guardar} disabled={guardando || !(Number(costo) > 0)}>
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
