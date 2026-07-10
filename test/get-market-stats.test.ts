import { afterEach, describe, expect, it } from "vitest";
import { getMarketStats } from "../src/supost.js";
import { fetchStub } from "./helpers.js";

afterEach(() => {
  delete process.env.SUPOST_BASE_URL;
});

describe("getMarketStats", () => {
  it("fetches /stats.md and returns the markdown verbatim", async () => {
    const md = "# Stanford marketplace statistics — SUpost\n\n- 50,000+ verified";
    const { fetchImpl, urls } = fetchStub([
      new Response(md, { status: 200, headers: { "content-type": "text/markdown" } }),
    ]);
    const stats = await getMarketStats({ fetchImpl });
    expect(urls[0]).toBe("https://supost.com/stats.md");
    expect(stats).toBe(md);
  });

  it("honors SUPOST_BASE_URL", async () => {
    process.env.SUPOST_BASE_URL = "https://preview.supost.com/";
    const { fetchImpl, urls } = fetchStub([new Response("x", { status: 200 })]);
    await getMarketStats({ fetchImpl });
    expect(urls[0]).toBe("https://preview.supost.com/stats.md");
  });

  it("surfaces upstream failures as structured errors", async () => {
    const { fetchImpl } = fetchStub([new Response("down", { status: 503 })]);
    await expect(getMarketStats({ fetchImpl })).rejects.toMatchObject({
      status: 503,
      code: "http_error",
    });
  });
});
