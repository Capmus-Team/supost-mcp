import { afterEach, describe, expect, it } from "vitest";
import { clientIp, identifyClient } from "../src/client.js";

afterEach(() => {
  delete process.env.CLIENT_ID_SALT;
});

const HEADERS = {
  "x-forwarded-for": "203.0.113.7, 10.0.0.1",
  "user-agent": "claude-code/2.0 (mcp)",
  "x-vercel-ip-country": "US",
};

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    expect(clientIp(HEADERS)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp({ "x-real-ip": "198.51.100.2" })).toBe("198.51.100.2");
  });

  it("handles array-valued headers", () => {
    expect(clientIp({ "x-forwarded-for": ["203.0.113.9", "10.0.0.1"] })).toBe("203.0.113.9");
  });
});

describe("identifyClient", () => {
  it("hashes IP + UA into a stable opaque id that never contains the IP", () => {
    const a = identifyClient(HEADERS);
    const b = identifyClient(HEADERS);
    expect(a).not.toBeNull();
    expect(a!.client_id).toBe(b!.client_id);
    expect(a!.client_id).toMatch(/^client:[0-9a-f]{24}$/);
    expect(a!.client_id).not.toContain("203.0.113.7");
    expect(a!.client_ua).toBe("claude-code/2.0 (mcp)");
    expect(a!.client_country).toBe("US");
  });

  it("changes when the IP or UA changes", () => {
    const base = identifyClient(HEADERS)!.client_id;
    expect(identifyClient({ ...HEADERS, "x-forwarded-for": "203.0.113.8" })!.client_id).not.toBe(base);
    expect(identifyClient({ ...HEADERS, "user-agent": "cursor/1.0" })!.client_id).not.toBe(base);
  });

  it("changes with the salt", () => {
    const base = identifyClient(HEADERS)!.client_id;
    process.env.CLIENT_ID_SALT = "another";
    expect(identifyClient(HEADERS)!.client_id).not.toBe(base);
  });

  it("still identifies by UA alone when no IP header is present", () => {
    const id = identifyClient({ "user-agent": "cursor/1.0" });
    expect(id).not.toBeNull();
    expect(id!.client_country).toBeNull();
  });

  it("returns null when nothing identifies the caller", () => {
    expect(identifyClient(undefined)).toBeNull();
    expect(identifyClient({})).toBeNull();
    expect(identifyClient({ accept: "application/json" })).toBeNull();
  });
});
