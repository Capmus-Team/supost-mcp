import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

async function connectedClient() {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

const NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = NODE_ENV;
  delete process.env.TOOL_LOG_URL;
  delete process.env.TOOL_LOG_KEY;
  vi.unstubAllGlobals();
});

describe("MCP server", () => {
  it("exposes exactly the published tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_post",
      "get_listing",
      "get_market_stats",
      "list_categories",
      "search_listings",
      "send_message",
    ]);
  });

  it("send_message POSTs to the public messages API and reports pending, not sent", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({ status: "pending_verification", email: "buyer@example.com" }),
        { status: 202, headers: { "content-type": "application/json" } }
      );
    });
    const client = await connectedClient();
    const result = await client.callTool({
      name: "send_message",
      arguments: {
        post_id: 42,
        message: "Hi, is this still available?",
        reply_to_email: "buyer@example.com",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/public/messages");
    expect(requests[0]?.init?.method).toBe("POST");
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("pending");
    expect(content[0]?.text).toContain("confirmation link");
  });

  it("search_listings round-trips params to the API and returns JSON text", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify({ listings: [], next_cursor: null }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const client = await connectedClient();
    const result = await client.callTool({
      name: "search_listings",
      arguments: { q: "bike", max_price: 100, limit: 5 },
    });
    const requested = new URL(urls[0] ?? "");
    expect(requested.pathname).toBe("/api/public/listings");
    expect(requested.searchParams.get("q")).toBe("bike");
    expect(requested.searchParams.get("max_price")).toBe("100");
    expect(requested.searchParams.get("limit")).toBe("5");
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0]?.text ?? "")).toEqual({
      listings: [],
      next_cursor: null,
    });
    expect(result.isError).toBeFalsy();
  });

  it("captures sanitized PostHog props but logs full args to the DB RPC", async () => {
    process.env.NODE_ENV = "production";
    process.env.TOOL_LOG_URL = "https://db.test.supabase.co";
    process.env.TOOL_LOG_KEY = "srk";
    const requests: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, body: String(init?.body ?? "") });
      if (url.includes("/api/public/messages")) {
        return new Response(
          JSON.stringify({ status: "pending_verification", email: "buyer@example.com" }),
          { status: 202, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("ok", { status: 200 });
    });
    const client = await connectedClient();
    await client.callTool({
      name: "send_message",
      arguments: {
        post_id: 42,
        message: "Hi, is this still available?",
        reply_to_email: "buyer@example.com",
      },
    });

    const posthog = requests.find((r) => r.url.includes("posthog.com"));
    expect(posthog).toBeDefined();
    const props = JSON.parse(posthog!.body).properties;
    expect(props).toMatchObject({
      tool: "send_message",
      ok: true,
      post_id: 42,
      message_chars: 28,
    });
    expect(JSON.stringify(props)).not.toContain("buyer@example.com");
    expect(JSON.stringify(props)).not.toContain("still available");

    const dbLog = requests.find((r) => r.url.includes("/rpc/log_mcp_tool_call"));
    expect(dbLog).toBeDefined();
    expect(JSON.parse(dbLog!.body)).toMatchObject({
      p_tool: "send_message",
      p_ok: true,
      p_args: {
        post_id: 42,
        message: "Hi, is this still available?",
        reply_to_email: "buyer@example.com",
      },
    });
  });

  it("upstream errors become isError tool results, not protocol failures", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ error: "invalid_request", message: "Unknown category" }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );
    const client = await connectedClient();
    const result = await client.callTool({
      name: "search_listings",
      arguments: { cat: "nonsense" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("invalid_request");
  });
});
