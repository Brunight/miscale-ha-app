import * as Application from "expo-application";
import * as Device from "expo-device";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSettings } from "@/hooks/useSettings";
import { HomeAssistant, isGone, normalizeUrl } from "@/lib/ha";
import { emptySettings, type Settings } from "@/lib/settings";

const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

export default function SettingsScreen() {
  const { settings, save } = useSettings();
  const [form, setForm] = useState<Settings>(() => settings ?? emptySettings());
  const [height, setHeight] = useState(String(form.heightCm));
  const [tolerance, setTolerance] = useState(String(form.toleranceKg));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const insets = useSafeAreaInsets();

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function onSave() {
    const s: Settings = {
      ...form,
      haUrl: normalizeUrl(form.haUrl),
      token: form.token.trim(),
      name: form.name.trim(),
      heightCm: Number(height),
      toleranceKg: Number(tolerance),
      scaleAddress: form.scaleAddress?.trim().toUpperCase() || null,
    };
    const problem = !/^https?:\/\//.test(s.haUrl)
      ? "Home Assistant URL must start with http:// or https://"
      : !s.token
        ? "Paste a long-lived access token"
        : !s.name
          ? "Enter your name"
          : !(s.heightCm > 50 && s.heightCm < 250)
            ? "Height must be in cm"
            : !/^\d{4}-\d{2}-\d{2}$/.test(s.birth)
              ? "Birth date must be YYYY-MM-DD"
              : !(s.toleranceKg > 0)
                ? "Tolerance must be a positive number"
                : s.scaleAddress && !MAC.test(s.scaleAddress)
                  ? "Scale address must look like AA:BB:CC:DD:EE:FF"
                  : null;
    if (problem) return setMessage({ text: problem, error: true });

    setBusy(true);
    setMessage({ text: "Connecting to Home Assistant…", error: false });
    try {
      const ha = new HomeAssistant(s.haUrl, s.token);
      await ha.ping();
      // A new server needs a new registration; the same one keeps its device and history.
      const sameServer = settings?.registration && settings.haUrl === s.haUrl;
      const device = {
        deviceId: s.deviceId,
        deviceName: `Mi Scale ${s.name}`,
        appVersion: Application.nativeApplicationVersion ?? "dev",
        manufacturer: Device.manufacturer ?? "Android",
        model: Device.modelName ?? "Android",
        osVersion: Device.osVersion ?? "",
      };
      s.registration = sameServer ? settings.registration : await ha.register(device);
      try {
        await ha.registerSensors(s.registration!, s.name, s.deviceId);
      } catch (e) {
        if (!isGone(e)) throw e;
        // The device was deleted in HA: register again.
        s.registration = await ha.register(device);
        await ha.registerSensors(s.registration, s.name, s.deviceId);
      }
      await save(s);
      router.replace("/");
    } catch (e) {
      setMessage({ text: `Couldn't connect: ${e instanceof Error ? e.message : String(e)}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      className="bg-white dark:bg-neutral-950"
      contentContainerClassName="gap-3 p-5"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="mt-2 text-xl font-bold text-neutral-900 dark:text-neutral-100">Home Assistant</Text>
      <Field label="URL" value={form.haUrl} onChange={(v) => set("haUrl", v)} placeholder="http://homeassistant.local:8123" url />
      <Field
        label="Long-lived access token"
        hint="Your HA profile › Security › Long-lived access tokens. Use your own HA user."
        value={form.token}
        onChange={(v) => set("token", v)}
        secret
      />

      <Text className="mt-2 text-xl font-bold text-neutral-900 dark:text-neutral-100">You</Text>
      <Field label="Name" value={form.name} onChange={(v) => set("name", v)} />
      <Field label="Height (cm)" value={height} onChange={setHeight} numeric />
      <Field
        label="Birth date"
        hint="Year-month-day, e.g. 1990-01-31"
        value={form.birth}
        onChange={(v) => set("birth", v)}
        placeholder="YYYY-MM-DD"
      />
      <View className="flex-row items-center justify-between">
        <Text className="text-[15px] text-neutral-700 dark:text-neutral-300">Sex for the formulas: {form.male ? "male" : "female"}</Text>
        <Switch value={form.male} onValueChange={(v) => set("male", v)} />
      </View>

      <Text className="mt-2 text-xl font-bold text-neutral-900 dark:text-neutral-100">Scale</Text>
      <Field
        label="Scale address (optional)"
        hint="Only accept this scale. Shown on the main screen after a weigh-in."
        value={form.scaleAddress ?? ""}
        onChange={(v) => set("scaleAddress", v)}
        placeholder="AA:BB:CC:DD:EE:FF"
      />
      <Field
        label="Tolerance (kg)"
        hint="A weigh-in farther than this from your last weight asks before saving."
        value={tolerance}
        onChange={setTolerance}
        numeric
      />

      {message && (
        <Text className={`text-[15px] ${message.error ? "text-red-600 dark:text-red-400" : "text-neutral-600 dark:text-neutral-400"}`}>
          {message.text}
        </Text>
      )}
      <Pressable onPress={onSave} disabled={busy} className={`mt-2 items-center rounded-lg bg-[#0a66c2] p-3.5 ${busy ? "opacity-60" : ""}`}>
        <Text className="text-[17px] font-semibold text-white">{busy ? "Connecting…" : "Save"}</Text>
      </Pressable>
      {/* Keeps the button above Android's navigation bar (the app draws edge to edge). */}
      <View style={{ height: insets.bottom }} />
    </ScrollView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
  numeric?: boolean;
  secret?: boolean;
  url?: boolean;
}) {
  const dark = useColorScheme() === "dark";
  return (
    <View className="gap-1">
      <Text className="text-[15px] text-neutral-700 dark:text-neutral-300">{props.label}</Text>
      <TextInput
        className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base text-neutral-900 dark:border-neutral-700 dark:text-neutral-100"
        placeholderTextColor={dark ? "#737373" : "#a3a3a3"}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        keyboardType={props.numeric ? "decimal-pad" : props.url ? "url" : "default"}
        secureTextEntry={props.secret}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {props.hint && <Text className="text-[13px] text-neutral-500 dark:text-neutral-400">{props.hint}</Text>}
    </View>
  );
}
