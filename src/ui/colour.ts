/** A 0xRRGGBB colour as a CSS hex string. */
export function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

/**
 * Dark or light text, whichever reads better on the given background.
 *
 * Player colours run from a pale yellow to a deep blue, so a single text
 * colour is unreadable on some of them. This picks by the background's
 * perceived brightness.
 */
export function inkOn(colour: number): string {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? '#1a1408' : '#fbf7ee';
}
