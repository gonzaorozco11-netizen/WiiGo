// Textos del llamado de atención y del apercibimiento por llegada tarde.
//
// Se arman una sola vez, cuando la persona ficha tarde, y se guardan tal
// cual en la tabla `sanciones`: lo que firmó tiene que poder leerse igual
// dentro de un año aunque cambien estos textos.
//
// Criterios (revisados con Gonzalo, 22/10/2026):
// - Las tardanzas se cuentan por mes. Las primeras son llamado de atención;
//   desde la N° APERCIBIMIENTO_DESDE (por defecto la 4ª), cada una es un
//   apercibimiento. "Podrá dar lugar": la sanción la decide la empresa.
// - El apercibimiento es SOLO por la tardanza de ese día. Las anteriores van
//   como antecedentes: una misma falta no se sanciona dos veces.
// - Sin artículos de ley ni plazos, y sin nombrar el presentismo.

export const MESES_SANCION = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ORDINAL = ["", "primera", "segunda", "tercera", "cuarta", "quinta", "sexta", "séptima", "octava", "novena", "décima"];

export const APERCIBIMIENTO_DESDE_DEFECTO = 4;

function fechaLarga(fecha: string) {
  const [a, m, d] = fecha.split("-").map(Number);
  return `${d} de ${MESES_SANCION[m - 1]} de ${a}`;
}
function fechaCorta(fecha: string) {
  return `${Number(fecha.slice(8, 10))}/${Number(fecha.slice(5, 7))}`;
}
const ordinal = (n: number) => ORDINAL[n] ?? `${n}ª`;

export type DatosTardanza = {
  empresa: string;
  ciudad: string;
  nombre: string;
  fecha: string; // AAAA-MM-DD
  horaIngreso: string; // HH:MM
  horaHorario: string; // HH:MM
  minutos: number;
  numeroEnMes: number;
  apercibimientoDesde: number;
};

export function textoLlamado(d: DatosTardanza) {
  const [a, m] = d.fecha.split("-").map(Number);
  return [
    `${d.ciudad}, ${fechaLarga(d.fecha)}`,
    `LLAMADO DE ATENCIÓN`,
    `A: ${d.nombre}`,
    `Por medio de la presente se le formula un llamado de atención por haber ingresado a su puesto de trabajo el día ${fechaLarga(d.fecha)} a las ${d.horaIngreso} h, con ${d.minutos} ${d.minutos === 1 ? "minuto" : "minutos"} de demora respecto de su horario de ingreso de las ${d.horaHorario} h, según el registro de fichaje del local.`,
    `Le recordamos que la puntualidad es una de las obligaciones de su trabajo y le pedimos que la cumpla. Se espera que esté en el local 5 minutos antes de su horario.`,
    `Esta es su ${ordinal(d.numeroEnMes)} llegada tarde de ${MESES_SANCION[m - 1]} de ${a}. Le informamos que, a partir de la ${ordinal(d.apercibimientoDesde)} llegada tarde del mes, cada una podrá dar lugar a un apercibimiento.`,
    d.empresa,
  ].join("\n\n");
}

export type Antecedente = { fecha: string; horaIngreso: string; minutos: number; tipo: "LLAMADO" | "APERCIBIMIENTO" | null };

export function textoApercibimiento(d: DatosTardanza, antecedentes: Antecedente[]) {
  const lineas = antecedentes.map((x) => {
    const que = x.tipo === "APERCIBIMIENTO" ? " (apercibimiento)" : x.tipo === "LLAMADO" ? " (llamado de atención)" : "";
    return `• ${fechaCorta(x.fecha)}: ingreso ${x.horaIngreso} h, ${x.minutos} ${x.minutos === 1 ? "minuto" : "minutos"} de demora${que}.`;
  });
  return [
    `${d.ciudad}, ${fechaLarga(d.fecha)}`,
    `APERCIBIMIENTO`,
    `A: ${d.nombre}`,
    `Por medio de la presente se le aplica un apercibimiento por haber ingresado a su puesto de trabajo el día ${fechaLarga(d.fecha)} a las ${d.horaIngreso} h, con ${d.minutos} ${d.minutos === 1 ? "minuto" : "minutos"} de demora respecto de su horario de ingreso de las ${d.horaHorario} h, según el registro de fichaje del local.`,
    ...(lineas.length > 0
      ? [`Para esta medida se tienen en cuenta como antecedentes las llegadas tarde que ya se le notificaron este mes:`, lineas.join("\n")]
      : []),
    `Esta conducta no cumple con su obligación de puntualidad. Le hacemos saber que, si se repite, la empresa podrá aplicar nuevas sanciones, de mayor gravedad, incluida la suspensión.`,
    d.empresa,
  ].join("\n\n");
}
