import { afterEach, describe, expect, it, vi } from "vitest";
import { captureToolCall } from "../src/analytics.js";

const NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = NODE_ENV;
  delete process.env.POSTHOG_KEY;
  delete process.env.BRAND;
  vi.unstubAllGlobals();
});

describe("captureToolCall", () => {
  it("is a no-op under NODE_ENV=test (so tool tests never hit PostHog)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await captureToolCall("search_listings", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts one event with tool, brand, ok and a fixed distinct_id", async () => {
    process.env.NODE_ENV = "production";
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await captureToolCall("search_listings", true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.event).toBe("mcp_tool_called");
    expect(body.distinct_id).toBe("mcp.supost.com");
    expect(body.properties).toMatchObject({
      tool: "search_listings",
      brand: "supost",
      ok: true,
      $process_person_profile: false,
    });
  });

  it("merges sanitized props without letting them clobber core fields", async () => {
    process.env.NODE_ENV = "production";
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await captureToolCall("search_listings", true, { q: "bike", tool: "spoof" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.properties.q).toBe("bike");
    expect(body.properties.tool).toBe("search_listings");
  });

  it("uses the brand in the distinct_id", async () => {
    process.env.NODE_ENV = "production";
    process.env.BRAND = "capmus";
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await captureToolCall("get_listing", false);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.distinct_id).toBe("mcp.capmus.com");
    expect(body.properties.brand).toBe("capmus");
    expect(body.properties.ok).toBe(false);
  });

  it("POSTHOG_KEY=\"\" disables capture", async () => {
    process.env.NODE_ENV = "production";
    process.env.POSTHOG_KEY = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await captureToolCall("search_listings", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when the capture request fails", async () => {
    process.env.NODE_ENV = "production";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(captureToolCall("search_listings", true)).resolves.toBeUndefined();
  });
});
