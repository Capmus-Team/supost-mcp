import { afterEach, describe, expect, it, vi } from "vitest";
import { logToolCall } from "../src/toollog.js";

const NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = NODE_ENV;
  delete process.env.TOOL_LOG_URL;
  delete process.env.TOOL_LOG_KEY;
  delete process.env.BRAND;
  vi.unstubAllGlobals();
});

function enable() {
  process.env.NODE_ENV = "production";
  process.env.TOOL_LOG_URL = "https://db.example.supabase.co/";
  process.env.TOOL_LOG_KEY = "srk";
}

describe("logToolCall", () => {
  it("is a no-op without TOOL_LOG_URL/KEY (local dev, tests)", async () => {
    process.env.NODE_ENV = "production";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await logToolCall("search_listings", true, { q: "bike" }, null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts full args to the log RPC with the service key", async () => {
    enable();
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await logToolCall(
      "send_message",
      false,
      { post_id: 7, message: "hi there", reply_to_email: "a@b.com" },
      "rate_limited: back off"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    // trailing slash on TOOL_LOG_URL must not produce a double slash
    expect(url).toBe(
      "https://db.example.supabase.co/rest/v1/rpc/log_mcp_tool_call"
    );
    expect(init.headers.apikey).toBe("srk");
    expect(init.headers.authorization).toBe("Bearer srk");
    expect(JSON.parse(init.body)).toEqual({
      p_brand: "supost",
      p_tool: "send_message",
      p_ok: false,
      p_args: { post_id: 7, message: "hi there", reply_to_email: "a@b.com" },
      p_error: "rate_limited: back off",
    });
  });

  it("uses the active brand", async () => {
    enable();
    process.env.BRAND = "capmus";
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await logToolCall("search_listings", true, {}, null);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body).p_brand).toBe("capmus");
  });

  it("never throws when the log request fails", async () => {
    enable();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("db down")));
    await expect(
      logToolCall("search_listings", true, {}, null)
    ).resolves.toBeUndefined();
  });
});
