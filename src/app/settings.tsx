import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHaDiscovery } from "@/hooks/useHaDiscovery";
import { useSettings } from "@/hooks/useSettings";
import { authorizeUrl, base64url, codeFromRedirect, exchangeCode, pkce, REDIRECT_URI, revoke } from "@/lib/auth";
import { haFor, hasCredential, tokenSource } from "@/lib/client";
import { isGone, normalizeUrl } from "@/lib/ha";
import { emptySettings, type Settings } from "@/lib/settings";

const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

export default function SettingsScreen() {
  const { settings, save } = useSettings();
  const [form, setForm] = useState<Settings>(() => settings ?? emptySettings());
  const [height, setHeight] = useState(String(form.heightCm));
  const [tolerance, setTolerance] = useState(String(form.toleranceKg));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // Existing setups with a pasted token keep seeing it.
  const [advanced, setAdvanced] = useState(Boolean(form.token));
  const [searched, setSearched] = useState(false);
  const discovery = useHaDiscovery();
  const insets = useSafeAreaInsets();

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => ({ ...f, [key]: value }));
  // A login belongs to one server: changing the URL drops it.
  const setUrl = (haUrl: string) =>
    setForm((f) => ({
      ...f,
      haUrl,
      refreshToken: normalizeUrl(haUrl) === normalizeUrl(f.haUrl) ? f.refreshToken : null,
    }));

  async function onLogin() {
    const haUrl = normalizeUrl(form.haUrl);
    if (!/^https?:\/\//.test(haUrl)) return setMessage({ text: "Enter the Home Assistant URL first", error: true });
    setBusy(true);
    setMessage({ text: "Log in on the Home Assistant page…", error: false });
    try {
      const state = base64url(Crypto.getRandomBytes(16));
      const { verifier, challenge } = await pkce(
        Crypto.getRandomBytes(32),
        async (data) => new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data)),
      );
      const result = await WebBrowser.openAuthSessionAsync(authorizeUrl(haUrl, state, challenge), REDIRECT_URI);
      if (result.type !== "success") return setMessage({ text: "Login cancelled", error: true });
      const tokens = await exchangeCode(haUrl, codeFromRedirect(result.url, state), verifier);
      tokenSource(haUrl, tokens.refreshToken, tokens);
      setForm((f) => ({ ...f, haUrl, refreshToken: tokens.refreshToken }));
      setMessage({ text: "Logged in. Fill in the rest and save.", error: false });
    } catch (e) {
      setMessage({ text: `Couldn't log in: ${e instanceof Error ? e.message : String(e)}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  function onLogout() {
    if (form.refreshToken) revoke(form.haUrl, form.refreshToken).catch(() => {});
    set("refreshToken", null);
    setMessage(null);
  }

  function onFind() {
    setSearched(true);
    discovery.scan();
  }

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
      : !hasCredential(s)
        ? "Log in to Home Assistant"
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
      const ha = haFor(s);
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
      <Field label="URL" value={form.haUrl} onChange={setUrl} placeholder="http://192.168.0.10:8123" url />
      <SmallButton title={discovery.scanning ? "Searching…" : "Find on this network"} onPress={onFind} disabled={discovery.scanning} />
      {discovery.found.map((h) => (
        <Pressable
          key={h.url}
          onPress={() => setUrl(h.url)}
          className={`rounded-lg border p-3 ${normalizeUrl(form.haUrl) === h.url ? "border-[#0a66c2] dark:border-sky-400" : "border-neutral-300 dark:border-neutral-700"}`}
        >
          <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{h.name}</Text>
          <Text className="text-[13px] text-neutral-500 dark:text-neutral-400">
            {h.url}
            {h.version ? ` · ${h.version}` : ""}
          </Text>
        </Pressable>
      ))}
      {searched && !discovery.scanning && discovery.found.length === 0 && (
        <Text className="text-[13px] text-neutral-500 dark:text-neutral-400">
          {discovery.error ?? "No Home Assistant found. Is the phone on the same Wi-Fi?"}
        </Text>
      )}

      {form.refreshToken ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-[15px] text-green-700 dark:text-green-400">✓ Logged in to Home Assistant</Text>
          <SmallButton title="Log out" onPress={onLogout} />
        </View>
      ) : (
        <Pressable onPress={onLogin} disabled={busy} className={`items-center rounded-lg bg-[#0a66c2] p-3.5 ${busy ? "opacity-60" : ""}`}>
          <Text className="text-[17px] font-semibold text-white">Log in to Home Assistant</Text>
        </Pressable>
      )}
      <Pressable onPress={() => setAdvanced((a) => !a)}>
        <Text className="text-[15px] text-[#0a66c2] dark:text-sky-400">
          {advanced ? "Hide long-lived token" : "Use a long-lived token instead"}
        </Text>
      </Pressable>
      {advanced && (
        <Field
          label="Long-lived access token"
          hint="Your HA profile › Security › Long-lived access tokens. Only used when you aren't logged in."
          value={form.token}
          onChange={(v) => set("token", v)}
          secret
        />
      )}

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

function SmallButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`self-start rounded-lg bg-neutral-200 px-4 py-2 dark:bg-neutral-800 ${disabled ? "opacity-60" : ""}`}
    >
      <Text className="text-[15px] font-semibold text-neutral-800 dark:text-neutral-100">{title}</Text>
    </Pressable>
  );
}
