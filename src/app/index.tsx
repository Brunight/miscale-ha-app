import { Link, Redirect, Stack } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useScale, type ScanStatus } from "@/hooks/useScale";
import { useSettings } from "@/hooks/useSettings";
import { useWeighIn, type Phase } from "@/hooks/useWeighIn";
import type { Metrics } from "@/lib/body";
import type { Registration } from "@/lib/ha";
import { isConfigured, type Settings } from "@/lib/settings";

export default function Index() {
  const { settings, loaded } = useSettings();
  if (!loaded) return <ActivityIndicator className="flex-1" />;
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
    <View className="flex-1 items-center gap-3 bg-white p-6">
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable>
                <Text className="text-base text-[#0a66c2]">Settings</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <Text className="text-lg text-neutral-600">{settings.name}</Text>
      <Text className={`text-7xl font-bold tabular-nums ${settling ? "text-neutral-400" : ""}`}>{weight != null ? `${weight.toFixed(1)} kg` : "–"}</Text>
      <PhaseView state={state} status={status} error={error} settling={Boolean(settling)} confirm={confirm} discard={discard} />
      {"metrics" in state && <MetricsTable metrics={state.metrics} impedance={state.m.impedance} />}
      {live && !settings.scaleAddress && <Text className="mt-2 text-center text-neutral-500">Scale address: {live.address}</Text>}
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
  if (settling) return <Text className="text-center text-[17px]">Measuring…</Text>;
  switch (state.phase) {
    case "idle":
      return <Text className="text-center text-[17px]">{status === "error" && error ? `${STATUS_TEXT.error}: ${error}` : STATUS_TEXT[status]}</Text>;
    case "measuring":
      return <Text className="text-center text-[17px]">Stay barefoot on the scale for body composition…</Text>;
    case "sending":
      return <Text className="text-center text-[17px]">Sending to Home Assistant…</Text>;
    case "saved":
      return <Text className="text-center text-[17px] text-green-700">Saved to Home Assistant ✓</Text>;
    case "discarded":
      return <Text className="text-center text-[17px]">Not saved</Text>;
    case "error":
      return (
        <View className="items-center gap-3">
          <Text className="text-center text-[17px] text-red-600">{`Couldn't save: ${state.message}`}</Text>
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
        <View className="items-center gap-3">
          <Text className="text-center text-[17px]">{question}</Text>
          <View className="flex-row gap-3">
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
    <View className="mt-4 self-stretch">
      {ROWS.filter(([k]) => metrics[k] != null).map(([k, label, unit]) => (
        <View key={k} className="flex-row justify-between border-b border-neutral-200 py-2">
          <Text className="text-base text-neutral-600">{label}</Text>
          <Text className="text-base font-semibold">
            {metrics[k]} {unit}
          </Text>
        </View>
      ))}
      {!impedance && <Text className="mt-2 text-center text-neutral-500">No impedance: body composition needs bare feet.</Text>}
    </View>
  );
}

function Button({ title, onPress, secondary }: { title: string; onPress: () => void; secondary?: boolean }) {
  return (
    <Pressable onPress={onPress} className={`rounded-lg px-5 py-3 ${secondary ? "bg-neutral-200" : "bg-[#0a66c2]"}`}>
      <Text className={`text-base font-semibold ${secondary ? "text-neutral-800" : "text-white"}`}>{title}</Text>
    </Pressable>
  );
}
