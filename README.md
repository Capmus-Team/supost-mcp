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

- [ ] **Publish to the MCP registry** — [server.json](server.json) is ready.
      Make the repo public first (`gh repo edit Capmus-Team/supost-mcp
      --visibility public`), then:
      ```sh
      brew install mcp-publisher
      mcp-publisher login github   # device flow, needs a browser
      mcp-publisher publish        # from the repo root
      ```
- [x] **`/help/mcp` docs page in supost-web** — PR
      [#1242](https://github.com/Capmus-Team/supost-web/pull/1242) (guide
      registry entry + llms.txt MCP line); live once merged to dev → master.
- [ ] **PR/citation announcement** — draft and story beats in
      [docs/announcement-draft.md](docs/announcement-draft.md); post after
      the registry listing and /help/mcp are live (doc 190 workstream F).
- [x] E2 is live on production (`supost.com`, 2026-07-09); smoke script
      verified against production, and the server is deployed at
      `https://supost-mcp.vercel.app/mcp`.
