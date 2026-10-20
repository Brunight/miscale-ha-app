import "../global.css";

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";

import { SettingsProvider } from "@/hooks/useSettings";

export default function RootLayout() {
  // Follows the system theme; the screens use NativeWind's dark: variants for the same switch.
  const theme = useColorScheme() === "dark" ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={theme}>
      <SettingsProvider>
        <StatusBar style="auto" />
        <Stack>
          <Stack.Screen name="index" options={{ title: "Mi Scale" }} />
          <Stack.Screen name="settings" options={{ title: "Settings" }} />
        </Stack>
      </SettingsProvider>
    </ThemeProvider>
  );
}
