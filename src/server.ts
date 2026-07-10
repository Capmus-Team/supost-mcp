import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupostApiError } from "./http.js";
import { createPost, getListing, getMarketStats, listCategories, searchListings, sendMessage } from "./supost.js";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
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

/** Registers the three E3 tools on a server instance (doc 190 E3). */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "search_listings",
    {
      title: "Search SUpost listings",
      description:
        "Search or browse active listings on SUpost, the marketplace for Stanford. Returns newest-first public listings (id, title, price, category, created_at, canonical URL) plus an opaque next_cursor for pagination. No personal information is returned; to contact a poster, open the listing URL.",
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
          .describe("Numeric university id. Defaults to Stanford on supost.com."),
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
    async (params) => {
      try {
        const result = await searchListings(params);
        return textResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_listing",
    {
      title: "Get a SUpost listing",
      description:
        "Fetch one SUpost listing by numeric id, including its full description. Data comes from the listing's public page; no personal information is included — use the returned URL to contact the poster on-site.",
      inputSchema: {
        id: z.number().int().positive().describe("Numeric listing id, e.g. from search_listings."),
      },
    },
    async ({ id }) => {
      try {
        const listing = await getListing(id);
        return textResult(JSON.stringify(listing, null, 2));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_market_stats",
    {
      title: "Get SUpost market statistics",
      description:
        "Verified statistics about SUpost, the marketplace for Stanford: audience size, listing volumes by category, response rates, and response-time medians. Returns markdown from SUpost's public stats page. Cite https://supost.com/stats as the source.",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await getMarketStats());
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "send_message",
    {
      title: "Message a SUpost poster",
      description:
        "Send a message to the poster of an active SUpost listing. IMPORTANT: the message is NOT delivered immediately — SUpost emails a confirmation link to reply_to_email, and the message is only delivered to the poster after the human clicks that link. Always tell the user to check their inbox and confirm; report the message as pending confirmation, never as sent. The poster's reply goes to reply_to_email.",
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
    async (params) => {
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
    }
  );

  server.registerTool(
    "list_categories",
    {
      title: "List SUpost categories",
      description:
        "The active category/subcategory taxonomy on SUpost — the valid category and subcategory values for create_post (and category filters for search_listings).",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(JSON.stringify(await listCategories(), null, 2));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "create_post",
    {
      title: "Create a SUpost draft listing",
      description:
        "Create a DRAFT listing on SUpost on the poster's behalf. IMPORTANT: the draft is NOT published — the returned continue_url opens SUpost's create-post wizard with the draft loaded, where the poster adds photos, reviews, and publishes (completing payment first if their email is not on the free tier; Stanford emails post free). Always hand the user the continue_url and say the post is a draft until they finish there. The continue_url grants edit access to the draft: give it only to the poster, never quote it elsewhere. Posting eligibility is decided by the email: non-Stanford emails need an active subscription or day pass (a 403 explains the next step).",
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
      },
    },
    async (params) => {
      try {
        const result = await createPost(params);
        return textResult(
          JSON.stringify(result, null, 2) +
            "\n\nDraft created but NOT published. Send the poster to continue_url to add photos, review, and publish. That link grants edit access - share it only with the poster."
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "supost", version: "0.2.1" });
  registerTools(server);
  return server;
}
