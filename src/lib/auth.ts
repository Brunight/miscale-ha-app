/**
 * Logs in to Home Assistant with its OAuth2 / IndieAuth flow, the way the Companion app
 * does, so nobody has to create and paste a long-lived token.
 * https://developers.home-assistant.io/docs/auth_api
 *
 * HA identifies the app by CLIENT_ID, a web page that lists REDIRECT_URI in a
 * <link rel="redirect_uri"> tag (docs/index.html, served by GitHub Pages). HA fetches that
 * page during login, so the HA server needs internet access to reach it.
 */

import { normalizeUrl } from "./ha";

export const CLIENT_ID = "https://brunight.github.io/miscale-ha-app/";
export const REDIRECT_URI = "miscale://auth";

/** The access token is renewed this long before HA says it expires. */
const EXPIRY_MARGIN_MS = 60_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type Tokens = { accessToken: string; expiresAt: number; refreshToken: string };

export class AuthError extends Error {
  /** True when HA no longer accepts the refresh token: the person must log in again. */
  constructor(message: string, readonly revoked = false) {
    super(message);
  }
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** PKCE (RFC 7636, S256) from 32 random bytes and a SHA-256 implementation. */
export async function pkce(random: Uint8Array, sha256: (data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>) {
  const verifier = base64url(random);
  const challenge = base64url(await sha256(new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

export function authorizeUrl(haUrl: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${normalizeUrl(haUrl)}/auth/authorize?${params}`;
}

/** The authorization code from the URL HA redirected to, after checking it answers our request. */
export function codeFromRedirect(url: string, state: string): string {
  const query = new URLSearchParams(url.split("?")[1] ?? "");
  if (query.get("state") !== state) throw new AuthError("the login answer doesn't match the request");
  const error = query.get("error");
  if (error) throw new AuthError(`Home Assistant refused the login (${error})`);
  const code = query.get("code");
  if (!code) throw new AuthError("Home Assistant didn't send a login code");
  return code;
}

async function tokenRequest(haUrl: string, body: Record<string, string>, fetchFn: Fetch) {
  const res = await fetchFn(`${normalizeUrl(haUrl)}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    const revoked = json.error === "invalid_grant";
    throw new AuthError(
      revoked ? "the Home Assistant login expired or was revoked" : (json.error_description ?? json.error ?? `HTTP ${res.status}`),
      revoked,
    );
  }
  return json as { access_token: string; expires_in: number; refresh_token?: string };
}

export async function exchangeCode(
  haUrl: string,
  code: string,
  verifier: string,
  fetchFn: Fetch = (u, i) => fetch(u, i),
  now = Date.now,
): Promise<Tokens> {
  const t = await tokenRequest(
    haUrl,
    { grant_type: "authorization_code", code, client_id: CLIENT_ID, code_verifier: verifier },
    fetchFn,
  );
  if (!t.refresh_token) throw new AuthError("Home Assistant didn't send a refresh token");
  return { accessToken: t.access_token, expiresAt: now() + t.expires_in * 1000, refreshToken: t.refresh_token };
}

/** Hands out a valid access token, renewing it with the refresh token when it's about to expire. */
export class TokenSource {
  private access: { token: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private haUrl: string,
    readonly refreshToken: string,
    private fetchFn: Fetch = (u, i) => fetch(u, i),
    private now = Date.now,
  ) {}

  /** Seeds the access token returned by the login, saving one round trip. */
  seed(tokens: Tokens) {
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
    return this;
  }

  accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt - EXPIRY_MARGIN_MS > this.now()) return Promise.resolve(this.access.token);
    // Calls made while a refresh is running share it.
    this.pending ??= tokenRequest(
      this.haUrl,
      { grant_type: "refresh_token", refresh_token: this.refreshToken, client_id: CLIENT_ID },
      this.fetchFn,
    )
      .then((t) => {
        this.access = { token: t.access_token, expiresAt: this.now() + t.expires_in * 1000 };
        return t.access_token;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}

/** Revokes a refresh token (log out). HA answers 200 whether or not the token existed. */
export async function revoke(haUrl: string, refreshToken: string, fetchFn: Fetch = (u, i) => fetch(u, i)) {
  await fetchFn(`${normalizeUrl(haUrl)}/auth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  });
}
