# supost-mcp

Remote [MCP](https://modelcontextprotocol.io) server for **SUpost**, the
marketplace for Stanford — and, via `BRAND=capmus`, for **Capmus**
(capmus.com), which serves the same public API from the same supost-web
codebase. One repo, two Vercel projects:

| Brand | Vercel project | Endpoint | Env |
| --- | --- | --- | --- |
| SUpost | `supost-mcp` | `https://mcp.supost.com/mcp` | (defaults) |
| Capmus | `capmus-mcp` | `https://mcp.capmus.com/mcp` | `BRAND=capmus` |

`BRAND` selects the server name, tool titles/descriptions, and default base
URL; `SUPOST_BASE_URL` still overrides the base URL for previews.

Lets AI agents search active listings, fetch
listing details, read verified market statistics, message posters, and
create draft listings.

This is doc 190 workstream **E3** (see `supost-web/docs/dev/190-ai-agent-discovery-implementation-plan.md`).
It is a **pure client** of SUpost's public surfaces — the read-only listings
API (E2), public listing pages, and `/stats.md`. It has **no privileged
database access and holds no secrets**; the only configuration is the public
base URL.

## Tools

| Tool | Backing surface | What it returns |
| --- | --- | --- |
| `search_listings` | `GET /api/public/listings` | Newest-first active listings (id, title, price, category, created_at, canonical URL) with opaque cursor pagination. Params: `q`, `cat`, `university`, `max_price`, `limit` (≤50), `cursor`. |
| `get_listing` | `GET /post/index/<id>` → canonical listing page | One listing incl. full description, parsed from the page's schema.org `Product` JSON-LD. |
| `get_market_stats` | `GET /stats.md` | The public stats page's markdown rendition (audience, listing volumes, response rates/times). |
| `list_categories` | `GET /api/public/categories` | The active category/subcategory taxonomy — valid `create_post` values. |
| `create_post` | `POST /api/public/posts` | Creates a DRAFT listing; returns a `continue_url` where the poster adds photos, reviews, and publishes (paying first when not on the free tier). Never publishes directly. |
| `send_message` | `POST /api/public/messages` | Submits a message to a listing's poster. NOT delivered immediately: a confirmation link is emailed to `reply_to_email`, and the message only goes out after the human clicks it — agents must report it as pending confirmation, never sent. |
| `check_message_status` | PostgREST RPC `get_guest_verification_status` (publishable key) | Whether the confirmation email for a `send_message` submission was delivered: `queued` / `sent` / `failed` (+ reason) / `unknown`. Never whether the link was clicked. |

No personal information is ever returned. `send_message` is the supported
way to contact a poster; the listing's `url` also carries the on-site
message form. API terms:
`https://supost.com/api/public/openapi.json`.

## Bouncing addresses

A message is only ever delivered after the human clicks the confirmation
link, so an address the link cannot reach is a message that never arrives
(supost-web `docs/dev/20260917-2040-guest-reply-bounce-feedback-handoff.md`).
`send_message` therefore never answers a plain "pending" for a dead address:

- An address whose confirmation email hard-bounced in the last 30 days is
  refused by the API with `422 email_undeliverable` before anything is
  stored. The tool returns an **error result** with
  `{status: "email_undeliverable", reason, email, message}` and tells the
  agent to ask for a different address rather than retry.
- Otherwise the API answers `202` with a `status_key`, and the tool polls
  the delivery status of the confirmation email for up to ~8 s (four checks,
  two seconds apart — a suppressed address fails in under a second, a fresh
  hard bounce in 1–16 s). A `failed` verdict is reported the same way as the
  422; `sent` / `queued` come back in the result as `confirmation_email`,
  with the `status_key` for a later `check_message_status`.

The poll is the same anon-callable PostgREST RPC the web form uses,
`get_guest_verification_status(status_key)`, reached with the marketplace's
**publishable** key (the value every browser already gets). It returns only
`queued | sent | failed` and a failure classification
(`mailbox_unknown | no_mx | suppressed | other`) — never the redemption
token, the message, or the address. Env: `SUPOST_STATUS_URL` /
`SUPOST_STATUS_KEY` override the defaults (production project);
`SUPOST_STATUS_KEY=""` disables polling (tools report `unknown`);
`SUPOST_STATUS_POLL_ATTEMPTS` / `SUPOST_STATUS_POLL_INTERVAL_MS` tune the
in-call wait.

## Hosting

Deployed on Vercel as a stateless **streamable-HTTP** MCP endpoint
([`mcp-handler`](https://www.npmjs.com/package/mcp-handler) +
`@modelcontextprotocol/sdk`):

```
https://mcp.supost.com/mcp        (rewritten to /api/mcp)
```

No sessions, no Redis, no auth — every request is independently served and
all upstream data is public and CDN-cached.

### Deploy

```sh
vercel deploy          # preview
vercel deploy --prod   # production
```

Optional env var: `SUPOST_BASE_URL` (default `https://supost.com`; set to
`https://preview.supost.com` on preview deployments to point at the dev
stack).

### Connect a client

```sh
claude mcp add --transport http supost https://mcp.supost.com/mcp
```

or in any MCP client that supports remote servers, add the URL above as a
streamable-HTTP server.

## Rate limiting

The public API enforces ~60 requests/minute/IP and serves 5-minute CDN
caching. The client in [src/http.ts](src/http.ts) respects this: on a 429 it
honors `Retry-After` (capped at 5 s), retries **once**, and otherwise
surfaces a structured `rate_limited` error instructing the agent to back off
— it never retries in a loop. All requests carry a `supost-mcp/…` User-Agent.

## Development

```sh
npm install
npm run check    # typecheck + tests
SUPOST_BASE_URL=https://preview.supost.com npx tsx scripts/smoke.ts   # live end-to-end
```

Tests (vitest) cover each tool's request/response mapping, error mapping,
JSON-LD extraction, and the rate-limit contract (Retry-After honored, capped,
single retry, structured failure).

## Follow-ups (manual steps)

- [ ] **Publish to the MCP registry** — [server.json](server.json) is ready.
      Make the repo public first (`gh repo edit Capmus-Team/supost-mcp
      --visibility public`), then:
      ```sh
      brew install mcp-publisher
      mcp-publisher login github   # device flow, needs a browser
      mcp-publisher publish        # from the repo root
      ```
      For the Capmus entry, publish [server.capmus.json](server.capmus.json)
      the same way (`cp server.capmus.json server.json` in a scratch checkout,
      or `mcp-publisher publish --file server.capmus.json` if supported).
- [x] **`/help/mcp` docs page in supost-web** — PR
      [#1242](https://github.com/Capmus-Team/supost-web/pull/1242) (guide
      registry entry + llms.txt MCP line); live once merged to dev → master.
- [ ] **PR/citation announcement** — draft and story beats in
      [docs/announcement-draft.md](docs/announcement-draft.md); post after
      the registry listing and /help/mcp are live (doc 190 workstream F).
- [x] E2 is live on production (`supost.com`, 2026-07-09); smoke script
      verified against production, and the server is deployed at
      `https://mcp.supost.com/mcp`.
