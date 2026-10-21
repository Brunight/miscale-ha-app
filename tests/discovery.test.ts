import { expect, test } from "bun:test";

import { haFromService, type FoundService } from "../src/lib/discovery";

const service = (txt: Record<string, string>, ipv4 = ["192.168.0.162"]): FoundService => ({
  name: "Home",
  host: "homeassistant.local.",
  port: 8123,
  ipv4,
  txt,
});

test("uses the internal URL when it isn't a .local name", () => {
  expect(haFromService(service({ location_name: "Casa", internal_url: "http://192.168.0.162:8123/", version: "2026.10.1" }))).toEqual({
    name: "Casa",
    url: "http://192.168.0.162:8123",
    version: "2026.10.1",
  });
});

test("prefers the IP address over .local names", () => {
  expect(haFromService(service({ internal_url: "http://homeassistant.local:8123", base_url: "http://homeassistant.local:8123" }))?.url).toBe(
    "http://192.168.0.162:8123",
  );
});

test("falls back to the service name and gives up without an address", () => {
  expect(haFromService(service({}))).toEqual({ name: "Home", url: "http://192.168.0.162:8123", version: null });
  expect(haFromService(service({}, []))).toBeNull();
});
