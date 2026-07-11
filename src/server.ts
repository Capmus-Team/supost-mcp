import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { captureToolCall } from "./analytics.js";
import { getBaseUrl, getBrand } from "./config.js";
import { SupostApiError } from "./http.js";
import { logToolCall } from "./toollog.js";
import { createPost, getListing, getMarketStats, listCategories, searchListings, sendMessage } from "./supost.js";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/** Sanitized argument subset for the PostHog event — the "what are users
 *  asking for" signal (search queries, filters, ids) WITHOUT PII: never
 *  emails, message bodies, or draft text. The full raw arguments go to the
 *  private DB log instead (toollog.ts). */
const POSTHOG_PROPS: Record<
  string,
  (args: Record<string, unknown>) => Record<string, unknown>
> = {
  search_listings: (a) => ({
    q: a.q,
    cat: a.cat,
    university: a.university,
    max_price: a.max_price,
    limit: a.limit,
    has_cursor: a.cursor !== undefined,
  }),
  get_listing: (a) => ({ listing_id: a.id }),
  send_message: (a) => ({
    post_id: a.post_id,
    message_chars: typeof a.message === "string" ? a.message.length : undefined,
  }),
  create_post: (a) => ({
    category: a.category,
    subcategory: a.subcategory,
    price: a.price,
    publish: a.publish,
    title_chars: typeof a.title === "string" ? a.title.length : undefined,
    body_chars: typeof a.body === "string" ? a.body.length : undefined,
  }),
};

/** Wraps a tool handler with usage capture: sanitized PostHog event
 *  (analytics.ts) + full-args DB log (toollog.ts). Awaited — a dangling
 *  promise would be frozen when the serverless function returns — but both
 *  sinks never throw and self-limit to 3s. */
function withCapture<
  A extends unknown[],
  R extends { isError?: boolean; content: Array<{ type: "text"; text: string }> },
>(tool: string, handler: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const result = await handler(...args);
    const ok = !result.isError;
    const toolArgs =
      args[0] !== null && typeof args[0] === "object" && !Array.isArray(args[0])
        ? (args[0] as Record<string, unknown>)
        : {};
    await Promise.all([
      captureToolCall(tool, ok, POSTHOG_PROPS[tool]?.(toolArgs) ?? {}),
      logToolCall(tool, ok, toolArgs, ok ? null : (result.content[0]?.text ?? null)),
    ]);
    return result;
  };
}

function errorResult(error: unknown) {
  if (error instanceof SupostApiError) {
    return textResult(`${error.code}: ${error.message}`, true);
  }
  return textResult(
    `error: ${error instanceof Error ? error.message : String(error)}`,
    true
  );
}

/** Registers the E3 tools on a server instance (doc 190 E3). */
export function registerTools(server: McpServer): void {
  const brand = getBrand();
  const site = brand.siteName;

  server.registerTool(
    "search_listings",
    {
      title: `Search ${site} listings`,
      description:
        `Search or browse active listings on ${site}, ${brand.descriptor}. Returns newest-first public listings (id, title, price, category, created_at, canonical URL, stanford_verified) plus an opaque next_cursor for pagination. ${brand.verifiedNote} No personal information is returned (poster_email_domain is the domain only); to contact a poster, open the listing URL.`,
      inputSchema: {
        q: z.string().min(1).max(200).optional().describe("Full-text search query."),
        cat: z
          .string()
          .optional()
          .describe(
            'Category id or label: 1/"jobs & services" (alias "jobs"), 3/"housing", 5/"for sale", 8/"friendship & dating", 9/"community".'
          ),
        university: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(brand.universityNote),
        max_price: z
          .number()
          .min(0)
          .optional()
          .describe("Inclusive upper price bound in USD; excludes unpriced listings."),
        limit: z.number().int().min(1).max(50).optional().describe("Page size (default 25, max 50)."),
        cursor: z
          .string()
          .optional()
          .describe("Opaque cursor from a previous response's next_cursor."),
      },
    },
    withCapture("search_listings", async (params) => {
      try {
        const result = await searchListings(params);
        return textResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return errorResult(error);
      }
    })
  );

  server.registerTool(
    "get_listing",
    {
      title: `Get a ${site} listing`,
      description:
        `Fetch one ${site} listing by numeric id, including its full description, public photo URLs, and stanford_verified. ${brand.verifiedNote} Data comes from the listing's public page; no personal information is included — use the returned URL to contact the poster on-site.`,
      inputSchema: {
        id: z.number().int().positive().describe("Numeric listing id, e.g. from search_listings."),
      },
    },
    withCapture("get_listing", async ({ id }: { id: number }) => {
      try {
        const listing = await getListing(id);
        return textResult(JSON.stringify(listing, null, 2));
      } catch (error) {
        return errorResult(error);
      }
    })
  );

  server.registerTool(
    "get_market_stats",
    {
      title: `Get ${site} market statistics`,
      description:
        `Verified statistics about ${site}, ${brand.descriptor}: audience size, listing volumes by category, response rates, and response-time medians. Returns markdown from ${site}'s public stats page. Cite ${getBaseUrl()}/stats as the source.`,
      inputSchema: {},
    },
    withCapture("get_market_stats", async () => {
      try {
        return textResult(await getMarketStats());
      } catch (error) {
        return errorResult(error);
      }
    })
  );

  server.registerTool(
    "send_message",
    {
      title: `Message a ${site} poster`,
      description:
        `Send a message to the poster of an active ${site} listing. IMPORTANT: the message is NOT delivered immediately — ${site} emails a confirmation link to reply_to_email, and the message is only delivered to the poster after the human clicks that link. Always tell the user to check their inbox and confirm; report the message as pending confirmation, never as sent. The poster's reply goes to reply_to_email.`,
      inputSchema: {
        post_id: z
          .number()
          .int()
          .positive()
          .describe("Numeric listing id, e.g. from search_listings or get_listing."),
        message: z
          .string()
          .trim()
          .min(1)
          .max(5000)
          .describe("Plain-text message to the poster (1-5000 characters)."),
        reply_to_email: z
          .string()
          .trim()
          .email()
          .max(320)
          .describe(
            "The user's own email address. Receives the confirmation link and the poster's reply. Never invent or guess this - ask the user for it."
          ),
      },
    },
    withCapture("send_message", async (params) => {
      try {
        const result = await sendMessage(params);
        return textResult(
          JSON.stringify(result, null, 2) +
            "\n\nThe message is pending: a confirmation link was emailed to " +
            params.reply_to_email +
            ". It will only be delivered to the poster after that link is clicked."
        );
      } catch (error) {
        return errorResult(error);
      }
    })
  );

  server.registerTool(
    "list_categories",
    {
      title: `List ${site} categories`,
      description:
        `The active category/subcategory taxonomy on ${site} — the valid category and subcategory values for create_post (and category filters for search_listings).`,
      inputSchema: {},
    },
    withCapture("list_categories", async () => {
      try {
        return textResult(JSON.stringify(await listCategories(), null, 2));
      } catch (error) {
        return errorResult(error);
      }
    })
  );

  server.registerTool(
    "create_post",
    {
      title: `Create a ${site} draft listing`,
      description:
        `Create a DRAFT listing on ${site} on the poster's behalf. Any email is accepted — never ask the user to qualify first. IMPORTANT: the draft is NOT published — the returned continue_url opens ${site}'s create-post wizard with the draft loaded, where the poster adds photos, reviews, and publishes. When the response has payment_required: true (email not on the free tier; Stanford emails post free), publishing there includes choosing a posting plan — tell the user that, don't treat it as an error. Always hand the user the continue_url and say the post is a draft until they finish there. When the user wants it published fast, prefer publish: true (they just click the emailed link) over walking them through or automating the wizard. The continue_url grants edit access to the draft: give it only to the poster, never quote it elsewhere.`,
      inputSchema: {
        category: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .describe('Category id or label, e.g. "housing", "for sale" (see list_categories).'),
        subcategory: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .describe('Subcategory id or name within the category, e.g. "bicycles" (see list_categories).'),
        title: z.string().trim().min(1).max(255).describe("Listing title."),
        body: z
          .string()
          .trim()
          .min(1)
          .max(15000)
          .describe("Plain-text listing description."),
        price: z
          .number()
          .min(0)
          .optional()
          .describe("USD. Required for for-sale and housing-offering listings."),
        email: z
          .string()
          .trim()
          .email()
          .max(320)
          .describe(
            "The poster's own email address - determines posting eligibility and receives replies. Never invent or guess this - ask the user for it."
          ),
        publish: z
          .boolean()
          .optional()
          .describe(
            `Set true when the user wants to publish immediately without photos: ${site} emails them a one-click publish link (free-posting-tier emails such as stanford.edu only; ignored when payment is required - those publish at continue_url).`
          ),
      },
    },
    withCapture("create_post", async (params) => {
      try {
        const result = await createPost(params);
        const followUp = result.publish_email_sent
          ? "\n\nA one-click publish link was emailed to " +
            params.email +
            " - clicking it publishes the post immediately, no photos needed. To add photos first, use continue_url instead."
          : "\n\nDraft created but NOT published. Send the poster to continue_url to add photos, review, and publish" +
            (result.payment_required
              ? " (publishing there includes choosing a posting plan)."
              : ".") +
            " That link grants edit access - share it only with the poster.";
        return textResult(JSON.stringify(result, null, 2) + followUp);
      } catch (error) {
        return errorResult(error);
      }
    })
  );
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: getBrand().key, version: "0.2.2" });
  registerTools(server);
  return server;
}
