import RAPIER from '@dimforge/rapier3d-compat';

let pending: Promise<typeof RAPIER> | undefined;

/**
 * Rapier ships as WebAssembly and has to be initialised once per process
 * before any of its classes exist. Callers await this instead of importing the
 * module directly.
 */
export function loadRapier(): Promise<typeof RAPIER> {
  pending ??= RAPIER.init().then(() => RAPIER);
  return pending;
}

export type Rapier = typeof RAPIER;
