import { describe, expect, it } from "vitest";
import { SupostApiError } from "../src/http.js";
import { buildSearchUrl, searchListings } from "../src/supost.js";
import { fetchStub, jsonResponse, noSleep } from "./helpers.js";

const LISTING = {
  id: 130088421,
  title: "Sublet in Escondido Village Kennedy",
  price: 1517,
  category: "housing",
  created_at: "2026-07-01T22:24:44.219+00:00",
  url: "https://supost.com/post/sublet-in-escondido-village-kennedy-130088421",
  poster_email_domain: "stanford.edu",
  stanford_verified: true,
};

describe("buildSearchUrl", () => {
  it("maps every parameter onto the public API query string", () => {
    const url = new URL(
      buildSearchUrl(
        {
          q: "bike",
          cat: "for sale",
          university: 1,
          max_price: 200,
          limit: 10,
          cursor: "abc",
        },
        "https://supost.com"
      )
    );
    expect(url.pathname).toBe("/api/public/listings");
    expect(url.searchParams.get("q")).toBe("bike");
    expect(url.searchParams.get("cat")).toBe("for sale");
    expect(url.searchParams.get("university")).toBe("1");
    expect(url.searchParams.get("max_price")).toBe("200");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("cursor")).toBe("abc");
  });

  it("omits absent parameters instead of sending empty values", () => {
    const url = new URL(buildSearchUrl({}, "https://supost.com"));
    expect([...url.searchParams.keys()]).toEqual([]);
  });
});

describe("searchListings", () => {
  it("returns listings and cursor from the API response", async () => {
    const { fetchImpl } = fetchStub([
      jsonResponse({ listings: [LISTING], next_cursor: "next123" }),
    ]);
    const result = await searchListings({ q: "sublet" }, { fetchImpl });
    expect(result.listings).toEqual([LISTING]);
    expect(result.next_cursor).toBe("next123");
  });

  it("normalizes a missing next_cursor to null", async () => {
    const { fetchImpl } = fetchStub([jsonResponse({ listings: [] })]);
    const result = await searchListings({}, { fetchImpl });
    expect(result.next_cursor).toBeNull();
  });

  it("surfaces the API's structured 400 error", async () => {
    const { fetchImpl } = fetchStub([
      jsonResponse(
        { error: "invalid_request", message: "Unknown parameter(s): area." },
        400
      ),
    ]);
    await expect(searchListings({}, { fetchImpl })).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
      message: "Unknown parameter(s): area.",
    });
  });

  it("rejects a response without a listings array", async () => {
    const { fetchImpl } = fetchStub([jsonResponse({ nope: true })]);
    await expect(searchListings({}, { fetchImpl })).rejects.toBeInstanceOf(
      SupostApiError
    );
  });

  it("retries once after a 429 and succeeds", async () => {
    const { fetchImpl, urls } = fetchStub([
      jsonResponse({ error: "rate_limited", message: "slow down" }, 429, {
        "retry-after": "1",
      }),
      jsonResponse({ listings: [LISTING], next_cursor: null }),
    ]);
    const result = await searchListings({}, { fetchImpl, sleep: noSleep });
    expect(result.listings).toHaveLength(1);
    expect(urls).toHaveLength(2);
  });
});
