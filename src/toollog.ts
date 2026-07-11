/**
 * Full tool-call log to the marketplace DB via the service-role-only
 * `public.log_mcp_tool_call` RPC (table: ops.mcp_tool_call). Unlike the
 * PostHog capture (analytics.ts), this records the COMPLETE tool arguments —
 * including user content such as message bodies and draft text — so it must
 * only ever land in the private ops schema, never a public surface.
 *
 * Enabled only when both env vars are set (Vercel project env, never the
 * repo): TOOL_LOG_URL (Supabase project URL) + TOOL_LOG_KEY (service-role
 * key). Absent env → no-op, which keeps local dev and tests offline.
 */

import { getBrand } from "./config.js";

const LOG_TIMEOUT_MS = 3_000;

function logTarget(): { url: string; key: string } | null {
  const url = process.env.TOOL_LOG_URL;
  const key = process.env.TOOL_LOG_KEY;
  if (!url || !key || process.env.NODE_ENV === "test") return null;
  return { url: url.replace(/\/$/, ""), key };
}

/** Never throws, never blocks the tool response beyond its 3s cap. */
export function logToolCall(
  tool: string,
  ok: boolean,
  args: Record<string, unknown>,
  error: string | null
): Promise<void> {
  const target = logTarget();
  if (!target) return Promise.resolve();
  return fetch(`${target.url}/rest/v1/rpc/log_mcp_tool_call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: target.key,
      authorization: `Bearer ${target.key}`,
    },
    body: JSON.stringify({
      p_brand: getBrand().key,
      p_tool: tool,
      p_ok: ok,
      p_args: args,
      p_error: error,
    }),
    signal: AbortSignal.timeout(LOG_TIMEOUT_MS),
  })
    .then(() => undefined)
    .catch(() => undefined);
}
