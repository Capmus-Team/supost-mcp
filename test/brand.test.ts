import { afterEach, describe, expect, it } from "vitest";
import { getBaseUrl, getBrand } from "../src/config.js";
import { registerTools } from "../src/server.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

afterEach(() => {
  delete process.env.BRAND;
  delete process.env.SUPOST_BASE_URL;
});

async function listTools() {
  const server = new McpServer({ name: getBrand().key, version: "0.0.0" });
  registerTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return (await client.listTools()).tools;
}

describe("brand config", () => {
  it("defaults to supost", () => {
    expect(getBrand().key).toBe("supost");
    expect(getBaseUrl()).toBe("https://supost.com");
  });

  it("BRAND=capmus switches identity and base URL", () => {
    process.env.BRAND = "capmus";
    expect(getBrand().siteName).toBe("Capmus");
    expect(getBaseUrl()).toBe("https://capmus.com");
  });

  it("rejects unknown brands", () => {
    process.env.BRAND = "craigslist";
    expect(() => getBrand()).toThrow(/Unknown BRAND/);
  });

  it("capmus tool descriptions carry Capmus branding, not SUpost", async () => {
    process.env.BRAND = "capmus";
    const tools = await listTools();
    expect(tools.length).toBe(6);
    for (const tool of tools) {
      expect(tool.description).not.toContain("SUpost");
      expect(tool.description).not.toContain("Stanford,");
    }
    const stats = tools.find((t) => t.name === "get_market_stats");
    expect(stats?.description).toContain("https://capmus.com/stats");
  });
});
