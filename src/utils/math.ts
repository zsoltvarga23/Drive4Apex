/** Small math helpers shared across systems. */

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Frame-rate independent exponential smoothing.
 * `rate` ≈ how quickly the value converges (higher = snappier).
 */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

/** Wrap an angle to [-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Positive modulo. */
export const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** Format seconds as M:SS.cc for race timers. */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '--:--.--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const c = Math.floor((seconds * 100) % 100);
  return `${m}:${s.toString().padStart(2, '0')}.${c.toString().padStart(2, '0')}`;
}

/** Ordinal suffix for race positions: 1st, 2nd, 3rd… */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
