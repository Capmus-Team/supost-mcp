import type { FetchLike } from "../src/http.js";

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html" },
  });
}

/** Records every requested URL and pops responses in order. */
export function fetchStub(responses: Response[]): {
  fetchImpl: FetchLike;
  urls: string[];
} {
  const urls: string[] = [];
  const queue = [...responses];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    const next = queue.shift();
    if (!next) throw new Error("fetchStub: no more queued responses");
    return next;
  };
  return { fetchImpl, urls };
}

export const noSleep = async () => {};
