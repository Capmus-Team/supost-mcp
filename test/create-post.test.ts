import { describe, expect, it } from "vitest";
import { SupostApiError } from "../src/http.js";
import { createPost, listCategories } from "../src/supost.js";
import { fetchStub, jsonResponse, noSleep } from "./helpers.js";

const PARAMS = {
  category: "for sale",
  subcategory: "bicycles",
  title: "Trek hybrid, great condition",
  body: "Barely used, includes lock and lights.",
  price: 150,
  email: "poster@stanford.edu",
};

const CREATED = {
  draft_id: 130088439,
  continue_url:
    "https://supost.com/add/cat/5/sub/4?draft_id=130088439&token=abc",
  detail: "Draft created — it is NOT published.",
};

describe("createPost", () => {
  it("POSTs the params as JSON and returns the draft hand-off", async () => {
    const requests: Array<{
      url: string;
      init?: { method?: string; body?: string; headers?: Record<string, string> };
    }> = [];
    const fetchImpl = async (
      url: string,
      init?: { method?: string; body?: string; headers?: Record<string, string> }
    ) => {
      requests.push({ url, init });
      return jsonResponse(CREATED, 201);
    };

    const result = await createPost(PARAMS, { fetchImpl, sleep: noSleep });

    expect(result).toEqual(CREATED);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/public/posts");
    expect(requests[0]!.init?.method).toBe("POST");
    expect(JSON.parse(requests[0]!.init?.body ?? "")).toEqual(PARAMS);
  });

  it("surfaces the eligibility 403 with its structured code", async () => {
    const { fetchImpl } = fetchStub([
      jsonResponse(
        {
          error: "email_not_eligible",
          message: "Please use a valid Stanford email, an approved email, or pay to post",
          help_url: "https://supost.com/add",
        },
        403
      ),
    ]);
    await expect(
      createPost(PARAMS, { fetchImpl, sleep: noSleep })
    ).rejects.toMatchObject({ code: "email_not_eligible", status: 403 });
  });

  it("rejects an unexpected response shape", async () => {
    const { fetchImpl } = fetchStub([jsonResponse({ ok: true }, 201)]);
    await expect(
      createPost(PARAMS, { fetchImpl, sleep: noSleep })
    ).rejects.toBeInstanceOf(SupostApiError);
  });
});

describe("listCategories", () => {
  it("GETs the taxonomy", async () => {
    const { fetchImpl, urls } = fetchStub([
      jsonResponse({
        categories: [
          { id: 5, label: "for sale", subcategories: [{ id: 4, name: "bicycles" }] },
        ],
      }),
    ]);
    const result = await listCategories({ fetchImpl, sleep: noSleep });
    expect(new URL(urls[0]!).pathname).toBe("/api/public/categories");
    expect(result.categories[0]!.label).toBe("for sale");
  });

  it("rejects an unexpected response shape", async () => {
    const { fetchImpl } = fetchStub([jsonResponse({ nope: true })]);
    await expect(
      listCategories({ fetchImpl, sleep: noSleep })
    ).rejects.toBeInstanceOf(SupostApiError);
  });
});
