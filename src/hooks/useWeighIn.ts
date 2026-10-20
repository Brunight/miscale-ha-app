import { useCallback, useEffect, useRef, useState } from "react";

import { compute, type Metrics } from "@/lib/body";
import { HomeAssistant } from "@/lib/ha";
import { decide, type Decision, type Member } from "@/lib/identify";
import type { Measurement, SessionEvent } from "@/lib/session";
import type { Registration } from "@/lib/ha";
import type { Settings } from "@/lib/settings";

/** How long to wait for the impedance before sending the weight alone. */
const IMPEDANCE_WAIT_MS = 25_000;

export type Phase =
  | { phase: "idle" }
  | { phase: "measuring"; m: Measurement }
  | { phase: "ask"; m: Measurement; metrics: Metrics; decision: Exclude<Decision, { kind: "me" }> }
  | { phase: "sending"; m: Measurement; metrics: Metrics }
  | { phase: "saved"; m: Measurement; metrics: Metrics }
  | { phase: "discarded"; m: Measurement; metrics: Metrics }
  | { phase: "error"; m: Measurement; metrics: Metrics; message: string };

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Turns weigh-in events into: wait for impedance → decide whose it is → send to HA (or ask). */
export function useWeighIn(settings: Settings & { registration: Registration }) {
  const [state, setState] = useState<Phase>({ phase: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The measurement being handled, and whether it has been sent as this person's.
  const current = useRef<{ m: Measurement; finalized: boolean; sent: boolean } | null>(null);

  const ha = new HomeAssistant(settings.haUrl, settings.token);
  const metricsFor = (m: Measurement) =>
    compute(m.weightKg, m.impedance, settings.heightCm, settings.birth, settings.male, localDay(m.measuredAt));

  const send = useCallback(
    async (m: Measurement) => {
      const metrics = metricsFor(m);
      setState({ phase: "sending", m, metrics });
      try {
        await ha.sendMeasurement(settings.registration, settings.name, settings.deviceId, m, metrics);
        if (current.current?.m.measuredAt === m.measuredAt) current.current.sent = true;
        setState({ phase: "saved", m, metrics });
      } catch (e) {
        setState({ phase: "error", m, metrics, message: e instanceof Error ? e.message : String(e) });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings],
  );

  const finalize = useCallback(
    async (m: Measurement) => {
      if (!current.current || current.current.m.measuredAt !== m.measuredAt || current.current.finalized) return;
      current.current.finalized = true;
      const metrics = metricsFor(m);
      let members: Member[] = [];
      try {
        members = await ha.household();
      } catch {
        // HA unreachable: decide without the household. Sending will fail too and offer to retry.
      }
      if (!members.some((x) => x.deviceId === settings.deviceId)) {
        members.push({ deviceId: settings.deviceId, name: settings.name, lastWeightKg: null });
      }
      const decision = decide(m.weightKg, settings.deviceId, members, settings.toleranceKg);
      if (decision.kind === "me") await send(m);
      else setState({ phase: "ask", m, metrics, decision });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, send],
  );

  const onEvent = useCallback(
    (e: SessionEvent) => {
      const m = e.measurement;
      if (e.event === "started") {
        if (timer.current) clearTimeout(timer.current);
        current.current = { m, finalized: false, sent: false };
        setState({ phase: "measuring", m });
        if (m.impedance) finalize(m);
        else timer.current = setTimeout(() => finalize(m), IMPEDANCE_WAIT_MS);
        return;
      }
      // The impedance arrived.
      const cur = current.current;
      if (!cur || cur.m.measuredAt !== m.measuredAt) return;
      cur.m = m;
      if (timer.current) clearTimeout(timer.current);
      if (!cur.finalized) finalize(m);
      // Late impedance for a weigh-in already saved without it: send the body composition too.
      else if (cur.sent) send(m);
      else setState((s) => (s.phase === "ask" ? { ...s, m, metrics: metricsFor(m) } : s));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finalize, send],
  );

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const confirm = useCallback(() => {
    if (current.current) send(current.current.m);
  }, [send]);

  const discard = useCallback(() => {
    const cur = current.current;
    if (!cur) return;
    setState({ phase: "discarded", m: cur.m, metrics: metricsFor(cur.m) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  return { state, onEvent, confirm, discard };
}
