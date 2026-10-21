import { expect, test } from "bun:test";

import { HAError, HomeAssistant, isGone, SENSORS, type Registration } from "../src/lib/ha";
import type { Measurement } from "../src/lib/session";

type Call = { url: string; init: RequestInit; body: any };

function fakeFetch(responder: (url: string, body: any) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, init, body });
    const { status = 200, json = null } = responder(url, body);
    return new Response(json === null ? "" : JSON.stringify(json), { status });
  };
  return { fn, calls };
}

const reg: Registration = { webhookId: "hook", cloudhookUrl: null, remoteUiUrl: null };
const m: Measurement = {
  address: "AA",
  measuredAt: new Date("2026-10-20T07:30:00Z"),
  scaleTime: "2026-10-20T07:30:00",
  weightKg: 80,
  impedance: null,
  raw: "",
};

test("register sends the device and stores the webhook", async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 201, json: { webhook_id: "abc", cloudhook_url: null, remote_ui_url: null } }));
  const ha = new HomeAssistant("http://ha.local:8123/", "tok", fn);
  const r = await ha.register({ deviceId: "d1", deviceName: "Mi Scale Bruno", appVersion: "1", manufacturer: "x", model: "y", osVersion: "15" });
  expect(r).toEqual({ webhookId: "abc", cloudhookUrl: null, remoteUiUrl: null });
  expect(calls[0].url).toBe("http://ha.local:8123/api/mobile_app/registrations");
  expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  expect(calls[0].body.device_id).toBe("d1");
});

test("webhook URLs: cloudhook, then remote UI, then the instance", () => {
  const ha = new HomeAssistant("http://ha.local:8123", "tok");
  expect(ha.webhookUrls({ webhookId: "w", cloudhookUrl: "https://hooks.nabu.casa/x", remoteUiUrl: "https://r.ui.nabu.casa/" })).toEqual([
    "https://hooks.nabu.casa/x",
    "https://r.ui.nabu.casa/api/webhook/w",
    "http://ha.local:8123/api/webhook/w",
  ]);
});

test("falls back to the next webhook URL, but not after a 410", async () => {
  const two: Registration = { ...reg, cloudhookUrl: "https://cloud/x" };
  const ok = fakeFetch((url) => (url.startsWith("https://cloud") ? { status: 503 } : { json: {} }));
  await new HomeAssistant("http://ha", "t", ok.fn).sendMeasurement(two, "Bruno", "d1", m, { bmi: 25, age: 36, bmr: 1600, visceral_fat: 10 });
  expect(ok.calls.map((c) => c.url)).toEqual(["https://cloud/x", "http://ha/api/webhook/hook"]);

  const gone = fakeFetch(() => ({ status: 410 }));
  const err = await new HomeAssistant("http://ha", "t", gone.fn).sendMeasurement(two, "Bruno", "d1", m, { bmi: 25, age: 36, bmr: 1600, visceral_fat: 10 }).catch((e) => e);
  expect(isGone(err)).toBe(true);
  expect(gone.calls).toHaveLength(1);
});

test("sendMeasurement only sends what was measured, and tags the weight sensor", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: { miscale_weight: { success: true } } }));
  await new HomeAssistant("http://ha", "t", fn).sendMeasurement(reg, "Bruno", "d1", m, { bmi: 25.2, age: 36, bmr: 1619, visceral_fat: 14.8 });
  const { type, data } = calls[0].body;
  expect(type).toBe("update_sensor_states");
  expect(data.map((d: any) => d.unique_id).sort()).toEqual(["miscale_bmi", "miscale_bmr", "miscale_visceral_fat", "miscale_weight"]);
  const weight = data.find((d: any) => d.unique_id === "miscale_weight");
  expect(weight.state).toBe(80);
  expect(weight.attributes).toMatchObject({ miscale_metric: "weight", miscale_person: "Bruno", miscale_device: "d1", measured_at: "2026-10-20T07:30:00.000Z" });
});

test("sensors deleted in HA are registered again", async () => {
  let updates = 0;
  const { fn, calls } = fakeFetch((_, body) => {
    if (body.type !== "update_sensor_states") return { json: {} };
    updates++;
    return { json: updates === 1 ? { miscale_weight: { success: false, error: { code: "not_registered", message: "x" } } } : {} };
  });
  await new HomeAssistant("http://ha", "t", fn).sendMeasurement(reg, "Bruno", "d1", m, { bmi: 25, age: 36, bmr: 1600, visceral_fat: 10 });
  expect(calls.filter((c) => c.body.type === "register_sensor")).toHaveLength(SENSORS.length);
  expect(updates).toBe(2);
});

test("household reads every tagged weight sensor", async () => {
  const { fn } = fakeFetch(() => ({
    json: [
      { entity_id: "sensor.mi_scale_bruno_weight", state: "82.4", attributes: { miscale_metric: "weight", miscale_person: "Bruno", miscale_device: "d1" } },
      { entity_id: "sensor.mi_scale_ana_weight", state: "unknown", attributes: { miscale_metric: "weight", miscale_person: "Ana", miscale_device: "d2" } },
      { entity_id: "sensor.temperature", state: "16", attributes: {} },
    ],
  }));
  expect(await new HomeAssistant("http://ha", "t", fn).household()).toEqual([
    { deviceId: "d1", name: "Bruno", lastWeightKg: 82.4 },
    { deviceId: "d2", name: "Ana", lastWeightKg: null },
  ]);
});

test("errors explain the common causes", async () => {
  const { fn } = fakeFetch(() => ({ status: 401 }));
  const err = await new HomeAssistant("http://ha", "bad", fn).ping().catch((e) => e);
  expect(err).toBeInstanceOf(HAError);
  expect(err.message).toBe("Home Assistant refused the login or token");
});
