import { expect, test } from "bun:test";

import { parse } from "../src/lib/packet";
import { Session } from "../src/lib/session";
import { packet } from "./packets";

function setup() {
  const clock = { t: new Date(2026, 9, 12, 7, 30) };
  const session = new Session(() => clock.t);
  const tick = (ms: number) => (clock.t = new Date(clock.t.getTime() + ms));
  return { session, tick };
}

const reading = (weight: number, opts: Parameters<typeof packet>[1] = {}, address = "AA:BB:CC:DD:EE:FF") => ({
  ...parse(packet(weight, opts))!,
  address,
});

test("a full weigh-in becomes one measurement", () => {
  const { session, tick } = setup();
  expect(session.handle(reading(81.5))).toBeNull(); // still settling
  const started = session.handle(reading(81.6, { stabilized: true }))!;
  expect(started.event).toBe("started");
  expect(started.measurement.impedance).toBeNull();
  tick(3000);
  const imp = session.handle(reading(81.6, { impedance: 480, stabilized: true }))!;
  expect(imp.event).toBe("impedance");
  expect(imp.measurement.impedance).toBe(480);
  expect(imp.measurement.measuredAt).toEqual(started.measurement.measuredAt);
  tick(5000);
  expect(session.handle(reading(81.6, { impedance: 480, stabilized: true, removed: true }))).toBeNull();
});

test("an old result repeated after the app opens is ignored", () => {
  const { session } = setup();
  expect(session.handle(reading(81.6, { impedance: 480, stabilized: true, removed: true }))).toBeNull();
});

test("a new weigh-in after the window, or with another weight, starts again", () => {
  const { session, tick } = setup();
  session.handle(reading(81.6, { stabilized: true }));
  tick(10_000);
  expect(session.handle(reading(60.2, { stabilized: true }))!.event).toBe("started");
  tick(4 * 60_000);
  expect(session.handle(reading(60.2, { stabilized: true, impedance: 500 }))!.event).toBe("started");
});
