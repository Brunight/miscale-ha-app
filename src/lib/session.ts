import type { Reading } from "./packet";

/** One weigh-in, built from the packets the scale sends while someone stands on it. */
export type Measurement = {
  address: string;
  measuredAt: Date;
  scaleTime: string | null;
  weightKg: number;
  impedance: number | null;
  raw: string;
};

export type SessionEvent = { event: "started" | "impedance"; measurement: Measurement };

/**
 * Groups the packets of one weigh-in into a single measurement. A port of app/session.py,
 * keeping only the latest measurement in memory instead of a database.
 *
 * The scale sends the weight while it settles, then the stabilized weight and, a few
 * seconds later, the same packet with the impedance. It keeps advertising the result for
 * a while after the person steps off, and its clock ticks on every packet, so a
 * measurement is deduplicated by weight and arrival time, not by the scale's timestamp.
 */
export class Session {
  static WINDOW_MS = 3 * 60 * 1000;
  private last: Measurement | null = null;

  constructor(private now: () => Date = () => new Date()) {}

  handle(r: Reading): SessionEvent | null {
    if (!r.stabilized) return null;
    const now = this.now();
    const m = this.last;
    if (
      m &&
      m.address === r.address &&
      Math.abs(m.weightKg - r.weightKg) <= 0.1 &&
      now.getTime() - m.measuredAt.getTime() < Session.WINDOW_MS
    ) {
      if (r.impedance && !m.impedance) {
        this.last = { ...m, impedance: r.impedance, raw: r.raw };
        return { event: "impedance", measurement: this.last };
      }
      return null;
    }
    // An old result being repeated (e.g. the app was opened right after a weigh-in).
    if (r.removed) return null;
    this.last = {
      address: r.address,
      measuredAt: now,
      scaleTime: r.scaleTime,
      weightKg: r.weightKg,
      impedance: r.impedance,
      raw: r.raw,
    };
    return { event: "started", measurement: this.last };
  }
}
