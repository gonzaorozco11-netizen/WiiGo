// Un timbre corto para los avisos de la tablet (pedidos nuevos, clientes
// esperando para pagar). Dos notas: se escucha pero no asusta. Sin sonido
// (navegador que no lo deja, tablet en silencio) igual queda el cartel.
export function sonarTimbre() {
  try {
    const Contexto = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Contexto) return;
    const ctx = new Contexto();
    [880, 1175].forEach((frecuencia, i) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.frequency.value = frecuencia;
      osc.connect(vol);
      vol.connect(ctx.destination);
      const inicio = ctx.currentTime + i * 0.22;
      vol.gain.setValueAtTime(0.0001, inicio);
      vol.gain.exponentialRampToValueAtTime(0.25, inicio + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.2);
      osc.start(inicio);
      osc.stop(inicio + 0.21);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    // Sin sonido igual queda el cartel.
  }
}
