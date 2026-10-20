import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { SettingsProvider } from "@/hooks/useSettings";

export default function RootLayout() {
  return (
    <SettingsProvider>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: "Mi Scale" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </SettingsProvider>
  );
}
