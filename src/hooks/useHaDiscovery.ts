import { useCallback, useEffect, useRef, useState } from "react";
import Zeroconf, { ImplType } from "react-native-zeroconf";

import { haFromService, SERVICE_TYPE, type FoundHA } from "@/lib/discovery";

const SCAN_MS = 8000;

/** Looks for Home Assistant on the local network for a few seconds when `scan` is called. */
export function useHaDiscovery() {
  const [found, setFound] = useState<FoundHA[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zeroconf = useRef<Zeroconf | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    zeroconf.current?.stop();
    setScanning(false);
  }, []);

  useEffect(() => {
    const z = new Zeroconf();
    zeroconf.current = z;
    z.on("resolved", (service) => {
      const ha = haFromService(service);
      if (ha) setFound((list) => (list.some((x) => x.url === ha.url) ? list : [...list, ha]));
    });
    z.on("error", (e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      z.stop();
      z.removeDeviceListeners();
      zeroconf.current = null;
    };
  }, []);

  const scan = useCallback(() => {
    const z = zeroconf.current;
    if (!z) return;
    setFound([]);
    setError(null);
    setScanning(true);
    z.scan({ type: SERVICE_TYPE, protocol: "tcp", domain: "local.", implType: ImplType.NSD });
    timer.current = setTimeout(stop, SCAN_MS);
  }, [stop]);

  return { found, scanning, error, scan };
}
