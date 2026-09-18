import { getBaseUrl, getStatusPoll, getStatusRpc } from "./config.js";
import { fetchPublic, SupostApiError, type FetchPublicOptions } from "./http.js";

/**
 * Thin clients over SUpost's public surfaces (doc 190 E3). Shapes mirror the
 * public API contract (supost-web src/lib/public-listings.ts); nothing here
 * touches the database or any authenticated endpoint.
 */

export interface PublicListing {
  id: number;
  title: string | null;
  price: number | null;
  category: string | null;
  created_at: string | null;
  url: string;
  /** Poster email DOMAIN only (e.g. "stanford.edu"); never the raw address.
   *  Optional: absent until the public API deploy that adds it. */
  poster_email_domain?: string | null;
  /** True when the poster verified a Stanford email — the on-site
   *  "@stanford.edu verified" badge. SUpost's core trust signal. */
  stanford_verified?: boolean;
}

export interface SearchListingsResult {
  listings: PublicListing[];
  next_cursor: string | null;
}

export interface SearchListingsParams {
  q?: string;
  cat?: string;
  university?: number;
  max_price?: number;
  limit?: number;
  cursor?: string;
}

async function readJsonError(response: Response): Promise<never> {
  let code = "http_error";
  let message = `SUpost API returned HTTP ${response.status}.`;
  const details: Record<string, unknown> = {};
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.error === "string") code = body.error;
    if (typeof body.message === "string") message = body.message;
    for (const [key, value] of Object.entries(body)) {
      if (key !== "error" && key !== "message") details[key] = value;
    }
  } catch {
    // non-JSON error body; keep the generic message
  }
  throw new SupostApiError(message, response.status, code, details);
}

export function buildSearchUrl(params: SearchListingsParams, baseUrl = getBaseUrl()): string {
  const url = new URL(`${baseUrl}/api/public/listings`);
  if (params.q !== undefined) url.searchParams.set("q", params.q);
  if (params.cat !== undefined) url.searchParams.set("cat", params.cat);
  if (params.university !== undefined) url.searchParams.set("university", String(params.university));
  if (params.max_price !== undefined) url.searchParams.set("max_price", String(params.max_price));
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params.cursor !== undefined) url.searchParams.set("cursor", params.cursor);
  return url.toString();
}

export async function searchListings(
  params: SearchListingsParams,
  options: FetchPublicOptions = {}
): Promise<SearchListingsResult> {
  const response = await fetchPublic(buildSearchUrl(params), options);
  if (!response.ok) {
    await readJsonError(response);
  }
  const body = (await response.json()) as SearchListingsResult;
  if (!Array.isArray(body.listings)) {
    throw new SupostApiError(
      "Unexpected response shape from SUpost listings API.",
      502,
      "bad_upstream_response"
    );
  }
  return { listings: body.listings, next_cursor: body.next_cursor ?? null };
}

export interface ListingDetail {
  id: number;
  title: string | null;
  description: string | null;
  price: number | null;
  category: string | null;
  url: string;
  /** Public CDN photo URLs, in listing order. Empty when the post has no photos. */
  photos: string[];
  /** True when the poster verified a Stanford email — the on-site
   *  "@stanford.edu verified" badge. SUpost's core trust signal. */
  stanford_verified: boolean;
}

/**
 * There is no by-id endpoint in the public API (yet); listing pages embed a
 * schema.org Product JSON-LD block with the same public fields plus the
 * description. We fetch `/post/index/<id>` — the only id-only form that gets
 * a real HTTP 308 to the canonical slug URL (supost-web src/proxy.ts), whose
 * page carries the Product JSON-LD — and read that block. Still a public,
 * cacheable, no-PII surface.
 */
export function extractProductJsonLd(html: string): {
  name?: string;
  description?: string;
  category?: string;
  url?: string;
  image?: string | string[];
  offers?: { price?: number };
  additionalProperty?: Array<{ name?: string; value?: unknown }>;
} | null {
  const scripts = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  );
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1] ?? "");
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (node && node["@type"] === "Product") {
          return node;
        }
      }
    } catch {
      // skip malformed blocks
    }
  }
  return null;
}

export async function getListing(
  id: number,
  options: FetchPublicOptions = {}
): Promise<ListingDetail> {
  const pageUrl = `${getBaseUrl()}/post/index/${id}`;
  const response = await fetchPublic(pageUrl, options);
  if (response.status === 404) {
    throw new SupostApiError(
      `Listing ${id} was not found. It may have been sold, expired, or removed.`,
      404,
      "not_found"
    );
  }
  if (!response.ok) {
    throw new SupostApiError(
      `SUpost returned HTTP ${response.status} for listing ${id}.`,
      response.status,
      "http_error"
    );
  }
  const product = extractProductJsonLd(await response.text());
  if (product === null) {
    throw new SupostApiError(
      `Listing ${id} did not contain structured listing data.`,
      502,
      "bad_upstream_response"
    );
  }
  const photos = (
    Array.isArray(product.image) ? product.image : product.image ? [product.image] : []
  ).filter((entry): entry is string => typeof entry === "string");
  // supost-web emits a `posterVerified` PropertyValue only for posters with a
  // verified Stanford email (the on-site "@stanford.edu verified" badge).
  const stanfordVerified = Array.isArray(product.additionalProperty)
    ? product.additionalProperty.some(
        (prop) => prop?.name === "posterVerified" && prop.value === true
      )
    : false;

  return {
    id,
    title: product.name ?? null,
    description: product.description ?? null,
    price: typeof product.offers?.price === "number" ? product.offers.price : null,
    category: product.category ?? null,
    url: product.url ?? pageUrl,
    photos,
    stanford_verified: stanfordVerified,
  };
}

/**
 * Market stats come from the public stats page's machine rendition
 * (/stats.md, doc 190 C2) — returned verbatim as markdown, since it is
 * already written for agent consumption.
 */
export async function getMarketStats(
  options: FetchPublicOptions = {}
): Promise<string> {
  const response = await fetchPublic(`${getBaseUrl()}/stats.md`, options);
  if (!response.ok) {
    throw new SupostApiError(
      `SUpost stats are temporarily unavailable (HTTP ${response.status}).`,
      response.status,
      "http_error"
    );
  }
  return response.text();
}

export interface SendMessageParams {
  post_id: number;
  message: string;
  reply_to_email: string;
}

export interface SendMessageResult {
  status: "pending_verification";
  email: string;
  /** Handle for polling whether the confirmation email was delivered
   *  (`getMessageDeliveryStatus`). Not the redemption token: redeems
   *  nothing. Null when the API could not report a status for this
   *  submission (or on responses from before 2026-09-17). */
  status_key: string | null;
  detail?: string;
}

/**
 * Submits a message to a listing's poster via the public messages endpoint
 * (doc 222 Phase 1). The message is NOT delivered immediately: SUpost emails
 * a confirmation link to `reply_to_email`, and the message is only created
 * and delivered after the human clicks it. Report the result as "pending
 * confirmation", never as "sent".
 *
 * An address whose confirmation email recently hard-bounced is refused by
 * the API with a 422 `email_undeliverable` before anything is stored; that
 * surfaces here as a SupostApiError with `details.reason` / `details.email`.
 */
export async function sendMessage(
  params: SendMessageParams,
  options: FetchPublicOptions = {}
): Promise<SendMessageResult> {
  // Trusted-agent proof-of-origin (supost-web docs/dev/316): the public
  // messages endpoint requires either a page token (browser flow) or this
  // API key. Set SUPOST_API_KEY in the deployment env; never in git.
  const apiKey = process.env.SUPOST_API_KEY?.trim();
  const response = await fetchPublic(
    `${getBaseUrl()}/api/public/messages`,
    options,
    {
      method: "POST",
      body: JSON.stringify(params),
      ...(apiKey ? { headers: { "x-supost-api-key": apiKey } } : {}),
    }
  );
  if (!response.ok) {
    await readJsonError(response);
  }
  const body = (await response.json()) as Partial<SendMessageResult>;
  if (body.status !== "pending_verification" || typeof body.email !== "string") {
    throw new SupostApiError(
      "Unexpected response shape from SUpost messages API.",
      502,
      "bad_upstream_response"
    );
  }
  return {
    status: "pending_verification",
    email: body.email,
    status_key: typeof body.status_key === "string" ? body.status_key : null,
    ...(typeof body.detail === "string" ? { detail: body.detail } : {}),
  };
}

/** Delivery status of the confirmation-link email, as the marketplace
 *  stores it. `unknown`: the key is not recognised (expired, mistyped, or
 *  minted before status tracking) or polling is not configured. */
export type MessageDeliveryStatus = "queued" | "sent" | "failed" | "unknown";

/** Why the confirmation email could not be delivered (classified
 *  server-side; the raw SMTP text never leaves the marketplace). */
export type MessageDeliveryFailureReason =
  | "mailbox_unknown"
  | "no_mx"
  | "suppressed"
  | "other";

export interface MessageDelivery {
  status: MessageDeliveryStatus;
  /** Set only alongside `failed`. */
  reason: MessageDeliveryFailureReason | null;
}

const FAILURE_REASONS: readonly MessageDeliveryFailureReason[] = [
  "mailbox_unknown",
  "no_mx",
  "suppressed",
  "other",
];

export function parseDeliveryFailureReason(value: unknown): MessageDeliveryFailureReason {
  return typeof value === "string" &&
    (FAILURE_REASONS as readonly string[]).includes(value)
    ? (value as MessageDeliveryFailureReason)
    : "other";
}

const STATUS_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStatusKey(value: unknown): value is string {
  return typeof value === "string" && STATUS_KEY_RE.test(value);
}

/**
 * One poll of the confirmation email's delivery status: the anon-callable
 * PostgREST RPC `get_guest_verification_status(status_key)` (supost-web
 * migration 20260917213000), reached directly with the publishable key the
 * way the web form does — the marketplace deliberately has no poll route.
 * Returns `unknown` for an unrecognised key or when polling is disabled;
 * throws SupostApiError only on an HTTP failure.
 */
export async function getMessageDeliveryStatus(
  statusKey: string,
  options: FetchPublicOptions = {}
): Promise<MessageDelivery> {
  const rpc = getStatusRpc();
  if (!rpc || !isStatusKey(statusKey)) return { status: "unknown", reason: null };
  const response = await fetchPublic(
    `${rpc.url}/rest/v1/rpc/get_guest_verification_status`,
    options,
    {
      method: "POST",
      body: JSON.stringify({ p_status_key: statusKey }),
      headers: { apikey: rpc.key, authorization: `Bearer ${rpc.key}` },
    }
  );
  if (!response.ok) {
    throw new SupostApiError(
      `Delivery status lookup returned HTTP ${response.status}.`,
      response.status,
      "status_unavailable"
    );
  }
  const body = (await response.json()) as unknown;
  const row = (Array.isArray(body) ? body[0] : body) as
    | { status?: unknown; reason?: unknown }
    | null
    | undefined;
  const status = row?.status;
  if (status === "sent" || status === "queued") return { status, reason: null };
  if (status === "failed") {
    return { status: "failed", reason: parseDeliveryFailureReason(row?.reason) };
  }
  return { status: "unknown", reason: null };
}

/**
 * Polls `getMessageDeliveryStatus` up to `attempts` times, `intervalMs`
 * apart (first check after one interval — a suppressed address fails at
 * Mailgun in under a second, so it usually already has the answer), and
 * stops early on `sent` / `failed`. A lookup error counts as "still queued",
 * exactly like the web form: the send itself already succeeded.
 */
export async function waitForMessageDelivery(
  statusKey: string,
  options: FetchPublicOptions = {},
  poll: { attempts: number; intervalMs: number } = getStatusPoll()
): Promise<MessageDelivery> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: MessageDelivery = { status: "queued", reason: null };
  for (let i = 0; i < poll.attempts; i += 1) {
    await sleep(poll.intervalMs);
    try {
      last = await getMessageDeliveryStatus(statusKey, options);
    } catch {
      continue;
    }
    if (last.status !== "queued") return last;
  }
  return last;
}

/**
 * Agent-facing wording for an address the confirmation email cannot reach.
 * Mirrors the marketplace's own copy (factual, then the fix); the address is
 * the one the caller submitted, so the agent can quote it back to the user.
 */
export function describeUndeliverable(
  email: string,
  reason: MessageDeliveryFailureReason
): string {
  const stanford = /@(?:[a-z0-9-]+\.)*stanford\.edu$/i.test(email);
  const alt = stanford
    ? "If they have graduated or left Stanford, use their alumni or personal address."
    : "Check the spelling, or use another address.";
  switch (reason) {
    case "mailbox_unknown":
      return stanford
        ? `Stanford's mail server says ${email} doesn't exist. ${alt}`
        : `The mail server for ${email} says that mailbox doesn't exist. ${alt}`;
    case "no_mx":
      return `${email} can't receive mail: its domain has no mail server. Check the spelling of the address.`;
    case "suppressed":
    case "other":
    default:
      return `Email to ${email} isn't being delivered. ${alt}`;
  }
}

export interface PublicCategory {
  id: number;
  label: string;
  subcategories: Array<{ id: number; name: string }>;
}

/** The active category/subcategory taxonomy (valid create_post values). */
export async function listCategories(
  options: FetchPublicOptions = {}
): Promise<{ categories: PublicCategory[] }> {
  const response = await fetchPublic(
    `${getBaseUrl()}/api/public/categories`,
    options
  );
  if (!response.ok) {
    await readJsonError(response);
  }
  const body = (await response.json()) as { categories?: PublicCategory[] };
  if (!Array.isArray(body.categories)) {
    throw new SupostApiError(
      "Unexpected response shape from SUpost categories API.",
      502,
      "bad_upstream_response"
    );
  }
  return { categories: body.categories };
}

export interface CreatePostParams {
  category: string;
  subcategory: string;
  title: string;
  body: string;
  price?: number;
  email: string;
  publish?: boolean;
}

export interface CreatePostResult {
  draft_id: number;
  continue_url: string;
  payment_required?: boolean;
  publish_email_sent?: boolean;
  detail?: string;
}

/**
 * Creates a DRAFT listing via the public posts endpoint (doc 222 Phase 2).
 * The draft is never published by the API: the human opens `continue_url`
 * to add photos, review, and publish (paying first when their email isn't
 * on the free posting tier). `continue_url` grants edit access to the
 * draft — hand it to the poster only.
 */
export async function createPost(
  params: CreatePostParams,
  options: FetchPublicOptions = {}
): Promise<CreatePostResult> {
  const response = await fetchPublic(
    `${getBaseUrl()}/api/public/posts`,
    options,
    { method: "POST", body: JSON.stringify(params) }
  );
  if (!response.ok) {
    await readJsonError(response);
  }
  const body = (await response.json()) as CreatePostResult;
  if (typeof body.draft_id !== "number" || typeof body.continue_url !== "string") {
    throw new SupostApiError(
      "Unexpected response shape from SUpost posts API.",
      502,
      "bad_upstream_response"
    );
  }
  return body;
}
