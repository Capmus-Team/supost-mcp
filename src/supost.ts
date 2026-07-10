import { getBaseUrl } from "./config.js";
import { fetchPublic, SupostApiError, type FetchPublicOptions } from "./http.js";

/**
 * Thin clients over SUpost's public surfaces (doc 190 E3). Shapes mirror the
 * public API contract (supost-web src/lib/public-listings.ts); nothing here
 * touches the database or any authenticated endpoint.
 */

export interface PublicListing {
  id: number;
  title: string | null;
  price: number | null;
  category: string | null;
  created_at: string | null;
  url: string;
}

export interface SearchListingsResult {
  listings: PublicListing[];
  next_cursor: string | null;
}

export interface SearchListingsParams {
  q?: string;
  cat?: string;
  university?: number;
  max_price?: number;
  limit?: number;
  cursor?: string;
}

async function readJsonError(response: Response): Promise<never> {
  let code = "http_error";
  let message = `SUpost API returned HTTP ${response.status}.`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (typeof body.error === "string") code = body.error;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // non-JSON error body; keep the generic message
  }
  throw new SupostApiError(message, response.status, code);
}

export function buildSearchUrl(params: SearchListingsParams, baseUrl = getBaseUrl()): string {
  const url = new URL(`${baseUrl}/api/public/listings`);
  if (params.q !== undefined) url.searchParams.set("q", params.q);
  if (params.cat !== undefined) url.searchParams.set("cat", params.cat);
  if (params.university !== undefined) url.searchParams.set("university", String(params.university));
  if (params.max_price !== undefined) url.searchParams.set("max_price", String(params.max_price));
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params.cursor !== undefined) url.searchParams.set("cursor", params.cursor);
  return url.toString();
}

export async function searchListings(
  params: SearchListingsParams,
  options: FetchPublicOptions = {}
): Promise<SearchListingsResult> {
  const response = await fetchPublic(buildSearchUrl(params), options);
  if (!response.ok) {
    await readJsonError(response);
  }
  const body = (await response.json()) as SearchListingsResult;
  if (!Array.isArray(body.listings)) {
    throw new SupostApiError(
      "Unexpected response shape from SUpost listings API.",
      502,
      "bad_upstream_response"
    );
  }
  return { listings: body.listings, next_cursor: body.next_cursor ?? null };
}

export interface ListingDetail {
  id: number;
  title: string | null;
  description: string | null;
  price: number | null;
  category: string | null;
  url: string;
}

/**
 * There is no by-id endpoint in the public API (yet); listing pages embed a
 * schema.org Product JSON-LD block with the same public fields plus the
 * description. We fetch `/post/index/<id>` — the only id-only form that gets
 * a real HTTP 308 to the canonical slug URL (supost-web src/proxy.ts), whose
 * page carries the Product JSON-LD — and read that block. Still a public,
 * cacheable, no-PII surface.
 */
export function extractProductJsonLd(html: string): {
  name?: string;
  description?: string;
  category?: string;
  url?: string;
  offers?: { price?: number };
} | null {
  const scripts = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  );
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1] ?? "");
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (node && node["@type"] === "Product") {
          return node;
        }
      }
    } catch {
      // skip malformed blocks
    }
  }
  return null;
}

export async function getListing(
  id: number,
  options: FetchPublicOptions = {}
): Promise<ListingDetail> {
  const pageUrl = `${getBaseUrl()}/post/index/${id}`;
  const response = await fetchPublic(pageUrl, options);
  if (response.status === 404) {
    throw new SupostApiError(
      `Listing ${id} was not found. It may have been sold, expired, or removed.`,
      404,
      "not_found"
    );
  }
  if (!response.ok) {
    throw new SupostApiError(
      `SUpost returned HTTP ${response.status} for listing ${id}.`,
      response.status,
      "http_error"
    );
  }
  const product = extractProductJsonLd(await response.text());
  if (product === null) {
    throw new SupostApiError(
      `Listing ${id} did not contain structured listing data.`,
      502,
      "bad_upstream_response"
    );
  }
  return {
    id,
    title: product.name ?? null,
    description: product.description ?? null,
    price: typeof product.offers?.price === "number" ? product.offers.price : null,
    category: product.category ?? null,
    url: product.url ?? pageUrl,
  };
}

/**
 * Market stats come from the public stats page's machine rendition
 * (/stats.md, doc 190 C2) — returned verbatim as markdown, since it is
 * already written for agent consumption.
 */
export async function getMarketStats(
  options: FetchPublicOptions = {}
): Promise<string> {
  const response = await fetchPublic(`${getBaseUrl()}/stats.md`, options);
  if (!response.ok) {
    throw new SupostApiError(
      `SUpost stats are temporarily unavailable (HTTP ${response.status}).`,
      response.status,
      "http_error"
    );
  }
  return response.text();
}
