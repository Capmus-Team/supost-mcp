/**
 * Fire-and-forget PostHog capture of tool calls — the read-side usage signal
 * the marketplace DB can't see (only write actions land in
 * analytics.conversion_event). One event per tool invocation, no params and
 * no PII: tool name, brand, and whether the call errored.
 *
 * The key is PostHog's *publishable* client token (same project 467959 the
 * web app uses), so this keeps the repo's no-secrets property. Set
 * POSTHOG_KEY="" to disable capture entirely.
 */

import { getBrand } from "./config.js";

const DEFAULT_KEY = "phc_yPfYnnQ3nCB5SVhYagYQeZfMYgbsaMXZLgHcL27rDEDR";
const CAPTURE_URL = "https://us.posthog.com/i/v0/e/";

function captureKey(): string | null {
  const key = process.env.POSTHOG_KEY ?? DEFAULT_KEY;
  if (!key || process.env.NODE_ENV === "test") return null;
  return key;
}

/**
 * Never throws, never blocks the tool response. A fixed per-brand
 * distinct_id ("mcp.supost.com") keeps this from minting a PostHog person
 * per request.
 */
export function captureToolCall(tool: string, ok: boolean): Promise<void> {
  const key = captureKey();
  if (!key) return Promise.resolve();
  const brand = getBrand().key;
  return fetch(CAPTURE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event: "mcp_tool_called",
      distinct_id: `mcp.${brand}.com`,
      properties: {
        tool,
        brand,
        ok,
        // Server-side event for a shared identity — never create a person.
        $process_person_profile: false,
      },
    }),
    signal: AbortSignal.timeout(3000),
  })
    .then(() => undefined)
    .catch(() => undefined);
}
