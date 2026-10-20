/** Builds scale advertisements the way the Mi Body Composition Scale 2 sends them (port of tests/packets.py). */
export function packet(
  weightKg: number,
  opts: {
    impedance?: number;
    stabilized?: boolean;
    removed?: boolean;
    lbs?: boolean;
    when?: [number, number, number, number, number, number];
    impedanceRaw?: number;
  } = {},
): Uint8Array {
  const { impedance, stabilized, removed, lbs, impedanceRaw } = opts;
  const [year, month, day, hour, minute, second] = opts.when ?? [2026, 10, 12, 7, 30, 0];
  const c0 = 0x02 | (lbs ? 0x01 : 0);
  let c1 = 0x04;
  if (impedance !== undefined || impedanceRaw !== undefined) c1 |= 0x02;
  if (stabilized) c1 |= 0x20;
  if (removed) c1 |= 0x80;
  const imp = impedanceRaw ?? impedance ?? 0;
  const w = lbs ? Math.round((weightKg / 0.45359237) * 100) : Math.round(weightKg * 200);
  return Uint8Array.from([c0, c1, year & 0xff, year >> 8, month, day, hour, minute, second, imp & 0xff, imp >> 8, w & 0xff, w >> 8]);
}

export const b64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
