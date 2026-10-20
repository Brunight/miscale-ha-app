import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import type { Registration } from "./ha";
import { DEFAULT_TOLERANCE_KG } from "./identify";

export type Settings = {
  haUrl: string;
  /** Long-lived access token of this person's own HA user. */
  token: string;
  name: string;
  heightCm: number;
  /** YYYY-MM-DD */
  birth: string;
  male: boolean;
  /** Only accept this scale (its MAC address). Null accepts any Mi Body Composition Scale 2. */
  scaleAddress: string | null;
  toleranceKg: number;
  /** Identifies this install in HA's mobile_app integration. */
  deviceId: string;
  registration: Registration | null;
};

const KEY = "miscale.settings";

export function emptySettings(): Settings {
  return {
    // Set EXPO_PUBLIC_HA_URL in .env to pre-fill it (read at build time).
    haUrl: process.env.EXPO_PUBLIC_HA_URL ?? "",
    token: "",
    name: "",
    heightCm: 170,
    birth: "",
    male: true,
    scaleAddress: null,
    toleranceKg: DEFAULT_TOLERANCE_KG,
    deviceId: Crypto.randomUUID(),
    registration: null,
  };
}

export const isConfigured = (s: Settings | null): s is Settings & { registration: Registration } =>
  Boolean(s?.registration && s.name && s.birth && s.heightCm);

export async function loadSettings(): Promise<Settings | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? { ...emptySettings(), ...JSON.parse(raw) } : null;
}

export async function saveSettings(s: Settings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}
