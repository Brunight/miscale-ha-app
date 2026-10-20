import * as Application from "expo-application";
import * as Device from "expo-device";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

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
  const [message, setMessage] = useState<string | null>(null);

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
    if (problem) return setMessage(problem);

    setBusy(true);
    setMessage("Connecting to Home Assistant…");
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
      setMessage(`Couldn't connect: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.section}>Home Assistant</Text>
      <Field label="URL" value={form.haUrl} onChange={(v) => set("haUrl", v)} placeholder="http://homeassistant.local:8123" url />
      <Field
        label="Long-lived access token"
        hint="Your HA profile › Security › Long-lived access tokens. Use your own HA user."
        value={form.token}
        onChange={(v) => set("token", v)}
        secret
      />

      <Text style={styles.section}>You</Text>
      <Field label="Name" value={form.name} onChange={(v) => set("name", v)} />
      <Field label="Height (cm)" value={height} onChange={setHeight} numeric />
      <Field label="Birth date" value={form.birth} onChange={(v) => set("birth", v)} placeholder="1990-01-31" />
      <View style={styles.switchRow}>
        <Text style={styles.label}>Sex for the formulas: {form.male ? "male" : "female"}</Text>
        <Switch value={form.male} onValueChange={(v) => set("male", v)} />
      </View>

      <Text style={styles.section}>Scale</Text>
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

      {message && <Text style={styles.message}>{message}</Text>}
      <Pressable onPress={onSave} disabled={busy} style={[styles.button, busy && styles.disabled]}>
        <Text style={styles.buttonText}>{busy ? "Connecting…" : "Save"}</Text>
      </Pressable>
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
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        keyboardType={props.numeric ? "decimal-pad" : props.url ? "url" : "default"}
        secureTextEntry={props.secret}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {props.hint && <Text style={styles.hint}>{props.hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, backgroundColor: "#fff" },
  section: { fontSize: 20, fontWeight: "700", marginTop: 8 },
  field: { gap: 4 },
  label: { fontSize: 15, color: "#333" },
  hint: { fontSize: 13, color: "#777" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  message: { fontSize: 15, color: "#cf222e" },
  button: { backgroundColor: "#0a66c2", padding: 14, borderRadius: 8, alignItems: "center", marginTop: 8 },
  disabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "600" },
});
