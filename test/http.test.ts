import { describe, expect, it } from "vitest";
import { fetchPublic } from "../src/http.js";
import { jsonResponse } from "./helpers.js";

function recordingFetch() {
  const calls: Array<Record<string, string> | undefined> = [];
  const fetchImpl = async (_url: string, init?: { headers?: Record<string, string> }) => {
    calls.push(init?.headers);
    return jsonResponse({ ok: true });
  };
  return { fetchImpl, calls };
}

describe("fetchPublic X-Forwarded-For", () => {
  it("forwards the calling agent's IP upstream", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await fetchPublic("https://supost.com/x", { fetchImpl, clientIp: "203.0.113.7" });
    expect(calls[0]?.["x-forwarded-for"]).toBe("203.0.113.7");
  });

  it("sends no X-Forwarded-For when the caller's IP is unknown", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await fetchPublic("https://supost.com/x", { fetchImpl });
    await fetchPublic("https://supost.com/x", { fetchImpl, clientIp: null });
    for (const headers of calls) {
      expect(headers).toBeDefined();
      expect(Object.keys(headers!)).not.toContain("x-forwarded-for");
    }
  });

  it("keeps the forwarded IP on the single 429 retry", async () => {
    const headersSeen: Array<Record<string, string> | undefined> = [];
    const responses = [jsonResponse({}, 429), jsonResponse({ ok: true })];
    const fetchImpl = async (_url: string, init?: { headers?: Record<string, string> }) => {
      headersSeen.push(init?.headers);
      return responses.shift()!;
    };
    await fetchPublic("https://supost.com/x", {
      fetchImpl,
      clientIp: "203.0.113.7",
      sleep: async () => {},
    });
    expect(headersSeen.map((h) => h?.["x-forwarded-for"])).toEqual([
      "203.0.113.7",
      "203.0.113.7",
    ]);
  });
});
