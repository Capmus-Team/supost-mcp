/**
 * The MCP server is a pure client of the marketplace's public surfaces
 * (doc 190 E3): the read-only listings API (E2), public listing pages, and
 * /stats.md. It holds no secrets — the only knobs are the public base URL
 * and BRAND, which selects the deployment's identity (supost.com and
 * capmus.com serve the same public API from the same codebase).
 */

export interface Brand {
  key: "supost" | "capmus";
  /** MCP server name and tool-title prefix. */
  siteName: string;
  /** Short positioning phrase used in tool descriptions. */
  descriptor: string;
  defaultBaseUrl: string;
  /** How the `university` search param defaults on this host. */
  universityNote: string;
}

const BRANDS: Record<Brand["key"], Brand> = {
  supost: {
    key: "supost",
    siteName: "SUpost",
    descriptor: "the marketplace for Stanford",
    defaultBaseUrl: "https://supost.com",
    universityNote: "Numeric university id. Defaults to Stanford on supost.com.",
  },
  capmus: {
    key: "capmus",
    siteName: "Capmus",
    descriptor: "the classifieds marketplace for university communities",
    defaultBaseUrl: "https://capmus.com",
    universityNote: "Numeric university id to scope results to one campus.",
  },
};

export function getBrand(): Brand {
  const key = process.env.BRAND ?? "supost";
  const brand = BRANDS[key as Brand["key"]];
  if (!brand) {
    throw new Error(`Unknown BRAND "${key}" (expected "supost" or "capmus").`);
  }
  return brand;
}

export function getBaseUrl(): string {
  // Note: not "BASE_URL" — Vite/Vitest injects its own process.env.BASE_URL.
  const raw = process.env.SUPOST_BASE_URL ?? getBrand().defaultBaseUrl;
  return raw.replace(/\/+$/, "");
}
