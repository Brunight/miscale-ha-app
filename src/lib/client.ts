import { TokenSource, type Tokens } from "./auth";
import { HomeAssistant, type Credential } from "./ha";
import type { Settings } from "./settings";

type Access = Pick<Settings, "haUrl" | "refreshToken" | "token">;

// One token source per login, so every screen shares the cached access token.
const sources = new Map<string, TokenSource>();

export function tokenSource(haUrl: string, refreshToken: string, seed?: Tokens): TokenSource {
  const key = `${haUrl}\n${refreshToken}`;
  let source = sources.get(key);
  if (!source) sources.set(key, (source = new TokenSource(haUrl, refreshToken)));
  if (seed) source.seed(seed);
  return source;
}

/** The login when there is one, otherwise the pasted long-lived token. */
export function credentialFor(s: Access): Credential {
  if (s.refreshToken) {
    const source = tokenSource(s.haUrl, s.refreshToken);
    return () => source.accessToken();
  }
  return s.token;
}

export const hasCredential = (s: Access) => Boolean(s.refreshToken || s.token.trim());

export const haFor = (s: Access) => new HomeAssistant(s.haUrl, credentialFor(s));
