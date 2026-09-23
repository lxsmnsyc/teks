/**
 * Mulberry32. Small, fast and reproducible from a 32-bit seed, so the server
 * and the clients can agree on the launch jitter for a round.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value in [-1, 1). */
export function signed(rng: () => number): number {
  return rng() * 2 - 1;
}
