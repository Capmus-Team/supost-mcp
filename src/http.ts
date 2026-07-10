/**
 * Fetch wrapper for SUpost's public endpoints with rate-limit-respecting
 * behavior: the public API returns 429 (in-memory limiter, 60 req/min/IP).
 * On 429 we honor Retry-After when present (capped), retry once, and if
 * still limited surface a structured error telling the agent to back off —
 * we never hammer the origin in a loop.
 */

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<Response>;

export class SupostApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = "SupostApiError";
  }
}

const MAX_RETRY_AFTER_MS = 5_000;
const DEFAULT_RETRY_AFTER_MS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "supost-mcp/0.1 (+https://github.com/capmus-team/supost-mcp)";

function retryDelayMs(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = header === null ? NaN : Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_RETRY_AFTER_MS;
  }
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

export interface FetchPublicOptions {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

export async function fetchPublic(
  url: string,
  options: FetchPublicOptions = {}
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let response = await fetchImpl(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json, text/markdown, text/html" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 429) {
    await sleep(retryDelayMs(response));
    response = await fetchImpl(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json, text/markdown, text/html" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 429) {
      throw new SupostApiError(
        "SUpost rate limit reached (60 requests/minute per IP). Wait a minute before retrying; results are CDN-cached for 5 minutes, so repeating an identical query sooner returns nothing new.",
        429,
        "rate_limited"
      );
    }
  }

  return response;
}
