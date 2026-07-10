# Announcement draft — SUpost MCP server

Angle (doc 190 E3/F): an early **classifieds MCP server** — possibly the
first student-marketplace MCP — is itself a citation-worthy story. Feeds the
off-site citation push (Workstream F: Stanford Daily, r/stanford, .edu
resource pages, Hacker News / MCP community).

## Short version (Reddit / HN / Slack)

> SUpost, the Stanford student marketplace (since 2005), now has a remote
> MCP server: https://supost-mcp.vercel.app/mcp
>
> Your AI assistant can search active listings, pull a listing's details,
> and cite verified market stats (response rates, medians) — no API key, no
> account. Claude Code: `claude mcp add --transport http supost
> https://supost-mcp.vercel.app/mcp`. There's also a plain JSON API with an
> OpenAPI spec: https://supost.com/api/public/openapi.json and docs at
> https://supost.com/help/mcp
>
> Everything is read-only and PII-free; to contact a poster you still go
> through the site. Feedback welcome — contact@supost.com.

## Story beats (press / blog pitch)

- Classifieds have barely moved since Craigslist; SUpost is making a
  20-year-old student marketplace natively usable by AI agents.
- Concrete demo: "Ask Claude to find furnished sublets near Stanford under
  $1,800" — the agent searches live listings and links canonical URLs.
- Trust angle: every poster is stanford.edu-verified; the stats tool serves
  conservative, database-mined figures (56–77% response rates by category).
- Openness angle: no key, no scraping arms race — llms.txt, markdown
  mirrors, OpenAPI spec, and MCP, all documented at /help/mcp.

## Checklist before posting

- [ ] /help/mcp live on production (supost-web PR #1242 merged + released)
- [ ] MCP registry listing live (see README follow-ups)
- [ ] Repo public (required for the registry story to land)
- [ ] Smoke script green against production
