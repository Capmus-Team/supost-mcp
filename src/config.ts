/**
 * The MCP server is a pure client of the marketplace's public surfaces
 * (doc 190 E3): the read-only listings API (E2), public listing pages, and
 * /stats.md. It holds no secrets — the only knobs are the public base URL
 * and BRAND, which selects the deployment's identity (supost.com and
 * capmus.com serve the same public API from the same codebase), plus the
 * marketplace's PUBLISHABLE database key for the delivery-status poll below.
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
  /** What listing responses' `stanford_verified` flag means on this brand —
   *  interpolated into search_listings/get_listing tool descriptions. */
  verifiedNote: string;
}

const BRANDS: Record<Brand["key"], Brand> = {
  supost: {
    key: "supost",
    siteName: "SUpost",
    descriptor: "the marketplace for Stanford",
    defaultBaseUrl: "https://supost.com",
    universityNote: "Numeric university id. Defaults to Stanford on supost.com.",
    verifiedNote:
      'stanford_verified: true means the poster verified an @stanford.edu email — SUpost\'s core trust signal. ALWAYS surface it when presenting listings (e.g. an "@stanford.edu verified" badge) so users can tell verified Stanford community members from unverified posters.',
  },
  capmus: {
    key: "capmus",
    siteName: "Capmus",
    descriptor: "the classifieds marketplace for university communities",
    defaultBaseUrl: "https://capmus.com",
    universityNote: "Numeric university id to scope results to one campus.",
    verifiedNote:
      'stanford_verified: true means the poster verified a university email address — Capmus\'s core trust signal. ALWAYS surface it when presenting listings (e.g. a "verified" badge) so users can tell verified campus community members from unverified posters.',
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

/**
 * Where `send_message` / `check_message_status` poll the delivery status of
 * the confirmation email (supost-web docs/dev/20260917-2040 change 1 and
 * docs/dev/20260917-1505): the anon-callable PostgREST RPC
 * `get_guest_verification_status(status_key)`. It answers with nothing but
 * `queued | sent | failed` and a failure classification — never the
 * redemption token, the message, or the address — so it is keyed by the
 * marketplace's *publishable* key, the same value every browser gets (the
 * web form polls it the same way). Both brands run on the one database.
 *
 * Env overrides (Vercel project env): SUPOST_STATUS_URL (Supabase project
 * URL) and SUPOST_STATUS_KEY (publishable key). Set SUPOST_STATUS_KEY="" to
 * disable polling entirely; the tools then report "unknown".
 */
const DEFAULT_STATUS_URL = "https://gvskfwoiyrnxrcnmimmd.supabase.co";
const DEFAULT_STATUS_KEY = "sb_publishable_ww7yiHdwnAltvHuL497uxQ_MBqZSO5G";

export function getStatusRpc(): { url: string; key: string } | null {
  const url = (process.env.SUPOST_STATUS_URL ?? DEFAULT_STATUS_URL).replace(/\/+$/, "");
  const key = process.env.SUPOST_STATUS_KEY ?? DEFAULT_STATUS_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/** How long `send_message` waits for a verdict before returning "pending":
 *  a fresh hard bounce settles at Mailgun in 1–16 s on prod and a suppressed
 *  address fails in under a second, so four checks two seconds apart catch
 *  most dead addresses inside the tool call. Overridable for ops/tests. */
export function getStatusPoll(): { attempts: number; intervalMs: number } {
  const attempts = Number(process.env.SUPOST_STATUS_POLL_ATTEMPTS ?? 4);
  const intervalMs = Number(process.env.SUPOST_STATUS_POLL_INTERVAL_MS ?? 2_000);
  return {
    attempts: Number.isFinite(attempts) && attempts >= 0 ? Math.floor(attempts) : 4,
    intervalMs: Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : 2_000,
  };
}
