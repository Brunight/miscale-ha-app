/**
 * Decides whether a weigh-in belongs to this phone's owner.
 *
 * Every phone reads the whole household's latest weights from Home Assistant, so every
 * phone reaches the same conclusion about who stepped on the scale without talking to
 * the others. A phone sends a weigh-in automatically only when its owner is the clear
 * closest match; otherwise it asks.
 */

export type Member = { deviceId: string; name: string; lastWeightKg: number | null };

export type Decision =
  | { kind: "me" }
  /** Someone else's weight is the closest match. */
  | { kind: "other"; closest: Member }
  /** The owner is the closest match, but someone else is almost as close. */
  | { kind: "close"; rival: Member }
  /** No one's last weight is within the tolerance. */
  | { kind: "nobody" };

export const DEFAULT_TOLERANCE_KG = 5;
/** How much closer the owner must be than the next person to be sure. */
export const DEFAULT_MARGIN_KG = 1;

export function decide(
  weightKg: number,
  myDeviceId: string,
  members: Member[],
  toleranceKg = DEFAULT_TOLERANCE_KG,
  marginKg = DEFAULT_MARGIN_KG,
): Decision {
  const me = members.find((m) => m.deviceId === myDeviceId);
  const near = members
    .filter((m) => m.lastWeightKg !== null && Math.abs(m.lastWeightKg - weightKg) <= toleranceKg)
    .map((m) => ({ m, diff: Math.abs(m.lastWeightKg! - weightKg) }))
    .sort((a, b) => a.diff - b.diff);

  if (near.length === 0) {
    // The owner's first weigh-in, and it is nobody else's: take it.
    return !me || me.lastWeightKg === null ? { kind: "me" } : { kind: "nobody" };
  }
  const [top, second] = near;
  if (top.m.deviceId !== myDeviceId) return { kind: "other", closest: top.m };
  if (second && second.diff - top.diff < marginKg) return { kind: "close", rival: second.m };
  return { kind: "me" };
}
