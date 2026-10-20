/**
 * Reads the Xiaomi Mi Body Composition Scale 2 (XMTZC05HM) from its BLE advertisements.
 * A port of app/scale.py from miscale-dashboard.
 *
 * The scale needs no connection or pairing: while someone is standing on it, it advertises
 * the Body Composition service (0x181B) with 13 bytes of service data:
 *
 *     [0]     control byte 0  (bit 0: pounds)
 *     [1]     control byte 1  (bit 1: has impedance, bit 5: stabilized,
 *                              bit 6: date invalid, bit 7: person stepped off)
 *     [2:4]   year (little endian)
 *     [4..8]  month, day, hour, minute, second
 *     [9:11]  impedance in ohms (little endian)
 *     [11:13] weight (little endian; /200 for kg, /100 for pounds)
 */

export const BODY_COMPOSITION = "0000181b-0000-1000-8000-00805f9b34fb";
const LB = 0.45359237;

export type Reading = {
  address: string;
  rssi: number | null;
  raw: string;
  weightKg: number;
  impedance: number | null;
  stabilized: boolean;
  removed: boolean;
  scaleTime: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function toHex(data: Uint8Array): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Finds the scale's payload in a device's service data, whatever case or UUID length the OS uses. */
export function scalePayload(serviceData: Record<string, string> | null | undefined): string | null {
  if (!serviceData) return null;
  for (const [uuid, value] of Object.entries(serviceData)) {
    const u = uuid.toLowerCase();
    if (u === BODY_COMPOSITION || u === "181b") return value;
  }
  return null;
}

/** Decodes one advertisement payload, or returns null if it is not a scale packet. */
export function parse(data: Uint8Array): Reading | null {
  if (data.length !== 13) return null;
  const c0 = data[0];
  const c1 = data[1];
  const lbs = Boolean(c0 & 0x01);
  let weight = (data[11] | (data[12] << 8)) / (lbs ? 100 : 200);
  if (lbs) weight *= LB;
  let impedance: number | null = c1 & 0x02 ? data[9] | (data[10] << 8) : null;
  // While still measuring, the scale sends 0xfffe / 0xffff as impedance.
  if (impedance !== null && !(impedance > 0 && impedance < 3000)) impedance = null;
  let scaleTime: string | null = null;
  if (!(c1 & 0x40)) {
    const year = data[2] | (data[3] << 8);
    const [month, day, hour, minute, second] = data.slice(4, 9);
    const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    // Same validity check as Python's datetime(): reject dates that roll over.
    if (d.getUTCMonth() === month - 1 && d.getUTCDate() === day && hour < 24 && minute < 60 && second < 60) {
      scaleTime = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
    }
  }
  return {
    address: "",
    rssi: null,
    raw: toHex(data),
    weightKg: Math.round(weight * 100) / 100,
    impedance,
    stabilized: Boolean(c1 & 0x20),
    removed: Boolean(c1 & 0x80),
    scaleTime,
  };
}

/**
 * Filters advertisements down to new scale packets: only the configured scale (if any),
 * and only when the content changes, since Android repeats the same advertisement.
 */
export class PacketFilter {
  private lastRaw = new Map<string, string>();

  constructor(private address: string | null = null) {}

  handle(address: string, rssi: number | null, serviceData: Record<string, string> | null | undefined): Reading | null {
    const b64 = scalePayload(serviceData);
    if (!b64) return null;
    if (this.address && address.toUpperCase() !== this.address.toUpperCase()) return null;
    const reading = parse(fromBase64(b64));
    if (!reading) return null;
    reading.address = address;
    reading.rssi = rssi;
    if (this.lastRaw.get(address) === reading.raw) return null;
    this.lastRaw.set(address, reading.raw);
    return reading;
  }
}
