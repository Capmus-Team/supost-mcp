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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP server", () => {
  it("exposes exactly the published tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_listing",
      "get_market_stats",
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
