"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pausarCombo, pedirPrecioCombo, pedirComboNuevo, subirFotoCombo, type ProductoParaCombo } from "@/app/portal/combos/actions";
import type { ComboGestion } from "@/lib/combosGestion";

// Portal de la marca → Mis combos (Gonzalo, 16/11; maqueta aprobada).
// Pausar/activar entra al instante. Cambiar el precio y armar uno nuevo se
// piden y los aprueba WiiGo (Aprobaciones), como los precios de los productos.

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const numero = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0;

export default function PortalCombos({
  combos,
  productos,
  soloLectura,
  pedidos,
}: {
  combos: ComboGestion[];
  productos: ProductoParaCombo[];
  soloLectura: boolean;
  pedidos: { nombre: string; lleva: string; precio: number }[];
}) {
  const [nuevo, setNuevo] = useState(false);
  return (
    <main className="portal-lienzo">
      <div className="rep-cab">
        <div>
          <h1 className="rep-titulo">Mis combos</h1>
          <p className="rep-sub">
            El precio del combo baja solo cuando el cliente lleva los productos juntos, en la caja, el tótem y la tienda online. Podés pausar un combo
            cuando quieras; los cambios de precio y los combos nuevos los aprueba WiiGo.
          </p>
        </div>
      </div>

      {soloLectura && <div className="rep-aviso">Estás mirando el portal de la marca: desde acá no se cambia nada.</div>}

      {pedidos.length > 0 && (
        <div className="cmb-pedidos">
          {pedidos.map((p, i) => (
            <div key={i} className="cmb-espera">
              <b>Combo nuevo pedido: {p.nombre}</b> · {p.lleva} · {pesos(p.precio)}. Esperando que WiiGo lo apruebe.
            </div>
          ))}
        </div>
      )}

      {!soloLectura &&
        (nuevo ? (
          <ComboNuevo productos={productos} cerrar={() => setNuevo(false)} />
        ) : (
          <button type="button" className="cmb-nuevo" onClick={() => setNuevo(true)}>
            + Armar un combo nuevo
          </button>
        ))}

      {combos.length === 0 ? (
        <p className="vacio">Todavía no tenés combos. Armá el primero con el botón de arriba.</p>
      ) : (
        <div className="cmb-grilla">
          {combos.map((c) => (
            <TarjetaCombo key={c.id} c={c} soloLectura={soloLectura} />
          ))}
        </div>
      )}
    </main>
  );
}

function FotoCombo({ c }: { c: ComboGestion }) {
  if (c.imagen) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.imagen} alt="" />;
  }
  return (
    <span className="cmb-fotos">
      {c.grupos.map((g, i) =>
        g.productos[0]?.imagen ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={g.productos[0].imagen} alt="" />
        ) : null
      )}
    </span>
  );
}

function TarjetaCombo({ c, soloLectura }: { c: ComboGestion; soloLectura: boolean }) {
  const router = useRouter();
  const [cambiando, setCambiando] = useState(false);
  const [precio, setPrecio] = useState(String(c.precio));
  const [efectivo, setEfectivo] = useState(c.precioEfectivo == null ? "" : String(c.precioEfectivo));
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  const lleva = c.grupos.map((g) => `${g.cantidad} × ${g.productos.map((p) => p.nombre).join(" o ")}`).join(" + ");
  const p = numero(precio);
  const e = efectivo.trim() ? numero(efectivo) : null;
  const ahorro = c.suelto > 0 && p > 0 ? c.suelto - p : 0;

  function pausar() {
    setError(null);
    empezar(async () => {
      const r = await pausarCombo(c.id, c.estado === "ACTIVO");
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }
  function mandarPrecio() {
    setError(null);
    empezar(async () => {
      const r = await pedirPrecioCombo(c.id, p, e);
      if (r.error) return setError(r.error);
      setOk("Listo: se lo mandamos a WiiGo para aprobar.");
      setCambiando(false);
      router.refresh();
    });
  }

  return (
    <article className={`cmb-tarjeta${c.estado === "PAUSADO" ? " pausado" : ""}`}>
      <div className="cmb-foto">
        <FotoCombo c={c} />
        <span className={`cmb-estado ${c.pedido ? "esp" : c.estado === "ACTIVO" ? "on" : "off"}`}>
          {c.pedido ? "Cambio pedido" : c.estado === "ACTIVO" ? "Activo" : "Pausado"}
        </span>
      </div>
      <div className="cmb-info">
        <h3>{c.nombre}</h3>
        <p className="cmb-lleva">{lleva}</p>
        <div className="cmb-precios">
          <b>{pesos(c.precio)}</b>
          {c.precioEfectivo != null && <span>{pesos(c.precioEfectivo)} efectivo</span>}
          {c.suelto > c.precio && <s>{pesos(c.suelto)}</s>}
        </div>
        <p className="cmb-dato">
          Este mes: <b>{c.vendidosMes} {c.vendidosMes === 1 ? "combo vendido" : "combos vendidos"}</b>
          {c.suelto > c.precio ? ` · ahorro ${Math.round((1 - c.precio / c.suelto) * 100)}%` : ""}
        </p>
        {c.suelto > 0 && c.suelto <= c.precio && (
          <p className="rep-error">Hoy los productos sueltos salen {pesos(c.suelto)}: el combo no está ahorrando nada. Bajale el precio.</p>
        )}
        {c.pedido && (
          <div className="cmb-espera">
            Pediste pasarlo a <b>{pesos(c.pedido.precio)}</b>
            {c.pedido.precioEfectivo != null && (
              <>
                {" "}
                · efectivo <b>{pesos(c.pedido.precioEfectivo)}</b>
              </>
            )}
            . Esperando que WiiGo lo apruebe.
          </div>
        )}

        {cambiando && (
          <div className="cmb-form">
            <p className="cmb-dato">
              Sueltos hoy: <b>{pesos(c.suelto)}</b> · efectivo <b>{pesos(c.sueltoEfectivo)}</b>
            </p>
            <label>
              Nuevo precio con tarjeta o QR
              <input inputMode="numeric" value={precio} onChange={(ev) => setPrecio(ev.target.value)} />
            </label>
            <label>
              Nuevo precio en efectivo
              <input inputMode="numeric" value={efectivo} onChange={(ev) => setEfectivo(ev.target.value)} placeholder="Opcional" />
            </label>
            {ahorro > 0 ? (
              <p className="cmb-ahorro">
                El cliente ahorra {pesos(ahorro)} ({Math.round((ahorro / c.suelto) * 100)}%) con tarjeta
                {e != null && c.sueltoEfectivo > e ? ` y ${pesos(c.sueltoEfectivo - e)} en efectivo` : ""}.
              </p>
            ) : (
              p > 0 && <p className="rep-error">Así sale igual o más caro que los sueltos.</p>
            )}
            <div className="cmb-acc">
              <button type="button" className="boton-portal" disabled={pendiente || !(p > 0)} onClick={mandarPrecio}>
                {pendiente ? "Mandando…" : "Mandar a WiiGo para aprobar"}
              </button>
              <button type="button" className="cmb-sec" onClick={() => setCambiando(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {ok && <p className="rep-ok">{ok}</p>}
        {error && <p className="rep-error">{error}</p>}

        {!soloLectura && !cambiando && (
          <div className="cmb-acc">
            {c.estado === "ACTIVO" && !c.pedido && (
              <button type="button" className="boton-portal" onClick={() => { setOk(null); setCambiando(true); }}>
                Cambiar precio
              </button>
            )}
            <button type="button" className="cmb-sec" disabled={pendiente} onClick={pausar}>
              {c.estado === "ACTIVO" ? "Pausar" : "Volver a activarlo"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function ComboNuevo({ productos, cerrar }: { productos: ProductoParaCombo[]; cerrar: () => void }) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [filas, setFilas] = useState<{ idProducto: string; cantidad: number }[]>([
    { idProducto: "", cantidad: 1 },
    { idProducto: "", cantidad: 1 },
  ]);
  const [precio, setPrecio] = useState("");
  const [efectivo, setEfectivo] = useState("");
  const [imagen, setImagen] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [pendiente, empezar] = useTransition();

  const porId = new Map(productos.map((p) => [p.idProducto, p]));
  const elegidas = filas.filter((f) => f.idProducto);
  const suelto = elegidas.reduce((t, f) => t + (porId.get(f.idProducto)?.precio ?? 0) * f.cantidad, 0);
  const sueltoEf = elegidas.reduce((t, f) => t + (porId.get(f.idProducto)?.precioEfectivo ?? 0) * f.cantidad, 0);
  const p = numero(precio);
  const e = efectivo.trim() ? numero(efectivo) : null;

  async function subir(archivo: File | undefined) {
    if (!archivo) return;
    setError(null);
    setSubiendo(true);
    const fd = new FormData();
    fd.append("archivo", archivo);
    const r = await subirFotoCombo(fd);
    setSubiendo(false);
    if (r.error) setError(r.error);
    else setImagen(r.url ?? null);
  }
  function mandar() {
    setError(null);
    empezar(async () => {
      const r = await pedirComboNuevo({
        nombre,
        grupos: elegidas.map((f) => ({ cantidad: f.cantidad, productos: [f.idProducto] })),
        precio: p,
        precioEfectivo: e,
        imagen,
      });
      if (r.error) return setError(r.error);
      setListo(true);
      router.refresh();
    });
  }

  if (listo) {
    return (
      <div className="cmb-form">
        <p className="rep-ok">✅ Listo: le mandamos el combo nuevo a WiiGo. Cuando lo aprueben, empieza a funcionar solo.</p>
        <button type="button" className="cmb-sec" onClick={cerrar}>
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <div className="cmb-form cmb-form-nuevo">
      <h3>Combo nuevo</h3>
      <label>
        Nombre (como lo ve el cliente)
        <input value={nombre} onChange={(ev) => setNombre(ev.target.value)} placeholder="Ej.: Star · Whey 2 lb + creatina" maxLength={80} />
      </label>
      <span className="cmb-paso">Qué lleva (cualquier sabor de cada producto entra)</span>
      {filas.map((f, i) => (
        <div key={i} className="cmb-fila">
          <select value={f.idProducto} onChange={(ev) => setFilas((a) => a.map((x, k) => (k === i ? { ...x, idProducto: ev.target.value } : x)))}>
            <option value="">Elegí un producto…</option>
            {productos.map((p) => (
              <option key={p.idProducto} value={p.idProducto}>
                {p.nombre} — {pesos(p.precio)}
              </option>
            ))}
          </select>
          <div className="rep-cant">
            <button type="button" onClick={() => setFilas((a) => a.map((x, k) => (k === i ? { ...x, cantidad: Math.max(1, x.cantidad - 1) } : x)))} aria-label="Menos">
              −
            </button>
            <input type="number" min="1" value={f.cantidad} readOnly aria-label="Cantidad" />
            <button type="button" onClick={() => setFilas((a) => a.map((x, k) => (k === i ? { ...x, cantidad: Math.min(20, x.cantidad + 1) } : x)))} aria-label="Más">
              +
            </button>
          </div>
          {filas.length > 1 && (
            <button type="button" className="rep-quitar" onClick={() => setFilas((a) => a.filter((_, k) => k !== i))}>
              Quitar
            </button>
          )}
        </div>
      ))}
      {filas.length < 6 && (
        <button type="button" className="cmb-sec" onClick={() => setFilas((a) => [...a, { idProducto: "", cantidad: 1 }])}>
          + Agregar otro producto
        </button>
      )}
      {suelto > 0 && (
        <p className="cmb-dato">
          Sueltos: <b>{pesos(suelto)}</b> · efectivo <b>{pesos(sueltoEf)}</b>
        </p>
      )}
      <label>
        Precio del combo con tarjeta o QR
        <input inputMode="numeric" value={precio} onChange={(ev) => setPrecio(ev.target.value)} />
      </label>
      <label>
        Precio del combo en efectivo
        <input inputMode="numeric" value={efectivo} onChange={(ev) => setEfectivo(ev.target.value)} placeholder="Opcional" />
      </label>
      {suelto > 0 && p > 0 && (p < suelto ? <p className="cmb-ahorro">El cliente ahorra {pesos(suelto - p)} ({Math.round(((suelto - p) / suelto) * 100)}%).</p> : <p className="rep-error">Así sale igual o más caro que los sueltos.</p>)}
      <label>
        Foto del combo (opcional)
        <input type="file" accept="image/*" onChange={(ev) => subir(ev.target.files?.[0])} />
      </label>
      {subiendo && <p className="cmb-dato">Subiendo la foto…</p>}
      {imagen && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagen} alt="" className="cmb-previa" />
      )}
      {!imagen && <p className="cmb-dato">Sin foto, se muestran las fotos de los productos una al lado de la otra.</p>}
      {error && <p className="rep-error">{error}</p>}
      <div className="cmb-acc">
        <button type="button" className="boton-portal" disabled={pendiente || subiendo} onClick={mandar}>
          {pendiente ? "Mandando…" : "Mandar a WiiGo para aprobar"}
        </button>
        <button type="button" className="cmb-sec" onClick={cerrar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
