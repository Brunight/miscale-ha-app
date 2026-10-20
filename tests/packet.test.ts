import { describe, expect, test } from "bun:test";

import { BODY_COMPOSITION, PacketFilter, parse, scalePayload } from "../src/lib/packet";
import { b64, packet } from "./packets";

describe("parse", () => {
  test("settling weight", () => {
    const r = parse(packet(82.8))!;
    expect(r.weightKg).toBe(82.8);
    expect(r.stabilized).toBe(false);
    expect(r.removed).toBe(false);
    expect(r.impedance).toBeNull();
    expect(r.scaleTime).toBe("2026-10-12T07:30:00");
  });

  test("stabilized with impedance", () => {
    const r = parse(packet(82.8, { impedance: 480, stabilized: true }))!;
    expect(r.stabilized).toBe(true);
    expect(r.impedance).toBe(480);
  });

  test("impedance still being measured is ignored", () => {
    expect(parse(packet(82.8, { stabilized: true, impedanceRaw: 0xfffe }))!.impedance).toBeNull();
  });

  test("pounds", () => {
    expect(Math.abs(parse(packet(82.8, { lbs: true, stabilized: true }))!.weightKg - 82.8)).toBeLessThan(0.01);
  });

  test("removed, wrong length and invalid date", () => {
    expect(parse(packet(70, { impedance: 500, stabilized: true, removed: true }))!.removed).toBe(true);
    expect(parse(new Uint8Array(12))).toBeNull();
    expect(parse(packet(70, { when: [2026, 2, 30, 7, 0, 0] }))!.scaleTime).toBeNull();
  });
});

test("scalePayload accepts any UUID casing and the short form", () => {
  expect(scalePayload({ [BODY_COMPOSITION.toUpperCase()]: "x" })).toBe("x");
  expect(scalePayload({ "181B": "y" })).toBe("y");
  expect(scalePayload({ "0000fe95-0000-1000-8000-00805f9b34fb": "z" })).toBeNull();
  expect(scalePayload(null)).toBeNull();
});

test("PacketFilter dedupes and filters by address", () => {
  const filter = new PacketFilter("aa:bb:cc:dd:ee:ff");
  const data = { [BODY_COMPOSITION]: b64(packet(70, { stabilized: true })) };
  const first = filter.handle("AA:BB:CC:DD:EE:FF", -60, data);
  expect(first?.address).toBe("AA:BB:CC:DD:EE:FF");
  expect(first?.rssi).toBe(-60);
  expect(filter.handle("AA:BB:CC:DD:EE:FF", -61, data)).toBeNull(); // same advertisement repeated
  expect(filter.handle("11:22:33:44:55:66", -60, data)).toBeNull(); // another scale
  expect(filter.handle("AA:BB:CC:DD:EE:FF", -60, { other: "AAAA" })).toBeNull();
});
