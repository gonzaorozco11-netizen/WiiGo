"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { costearEntrega, costeoGuardadoDeEntrega } from "@/app/(app)/proveedores/actions";
import type { EntregaHistorial, LineaEntrega } from "@/lib/comprasDatos";

// Costear una entrega.
//
// Dos formas de comprar, una sola pantalla:
//
// - Alifrut (LIQUIDACION_VENTA): solo costo + IVA. No nace deuda.
// - Coca-Cola (REMITO / PERIODO): además la factura, que sí genera deuda.
//
// El bloque de "qué entregas cubre" existe porque una factura no siempre
// corresponde a una sola entrega. El proveedor puede facturar el pedido
// entero el viernes y entregar en dos veces — una deuda, dos entregas. El
// sistema no puede adivinarlo: lo elige quien tiene la factura adelante.

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function redondear2(v: number) {
  return Math.round(v * 100) / 100;
}

function fechaCorta(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sumarDias(iso: string, dias: number) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CostosRecepcionModal({
  entrega,
  lineas,
  todasLasLineas,
  entregasDelPedido,
  proveedor,
  nombrePorVariante,
  costoActualPorVariante,
  ivaActualPorVariante,
  onClose,
}: {
  entrega: EntregaHistorial;
  /** Lo que llegó en ESTA entrega. */
  lineas: LineaEntrega[];
  /** Las de todas las entregas del pedido, para poder sumar lo que ya se costeó. */
  todasLasLineas: LineaEntrega[];
  /** Todas las entregas del mismo pedido, para elegir cuáles cubre la factura. */
  entregasDelPedido: EntregaHistorial[];
  proveedor: ProveedorConSaldo | undefined;
  nombrePorVariante: Map<string, string>;
  costoActualPorVariante: Map<string, number | null>;
  /** Alícuota que ya tiene cargada cada producto. En alimentos no todo es 21%. */
  ivaActualPorVariante: Map<string, number>;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Alifrut no factura por entrega: su factura llega a fin de mes contra la
  // liquidación. Para él, todo el bloque de factura sobra.
  const pideFactura = proveedor?.modo_facturacion !== "LIQUIDACION_VENTA";

  // Arranca vacío siempre, a propósito. Dos razones:
  //
  // 1. Precargado con el costo anterior, se puede guardar sin mirar el
  //    remito — y queda "costeado" con un número viejo que nadie revisó.
  // 2. El costo guardado ya tiene los impuestos prorrateados adentro, así que
  //    reusarlo al corregir se los volvería a sumar sobre un número que ya
  //    los tenía, inflando el costo en cada pasada.
  //
  // El costo anterior sigue a la vista en su columna, para comparar.
  const [costos, setCostos] = useState<Record<string, string>>(
    Object.fromEntries(lineas.map((l) => [l.idVariante, ""]))
  );
  const [alicuotas, setAlicuotas] = useState<Record<string, number>>(
    Object.fromEntries(lineas.map((l) => [l.idVariante, ivaActualPorVariante.get(l.idVariante) ?? 21]))
  );
  const [comprobante, setComprobante] = useState<File | null>(null);

  /** Ya se costeó antes: esto es una corrección, no una carga nueva. */
  const esCorreccion = entrega.facturada;
  // Siempre se consulta: aunque sea una carga nueva, otra entrega del mismo
  // pedido puede tener ya la factura cargada y hay que traerla.
  const [cargando, setCargando] = useState(true);
  /** Entregas que ya cuelgan de la misma factura: su costo suma al total. */
  const [yaCubiertas, setYaCubiertas] = useState<string[]>([]);
  const [facturaHeredada, setFacturaHeredada] = useState(false);

  // --- Factura ---
  const [numero, setNumero] = useState("");
  const [tipoComprobante, setTipoComprobante] = useState("A");
  const [fechaEmision, setFechaEmision] = useState(hoyISO());
  const [montoFactura, setMontoFactura] = useState("");
  const [unidadesFactura, setUnidadesFactura] = useState("");
  // Lo que el proveedor facturó de más.
  const [discrepancia, setDiscrepancia] = useState(false);
  const [motivoDiscrepancia, setMotivoDiscrepancia] = useState("");
  const [malNeto, setMalNeto] = useState("");
  const [malAlicuota, setMalAlicuota] = useState(21);
  const [malIvaManual, setMalIvaManual] = useState<string | null>(null);
  const [malImpuestos, setMalImpuestos] = useState("");
  const [malRetenciones, setMalRetenciones] = useState("");

  // El pie: lo que está en la factura pero no en ningún renglón.
  const [impuestos, setImpuestos] = useState("");
  const [retenciones, setRetenciones] = useState("");
  const [descuentos, setDescuentos] = useState("");
  /** null = todavía lo calcula el sistema. Un número = lo pisó una persona. */
  const [ivaManual, setIvaManual] = useState<string | null>(null);

  // Al abrir una corrección se trae lo que se había cargado. Vacío está bien
  // para costear por primera vez — obliga a mirar el remito — pero acá haría
  // que corregir un número te obligue a tipear todos los demás de nuevo.
  //
  // Los costos vienen del PAPEL, no del costo real: el real tiene las
  // percepciones prorrateadas adentro y reusarlo se las sumaría de nuevo.
  useEffect(() => {
    let vigente = true;
    costeoGuardadoDeEntrega(entrega.idRecepcion)
      .then((g) => {
        if (!vigente) return;
        if (g.costos.length > 0) {
          setCostos((prev) => {
            const copia = { ...prev };
            g.costos.forEach((c) => (copia[c.idVariante] = String(c.costo)));
            return copia;
          });
        }
        // La propia (corrección) o la de una entrega hermana del mismo pedido.
        const f = g.factura ?? g.facturaHermana;
        if (f) {
          setNumero(f.numero);
          setTipoComprobante(f.tipoComprobante || "A");
          if (f.fechaEmision) setFechaEmision(f.fechaEmision);
          setMontoFactura(f.monto ? String(f.monto) : "");
        }
        // El pie solo cuando es SU factura. Si viene de una entrega hermana,
        // esas percepciones ya se repartieron en el costo de aquella — volver
        // a cargarlas acá las contaría dos veces y el total nunca cerraría.
        if (g.factura) {
          if (g.factura.impuestos) setImpuestos(String(g.factura.impuestos));
          if (g.factura.retenciones) setRetenciones(String(g.factura.retenciones));
          if (g.factura.descuentos) setDescuentos(String(g.factura.descuentos));
          if (g.factura.iva) setIvaManual(String(g.factura.iva));
        }
        if (g.facturaHermana) {
          setFacturaHeredada(true);
          setYaCubiertas(g.facturaHermana.idsRecepcion);
        }
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [entrega.idRecepcion]);

  // Las otras entregas del mismo pedido que todavía no se facturaron.
  const otras = useMemo(
    () => entregasDelPedido.filter((e) => e.idRecepcion !== entrega.idRecepcion && !e.facturada),
    [entregasDelPedido, entrega.idRecepcion]
  );

  // Vienen tildadas las anteriores a la fecha de la factura: una factura no
  // puede cubrir mercadería que entró después de emitirse. Es una sugerencia,
  // no una regla — se destilda.
  const [cubiertas, setCubiertas] = useState<Record<string, boolean>>({});
  const sugeridas = useMemo(() => {
    const map: Record<string, boolean> = {};
    otras.forEach((e) => {
      map[e.idRecepcion] = e.fechaRecibida.slice(0, 10) <= fechaEmision;
    });
    return map;
  }, [otras, fechaEmision]);
  const estaCubierta = (id: string) => cubiertas[id] ?? sugeridas[id] ?? false;

  const vencimiento = proveedor?.condicion_pago_dias
    ? sumarDias(fechaEmision, proveedor.condicion_pago_dias)
    : null;

  /**
   * Cuánto de cada producto entró en las OTRAS entregas del mismo pedido.
   *
   * La tabla muestra los renglones del pedido entero, así que en la 2ª
   * entrega aparecen también los productos que ya habían llegado en la 1ª,
   * con 0 unidades. Sin esto los dos casos se ven iguales — "0 recibido" —
   * y no hay forma de distinguir "esto ya lo tenés, se costeó aparte" de
   * "esto el proveedor nunca lo mandó", que son cosas muy distintas.
   */
  const entroEnOtraEntrega = useMemo(() => {
    const map = new Map<string, { unidades: number; costeado: boolean }>();
    for (const l of todasLasLineas) {
      if (l.idRecepcion === entrega.idRecepcion || l.cantidadRecibida <= 0) continue;
      const previo = map.get(l.idVariante) ?? { unidades: 0, costeado: false };
      map.set(l.idVariante, {
        unidades: previo.unidades + l.cantidadRecibida,
        costeado: previo.costeado || (l.costoUnitario ?? 0) > 0,
      });
    }
    return map;
  }, [todasLasLineas, entrega.idRecepcion]);

  const totales = lineas.reduce(
    (acc, l) => {
      const neto = (Number(costos[l.idVariante]) || 0) * l.cantidadRecibida;
      const iva = neto * ((alicuotas[l.idVariante] ?? 21) / 100);
      return { neto: acc.neto + neto, iva: acc.iva + iva };
    },
    { neto: 0, iva: 0 }
  );

  // ---------- El pie ----------
  const nImpuestos = Number(impuestos) || 0;
  const nRetenciones = Number(retenciones) || 0;
  const nDescuentos = Number(descuentos) || 0;
  // El IVA sale de la alícuota de cada producto — no de una sola tasa al pie,
  // porque en la góndola conviven el 21% y el 10,5%. Se puede pisar a mano si
  // la factura lo discrimina distinto.
  const ivaCalculado = totales.iva;
  const ivaFinal = ivaManual !== null ? Number(ivaManual) || 0 : ivaCalculado;

  // ---------- Lo mal facturado ----------
  const nMalNeto = discrepancia ? Number(malNeto) || 0 : 0;
  const malIvaCalculado = redondear2(nMalNeto * (malAlicuota / 100));
  const nMalIva = discrepancia ? (malIvaManual !== null ? Number(malIvaManual) || 0 : malIvaCalculado) : 0;
  const nMalImpuestos = discrepancia ? Number(malImpuestos) || 0 : 0;
  const nMalRetenciones = discrepancia ? Number(malRetenciones) || 0 : 0;
  const totalReclamo = nMalNeto + nMalIva + nMalImpuestos + nMalRetenciones;

  // Impuestos y retenciones encarecen la mercadería; los descuentos la
  // abaratan. El IVA no entra: vuelve como crédito fiscal.
  const costoDeLoQueLlego = totales.neto + nImpuestos + nRetenciones - nDescuentos;
  // Lo mal facturado suma al total y al IVA pero NO al costo: esa mercadería
  // no llegó, así que no puede encarecer la que sí llegó.
  const subtotalSinIva = costoDeLoQueLlego + nMalNeto + nMalImpuestos + nMalRetenciones;
  const totalEntrega = subtotalSinIva + ivaFinal + nMalIva;

  // Lo que realmente cuesta cada unidad, con el pie repartido proporcional al
  // valor de cada línea. Es el número que se guarda y con el que se calcula
  // el margen — por eso sale de `costoDeLoQueLlego`, sin lo mal facturado.
  const factor = totales.neto > 0 ? costoDeLoQueLlego / totales.neto : 1;
  const hayPie = nImpuestos !== 0 || nRetenciones !== 0 || nDescuentos !== 0;

  // Control de que cuadre: unidades cubiertas contra las que dice la factura.
  const unidadesCubiertas =
    lineas.reduce((a, l) => a + l.cantidadRecibida, 0) +
    otras.filter((e) => estaCubierta(e.idRecepcion)).reduce((a, e) => a + e.unidades, 0);
  const unidadesDeclaradas = Number(unidadesFactura) || 0;
  const cuadranUnidades = unidadesDeclaradas > 0 && unidadesDeclaradas === unidadesCubiertas;
  const hayDeclaracion = unidadesDeclaradas > 0;

  // Lo que aportan las OTRAS entregas cubiertas, con el costo que ya tienen
  // cargado. Si alguna todavía no se costeó, suma 0 y el aviso lo dice.
  //
  // Son de dos clases: las que se tildan acá, y las que ya cuelgan de esta
  // misma factura porque se costearon antes. Las segundas no se eligen —
  // están cubiertas por definición y su plata tiene que sumar, o el total
  // nunca llegaría al de la factura.
  const cubiertasPrevias = entregasDelPedido.filter(
    (e) => e.idRecepcion !== entrega.idRecepcion && yaCubiertas.includes(e.idRecepcion)
  );
  const otrasCubiertas = [...otras.filter((e) => estaCubierta(e.idRecepcion)), ...cubiertasPrevias];
  const totalOtras = otrasCubiertas.reduce((acc, e) => {
    const suyas = todasLasLineas.filter((l) => l.idRecepcion === e.idRecepcion);
    return (
      acc +
      suyas.reduce((a, l) => {
        // Los dos pedazos por separado, porque llevan IVA distinto:
        // el neto del papel paga IVA, y la percepción que se le prorrateó
        // encima NO. Sumando el costo real y aplicándole IVA a todo se le
        // cobraba IVA a la percepción, y el total de la factura quedaba
        // siempre unos pesos por encima del papel.
        const real = (l.costoUnitario ?? 0) * l.cantidadRecibida;
        const neto = (l.costoNetoFactura ?? l.costoUnitario ?? 0) * l.cantidadRecibida;
        const pie = real - neto;
        return a + neto * (1 + (ivaActualPorVariante.get(l.idVariante) ?? 21) / 100) + pie;
      }, 0)
    );
  }, 0);
  // Entregas que esta factura cubre pero que todavía no se costearon: su
  // plata no existe en el sistema todavía, así que el total NO PUEDE cuadrar.
  // No es un error de nadie — es información que falta.
  const sinCostearAun = otrasCubiertas.filter((e) =>
    todasLasLineas.filter((l) => l.idRecepcion === e.idRecepcion).some((l) => l.costoUnitario == null)
  );
  const hayOtrasSinCostear = sinCostearAun.length > 0;

  // El control que importa: la suma de los ítems contra el total de la
  // factura. Sin esto, un error de tipeo en el total se convierte en deuda
  // real y en crédito fiscal calculado sobre otra cosa.
  const totalCubierto = totalEntrega + totalOtras;
  const montoDeclarado = Number(montoFactura) || 0;
  const diferencia = montoDeclarado - totalCubierto;
  // Un peso de tolerancia: los redondeos del proveedor no son un error.
  const cuadraPlata = Math.abs(diferencia) <= 1;
  const hayMonto = montoDeclarado > 0;
  // Con entregas sin costear, la diferencia no significa nada todavía: falta
  // plata que va a aparecer cuando se carguen. Bloquear acá sería pedir que
  // cierre una cuenta a la que le faltan renglones.
  const sePuedeVerificar = !hayOtrasSinCostear;

  // Qué falta para poder guardar. Se calcula acá y no se descubre después de
  // apretar: el botón apagado con el motivo al pasar el mouse molesta menos
  // que un error rojo tras completar todo el formulario.
  // Un renglón que llegó y quedó sin costo deja el lote ciego: el FIFO no
  // sabe cuánto valió esa mercadería y el margen sale mal, sin avisar.
  const sinCostear = lineas.filter((l) => l.cantidadRecibida > 0 && !(Number(costos[l.idVariante]) > 0));

  const motivoBloqueo = cargando
    ? "Buscando lo que ya habías cargado..."
    : sinCostear.length
    ? sinCostear.length === lineas.filter((l) => l.cantidadRecibida > 0).length
      ? "Falta cargar los costos."
      : `Falta el costo de ${sinCostear.length} ${sinCostear.length === 1 ? "producto" : "productos"}.`
    : !pideFactura
    ? null
    : !numero.trim()
      ? "Falta el número de factura."
      : montoDeclarado <= 0
        ? "Falta el total de la factura."
        : discrepancia && totalReclamo <= 0
          ? "Marcaste que facturó algo mal: poné cuánto facturó de más."
          : discrepancia && !motivoDiscrepancia.trim()
            ? "Contá qué facturó mal."
            : sePuedeVerificar && !cuadraPlata && !motivoDiscrepancia.trim()
              ? "Los números no cuadran: contá por qué antes de guardar."
              : null;
  const sePuedeGuardar = motivoBloqueo === null;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await costearEntrega({
          idRecepcion: entrega.idRecepcion,
          costos: lineas.map((l) => ({
            idVariante: l.idVariante,
            costo: Number(costos[l.idVariante]) || 0,
            iva: alicuotas[l.idVariante] ?? 21,
          })),
          factura: pideFactura
            ? {
                numero,
                tipoComprobante,
                fechaEmision,
                fechaVencimiento: vencimiento,
                monto: Number(montoFactura) || 0,
                idsRecepcionCubiertas: otras.filter((e) => estaCubierta(e.idRecepcion)).map((e) => e.idRecepcion),
                unidadesFacturadas: unidadesDeclaradas || null,
                malFacturado: discrepancia
                  ? {
                      neto: nMalNeto,
                      iva: nMalIva,
                      impuestos: nMalImpuestos,
                      retenciones: nMalRetenciones,
                      motivo: motivoDiscrepancia,
                    }
                  : null,
                impuestos: nImpuestos,
                retenciones: nRetenciones,
                descuentos: nDescuentos,
                iva: ivaFinal,
              }
            : null,
          comprobante,
        });
        if (res.error) setError(res.error);
        else onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  const etiquetaEntrega =
    entrega.totalEntregas === 1 ? "entrega única" : `${entrega.numeroEntrega}ª de ${entrega.totalEntregas} entregas`;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">WiiGo</p>
            <h2 className="text-xl font-semibold text-neutral-900">
              {esCorreccion ? "Corregir costeo" : "Costear entrega"}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {proveedor?.nombre ?? "—"} · Pedido #{entrega.idOrden.slice(0, 8).toUpperCase()} ·{" "}
              <b className="text-neutral-500">{etiquetaEntrega}</b>, del {fechaCorta(entrega.fechaRecibida)}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="divide-y divide-neutral-100">
          {/* ---------- 1. La factura ---------- */}
          {pideFactura && (
            <Bloque n={1} titulo="La factura">
              {/* Vino de otra entrega del mismo pedido. Decirlo evita que
                  alguien piense que el sistema se inventó los datos. */}
              {facturaHeredada && (
                <div className="flex gap-2.5 bg-accent-tint text-accent-dark rounded-lg px-3.5 py-2.5 mb-3 text-sm">
                  <span aria-hidden="true">📄</span>
                  <p>
                    Esta factura ya se había cargado con una entrega anterior de este mismo pedido.{" "}
                    <b>Completá los costos de esta entrega y el total va a cuadrar solo.</b>
                  </p>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-4">
                <Campo etiqueta="Nº de factura" obligatorio>
                  <input
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    placeholder="A-0003-00004521"
                    className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </Campo>
                <Campo etiqueta="Tipo">
                  <select
                    value={tipoComprobante}
                    onChange={(e) => setTipoComprobante(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="A">Factura A</option>
                    <option value="B">Factura B</option>
                    <option value="C">Factura C</option>
                    <option value="REMITO">Remito</option>
                  </select>
                </Campo>
                <Campo etiqueta="Fecha de la factura" obligatorio>
                  <input
                    type="date"
                    value={fechaEmision}
                    onChange={(e) => setFechaEmision(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </Campo>
                <Campo etiqueta="Total de la factura" obligatorio>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={montoFactura}
                    onChange={(e) => setMontoFactura(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </Campo>
              </div>
              <p className="text-xs text-neutral-400 mt-2.5">
                La fecha de la factura no es la del pedido: manda el período de IVA y desde ahí corre el plazo de
                pago.{" "}
                {vencimiento ? (
                  <>
                    Vence el <b className="text-neutral-600">{fechaCorta(vencimiento)}</b> ·{" "}
                    {proveedor?.condicion_pago_dias} días.
                  </>
                ) : (
                  <>Este proveedor no tiene plazo de pago cargado en su ficha.</>
                )}
              </p>
            </Bloque>
          )}

          {/* ---------- 2. Los costos ---------- */}
          <Bloque n={pideFactura ? 2 : 1} titulo="Los costos de esta entrega">
            <div className="border border-neutral-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[620px]">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="p-3">Producto</th>
                    <th className="p-3 text-right">Recibido</th>
                    <th className="p-3 text-right">Costo anterior</th>
                    <th className="p-3 text-right">Costo neto</th>
                    <th className="p-3">IVA</th>
                    {hayPie && <th className="p-3 text-right bg-accent-tint text-accent">Costo final</th>}
                    <th className="p-3 text-right">Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => {
                    // Renglón del pedido que en esta entrega no trajo nada.
                    const noLlego = l.cantidadRecibida <= 0;
                    // Dos motivos distintos para el mismo 0: o ya llegó en
                    // otra entrega, o el proveedor no lo mandó nunca.
                    const otra = entroEnOtraEntrega.get(l.idVariante);
                    const yaEntroAntes = otra?.unidades ?? 0;
                    const yaEstaba = noLlego && yaEntroAntes > 0;
                    const costoAnterior = costoActualPorVariante.get(l.idVariante) ?? null;
                    const costoNuevo = Number(costos[l.idVariante]) || 0;
                    // Se compara final contra final: el costo anterior ya
                    // tiene sus impuestos adentro, así que compararlo contra
                    // el neto de hoy mostraría una baja que no existe.
                    const costoFinal = costoNuevo * factor;
                    const puedeComparar = costoAnterior != null && costoAnterior > 0 && costoNuevo > 0;
                    const pct = puedeComparar ? ((costoFinal - costoAnterior) / costoAnterior) * 100 : null;
                    return (
                      <tr
                        key={l.idVariante}
                        className={`border-b border-neutral-100 last:border-0 ${noLlego ? "opacity-50" : ""}`}
                      >
                        <td className="p-3 text-neutral-900">
                          {nombrePorVariante.get(l.idVariante) ?? "—"}
                          {yaEstaba && (
                            <span className="block text-[11px] text-neutral-400">
                              Ya entró en otra entrega ({yaEntroAntes} u.) —{" "}
                              {otra?.costeado ? "su costo se cargó ahí" : "se costea en esa entrega"}
                            </span>
                          )}
                          {noLlego && !yaEstaba && (
                            <span className="block text-[11px] text-amber-700">
                              El proveedor todavía no lo mandó
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right text-neutral-500 tabular-nums">{l.cantidadRecibida}</td>
                        <td className="p-3 text-right text-neutral-400 tabular-nums">
                          {costoAnterior != null ? `$${formatearMonto(costoAnterior)}` : "—"}
                        </td>
                        <td className="p-2 text-right">
                          {noLlego ? (
                            // Sin unidades no hay nada que costear: el lote
                            // está vacío. Y dejarlo escribible cambiaría el
                            // costo de referencia del producto por una
                            // entrega que no ocurrió.
                            <span className="text-xs text-neutral-400 px-3">
                              {yaEstaba ? (otra?.costeado ? "ya costeado" : "en otra entrega") : "no vino"}
                            </span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={costos[l.idVariante] ?? ""}
                              onChange={(e) => setCostos((prev) => ({ ...prev, [l.idVariante]: e.target.value }))}
                              className="w-24 rounded-lg border border-accent px-2 py-1.5 text-sm text-right tabular-nums font-semibold focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                          )}
                        </td>
                        <td className="p-2">
                          {/* Por producto y no una sola para todo el pedido: en
                              alimentos conviven el 21% y el 10,5%, y con la
                              alícuota mal puesta el crédito fiscal sale mal. */}
                          {noLlego ? (
                            <span className="text-xs text-neutral-400 px-2">—</span>
                          ) : (
                          <select
                            value={alicuotas[l.idVariante] ?? 21}
                            onChange={(e) =>
                              setAlicuotas((prev) => ({ ...prev, [l.idVariante]: Number(e.target.value) }))
                            }
                            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                          >
                            <option value={21}>21%</option>
                            <option value={10.5}>10,5%</option>
                            <option value={0}>Exento</option>
                          </select>
                          )}
                        </td>
                        {hayPie && (
                          <td className="p-3 text-right tabular-nums bg-accent-tint font-semibold text-accent">
                            {costoNuevo > 0 ? `$${formatearMonto(costoFinal)}` : "—"}
                          </td>
                        )}
                        <td className="p-3 text-right tabular-nums">
                          {/* Sin unidades no hay costo nuevo que comparar:
                              decir "sin cambios" ahí suena a que se revisó
                              el precio y dio igual, y no se revisó nada. */}
                          {noLlego ? (
                            <span className="text-xs text-neutral-300">—</span>
                          ) : pct == null || Math.abs(pct) < 0.05 ? (
                            <span className="text-xs text-neutral-400">sin cambios</span>
                          ) : pct > 0 ? (
                            <span className="text-xs font-semibold text-red-600">▲ +{pct.toFixed(1)}%</span>
                          ) : (
                            <span className="text-xs font-semibold text-emerald-600">▼ {pct.toFixed(1)}%</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-neutral-50 border-t border-neutral-200 text-sm font-semibold tabular-nums">
                    <td className="p-3 text-xs text-neutral-500 uppercase" colSpan={3}>
                      Neto de los ítems
                    </td>
                    <td className="p-3 text-right text-neutral-900" colSpan={hayPie ? 3 : 2}>
                      ${formatearMonto(totales.neto)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-neutral-400 mt-2.5">
              Poné el <b className="text-neutral-600">neto que dice el renglón de la factura</b>, sin IVA. Cada
              entrega guarda el suyo: si el mismo producto entró dos veces a precios distintos, el sistema no los
              promedia — los gasta del más viejo al más nuevo.
            </p>
          </Bloque>

          {/* ---------- 3. Qué entregas cubre ---------- */}
          {pideFactura && (otras.length > 0 || cubiertasPrevias.length > 0) && (
            <Bloque n={3} titulo="Qué entregas cubre esta factura">
              <div className="flex flex-col gap-2">
                <EntregaFija
                  titulo={`${entrega.numeroEntrega}ª entrega · ${fechaCorta(entrega.fechaRecibida)}`}
                  detalle="la que estás costeando"
                  unidades={lineas.reduce((a, l) => a + l.cantidadRecibida, 0)}
                />
                {/* Las que ya se costearon con esta misma factura. No se
                    destildan: están cubiertas por definición. */}
                {cubiertasPrevias.map((e) => (
                  <EntregaFija
                    key={e.idRecepcion}
                    titulo={`${e.numeroEntrega}ª entrega · ${fechaCorta(e.fechaRecibida)}`}
                    detalle="ya costeada con esta misma factura"
                    unidades={e.unidades}
                  />
                ))}
                {otras.map((e) => {
                  const on = estaCubierta(e.idRecepcion);
                  return (
                    <button
                      key={e.idRecepcion}
                      type="button"
                      onClick={() => setCubiertas((prev) => ({ ...prev, [e.idRecepcion]: !on }))}
                      className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left ${
                        on ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white hover:bg-neutral-50"
                      }`}
                    >
                      <span
                        className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center text-[11px] font-bold shrink-0 ${
                          on ? "bg-accent border-accent text-white" : "border-neutral-300 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-neutral-900">
                          {e.numeroEntrega}ª entrega · {fechaCorta(e.fechaRecibida)}
                        </span>
                        <span className="block text-xs text-neutral-400">
                          {on ? "la cubre esta factura" : "va en otra factura"}
                        </span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-neutral-700">{e.unidades} un.</span>
                    </button>
                  );
                })}
              </div>

              {hayDeclaracion && (
                <div
                  className={`flex items-center gap-3 flex-wrap rounded-lg px-3.5 py-2.5 mt-3 text-sm tabular-nums ${
                    cuadranUnidades
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  <span>
                    La factura dice <b>{unidadesDeclaradas} unidades</b> · estás cubriendo{" "}
                    <b>{unidadesCubiertas}</b>
                  </span>
                  <span className="flex-1" />
                  <b>
                    {cuadranUnidades
                      ? "✓ Cuadra"
                      : unidadesDeclaradas > unidadesCubiertas
                        ? `✕ Sobran ${unidadesDeclaradas - unidadesCubiertas} facturadas`
                        : `✕ Faltan ${unidadesCubiertas - unidadesDeclaradas} en la factura`}
                  </b>
                </div>
              )}

              <div className="mt-3">
                <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
                  Unidades que dice la factura (opcional)
                </label>
                <input
                  type="number"
                  min={0}
                  value={unidadesFactura}
                  onChange={(e) => setUnidadesFactura(e.target.value)}
                  placeholder="para controlar que cuadre"
                  className="w-56 rounded-lg border border-neutral-300 px-2.5 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <p className="text-xs text-neutral-400 mt-2.5">
                Vienen tildadas las entregas anteriores a la fecha de la factura. Si el proveedor mandó una factura
                por entrega, destildalas.{" "}
                <b className="text-neutral-600">Si el número de factura ya está cargado, no se genera deuda nueva</b> —
                esta entrega se suma a la que ya existe.
              </p>
            </Bloque>
          )}

          {/* ---------- 4. Cierre ---------- */}
          <Bloque n={pideFactura ? 4 : 2} titulo={pideFactura ? "Al pie de la factura" : "Cierre"}>
            {pideFactura && (
              <>
                <div className="grid gap-3 sm:grid-cols-4 mb-4">
                  <CampoPie
                    etiqueta="Impuestos ($)"
                    valor={impuestos}
                    onCambio={setImpuestos}
                    pista="Percepciones, IIBB."
                    efecto="Entran al costo."
                  />
                  <CampoPie
                    etiqueta="Retenciones ($)"
                    valor={retenciones}
                    onCambio={setRetenciones}
                    efecto="Entran al costo."
                  />
                  <CampoPie
                    etiqueta="Descuentos ($)"
                    valor={descuentos}
                    onCambio={setDescuentos}
                    efecto="Se restan del costo."
                  />
                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-500 mb-1">IVA ($)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={ivaManual ?? (ivaCalculado > 0 ? ivaCalculado.toFixed(2) : "")}
                      onChange={(e) => setIvaManual(e.target.value)}
                      className="w-full rounded-lg border border-accent bg-accent-tint px-2.5 py-2 text-sm text-right tabular-nums font-semibold focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    <p className="text-[11px] text-neutral-400 mt-1 leading-snug">
                      Sale de la alícuota de cada producto. Si la factura lo discrimina distinto, corregilo.{" "}
                      <b className="text-neutral-600">No entra al costo: es crédito fiscal.</b>
                      {ivaManual !== null && (
                        <button
                          type="button"
                          onClick={() => setIvaManual(null)}
                          className="block text-accent hover:underline mt-0.5"
                        >
                          Volver al calculado (${formatearMonto(ivaCalculado)})
                        </button>
                      )}
                    </p>
                  </div>
                </div>

                {/* La escalera. El IVA se suma al final y sobre el neto de los
                    ítems, no sobre el subtotal: las percepciones no llevan IVA. */}
                <div className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3">
                  <Renglon etiqueta={`Neto de los ${lineas.reduce((a, l) => a + l.cantidadRecibida, 0)} ítems`} valor={totales.neto} />
                  {(nImpuestos !== 0 || nRetenciones !== 0) && (
                    <Renglon etiqueta="+ Impuestos y retenciones" valor={nImpuestos + nRetenciones} />
                  )}
                  {nDescuentos !== 0 && <Renglon etiqueta="− Descuentos" valor={-nDescuentos} rojo />}
                  <Renglon etiqueta="Subtotal sin IVA" valor={subtotalSinIva} fuerte />
                  <Renglon etiqueta="+ IVA" valor={ivaFinal} />
                  <div className="flex justify-between items-baseline border-t-2 border-neutral-200 mt-1.5 pt-2.5">
                    <span className="text-base font-bold">Total</span>
                    <span className="text-base font-bold tabular-nums">${formatearMonto(totalEntrega)}</span>
                  </div>
                  {hayPie && (
                    <p className="text-xs text-neutral-500 mt-2.5">
                      El costo de cada producto sube un{" "}
                      <b className="text-neutral-700">{((factor - 1) * 100).toFixed(1)}%</b> por el pie de la
                      factura. Esa plata se paga igual, así que va al costo — mirá la columna{" "}
                      <b className="text-neutral-700">Costo final</b> arriba.
                    </p>
                  )}
                </div>
              </>
            )}

            {pideFactura && hayMonto && (
              <div
                className={`rounded-lg px-3.5 py-3 mt-3 mb-3 text-sm tabular-nums ${
                  !sePuedeVerificar
                    ? "bg-accent-tint text-accent-dark"
                    : cuadraPlata
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-700"
                }`}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span>
                    Suma de los ítems <b>${formatearMonto(totalCubierto)}</b> · Total de la factura{" "}
                    <b>${formatearMonto(montoDeclarado)}</b>
                  </span>
                  <span className="flex-1" />
                  <b>
                    {!sePuedeVerificar
                      ? "⏳ Falta costear"
                      : cuadraPlata
                        ? "✓ Cuadra"
                        : `✕ ${diferencia > 0 ? "Faltan" : "Sobran"} $${formatearMonto(Math.abs(diferencia))}`}
                  </b>
                </div>
                {!sePuedeVerificar && (
                  <p className="text-xs mt-1.5 opacity-90">
                    Esta factura cubre {sinCostearAun.length}{" "}
                    {sinCostearAun.length === 1 ? "entrega que todavía no tiene" : "entregas que todavía no tienen"}{" "}
                    su costo cargado. <b>Guardá igual</b> — el total va a cuadrar solo cuando las costees.
                  </p>
                )}
              </div>
            )}

            {pideFactura && hayMonto && sePuedeVerificar && !cuadraPlata && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 mb-3">
                <p className="text-sm text-amber-900 mb-2">
                  <b>No cuadra. Contá por qué antes de guardar.</b> Puede ser que el proveedor haya facturado mal, o
                  que la factura traiga percepciones o un descuento al pie que no están en los ítems. Las dos cosas
                  son válidas — lo que no puede pasar es que la diferencia se pierda.
                </p>
                <textarea
                  value={motivoDiscrepancia}
                  onChange={(e) => setMotivoDiscrepancia(e.target.value)}
                  rows={2}
                  placeholder="Ej: facturaron 24 aguas que nunca entraron. / Trae percepción de IIBB de $2.900."
                  className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            )}

            {pideFactura && (
              <div
                className={`rounded-xl border mb-3 ${
                  discrepancia ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"
                }`}
              >
                <label className="flex items-start gap-2.5 cursor-pointer px-3.5 py-3">
                  <input
                    type="checkbox"
                    checked={discrepancia}
                    onChange={(e) => setDiscrepancia(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-amber-600"
                  />
                  <span className="text-sm">
                    <b className={discrepancia ? "text-amber-900" : "text-neutral-900"}>
                      ⚠ El proveedor facturó algo mal
                    </b>
                    {!discrepancia && (
                      <span className="block text-xs text-neutral-500">
                        Mandó de menos y facturó todo, se equivocó en un precio, cobró algo bonificado.
                      </span>
                    )}
                  </span>
                </label>

                {discrepancia && (
                  <div className="px-3.5 pb-3.5">
                    <p className="text-xs text-amber-900 mb-3 leading-relaxed">
                      Poné acá <b>lo que facturó de más</b>. Cuenta para el total de la factura y para el IVA — así la
                      deuda y tu libro coinciden con lo que el proveedor ya declaró — pero{" "}
                      <b>no entra al costo de tus productos</b>. Se abre solo el reclamo de nota de crédito.
                    </p>

                    <div className="grid gap-3 sm:grid-cols-5">
                      <div>
                        <label className="block text-[10.5px] font-bold text-amber-800 uppercase mb-1">
                          Facturado de más · neto ($)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={malNeto}
                          onChange={(e) => setMalNeto(e.target.value)}
                          placeholder="0,00"
                          className="w-full rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[10.5px] font-bold text-amber-800 uppercase mb-1">
                          Alícuota de IVA
                        </label>
                        <select
                          value={malAlicuota}
                          onChange={(e) => {
                            setMalAlicuota(Number(e.target.value));
                            setMalIvaManual(null);
                          }}
                          className="w-full rounded-lg border border-amber-300 bg-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                          <option value={21}>21% · general</option>
                          <option value={10.5}>10,5%</option>
                          <option value={0}>Exento</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10.5px] font-bold text-amber-800 uppercase mb-1">IVA ($)</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={malIvaManual ?? (malIvaCalculado > 0 ? malIvaCalculado.toFixed(2) : "")}
                          onChange={(e) => setMalIvaManual(e.target.value)}
                          placeholder="0,00"
                          className="w-full rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <p className="text-[10.5px] text-amber-700 mt-1 leading-snug">
                          Sobre el neto de ${formatearMonto(nMalNeto)}. Las percepciones no llevan IVA.
                        </p>
                      </div>
                      <div>
                        <label className="block text-[10.5px] font-bold text-amber-800 uppercase mb-1">
                          Impuestos ($)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={malImpuestos}
                          onChange={(e) => setMalImpuestos(e.target.value)}
                          placeholder="0,00"
                          className="w-full rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <p className="text-[10.5px] text-amber-700 mt-1 leading-snug">
                          Percepciones, IIBB sobre lo mal facturado.
                        </p>
                      </div>
                      <div>
                        <label className="block text-[10.5px] font-bold text-amber-800 uppercase mb-1">
                          Retenciones ($)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={malRetenciones}
                          onChange={(e) => setMalRetenciones(e.target.value)}
                          placeholder="0,00"
                          className="w-full rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="block text-[10.5px] font-bold text-amber-800 uppercase mb-1">
                        ¿Qué facturó mal? <span className="text-red-600">*</span>
                      </label>
                      <textarea
                        value={motivoDiscrepancia}
                        onChange={(e) => setMotivoDiscrepancia(e.target.value)}
                        rows={2}
                        placeholder="Ej: cobraron a $10.000 la unidad que iba bonificada."
                        className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>

                    {totalReclamo > 0 && (
                      <p className="text-sm text-amber-900 mt-3 tabular-nums">
                        <b>Reclamo de nota de crédito: ${formatearMonto(totalReclamo)}</b> — va a quedar en la lista
                        de Reclamos hasta que el proveedor te acredite.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <SubirComprobante archivo={comprobante} onCambio={setComprobante} />

            {!pideFactura && (
              <p className="text-xs text-neutral-400 mt-3">
                A {proveedor?.nombre ?? "este proveedor"} se le paga por lo que se venda, no por esta entrega, así
                que esto <b className="text-neutral-600">no genera deuda</b>. Su factura llega a fin de mes contra la
                liquidación.
              </p>
            )}

            {error && (
              <p className="text-sm text-red-600 mt-3" role="alert">
                {error}
              </p>
            )}

            {/* El motivo a la vista y no solo en el tooltip: si el botón
                está apagado sin explicación, parece que el sistema se colgó. */}
            {motivoBloqueo && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                {motivoBloqueo}
              </p>
            )}

            <div className="flex gap-2 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isPending || !sePuedeGuardar}
                title={motivoBloqueo ?? undefined}
                className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
              >
                {isPending ? "Guardando..." : "Guardar costeo"}
              </button>
            </div>
          </Bloque>
        </div>
      </div>
    </div>
  );
}

function Bloque({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <div className="px-6 py-5">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 mb-3 flex items-center gap-2">
        <span className="w-[18px] h-[18px] rounded-[5px] bg-accent-tint text-accent flex items-center justify-center text-[10.5px]">
          {n}
        </span>
        {titulo}
      </p>
      {children}
    </div>
  );
}

function Campo({
  etiqueta,
  obligatorio,
  children,
}: {
  etiqueta: string;
  obligatorio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-neutral-500 mb-1">
        {etiqueta} {obligatorio && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * Subir el remito o la factura.
 *
 * Va como botón y no como el `<input type="file">` pelado: ese renderiza
 * "Seleccionar archivo · Ningún archivo seleccionado" en gris chiquito, que
 * en una pantalla llena de números no se ve. Y sacarle la foto al remito es
 * justo lo que después salva una discusión con el proveedor.
 */
function SubirComprobante({
  archivo,
  onCambio,
}: {
  archivo: File | null;
  onCambio: (f: File | null) => void;
}) {
  const pesoKb = archivo ? Math.round(archivo.size / 1024) : 0;
  return (
    <div>
      <p className="text-xs font-semibold text-neutral-500 uppercase mb-1.5">Comprobante</p>
      {archivo ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-3">
          <span className="text-lg" aria-hidden="true">
            📄
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-emerald-900 truncate">{archivo.name}</span>
            <span className="block text-xs text-emerald-700">
              {pesoKb >= 1024 ? `${(pesoKb / 1024).toFixed(1)} MB` : `${pesoKb} KB`} · listo para subir
            </span>
          </span>
          <button
            type="button"
            onClick={() => onCambio(null)}
            className="text-xs font-semibold text-emerald-800 border border-emerald-300 rounded-lg px-2.5 py-1.5 hover:bg-emerald-100"
          >
            Quitar
          </button>
        </div>
      ) : (
        <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 px-3.5 py-3 cursor-pointer hover:border-accent hover:bg-accent-tint">
          <span className="text-lg" aria-hidden="true">
            📎
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-neutral-800">
              Subir foto del remito o la factura
            </span>
            <span className="block text-xs text-neutral-500">
              Sacale una foto con el celular, o elegí un PDF. Es opcional, pero después no se puede recuperar.
            </span>
          </span>
          <span className="text-xs font-semibold text-white bg-accent rounded-lg px-3 py-1.5 whitespace-nowrap">
            Elegir archivo
          </span>
          <input
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => onCambio(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
}

function CampoPie({
  etiqueta,
  valor,
  onCambio,
  pista,
  efecto,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  pista?: string;
  efecto: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-neutral-500 mb-1">{etiqueta}</label>
      <input
        type="number"
        min={0}
        step="0.01"
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder="0,00"
        className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <p className="text-[11px] text-neutral-400 mt-1 leading-snug">
        {pista && `${pista} `}
        <b className="text-neutral-600">{efecto}</b>
      </p>
    </div>
  );
}

function Renglon({
  etiqueta,
  valor,
  fuerte,
  rojo,
}: {
  etiqueta: string;
  valor: number;
  fuerte?: boolean;
  rojo?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 py-1.5 text-sm tabular-nums ${
        fuerte ? "font-semibold border-t border-neutral-200 mt-1 pt-2" : ""
      }`}
    >
      <span className={fuerte ? "text-neutral-900" : "text-neutral-500"}>{etiqueta}</span>
      <span className={rojo ? "text-red-600 font-medium" : "text-neutral-900 font-medium"}>
        ${formatearMonto(Math.abs(valor))}
      </span>
    </div>
  );
}

/** La entrega que se está costeando: siempre va, no se puede destildar. */
function EntregaFija({ titulo, detalle, unidades }: { titulo: string; detalle: string; unidades: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-accent bg-accent-tint px-3.5 py-2.5">
      <span className="w-[18px] h-[18px] rounded-[5px] bg-accent border border-accent text-white flex items-center justify-center text-[11px] font-bold shrink-0">
        ✓
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-neutral-900">{titulo}</span>
        <span className="block text-xs text-neutral-400">{detalle}</span>
      </span>
      <span className="text-sm font-semibold tabular-nums text-neutral-700">{unidades} un.</span>
    </div>
  );
}
