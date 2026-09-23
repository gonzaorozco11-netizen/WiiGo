"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { marcarCartelesPuestos } from "@/app/(app)/carteles/actions";

export type ItemCartel = {
  idProducto: string;
  nombre: string;
  marca: string | null;
  /** Lo que se cobra con tarjeta, débito o QR (con la oferta ya aplicada). */
  lista: number;
  /** Lo que se cobra pagando en efectivo. */
  efectivo: number;
  tienePrecioEfectivo: boolean;
  enOferta: boolean;
  descuento: number;
  /** Si este producto tiene un cartel pendiente de cambiar, su tarea. */
  idTarea: string | null;
  vencida: boolean;
};

const SIN_MARCA = "Sin marca";

/**
 * Las medidas de porta precios que hay en la tienda.
 *
 * Hay más de una a propósito: el riel de una marca no tiene por qué medir lo
 * mismo que el de otra. Animalfit usa uno de 34 mm de alto y el resto de la
 * tienda 40. Con diez marcas van a aparecer más, por eso además está la opción
 * de escribir la medida a mano.
 */
const MEDIDAS = [
  { id: "65x40", nombre: "65 × 40 mm", ancho: 65, alto: 40 },
  { id: "65x34", nombre: "65 × 34 mm", ancho: 65, alto: 34 },
  { id: "60x40", nombre: "60 × 40 mm", ancho: 60, alto: 40 },
  { id: "50x30", nombre: "50 × 30 mm", ancho: 50, alto: 30 },
  { id: "75x45", nombre: "75 × 45 mm", ancho: 75, alto: 45 },
  // 100 y no 105: dos de 105 ocupan los 210 exactos de la hoja y no queda
  // margen para imprimir, así que entraría uno solo por fila.
  { id: "100x70", nombre: "100 × 70 mm (grande)", ancho: 100, alto: 70 },
] as const;

const pesos = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");

/**
 * Cuántos carteles entran en una A4 y dónde arranca la grilla.
 *
 * La grilla va centrada en la hoja en vez de pegada a un margen fijo: así se
 * aprovecha todo lo que se puede sin quedar a milímetros del borde. El mínimo
 * de 4 mm es porque ninguna impresora hogareña imprime más cerca que eso —
 * poner 3 columnas de 65 mm sin ese colchón hace que la tercera salga cortada.
 */
function grillaA4(medida: { ancho: number; alto: number }) {
  const MARGEN_MIN = 4;
  const cols = Math.max(1, Math.floor((210 - 2 * MARGEN_MIN) / medida.ancho));
  const filas = Math.max(1, Math.floor((297 - 2 * MARGEN_MIN) / medida.alto));
  return {
    cols,
    filas,
    margenX: (210 - cols * medida.ancho) / 2,
    margenY: (297 - filas * medida.alto) / 2,
  };
}

export default function CartelesApp({ items }: { items: ItemCartel[] }) {
  const router = useRouter();
  const [enviando, startTransition] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  const imprimibles = useMemo(() => items.filter((i) => i.tienePrecioEfectivo), [items]);
  const sinEfectivo = items.length - imprimibles.length;
  const pendientes = useMemo(() => imprimibles.filter((i) => i.idTarea), [imprimibles]);

  const [modo, setModo] = useState<"cambiaron" | "todos">(pendientes.length > 0 ? "cambiaron" : "todos");
  const visibles = modo === "cambiaron" ? pendientes : imprimibles;

  const [medida, setMedida] = useState<{ ancho: number; alto: number }>({ ancho: 65, alto: 40 });
  const [medidaId, setMedidaId] = useState<string>("65x40");
  const [aire, setAire] = useState(1);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set(visibles.map((i) => i.idProducto)));

  const aImprimir = visibles.filter((i) => elegidos.has(i.idProducto));
  const impreso = { ancho: Math.max(20, medida.ancho - aire * 2), alto: Math.max(14, medida.alto - aire * 2) };
  const grilla = grillaA4(medida);
  const porHoja = grilla.cols * grilla.filas;
  const hojas = Math.ceil(aImprimir.length / porHoja) || 0;

  const porMarca = useMemo(() => {
    const m = new Map<string, ItemCartel[]>();
    for (const i of visibles) {
      const k = i.marca ?? SIN_MARCA;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [visibles]);

  function cambiarModo(nuevo: "cambiaron" | "todos") {
    setModo(nuevo);
    const lista = nuevo === "cambiaron" ? pendientes : imprimibles;
    setElegidos(new Set(lista.map((i) => i.idProducto)));
  }

  function alternar(id: string) {
    setElegidos((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  function confirmarPuestos() {
    const tareas = aImprimir.map((i) => i.idTarea).filter((t): t is string => Boolean(t));
    startTransition(async () => {
      const res = await marcarCartelesPuestos(tareas);
      if (res.error) setAviso(res.error);
      else {
        setAviso(`Listo: ${res.cuantas} ${res.cuantas === 1 ? "cartel marcado" : "carteles marcados"} como puestos.`);
        router.refresh();
      }
    });
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold text-neutral-900">Carteles de góndola</h1>
        <p className="text-sm text-neutral-500 mt-1 mb-4">
          {imprimibles.length} productos con los dos precios cargados
          {sinEfectivo > 0 && ` · ${sinEfectivo} sin precio en efectivo`}
          {pendientes.length > 0 && ` · ${pendientes.length} con el cartel viejo puesto`}
        </p>

        {sinEfectivo > 0 && (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 mb-4">
            <span className="text-lg leading-none">⚠️</span>
            <p className="text-sm text-neutral-700 leading-relaxed">
              <strong className="text-amber-700">{sinEfectivo} productos no se pueden imprimir todavía.</strong>{" "}
              No tienen cargado el precio en efectivo, así que el cartel saldría con ese renglón vacío. Se
              carga desde <b>Productos</b>, en el bloque de precio.
            </p>
          </div>
        )}

        {aviso && (
          <p className="mb-4 text-sm rounded-lg px-3 py-2 bg-emerald-50 text-emerald-700">{aviso}</p>
        )}

        {pendientes.length > 0 && (
          <div className="inline-flex gap-1 bg-neutral-100 rounded-xl p-1 mb-4">
            {(
              [
                ["cambiaron", `Cambiaron de precio · ${pendientes.length}`],
                ["todos", `Toda la góndola · ${imprimibles.length}`],
              ] as const
            ).map(([id, texto]) => (
              <button
                key={id}
                type="button"
                onClick={() => cambiarModo(id)}
                className={`px-4 py-2 text-sm rounded-lg ${
                  modo === id ? "bg-white shadow-sm font-semibold" : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {texto}
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-neutral-500 mb-3 leading-relaxed max-w-2xl">
          {modo === "cambiaron"
            ? "Los carteles que quedaron con el precio viejo puesto. Son los urgentes: mientras el cartel diga una cosa y la caja otra, hay que respetar el cartel."
            : "Todos los productos que pueden llevar cartel. Los que no tienen precio en efectivo no aparecen."}
        </p>

        {visibles.length === 0 ? (
          <p className="text-sm text-neutral-500 py-16 text-center">
            {modo === "cambiaron"
              ? "Ningún cartel quedó con el precio viejo. Está todo al día."
              : "Todavía no hay productos con los dos precios cargados."}
          </p>
        ) : (
          <>
            <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white mb-4">
              {porMarca.map(([marca, deLaMarca]) => {
                const todos = deLaMarca.every((i) => elegidos.has(i.idProducto));
                return (
                  <div key={marca}>
                    <div className="flex items-center gap-2 bg-neutral-50 px-4 py-2 border-b border-neutral-200">
                      <input
                        type="checkbox"
                        checked={todos}
                        onChange={() =>
                          setElegidos((prev) => {
                            const s = new Set(prev);
                            deLaMarca.forEach((i) => (todos ? s.delete(i.idProducto) : s.add(i.idProducto)));
                            return s;
                          })
                        }
                        className="w-4 h-4 accent-accent"
                      />
                      <span className="text-[11px] uppercase tracking-wider font-bold text-neutral-400">
                        {marca} · {deLaMarca.length}
                      </span>
                    </div>
                    {deLaMarca.map((i) => (
                      <label
                        key={i.idProducto}
                        className="flex items-center gap-3 px-4 py-2 border-b border-neutral-100 last:border-b-0 cursor-pointer hover:bg-neutral-50"
                      >
                        <input
                          type="checkbox"
                          checked={elegidos.has(i.idProducto)}
                          onChange={() => alternar(i.idProducto)}
                          className="w-4 h-4 accent-accent"
                        />
                        <span className="min-w-0 flex-1 flex items-center gap-2">
                          <span className="text-sm truncate">{i.nombre}</span>
                          {i.enOferta && (
                            <span className="shrink-0 text-[10px] font-bold text-red-700 bg-red-50 rounded px-1.5 py-0.5">
                              {i.descuento}% OFF
                            </span>
                          )}
                          {i.vencida && (
                            <span className="shrink-0 text-[10px] font-bold text-red-700 bg-red-50 rounded px-1.5 py-0.5">
                              VENCIDO
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-neutral-400 tabular-nums">
                          {pesos(i.lista)}
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-emerald-700 tabular-nums w-20 text-right">
                          {pesos(i.efectivo)}
                        </span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-4 flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs text-neutral-500 mb-1" htmlFor="medida">
                  Medida del porta precios
                </label>
                <select
                  id="medida"
                  value={medidaId}
                  onChange={(e) => {
                    setMedidaId(e.target.value);
                    const m = MEDIDAS.find((x) => x.id === e.target.value);
                    if (m) setMedida({ ancho: m.ancho, alto: m.alto });
                  }}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {MEDIDAS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                  <option value="libre">A medida…</option>
                </select>
              </div>

              {medidaId === "libre" && (
                <div className="flex items-end gap-2">
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1" htmlFor="ancho">
                      Ancho (mm)
                    </label>
                    <input
                      id="ancho"
                      type="number"
                      min={20}
                      max={200}
                      value={medida.ancho}
                      onChange={(e) => setMedida((m) => ({ ...m, ancho: Number(e.target.value) || 20 }))}
                      className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1" htmlFor="alto">
                      Alto (mm)
                    </label>
                    <input
                      id="alto"
                      type="number"
                      min={14}
                      max={280}
                      value={medida.alto}
                      onChange={(e) => setMedida((m) => ({ ...m, alto: Number(e.target.value) || 14 }))}
                      className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs text-neutral-500 mb-1" htmlFor="aire">
                  Aire por lado (mm)
                </label>
                <input
                  id="aire"
                  type="number"
                  min={0}
                  max={5}
                  step={0.5}
                  value={aire}
                  onChange={(e) => setAire(Math.min(Math.max(0, Number(e.target.value)), 5))}
                  className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <span className="text-sm text-neutral-600 mr-auto">
                <b className="text-neutral-900">{aImprimir.length}</b> carteles ·{" "}
                <b className="text-neutral-900">{hojas}</b> {hojas === 1 ? "hoja" : "hojas"} de{" "}
                {grilla.cols} × {grilla.filas} = {porHoja} · se imprimen a {impreso.ancho} ×{" "}
                {impreso.alto} mm
              </span>

              <button
                type="button"
                onClick={() => window.print()}
                disabled={aImprimir.length === 0}
                className="rounded-lg bg-accent text-white px-4 py-2.5 text-sm font-semibold hover:bg-accent-dark disabled:opacity-40"
              >
                🖨️ Imprimir
              </button>
            </div>

            <p className="text-xs text-neutral-500 mt-3 leading-relaxed max-w-2xl">
              Al imprimir poné <b>A4</b>, márgenes en <b>ninguno</b> y la escala en <b>100%</b>. Si el
              navegador achica la página los carteles salen más chicos y bailan en el porta precios. Se
              recortan por la línea punteada.
            </p>

            {aImprimir.some((i) => i.idTarea) && (
              <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 flex items-center gap-4 flex-wrap">
                <p className="text-sm text-neutral-600 flex-1 min-w-[260px]">
                  Cuando ya los hayas puesto en la góndola, marcalos acá y salen de la lista de pendientes.{" "}
                  <b className="text-neutral-900">No lo aprietes al imprimir</b> — recién cuando estén puestos.
                </p>
                <button
                  type="button"
                  onClick={confirmarPuestos}
                  disabled={enviando}
                  className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-40"
                >
                  {enviando ? "Guardando…" : "Ya los puse en la góndola"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <HojaDeCarteles items={aImprimir} medida={medida} impreso={impreso} grilla={grilla} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function HojaDeCarteles({
  items,
  medida,
  impreso,
  grilla,
}: {
  items: ItemCartel[];
  medida: { ancho: number; alto: number };
  impreso: { ancho: number; alto: number };
  grilla: ReturnType<typeof grillaA4>;
}) {
  const { cols, filas, margenX, margenY } = grilla;
  const porHoja = cols * filas;
  const hojas: ItemCartel[][] = [];
  for (let i = 0; i < items.length; i += porHoja) hojas.push(items.slice(i, i + porHoja));

  return (
    <div className="hoja-carteles">
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden; }
          .hoja-carteles, .hoja-carteles * { visibility: visible; }
          .hoja-carteles { position: absolute; left: 0; top: 0; }
          .ctl-hoja { page-break-after: always; }
          .ctl-hoja:last-child { page-break-after: auto; }
        }
        @media screen {
          .hoja-carteles { margin-top: 28px; }
          .ctl-hoja {
            transform: scale(.62); transform-origin: top left;
            margin-bottom: calc(-297mm * .38 + 24px);
            box-shadow: 0 4px 24px rgba(20,26,34,.16);
          }
        }
      `}</style>

      {hojas.map((hoja, h) => (
        <div
          key={h}
          className="ctl-hoja bg-white"
          style={{
            width: "210mm",
            height: "297mm",
            padding: `${margenY}mm ${margenX}mm`,
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, ${medida.ancho}mm)`,
            gridAutoRows: `${medida.alto}mm`,
          }}
        >
          {hoja.map((item) => (
            <div key={item.idProducto} style={{ display: "grid", placeItems: "center" }}>
              <Cartel item={item} ancho={impreso.ancho} alto={impreso.alto} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Un cartel de góndola.
 *
 * El número grande es el de tarjeta, no el de efectivo, y es a propósito: si el
 * grande fuera el de efectivo, quien paga con tarjeta pagaría más de lo que
 * leyó en la góndola y tendría razón en quejarse. Al revés, quien paga en
 * efectivo paga menos de lo que esperaba — y nadie se enojó nunca por eso. El
 * ahorro no se pierde: va en la tira verde, como premio en vez de como precio
 * base.
 *
 * El precio de tarjeta NO va tachado en el cartel normal: tachar significa
 * "antes costaba esto", y acá son dos precios según cómo pagás. En el de oferta
 * sí se puede tachar, porque ahí el precio anterior existió de verdad.
 */
function Cartel({ item, ancho, alto }: { item: ItemCartel; ancho: number; alto: number }) {
  const ahorro = item.lista - item.efectivo;
  // Todo se mide contra el alto del cartel: el mismo diseño tiene que entrar en
  // uno de 40 mm y en uno de 30 sin recortar el nombre a la mitad, y aprovechar
  // el lugar cuando el cartel es grande en vez de dejar medio blanco.
  const k = Math.max(0.55, Math.min(1.8, alto / 40));
  const nombreLargo = item.nombre.length > 34;
  const mm = (n: number) => `${(n * k).toFixed(2)}mm`;

  return (
    <div
      style={{
        width: `${ancho}mm`,
        height: `${alto}mm`,
        background: "#fff",
        color: "#11151b",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: `${item.enOferta ? 5.6 * k : 2.4 * k}mm ${3 * k}mm ${2.2 * k}mm`,
        fontFamily: "Archivo, 'Arial Narrow', Arial, sans-serif",
        fontVariantNumeric: "tabular-nums",
        outline: "0.2mm dashed #dcdcdc",
        outlineOffset: "0.6mm",
      }}
    >
      {item.enOferta && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            background: "#b91c1c",
            color: "#fff",
            fontSize: mm(2.1),
            fontWeight: 800,
            letterSpacing: ".09em",
            textTransform: "uppercase",
            padding: `${0.9 * k}mm ${3 * k}mm`,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Oferta</span>
          <span>{item.descuento}% off</span>
        </div>
      )}

      <div>
        <div
          style={{
            fontSize: mm(2.1),
            letterSpacing: ".11em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: "#9aa0a7",
            lineHeight: 1.3,
          }}
        >
          {item.marca ?? " "}
        </div>
        <div
          style={{
            fontSize: mm(nombreLargo ? 2.5 : 2.9),
            lineHeight: 1.1,
            fontWeight: 700,
            textTransform: "uppercase",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {item.nombre}
        </div>
      </div>

      <div style={{ marginTop: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: mm(1.6) }}>
          <span style={{ fontSize: mm(9.4), lineHeight: 0.92, fontWeight: 800, letterSpacing: "-.035em" }}>
            {pesos(item.lista)}
          </span>
          <span
            style={{
              fontSize: mm(2.1),
              fontWeight: 700,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              color: "#6b7178",
              lineHeight: 1.15,
            }}
          >
            Tarjeta,
            <br />
            débito o QR
          </span>
        </div>

        <div
          style={{
            marginTop: mm(1.3),
            background: "#effaf2",
            borderLeft: `${0.8 * k}mm solid #15803d`,
            padding: `${1 * k}mm ${2 * k}mm`,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: mm(1.5),
          }}
        >
          <span
            style={{
              fontSize: mm(2.1),
              fontWeight: 800,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "#15803d",
            }}
          >
            En efectivo
          </span>
          <span style={{ fontSize: mm(3.6), fontWeight: 800, color: "#0f5f2e", letterSpacing: "-.02em" }}>
            {pesos(item.efectivo)}
          </span>
          {ahorro > 0 && (
            <span style={{ fontSize: mm(2), color: "#3f7a56", fontWeight: 600 }}>
              ahorrás {pesos(ahorro)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
