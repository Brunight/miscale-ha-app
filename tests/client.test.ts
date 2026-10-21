import { expect, test } from "bun:test";

import { credentialFor, hasCredential, tokenSource } from "../src/lib/client";

test("the login wins over a pasted token, and token sources are shared", async () => {
  tokenSource("http://ha", "R", { accessToken: "fresh", expiresAt: Date.now() + 1_800_000, refreshToken: "R" });
  const cred = credentialFor({ haUrl: "http://ha", refreshToken: "R", token: "pasted" });
  expect(typeof cred).toBe("function");
  expect(await (cred as () => Promise<string>)()).toBe("fresh");
  expect(credentialFor({ haUrl: "http://ha", refreshToken: null, token: "pasted" })).toBe("pasted");
  expect(hasCredential({ haUrl: "http://ha", refreshToken: null, token: "  " })).toBe(false);
});
