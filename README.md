# supost-mcp

Remote [MCP](https://modelcontextprotocol.io) server for **SUpost**, the
Stanford student marketplace. Lets AI agents search active listings, fetch
listing details, and read verified market statistics.

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

No personal information is ever returned; to contact a poster, agents open
the listing's `url` and use the on-site message flow. API terms:
`https://supost.com/api/public/openapi.json`.

## Hosting

Deployed on Vercel as a stateless **streamable-HTTP** MCP endpoint
([`mcp-handler`](https://www.npmjs.com/package/mcp-handler) +
`@modelcontextprotocol/sdk`):

```
https://<deployment>/mcp        (rewritten to /api/mcp)
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
claude mcp add --transport http supost https://<deployment>/mcp
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

- [ ] **Publish to the MCP registry** (registry.modelcontextprotocol.io) once
      the production deployment is live, so agent platforms can discover it.
- [ ] **Add a `/help/mcp` docs page in supost-web** (pattern:
      `src/lib/help-guides.ts` registry) documenting the endpoint URL, tools,
      and terms; link it from `llms.txt`.
- [ ] **PR/citation announcement** — an early classifieds MCP is itself a
      story ("first student-marketplace MCP server"); feeds the doc 190
      workstream F off-site citation push (Stanford Daily, Reddit, .edu
      resource pages).
- [ ] After E2 ships to production (`supost.com`), re-run the smoke script
      against production and flip any preview URLs in client configs.
