import { describe, expect, it } from "vitest";
import { fetchPublic, SupostApiError } from "../src/http.js";
import { fetchStub, jsonResponse } from "./helpers.js";

const limited = () =>
  jsonResponse({ error: "rate_limited", message: "slow down" }, 429, {
    "retry-after": "1",
  });

describe("fetchPublic rate-limit behavior", () => {
  it("waits for Retry-After before the single retry", async () => {
    const waits: number[] = [];
    const { fetchImpl } = fetchStub([limited(), jsonResponse({ ok: true })]);
    const response = await fetchPublic("https://supost.com/x", {
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(response.status).toBe(200);
    expect(waits).toEqual([1000]);
  });

  it("caps a hostile Retry-After at 5 seconds", async () => {
    const waits: number[] = [];
    const { fetchImpl } = fetchStub([
      jsonResponse({}, 429, { "retry-after": "3600" }),
      jsonResponse({ ok: true }),
    ]);
    await fetchPublic("https://supost.com/x", {
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([5000]);
  });

  it("uses a default delay when Retry-After is absent or malformed", async () => {
    const waits: number[] = [];
    const { fetchImpl } = fetchStub([
      jsonResponse({}, 429, { "retry-after": "soon" }),
      jsonResponse({ ok: true }),
    ]);
    await fetchPublic("https://supost.com/x", {
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([2000]);
  });

  it("gives up after the second 429 with a structured error, never a loop", async () => {
    const { fetchImpl, urls } = fetchStub([limited(), limited()]);
    await expect(
      fetchPublic("https://supost.com/x", { fetchImpl, sleep: async () => {} })
    ).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    expect(urls).toHaveLength(2);
  });

  it("identifies itself with a descriptive User-Agent", async () => {
    let ua: string | undefined;
    const fetchImpl = async (_url: string, init?: { headers?: Record<string, string> }) => {
      ua = init?.headers?.["user-agent"];
      return jsonResponse({ ok: true });
    };
    await fetchPublic("https://supost.com/x", { fetchImpl });
    expect(ua).toMatch(/^supost-mcp\//);
  });

  it("error type is SupostApiError", async () => {
    const { fetchImpl } = fetchStub([limited(), limited()]);
    await expect(
      fetchPublic("https://supost.com/x", { fetchImpl, sleep: async () => {} })
    ).rejects.toBeInstanceOf(SupostApiError);
  });
});
