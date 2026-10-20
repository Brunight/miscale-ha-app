import { expect, test } from "bun:test";

import { decide, type Member } from "../src/lib/identify";

const me = (w: number | null): Member => ({ deviceId: "me", name: "Bruno", lastWeightKg: w });
const ana: Member = { deviceId: "ana", name: "Ana", lastWeightKg: 61 };
const leo: Member = { deviceId: "leo", name: "Leo", lastWeightKg: 81 };

test("the owner is the clear closest match", () => {
  expect(decide(82, "me", [me(82.4), ana, leo])).toEqual({ kind: "close", rival: leo });
  expect(decide(83.5, "me", [me(83.8), ana, leo])).toEqual({ kind: "me" });
});

test("someone else is closer", () => {
  expect(decide(60.5, "me", [me(82.4), ana, leo])).toEqual({ kind: "other", closest: ana });
});

test("nobody within the tolerance", () => {
  expect(decide(120, "me", [me(82.4), ana, leo])).toEqual({ kind: "nobody" });
});

test("first weigh-in is the owner's unless it matches someone else", () => {
  expect(decide(95, "me", [me(null), ana, leo])).toEqual({ kind: "me" });
  expect(decide(95, "me", [ana])).toEqual({ kind: "me" });
  expect(decide(61.2, "me", [me(null), ana, leo])).toEqual({ kind: "other", closest: ana });
});

test("tolerance and margin are configurable", () => {
  expect(decide(88, "me", [me(82.4)], 5)).toEqual({ kind: "nobody" });
  expect(decide(88, "me", [me(82.4)], 6)).toEqual({ kind: "me" });
  expect(decide(82, "me", [me(82.4), leo], 5, 0.5)).toEqual({ kind: "me" });
});
