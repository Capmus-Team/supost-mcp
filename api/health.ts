import { getBrand } from "../src/config.js";
import { serverVersion } from "../src/version.js";

/**
 * Liveness probe at /api/health (rewritten from /health, vercel.json) for
 * the UptimeRobot monitors on mcp.supost.com and mcp.capmus.com. Reports the
 * brand and the deployed version+commit so a stale deploy is visible from
 * the outside. No upstream calls: this answers "is the function serving",
 * not "is supost.com up".
 */
export function GET(): Response {
  return Response.json(
    { ok: true, brand: getBrand().key, version: serverVersion() },
    { headers: { "cache-control": "no-store" } }
  );
}
