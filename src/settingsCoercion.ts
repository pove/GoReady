/**
 * Coerces a raw value (a form field, or whatever JSON.parse handed back from
 * localStorage) to a positive finite number, falling back otherwise. Shared
 * between the settings form's save path and localStorage's load path, so a
 * corrupted or hand-edited stored value can never end up as anything but a
 * real number in memory.
 */
export function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
