import { expect, test } from "bun:test";

import { AuthError, authorizeUrl, CLIENT_ID, codeFromRedirect, exchangeCode, pkce, REDIRECT_URI, revoke, TokenSource } from "../src/lib/auth";

const sha256 = async (d: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));

type Call = { url: string; body: Record<string, string> };

function fakeFetch(responder: (body: Record<string, string>) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit) => {
    const body = Object.fromEntries(new URLSearchParams(init.body as string));
    calls.push({ url, body });
    const { status = 200, json } = responder(body);
    return new Response(JSON.stringify(json), { status });
  };
  return { fn, calls };
}

test("PKCE matches RFC 7636 appendix B", async () => {
  const random = Uint8Array.from([
    116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91,
    88, 5, 88, 83, 132, 141, 121,
  ]);
  expect(await pkce(random, sha256)).toEqual({
    verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  });
});

test("authorize URL", () => {
  const url = new URL(authorizeUrl("http://192.168.0.162:8123/", "st", "ch"));
  expect(url.origin + url.pathname).toBe("http://192.168.0.162:8123/auth/authorize");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state: "st",
    code_challenge: "ch",
    code_challenge_method: "S256",
  });
});

test("code from the redirect, checking the state", () => {
  expect(codeFromRedirect("miscale://auth?code=abc&state=st", "st")).toBe("abc");
  expect(() => codeFromRedirect("miscale://auth?code=abc&state=other", "st")).toThrow(AuthError);
  expect(() => codeFromRedirect("miscale://auth?error=access_denied&state=st", "st")).toThrow("access_denied");
  expect(() => codeFromRedirect("miscale://auth?state=st", "st")).toThrow(AuthError);
});

test("exchanging the code", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: { access_token: "A", expires_in: 1800, refresh_token: "R", token_type: "Bearer" } }));
  const tokens = await exchangeCode("http://ha:8123/", "abc", "ver", fn, () => 1000);
  expect(tokens).toEqual({ accessToken: "A", expiresAt: 1000 + 1_800_000, refreshToken: "R" });
  expect(calls[0].url).toBe("http://ha:8123/auth/token");
  expect(calls[0].body).toEqual({ grant_type: "authorization_code", code: "abc", client_id: CLIENT_ID, code_verifier: "ver" });
});

test("access tokens are cached, renewed near expiry, and refreshes are shared", async () => {
  let n = 0;
  const { fn, calls } = fakeFetch(() => ({ json: { access_token: `A${++n}`, expires_in: 1800 } }));
  const clock = { t: 0 };
  const source = new TokenSource("http://ha", "R", fn, () => clock.t);
  expect(await Promise.all([source.accessToken(), source.accessToken()])).toEqual(["A1", "A1"]);
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toEqual({ grant_type: "refresh_token", refresh_token: "R", client_id: CLIENT_ID });
  clock.t = 1_700_000; // still more than a minute left
  expect(await source.accessToken()).toBe("A1");
  clock.t = 1_750_000; // less than a minute left
  expect(await source.accessToken()).toBe("A2");
});

test("a seeded token is used without a request", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: {} }));
  const source = new TokenSource("http://ha", "R", fn, () => 0).seed({ accessToken: "S", expiresAt: 1_800_000, refreshToken: "R" });
  expect(await source.accessToken()).toBe("S");
  expect(calls).toHaveLength(0);
});

test("a revoked login is reported as such", async () => {
  const { fn } = fakeFetch(() => ({ status: 400, json: { error: "invalid_grant" } }));
  const err = await new TokenSource("http://ha", "R", fn).accessToken().catch((e) => e);
  expect(err).toBeInstanceOf(AuthError);
  expect(err.revoked).toBe(true);
});

test("log out revokes the refresh token", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: {} }));
  await revoke("http://ha/", "R", fn);
  expect(calls[0]).toEqual({ url: "http://ha/auth/revoke", body: { token: "R" } });
});
