/**
 * Algoritmo Mulberry32 — PRNG (Pseudo-Random Number Generator) determinístico.
 *
 * Dado el mismo seed (entero de 32 bits), produce exactamente la misma secuencia
 * de números pseudo-aleatorios en [0, 1). Esto permite que ambos jugadores en
 * una partida multijugador generen el mismo layout de obstáculos sin necesidad
 * de sincronización adicional.
 *
 * @param seed - Semilla entera (se recomienda un entero de 32 bits)
 * @returns Una función que, cada vez que se invoca, retorna un número en [0, 1)
 *
 * @example
 * const rng = seededRandom(12345);
 * const a = rng(); // ≈ 0.175
 * const b = rng(); // ≈ 0.831
 */
export function seededRandom(seed: number): () => number {
  let s = seed | 0; // asegurar entero de 32 bits
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
