/**
 * Fire-and-forget PostHog capture of tool calls — the read-side usage signal
 * the marketplace DB can't see (only write actions land in
 * analytics.conversion_event). One event per tool invocation with a
 * SANITIZED subset of arguments and no PII: tool name, brand, whether the
 * call errored, plus per-tool props like the search query — never emails or
 * message/draft text (the full payload goes to the DB log, toollog.ts).
 *
 * The key is PostHog's *publishable* client token (same project 467959 the
 * web app uses), so this keeps the repo's no-secrets property. Set
 * POSTHOG_KEY="" to disable capture entirely.
 */

import type { ClientIdentity } from "./client.js";
import { getBrand } from "./config.js";

const DEFAULT_KEY = "phc_yPfYnnQ3nCB5SVhYagYQeZfMYgbsaMXZLgHcL27rDEDR";
const CAPTURE_URL = "https://us.posthog.com/i/v0/e/";

function captureKey(): string | null {
  const key = process.env.POSTHOG_KEY ?? DEFAULT_KEY;
  if (!key || process.env.NODE_ENV === "test") return null;
  return key;
}

/**
 * Never throws, never blocks the tool response. The distinct_id is the
 * caller's hashed identity (client.ts) so `uniq(distinct_id)` counts
 * agents; without one it falls back to the per-brand "mcp.supost.com".
 * `$process_person_profile: false` keeps either from minting a PostHog
 * person per caller. `errorCode` is the upstream SupostApiError code
 * (rate_limited, not_found, …) or "unknown" for any other failure — never
 * the error message, which can quote user content.
 */
export function captureToolCall(
  tool: string,
  ok: boolean,
  props: Record<string, unknown> = {},
  client: ClientIdentity | null = null,
  errorCode: string | null = null
): Promise<void> {
  const key = captureKey();
  if (!key) return Promise.resolve();
  const brand = getBrand().key;
  return fetch(CAPTURE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event: "mcp_tool_called",
      distinct_id: client?.client_id ?? `mcp.${brand}.com`,
      properties: {
        ...props,
        tool,
        brand,
        ok,
        error_code: ok ? null : (errorCode ?? "unknown"),
        client_id: client?.client_id ?? null,
        client_ua: client?.client_ua ?? null,
        client_country: client?.client_country ?? null,
        // Server-side event for a hashed identity — never create a person.
        $process_person_profile: false,
      },
    }),
    signal: AbortSignal.timeout(3000),
  })
    .then(() => undefined)
    .catch(() => undefined);
}
