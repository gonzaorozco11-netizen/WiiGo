// Comparar un código leído por el lector con uno guardado.
//
// - Sin los ceros de adelante: un envase de EEUU trae 12 dígitos (UPC-A) y
//   el lector puede mandarlo con un 0 adelante (EAN-13).
// - Con o sin el dígito verificador: algunos lectores vienen configurados
//   para no mandar el último número (el que controla que los demás estén
//   bien). Si lo leído no lo trae, se calcula y se prueba también así.
// Se usa en el tótem (que corre en un navegador de 2020: nada moderno acá).

/** El dígito verificador GS1 (EAN-8, UPC-A, EAN-13) de los números sin él. */
export function digitoVerificador(sinVerificador: string): number {
  let suma = 0;
  for (let i = 0; i < sinVerificador.length; i++) {
    // Desde la derecha: 3, 1, 3, 1…
    const d = Number(sinVerificador.charAt(sinVerificador.length - 1 - i));
    suma += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (suma % 10)) % 10;
}

function tieneVerificadorValido(codigo: string) {
  if (codigo.length !== 8 && codigo.length !== 12 && codigo.length !== 13) return false;
  return digitoVerificador(codigo.slice(0, -1)) === Number(codigo.charAt(codigo.length - 1));
}

/** Las formas en que puede estar guardado lo leído, sin los ceros de adelante. */
export function candidatosCodigo(leido: string): string[] {
  const digitos = String(leido || "").replace(/\D/g, "");
  if (!digitos) return [];
  const candidatos = [digitos.replace(/^0+/, "")];
  // Le falta el verificador: 7 (EAN-8), 11 (UPC-A) o 12 (EAN-13) números.
  if ((digitos.length === 7 || digitos.length === 11 || digitos.length === 12) && !tieneVerificadorValido(digitos)) {
    candidatos.push((digitos + digitoVerificador(digitos)).replace(/^0+/, ""));
  }
  return candidatos.filter((c) => c.length >= 6);
}

/** Si lo leído es este código guardado (con las tolerancias de arriba). */
export function esMismoCodigo(guardado: string | null | undefined, leido: string): boolean {
  if (!guardado) return false;
  const g = String(guardado).replace(/\D/g, "").replace(/^0+/, "");
  if (!g) return false;
  return candidatosCodigo(leido).indexOf(g) !== -1;
}
