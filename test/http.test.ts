import { afterEach, describe, expect, it } from "vitest";
import { fetchPublic } from "../src/http.js";
import { jsonResponse } from "./helpers.js";

afterEach(() => {
  delete process.env.SUPOST_API_KEY;
});

function recordingFetch() {
  const calls: Array<Record<string, string> | undefined> = [];
  const fetchImpl = async (_url: string, init?: { headers?: Record<string, string> }) => {
    calls.push(init?.headers);
    return jsonResponse({ ok: true });
  };
  return { fetchImpl, calls };
}

describe("fetchPublic trusted-agent headers", () => {
  it("sends the calling agent's IP as x-supost-agent-client-ip, never X-Forwarded-For", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await fetchPublic("https://supost.com/api/public/listings", { fetchImpl, clientIp: "203.0.113.7" });
    expect(calls[0]?.["x-supost-agent-client-ip"]).toBe("203.0.113.7");
    expect(Object.keys(calls[0]!)).not.toContain("x-forwarded-for");
  });

  it("sends no agent IP header when the caller's IP is unknown", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await fetchPublic("https://supost.com/api/public/listings", { fetchImpl });
    await fetchPublic("https://supost.com/api/public/listings", { fetchImpl, clientIp: null });
    for (const headers of calls) {
      expect(headers).toBeDefined();
      expect(Object.keys(headers!)).not.toContain("x-supost-agent-client-ip");
      expect(Object.keys(headers!)).not.toContain("x-forwarded-for");
    }
  });

  it("sends x-supost-api-key on every marketplace call when SUPOST_API_KEY is set", async () => {
    process.env.SUPOST_API_KEY = "test-key";
    const { fetchImpl, calls } = recordingFetch();
    for (const path of ["/api/public/listings?q=bike", "/api/public/categories", "/api/public/posts", "/stats.md"]) {
      await fetchPublic(`https://supost.com${path}`, { fetchImpl });
    }
    expect(calls.map((h) => h?.["x-supost-api-key"])).toEqual(["test-key", "test-key", "test-key", "test-key"]);
  });

  it("omits the api key when the env is unset", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await fetchPublic("https://supost.com/api/public/categories", { fetchImpl });
    expect(Object.keys(calls[0]!)).not.toContain("x-supost-api-key");
  });

  it("never sends the key or the agent IP to another host (the status RPC)", async () => {
    process.env.SUPOST_API_KEY = "test-key";
    const { fetchImpl, calls } = recordingFetch();
    await fetchPublic("https://gvskfwoiyrnxrcnmimmd.supabase.co/rest/v1/rpc/get_guest_verification_status", {
      fetchImpl,
      clientIp: "203.0.113.7",
    });
    expect(Object.keys(calls[0]!)).not.toContain("x-supost-api-key");
    expect(Object.keys(calls[0]!)).not.toContain("x-supost-agent-client-ip");
  });

  it("keeps the agent headers on the single 429 retry", async () => {
    process.env.SUPOST_API_KEY = "test-key";
    const headersSeen: Array<Record<string, string> | undefined> = [];
    const responses = [jsonResponse({}, 429), jsonResponse({ ok: true })];
    const fetchImpl = async (_url: string, init?: { headers?: Record<string, string> }) => {
      headersSeen.push(init?.headers);
      return responses.shift()!;
    };
    await fetchPublic("https://supost.com/api/public/listings", {
      fetchImpl,
      clientIp: "203.0.113.7",
      sleep: async () => {},
    });
    expect(headersSeen.map((h) => [h?.["x-supost-agent-client-ip"], h?.["x-supost-api-key"]])).toEqual([
      ["203.0.113.7", "test-key"],
      ["203.0.113.7", "test-key"],
    ]);
  });
});
