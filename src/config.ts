/**
 * The MCP server is a pure client of SUpost's public surfaces (doc 190 E3):
 * the read-only listings API (E2), public listing pages, and /stats.md.
 * It holds no secrets — SUPOST_BASE_URL is the only knob, and it's public.
 */
export function getBaseUrl(): string {
  const raw = process.env.SUPOST_BASE_URL ?? "https://supost.com";
  return raw.replace(/\/+$/, "");
}
