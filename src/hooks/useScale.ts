import { useEffect, useEffectEvent, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, ScanMode } from "react-native-ble-plx";

import { PacketFilter, type Reading } from "@/lib/packet";
import { Session, type SessionEvent } from "@/lib/session";

export type ScanStatus = "starting" | "scanning" | "bluetooth-off" | "denied" | "error";

let manager: BleManager | null = null;
const getManager = () => (manager ??= new BleManager());

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted =
    Number(Platform.Version) >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT, P.ACCESS_FINE_LOCATION] : [P.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/**
 * Scans for the scale while the component using it is mounted. `live` is every new packet
 * (for the settling weight); `onEvent` fires when a weigh-in starts and when its impedance arrives.
 */
export function useScale(scaleAddress: string | null, onEvent: (e: SessionEvent) => void) {
  const [status, setStatus] = useState<ScanStatus>("starting");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Reading | null>(null);
  const emit = useEffectEvent(onEvent);

  useEffect(() => {
    const ble = getManager();
    const filter = new PacketFilter(scaleAddress);
    const session = new Session();
    let cancelled = false;
    let scanning = false;

    const start = async () => {
      if (!(await requestPermissions())) return setStatus("denied");
      if (cancelled || scanning) return;
      scanning = true;
      setStatus("scanning");
      // No UUID filter: the scale puts 0x181B in its service data, which Android's
      // service UUID filter doesn't look at. Packets are filtered in JS instead.
      await ble.startDeviceScan(null, { allowDuplicates: true, scanMode: ScanMode.LowLatency }, (err, device) => {
        if (err) {
          scanning = false;
          setError(err.message);
          setStatus("error");
          return;
        }
        if (!device) return;
        const reading = filter.handle(device.id, device.rssi, device.serviceData);
        if (!reading) return;
        setLive(reading);
        const event = session.handle(reading);
        if (event) emit(event);
      });
    };

    const sub = ble.onStateChange((state) => {
      if (state === "PoweredOn") start().catch((e) => (setError(String(e)), setStatus("error")));
      else if (state === "PoweredOff") {
        scanning = false;
        setStatus("bluetooth-off");
      }
    }, true);

    return () => {
      cancelled = true;
      sub.remove();
      ble.stopDeviceScan().catch(() => {});
    };
  }, [scaleAddress]);

  return { status, error, live };
}
