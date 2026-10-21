/**
 * Home Assistant announces itself on the local network as `_home-assistant._tcp` (mDNS),
 * with its name and URLs in the TXT record.
 */

export const SERVICE_TYPE = "home-assistant";

export type FoundService = {
  name: string;
  host: string;
  port: number;
  ipv4: string[];
  txt: Record<string, string>;
};

export type FoundHA = { name: string; url: string; version: string | null };

const usable = (url: string | undefined) => {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    // Not every Android version resolves .local names, so prefer an IP address over them.
    return host.endsWith(".local") ? null : url.replace(/\/+$/, "");
  } catch {
    return null;
  }
};

/** The URL to reach a discovered instance: its internal URL, or its IP address and port. */
export function haFromService(s: FoundService): FoundHA | null {
  const url =
    usable(s.txt.internal_url) ?? usable(s.txt.base_url) ?? (s.ipv4[0] ? `http://${s.ipv4[0]}:${s.port}` : null);
  if (!url) return null;
  return { name: s.txt.location_name || s.name, url, version: s.txt.version || null };
}
