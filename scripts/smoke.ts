/**
 * Live smoke test against a real deployment: exercises all three tools
 * end-to-end over the network. Usage:
 *   SUPOST_BASE_URL=https://preview.supost.com npx tsx scripts/smoke.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";

const server = buildServer();
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "smoke", version: "0.0.0" });
await Promise.all([server.connect(st), client.connect(ct)]);

const text = (r: Awaited<ReturnType<typeof client.callTool>>) =>
  (r.content as Array<{ text: string }>)[0]?.text ?? "";

const search = await client.callTool({
  name: "search_listings",
  arguments: { cat: "housing", limit: 2 },
});
console.log("search_listings isError:", search.isError ?? false);
const listings = JSON.parse(text(search)).listings;
console.log("  first:", listings[0]?.title, "$" + listings[0]?.price);

const detail = await client.callTool({
  name: "get_listing",
  arguments: { id: listings[0].id },
});
console.log("get_listing isError:", detail.isError ?? false);
console.log("  description:", JSON.parse(text(detail)).description?.slice(0, 80));

const stats = await client.callTool({ name: "get_market_stats", arguments: {} });
console.log("get_market_stats isError:", stats.isError ?? false);
console.log("  head:", text(stats).split("\n")[0]);
