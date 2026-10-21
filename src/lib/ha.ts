/**
 * Home Assistant client: registers the phone with the mobile_app integration, writes
 * weigh-ins as mobile_app sensors and reads the household's latest weights.
 * https://developers.home-assistant.io/docs/api/native-app-integration
 */

import type { Metrics } from "./body";
import type { Member } from "./identify";
import type { Measurement } from "./session";

export const APP_ID = "io.miscale.ha";
export const APP_NAME = "Mi Scale";

export type Registration = {
  webhookId: string;
  cloudhookUrl: string | null;
  remoteUiUrl: string | null;
};

export type DeviceInfo = {
  deviceId: string;
  deviceName: string;
  appVersion: string;
  manufacturer: string;
  model: string;
  osVersion: string;
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class HAError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** HA answers 410 when the mobile_app entry was deleted: the phone must register again. */
export const isGone = (e: unknown) => e instanceof HAError && e.status === 410;

export const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, "");

type SensorDef = {
  key: keyof Metrics | "weight" | "impedance";
  name: string;
  unit?: string;
  deviceClass?: string;
  icon: string;
};

/** Every sensor the app creates. `key` is the unique_id suffix and the Metrics field. */
export const SENSORS: SensorDef[] = [
  { key: "weight", name: "Weight", unit: "kg", deviceClass: "weight", icon: "mdi:scale-bathroom" },
  { key: "impedance", name: "Impedance", unit: "Ω", icon: "mdi:omega" },
  { key: "bmi", name: "BMI", icon: "mdi:human" },
  { key: "body_fat", name: "Body fat", unit: "%", icon: "mdi:percent" },
  { key: "fat_mass", name: "Fat mass", unit: "kg", deviceClass: "weight", icon: "mdi:scale-bathroom" },
  { key: "lean_mass", name: "Lean mass", unit: "kg", deviceClass: "weight", icon: "mdi:scale-bathroom" },
  { key: "muscle_mass", name: "Muscle mass", unit: "kg", deviceClass: "weight", icon: "mdi:arm-flex" },
  { key: "bone_mass", name: "Bone mass", unit: "kg", deviceClass: "weight", icon: "mdi:bone" },
  { key: "water", name: "Body water", unit: "%", icon: "mdi:water-percent" },
  { key: "protein", name: "Protein", unit: "%", icon: "mdi:food-steak" },
  { key: "visceral_fat", name: "Visceral fat", icon: "mdi:stomach" },
  { key: "bmr", name: "Basal metabolism", unit: "kcal", icon: "mdi:fire" },
];

const uniqueId = (key: string) => `miscale_${key}`;

/** Attributes that let every phone find the household's weight sensors in /api/states. */
const weightAttributes = (person: string, deviceId: string) => ({
  miscale_metric: "weight",
  miscale_person: person,
  miscale_device: deviceId,
});

/** A fixed long-lived token, or a function returning a fresh access token (see auth.ts). */
export type Credential = string | (() => Promise<string>);

export class HomeAssistant {
  constructor(
    readonly baseUrl: string,
    private token: Credential,
    private fetchFn: Fetch = (url, init) => fetch(url, init),
  ) {
    this.baseUrl = normalizeUrl(baseUrl);
  }

  private async request(url: string, init: RequestInit, auth: boolean): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth) headers.Authorization = `Bearer ${typeof this.token === "string" ? this.token : await this.token()}`;
    const res = await this.fetchFn(url, { ...init, headers });
    if (!res.ok) {
      const hint =
        res.status === 401
          ? "Home Assistant refused the login or token"
          : res.status === 404 && url.includes("mobile_app")
            ? "the mobile_app integration isn't loaded (add default_config or mobile_app)"
            : res.status === 410
              ? "this phone's registration was deleted in Home Assistant"
              : `HTTP ${res.status}`;
      throw new HAError(hint, res.status);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /** Checks the URL and token. */
  async ping(): Promise<void> {
    await this.request(`${this.baseUrl}/api/`, { method: "GET" }, true);
  }

  async register(device: DeviceInfo): Promise<Registration> {
    const body = {
      device_id: device.deviceId,
      app_id: APP_ID,
      app_name: APP_NAME,
      app_version: device.appVersion,
      device_name: device.deviceName,
      manufacturer: device.manufacturer,
      model: device.model,
      os_name: "Android",
      os_version: device.osVersion,
      supports_encryption: false,
      app_data: {},
    };
    const res = (await this.request(
      `${this.baseUrl}/api/mobile_app/registrations`,
      { method: "POST", body: JSON.stringify(body) },
      true,
    )) as { webhook_id: string; cloudhook_url?: string | null; remote_ui_url?: string | null };
    return {
      webhookId: res.webhook_id,
      cloudhookUrl: res.cloudhook_url ?? null,
      remoteUiUrl: res.remote_ui_url ?? null,
    };
  }

  /** The webhook URLs to try, in the order HA's docs recommend. */
  webhookUrls(reg: Registration): string[] {
    const urls: string[] = [];
    if (reg.cloudhookUrl) urls.push(reg.cloudhookUrl);
    if (reg.remoteUiUrl) urls.push(`${normalizeUrl(reg.remoteUiUrl)}/api/webhook/${reg.webhookId}`);
    urls.push(`${this.baseUrl}/api/webhook/${reg.webhookId}`);
    return urls;
  }

  private async webhook(reg: Registration, type: string, data: unknown): Promise<unknown> {
    let last: unknown;
    for (const url of this.webhookUrls(reg)) {
      try {
        return await this.request(url, { method: "POST", body: JSON.stringify({ type, data }) }, false);
      } catch (e) {
        // A deleted registration is gone on every URL; anything else may work on the next one.
        if (isGone(e)) throw e;
        last = e;
      }
    }
    throw last;
  }

  /** Creates (or updates) every sensor. Safe to call again, e.g. after a rename. */
  async registerSensors(reg: Registration, person: string, deviceId: string): Promise<void> {
    for (const s of SENSORS) {
      await this.webhook(reg, "register_sensor", {
        type: "sensor",
        unique_id: uniqueId(s.key),
        name: s.name,
        state: null,
        icon: s.icon,
        state_class: "measurement",
        ...(s.unit && { unit_of_measurement: s.unit }),
        ...(s.deviceClass && { device_class: s.deviceClass }),
        ...(s.key === "weight" && { attributes: weightAttributes(person, deviceId) }),
      });
    }
  }

  /** Writes one weigh-in. Body composition sensors are only updated when they were computed. */
  async sendMeasurement(
    reg: Registration,
    person: string,
    deviceId: string,
    m: Measurement,
    metrics: Metrics,
  ): Promise<void> {
    const common = { measured_at: m.measuredAt.toISOString(), scale_time: m.scaleTime };
    const values: Record<string, number | null | undefined> = { ...metrics, weight: m.weightKg, impedance: m.impedance };
    const updates = SENSORS.filter((s) => values[s.key] != null).map((s) => ({
      type: "sensor",
      unique_id: uniqueId(s.key),
      state: values[s.key],
      icon: s.icon,
      attributes: s.key === "weight" ? { ...common, ...weightAttributes(person, deviceId) } : common,
    }));
    const res = (await this.webhook(reg, "update_sensor_states", updates)) as Record<
      string,
      { success: boolean; error?: { code: string; message: string } }
    > | null;
    const failed = Object.entries(res ?? {}).filter(([, r]) => !r.success);
    if (failed.some(([, r]) => r.error?.code === "not_registered")) {
      // Sensors deleted in HA (or never created): create them and try once more.
      await this.registerSensors(reg, person, deviceId);
      await this.webhook(reg, "update_sensor_states", updates);
    } else if (failed.length) {
      throw new HAError(failed.map(([id, r]) => `${id}: ${r.error?.message ?? "failed"}`).join("; "));
    }
  }

  /** Every household member's latest weight, found by the attributes on their weight sensor. */
  async household(): Promise<Member[]> {
    const states = (await this.request(`${this.baseUrl}/api/states`, { method: "GET" }, true)) as {
      state: string;
      attributes: Record<string, unknown>;
    }[];
    return states
      .filter((s) => s.attributes?.miscale_metric === "weight" && typeof s.attributes.miscale_device === "string")
      .map((s) => {
        const w = Number.parseFloat(s.state);
        return {
          deviceId: s.attributes.miscale_device as string,
          name: String(s.attributes.miscale_person ?? "?"),
          lastWeightKg: Number.isFinite(w) ? w : null,
        };
      });
  }
}
