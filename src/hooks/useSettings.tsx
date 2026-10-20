import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { loadSettings, saveSettings, type Settings } from "@/lib/settings";

type Ctx = { settings: Settings | null; loaded: boolean; save: (s: Settings) => Promise<void> };

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (s: Settings) => {
    await saveSettings(s);
    setSettings(s);
  }, []);

  return <SettingsContext.Provider value={{ settings, loaded, save }}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}
