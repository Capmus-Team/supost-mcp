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
  it("exposes exactly the three E3 tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_listing",
      "get_market_stats",
      "search_listings",
    ]);
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
