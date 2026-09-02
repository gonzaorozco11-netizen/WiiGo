import https from "node:https";

// Los servidores de ARCA negocian TLS con parámetros Diffie-Hellman viejos
// (menos de 2048 bits). Node moderno los rechaza y la llamada muere con
// "dh key too small" antes de enviar nada.
//
// La solución es bajar el nivel de seguridad de OpenSSL a SECLEVEL=1, pero
// SOLO para estas conexiones: por eso no se toca la configuración global ni
// se usa el fetch general del sistema, sino un agente propio que se usa
// únicamente contra ARCA. El resto de la aplicación sigue con la seguridad
// completa.
//
// Esto NO desactiva la verificación del certificado del servidor: se sigue
// validando que del otro lado esté realmente ARCA.
const agenteArca = new https.Agent({
  ciphers: "DEFAULT:@SECLEVEL=1",
  keepAlive: true,
});

export type RespuestaSoap = { ok: boolean; status: number; texto: string };

export function postSoap(url: string, cuerpo: string, headers: Record<string, string>): Promise<RespuestaSoap> {
  return new Promise((resolve, reject) => {
    const destino = new URL(url);
    const pedido = https.request(
      {
        agent: agenteArca,
        protocol: destino.protocol,
        hostname: destino.hostname,
        port: destino.port || 443,
        path: destino.pathname + destino.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(cuerpo).toString() },
        timeout: 30000,
      },
      (respuesta) => {
        let datos = "";
        respuesta.setEncoding("utf8");
        respuesta.on("data", (parte) => (datos += parte));
        respuesta.on("end", () =>
          resolve({ ok: (respuesta.statusCode ?? 0) < 400, status: respuesta.statusCode ?? 0, texto: datos })
        );
      }
    );

    pedido.on("timeout", () => {
      pedido.destroy(new Error("ARCA no respondió en 30 segundos"));
    });
    pedido.on("error", reject);
    pedido.write(cuerpo);
    pedido.end();
  });
}
