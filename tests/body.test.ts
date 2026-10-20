import { expect, test } from "bun:test";

import { ageOn, compute, type Metrics } from "../src/lib/body";

test("age", () => {
  expect(ageOn("1990-06-15", "2026-06-14")).toBe(35);
  expect(ageOn("1990-06-15", "2026-06-15")).toBe(36);
});

// Outputs of app/body.py in miscale-dashboard for the same inputs.
const REFERENCE: [Parameters<typeof compute>, Metrics][] = [
  [[80, 500, 178, "1990-01-01", true, "2026-01-01"], { bmi: 25.2, age: 36, bmr: 1619, visceral_fat: 14.8, body_fat: 24.5, fat_mass: 19.63, muscle_mass: 57.3, bone_mass: 3.08, water: 51.8, protein: 19.9, lean_mass: 60.37 }],
  [[60, 550, 165, "1995-05-05", false, "2026-01-01"], { bmi: 22.0, age: 30, bmr: 1226, visceral_fat: 1, body_fat: 30.9, fat_mass: 18.53, muscle_mass: 39.0, bone_mass: 2.47, water: 49.3, protein: 15.7, lean_mass: 41.47 }],
  [[45, 600, 158, "1960-07-20", false, "2026-10-20"], { bmi: 18.0, age: 66, bmr: 852, visceral_fat: 1, body_fat: 22.2, fat_mass: 9.98, muscle_mass: 33.22, bone_mass: 1.8, water: 53.4, protein: 20.4, lean_mass: 35.02 }],
  [[55, 450, 170, "2000-02-29", true, "2026-02-28"], { bmi: 19.0, age: 25, bmr: 1350, visceral_fat: 2.5, body_fat: 9.5, fat_mass: 5.23, muscle_mass: 47.19, bone_mass: 2.58, water: 62.1, protein: 23.7, lean_mass: 49.77 }],
  [[110, 420, 185, "1975-12-31", true, "2026-10-20"], { bmi: 32.1, age: 50, bmr: 1935, visceral_fat: 29.7, body_fat: 34.5, fat_mass: 37.94, muscle_mass: 68.38, bone_mass: 3.68, water: 46.8, protein: 15.4, lean_mass: 72.06 }],
  [[80, null, 178, "1990-01-01", true, "2026-01-01"], { bmi: 25.2, age: 36, bmr: 1619, visceral_fat: 14.8 }],
];

test.each(REFERENCE)("matches the Python version for %p", (args, expected) => {
  expect(compute(...args)).toEqual(expected);
});
