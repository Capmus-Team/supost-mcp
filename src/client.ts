/**
 * Privacy-preserving caller identity for the PostHog usage signal
 * (analytics.ts). Without it every tool call lands on one fixed distinct_id
 * per brand, so "how many agents use the MCP" is unanswerable.
 *
 * The identity is a one-way hash of the caller's IP + User-Agent, salted
 * with CLIENT_ID_SALT (Vercel project env; the default keeps local dev
 * working). The raw IP is never sent anywhere. Country comes from Vercel's
 * geo header, so the event's location reflects the caller rather than the
 * function region (which is what PostHog's own geoip saw before).
 */

import { createHash } from "node:crypto";

const DEFAULT_SALT = "supost-mcp-client-id-v1";

/** Loose shape of `extra.requestInfo.headers` (Node IncomingHttpHeaders-like). */
export type HeaderBag = Record<string, string | string[] | undefined>;

export type ClientIdentity = {
  /** Stable, opaque id for IP + User-Agent — the PostHog distinct_id. */
  client_id: string;
  /** Raw User-Agent (MCP clients identify their harness here; not PII). */
  client_ua: string | null;
  /** ISO country code from Vercel's edge, or null outside Vercel. */
  client_country: string | null;
};

function header(headers: HeaderBag, name: string): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  const first = Array.isArray(value) ? value[0] : value;
  return first ? first.trim() : null;
}

/** First hop of x-forwarded-for (the client), else x-real-ip. */
export function clientIp(headers: HeaderBag): string | null {
  const forwarded = header(headers, "x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return header(headers, "x-real-ip");
}

/**
 * Returns null when nothing identifies the caller (no IP, no UA), so the
 * capture falls back to the per-brand distinct_id rather than hashing an
 * empty string into one shared "user".
 */
export function identifyClient(headers: HeaderBag | undefined): ClientIdentity | null {
  if (!headers) return null;
  const ip = clientIp(headers);
  const ua = header(headers, "user-agent");
  if (!ip && !ua) return null;
  const salt = process.env.CLIENT_ID_SALT || DEFAULT_SALT;
  const digest = createHash("sha256")
    .update(`${salt}|${ip ?? ""}|${ua ?? ""}`)
    .digest("hex");
  return {
    client_id: `client:${digest.slice(0, 24)}`,
    client_ua: ua,
    client_country: header(headers, "x-vercel-ip-country"),
  };
}
