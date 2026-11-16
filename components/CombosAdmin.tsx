"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { guardarPrecioCombo, cambiarEstadoCombo, subirFotoComboAdmin, cambiarFotoCombo, crearCombo } from "@/app/(app)/combos/actions";
import type { ComboGestion } from "@/lib/combosGestion";

// Pantalla Combos del sistema (Gonzalo, 16/11). Todo directo, sin aprobación:
// precio, pausar/activar, borrar, foto y combos nuevos. Lo que piden las
// marcas desde su portal (precio nuevo, combo nuevo) llega a Aprobaciones.

type Marca = { idMarca: string; nombre: string };
type Producto = { idProducto: string; idMarca: string; nombre: string; precio: number; precioEfectivo: number };

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const numero = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0;
const caja = "rounded-2xl border border-neutral-200 bg-white";
const campo = "rounded-lg border border-neutral-300 px-3 py-2 text-sm w-full";
const botonPri = "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
const botonSec = "rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40";

export default function CombosAdmin({ combos, marcas, productos, faltaSql }: { combos: ComboGestion[]; marcas: Marca[]; productos: Producto[]; faltaSql: boolean }) {
  const [nuevo, setNuevo] = useState(false);
  const activos = combos.filter((c) => c.estado === "ACTIVO").length;
  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Combos</h1>
          <p className="text-sm text-neutral-500 mt-1 max-w-prose">
            El precio del combo baja solo cuando el cliente lleva los productos juntos (caja, tótem y tienda online). Acá cambiás todo directo. Lo que
            piden las marcas desde su portal te llega a{" "}
            <Link href="/aprobaciones" className="text-accent font-semibold hover:underline">
              Aprobaciones
            </Link>
            .
          </p>
        </div>
        <span className="text-sm text-neutral-500">
          {activos} activos · {combos.length - activos} pausados
        </span>
      </div>

      {faltaSql && (
        <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Falta correr sql/combos.sql en Supabase.
        </p>
      )}

      {nuevo ? (
        <ComboNuevo marcas={marcas} productos={productos} cerrar={() => setNuevo(false)} />
      ) : (
        <button type="button" onClick={() => setNuevo(true)} className="mb-5 w-full rounded-2xl border-2 border-dashed border-neutral-300 py-3 text-sm font-bold text-neutral-700 hover:border-neutral-400">
          + Armar un combo nuevo
        </button>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {combos.map((c) => (
          <Tarjeta key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}

function Tarjeta({ c }: { c: ComboGestion }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [precio, setPrecio] = useState(String(c.precio));
  const [efectivo, setEfectivo] = useState(c.precioEfectivo == null ? "" : String(c.precioEfectivo));
  const [borrar, setBorrar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();
  const lleva = c.grupos.map((g) => `${g.cantidad} × ${g.productos.map((p) => p.nombre).join(" o ")}`).join(" + ");
  const p = numero(precio);
  const e = efectivo.trim() ? numero(efectivo) : null;

  const hacer = (f: () => Promise<{ error: string | null }>, despues?: () => void) => {
    setError(null);
    empezar(async () => {
      const r = await f();
      if (r.error) return setError(r.error);
      despues?.();
      router.refresh();
    });
  };
  async function foto(archivo: File | undefined) {
    if (!archivo) return;
    const fd = new FormData();
    fd.append("archivo", archivo);
    setError(null);
    const r = await subirFotoComboAdmin(fd);
    if (r.error || !r.url) return setError(r.error ?? "No se pudo subir.");
    hacer(() => cambiarFotoCombo(c.id, r.url!));
  }

  return (
    <div className={`${caja} overflow-hidden flex flex-col ${c.estado === "PAUSADO" ? "opacity-70" : ""}`}>
      <div className="relative h-40 bg-white grid place-items-center border-b border-neutral-100">
        {c.imagen ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.imagen} alt="" className="w-full h-full object-contain" />
        ) : (
          <span className="flex w-full h-full gap-2 p-3">
            {c.grupos.map((g, i) => g.productos[0] && <span key={i} className="flex-1 grid place-items-center text-xs text-neutral-400 text-center">{g.productos[0].nombre}</span>)}
          </span>
        )}
        <span className={`absolute top-2 right-2 rounded-full px-2.5 py-0.5 text-xs font-bold ${c.estado === "ACTIVO" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
          {c.estado === "ACTIVO" ? "Activo" : "Pausado"}
        </span>
        {c.marca && <span className="absolute top-2 left-2 rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs font-bold text-white">{c.marca}</span>}
      </div>
      <div className="p-4 grid gap-2 flex-1 content-start">
        <p className="font-bold text-neutral-900 leading-tight">{c.nombre}</p>
        <p className="text-xs text-neutral-500">{lleva}</p>
        <p className="text-sm">
          <b className="text-lg">{pesos(c.precio)}</b>
          {c.precioEfectivo != null && <span className="ml-2 font-semibold text-emerald-700">{pesos(c.precioEfectivo)} ef.</span>}
          {c.suelto > c.precio && <s className="ml-2 text-neutral-400">{pesos(c.suelto)}</s>}
        </p>
        <p className="text-xs text-neutral-500">
          Este mes: <b className="text-neutral-800">{c.vendidosMes} vendidos</b>
          {c.suelto > 0 ? ` · sueltos ${pesos(c.suelto)} / ef. ${pesos(c.sueltoEfectivo)}` : ""}
          {c.suelto > c.precio ? ` · ahorro ${Math.round((1 - c.precio / c.suelto) * 100)}%` : ""}
        </p>
        {c.suelto > 0 && c.suelto <= c.precio && <p className="text-xs font-semibold text-red-600">Con los precios de hoy el combo no ahorra nada.</p>}
        {c.pedido && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            La marca pidió {pesos(c.pedido.precio)}
            {c.pedido.precioEfectivo != null ? ` · ef. ${pesos(c.pedido.precioEfectivo)}` : ""}: está en{" "}
            <Link href="/aprobaciones" className="font-semibold underline">
              Aprobaciones
            </Link>
            .
          </p>
        )}

        {editando ? (
          <div className="grid gap-2 rounded-xl bg-neutral-50 p-3">
            <label className="text-xs font-semibold text-neutral-600">
              Con tarjeta o QR
              <input className={campo} inputMode="numeric" value={precio} onChange={(ev) => setPrecio(ev.target.value)} />
            </label>
            <label className="text-xs font-semibold text-neutral-600">
              En efectivo
              <input className={campo} inputMode="numeric" value={efectivo} onChange={(ev) => setEfectivo(ev.target.value)} placeholder="Opcional" />
            </label>
            {c.suelto > 0 && p > 0 && (
              <p className={`text-xs font-semibold ${p < c.suelto ? "text-emerald-700" : "text-red-600"}`}>
                {p < c.suelto ? `Ahorra ${pesos(c.suelto - p)} (${Math.round(((c.suelto - p) / c.suelto) * 100)}%)` : "Sale igual o más caro que los sueltos"}
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" className={botonPri} disabled={pendiente} onClick={() => hacer(() => guardarPrecioCombo(c.id, p, e), () => setEditando(false))}>
                Guardar precio
              </button>
              <button type="button" className={botonSec} onClick={() => setEditando(false)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mt-1">
            <button type="button" className={botonPri} onClick={() => setEditando(true)}>
              Cambiar precio
            </button>
            <button type="button" className={botonSec} disabled={pendiente} onClick={() => hacer(() => cambiarEstadoCombo(c.id, c.estado === "ACTIVO" ? "PAUSADO" : "ACTIVO"))}>
              {c.estado === "ACTIVO" ? "Pausar" : "Activar"}
            </button>
            <label className={`${botonSec} cursor-pointer`}>
              Cambiar foto
              <input type="file" accept="image/*" className="sr-only" onChange={(ev) => foto(ev.target.files?.[0])} />
            </label>
            {borrar ? (
              <span className="flex gap-1">
                <button type="button" className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white" disabled={pendiente} onClick={() => hacer(() => cambiarEstadoCombo(c.id, "BORRADO"))}>
                  Sí, borrar
                </button>
                <button type="button" className={botonSec} onClick={() => setBorrar(false)}>
                  No
                </button>
              </span>
            ) : (
              <button type="button" className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50" onClick={() => setBorrar(true)}>
                Borrar
              </button>
            )}
          </div>
        )}
        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      </div>
    </div>
  );
}

function ComboNuevo({ marcas, productos, cerrar }: { marcas: Marca[]; productos: Producto[]; cerrar: () => void }) {
  const router = useRouter();
  const [idMarca, setIdMarca] = useState("");
  const [nombre, setNombre] = useState("");
  const [filas, setFilas] = useState<{ idProducto: string; cantidad: number }[]>([
    { idProducto: "", cantidad: 1 },
    { idProducto: "", cantidad: 1 },
  ]);
  const [precio, setPrecio] = useState("");
  const [efectivo, setEfectivo] = useState("");
  const [imagen, setImagen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  const deLaMarca = useMemo(() => productos.filter((p) => p.idMarca === idMarca), [productos, idMarca]);
  const porId = useMemo(() => new Map(productos.map((p) => [p.idProducto, p])), [productos]);
  const elegidas = filas.filter((f) => f.idProducto);
  const suelto = elegidas.reduce((t, f) => t + (porId.get(f.idProducto)?.precio ?? 0) * f.cantidad, 0);
  const sueltoEf = elegidas.reduce((t, f) => t + (porId.get(f.idProducto)?.precioEfectivo ?? 0) * f.cantidad, 0);
  const p = numero(precio);
  const e = efectivo.trim() ? numero(efectivo) : null;

  async function foto(archivo: File | undefined) {
    if (!archivo) return;
    const fd = new FormData();
    fd.append("archivo", archivo);
    const r = await subirFotoComboAdmin(fd);
    if (r.error) setError(r.error);
    else setImagen(r.url ?? null);
  }
  function guardar() {
    setError(null);
    empezar(async () => {
      const r = await crearCombo({ idMarca, nombre, grupos: elegidas.map((f) => ({ cantidad: f.cantidad, productos: [f.idProducto] })), precio: p, precioEfectivo: e, imagen });
      if (r.error) return setError(r.error);
      cerrar();
      router.refresh();
    });
  }

  return (
    <div className={`${caja} p-5 mb-5 grid gap-3`}>
      <h2 className="font-bold text-neutral-900">Combo nuevo</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-neutral-600">
          Marca
          <select
            className={campo}
            value={idMarca}
            onChange={(ev) => {
              setIdMarca(ev.target.value);
              setFilas([
                { idProducto: "", cantidad: 1 },
                { idProducto: "", cantidad: 1 },
              ]);
            }}
          >
            <option value="">Elegí la marca…</option>
            {marcas.map((m) => (
              <option key={m.idMarca} value={m.idMarca}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-neutral-600">
          Nombre (como lo ve el cliente)
          <input className={campo} value={nombre} onChange={(ev) => setNombre(ev.target.value)} maxLength={80} placeholder="Ej.: Star · Whey 2 lb + creatina" />
        </label>
      </div>
      {idMarca && (
        <>
          <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">Qué lleva (cualquier sabor entra)</p>
          {filas.map((f, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <select className={`${campo} flex-1 min-w-[220px] w-auto`} value={f.idProducto} onChange={(ev) => setFilas((a) => a.map((x, k) => (k === i ? { ...x, idProducto: ev.target.value } : x)))}>
                <option value="">Elegí un producto…</option>
                {deLaMarca.map((p) => (
                  <option key={p.idProducto} value={p.idProducto}>
                    {p.nombre} — {pesos(p.precio)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={20}
                className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                value={f.cantidad}
                onChange={(ev) => setFilas((a) => a.map((x, k) => (k === i ? { ...x, cantidad: Math.min(20, Math.max(1, Number(ev.target.value) || 1)) } : x)))}
                aria-label="Cantidad"
              />
              {filas.length > 1 && (
                <button type="button" className="text-sm text-red-600 font-semibold" onClick={() => setFilas((a) => a.filter((_, k) => k !== i))}>
                  Quitar
                </button>
              )}
            </div>
          ))}
          {filas.length < 6 && (
            <button type="button" className={`${botonSec} justify-self-start`} onClick={() => setFilas((a) => [...a, { idProducto: "", cantidad: 1 }])}>
              + Agregar producto
            </button>
          )}
        </>
      )}
      {suelto > 0 && (
        <p className="text-sm text-neutral-600">
          Sueltos: <b>{pesos(suelto)}</b> · efectivo <b>{pesos(sueltoEf)}</b>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-neutral-600">
          Precio con tarjeta o QR
          <input className={campo} inputMode="numeric" value={precio} onChange={(ev) => setPrecio(ev.target.value)} />
        </label>
        <label className="text-xs font-semibold text-neutral-600">
          Precio en efectivo
          <input className={campo} inputMode="numeric" value={efectivo} onChange={(ev) => setEfectivo(ev.target.value)} placeholder="Opcional" />
        </label>
      </div>
      {suelto > 0 && p > 0 && (
        <p className={`text-sm font-semibold ${p < suelto ? "text-emerald-700" : "text-red-600"}`}>
          {p < suelto ? `El cliente ahorra ${pesos(suelto - p)} (${Math.round(((suelto - p) / suelto) * 100)}%)` : "Sale igual o más caro que los sueltos"}
        </p>
      )}
      <label className="text-xs font-semibold text-neutral-600">
        Foto (opcional; sin foto se ven las de los productos)
        <input type="file" accept="image/*" className="block mt-1 text-sm" onChange={(ev) => foto(ev.target.files?.[0])} />
      </label>
      {imagen && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagen} alt="" className="h-32 w-32 object-contain rounded-lg border border-neutral-200" />
      )}
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={botonPri} disabled={pendiente} onClick={guardar}>
          {pendiente ? "Guardando…" : "Crear combo"}
        </button>
        <button type="button" className={botonSec} onClick={cerrar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
