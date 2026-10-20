import { Link, Redirect, Stack } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useScale, type ScanStatus } from "@/hooks/useScale";
import { useSettings } from "@/hooks/useSettings";
import { useWeighIn, type Phase } from "@/hooks/useWeighIn";
import type { Metrics } from "@/lib/body";
import type { Registration } from "@/lib/ha";
import { isConfigured, type Settings } from "@/lib/settings";

export default function Index() {
  const { settings, loaded } = useSettings();
  if (!loaded) return <ActivityIndicator style={styles.center} />;
  if (!isConfigured(settings)) return <Redirect href="/settings" />;
  return <Weigh settings={settings} />;
}

const STATUS_TEXT: Record<ScanStatus, string> = {
  starting: "Starting Bluetooth…",
  scanning: "Step on the scale",
  "bluetooth-off": "Turn Bluetooth on to weigh in",
  denied: "Bluetooth permission denied. Allow Nearby devices for this app in Android settings.",
  error: "Bluetooth scan failed",
};

function Weigh({ settings }: { settings: Settings & { registration: Registration } }) {
  const { state, onEvent, confirm, discard } = useWeighIn(settings);
  const { status, error, live } = useScale(settings.scaleAddress, onEvent);

  // While the scale settles, show its live weight; afterwards, the measurement's.
  const settling = live && !live.stabilized && !live.removed;
  const weight = settling ? live.weightKg : "m" in state ? state.m.weightKg : null;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" style={styles.link}>
              Settings
            </Link>
          ),
        }}
      />
      <Text style={styles.hello}>{settings.name}</Text>
      <Text style={[styles.weight, settling && styles.settling]}>{weight != null ? `${weight.toFixed(1)} kg` : "–"}</Text>
      <PhaseView state={state} status={status} error={error} settling={Boolean(settling)} confirm={confirm} discard={discard} />
      {"metrics" in state && <MetricsTable metrics={state.metrics} impedance={state.m.impedance} />}
      {live && !settings.scaleAddress && <Text style={styles.note}>Scale address: {live.address}</Text>}
    </View>
  );
}

function PhaseView(props: {
  state: Phase;
  status: ScanStatus;
  error: string | null;
  settling: boolean;
  confirm: () => void;
  discard: () => void;
}) {
  const { state, status, error, settling } = props;
  if (settling) return <Text style={styles.message}>Measuring…</Text>;
  switch (state.phase) {
    case "idle":
      return <Text style={styles.message}>{status === "error" && error ? `${STATUS_TEXT.error}: ${error}` : STATUS_TEXT[status]}</Text>;
    case "measuring":
      return <Text style={styles.message}>Stay barefoot on the scale for body composition…</Text>;
    case "sending":
      return <Text style={styles.message}>Sending to Home Assistant…</Text>;
    case "saved":
      return <Text style={[styles.message, styles.ok]}>Saved to Home Assistant ✓</Text>;
    case "discarded":
      return <Text style={styles.message}>Not saved</Text>;
    case "error":
      return (
        <View style={styles.ask}>
          <Text style={[styles.message, styles.bad]}>{`Couldn't save: ${state.message}`}</Text>
          <Button title="Try again" onPress={props.confirm} />
        </View>
      );
    case "ask": {
      const d = state.decision;
      const question =
        d.kind === "other"
          ? `This looks like ${d.closest.name}'s weight. Save it as yours?`
          : d.kind === "close"
            ? `This could also be ${d.rival.name}. Save it as yours?`
            : "This is far from your last weight. Save it as yours?";
      return (
        <View style={styles.ask}>
          <Text style={styles.message}>{question}</Text>
          <View style={styles.row}>
            <Button title="Save as mine" onPress={props.confirm} />
            <Button title="Not me" onPress={props.discard} secondary />
          </View>
        </View>
      );
    }
  }
}

const ROWS: [keyof Metrics, string, string][] = [
  ["bmi", "BMI", ""],
  ["body_fat", "Body fat", "%"],
  ["muscle_mass", "Muscle", "kg"],
  ["water", "Water", "%"],
  ["bone_mass", "Bone", "kg"],
  ["protein", "Protein", "%"],
  ["visceral_fat", "Visceral fat", ""],
  ["bmr", "BMR", "kcal"],
];

function MetricsTable({ metrics, impedance }: { metrics: Metrics; impedance: number | null }) {
  return (
    <View style={styles.table}>
      {ROWS.filter(([k]) => metrics[k] != null).map(([k, label, unit]) => (
        <View key={k} style={styles.tableRow}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value}>
            {metrics[k]} {unit}
          </Text>
        </View>
      ))}
      {!impedance && <Text style={styles.note}>No impedance: body composition needs bare feet.</Text>}
    </View>
  );
}

function Button({ title, onPress, secondary }: { title: string; onPress: () => void; secondary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, secondary && styles.buttonSecondary]}>
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  container: { flex: 1, alignItems: "center", padding: 24, gap: 12, backgroundColor: "#fff" },
  link: { color: "#0a66c2", fontSize: 16 },
  hello: { fontSize: 18, color: "#555" },
  weight: { fontSize: 72, fontWeight: "700", fontVariant: ["tabular-nums"] },
  settling: { color: "#999" },
  message: { fontSize: 17, textAlign: "center" },
  ok: { color: "#1a7f37" },
  bad: { color: "#cf222e" },
  ask: { alignItems: "center", gap: 12 },
  row: { flexDirection: "row", gap: 12 },
  button: { backgroundColor: "#0a66c2", paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  buttonSecondary: { backgroundColor: "#eee" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  buttonTextSecondary: { color: "#222" },
  table: { alignSelf: "stretch", marginTop: 16 },
  tableRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderColor: "#eee" },
  label: { fontSize: 16, color: "#555" },
  value: { fontSize: 16, fontWeight: "600" },
  note: { marginTop: 8, color: "#777", textAlign: "center" },
});
