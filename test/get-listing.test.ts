import { afterEach, describe, expect, it } from "vitest";
import { extractProductJsonLd, getListing } from "../src/supost.js";
import { fetchStub, htmlResponse } from "./helpers.js";

const PRODUCT_LD = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Sublet in Escondido Village Kennedy",
  url: "https://supost.com/post/sublet-in-escondido-village-kennedy-130088421",
  description: "Subletting my place in Kennedy.",
  category: "housing",
  offers: { "@type": "Offer", price: 1517, priceCurrency: "USD" },
};

const PAGE = `<!DOCTYPE html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"SUpost"}</script>
<script type="application/ld+json">${JSON.stringify(PRODUCT_LD)}</script>
</head><body></body></html>`;

afterEach(() => {
  delete process.env.SUPOST_BASE_URL;
});

describe("extractProductJsonLd", () => {
  it("picks the Product node, skipping other JSON-LD blocks", () => {
    const product = extractProductJsonLd(PAGE);
    expect(product?.name).toBe(PRODUCT_LD.name);
    expect(product?.offers?.price).toBe(1517);
  });

  it("returns null when no Product block exists", () => {
    expect(extractProductJsonLd("<html></html>")).toBeNull();
  });

  it("skips malformed JSON-LD without throwing", () => {
    const html = `<script type="application/ld+json">{broken</script>
<script type="application/ld+json">${JSON.stringify(PRODUCT_LD)}</script>`;
    expect(extractProductJsonLd(html)?.name).toBe(PRODUCT_LD.name);
  });
});

describe("getListing", () => {
  it("requests the public post page and maps the Product JSON-LD", async () => {
    process.env.SUPOST_BASE_URL = "https://preview.supost.com";
    const { fetchImpl, urls } = fetchStub([htmlResponse(PAGE)]);
    const listing = await getListing(130088421, { fetchImpl });
    expect(urls[0]).toBe("https://preview.supost.com/post/index/130088421");
    expect(listing).toEqual({
      id: 130088421,
      title: PRODUCT_LD.name,
      description: PRODUCT_LD.description,
      price: 1517,
      category: "housing",
      url: PRODUCT_LD.url,
    });
  });

  it("maps a 404 page to a not_found error", async () => {
    const { fetchImpl } = fetchStub([htmlResponse("gone", 404)]);
    await expect(getListing(1, { fetchImpl })).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("errors when the page has no Product data", async () => {
    const { fetchImpl } = fetchStub([htmlResponse("<html></html>")]);
    await expect(getListing(1, { fetchImpl })).rejects.toMatchObject({
      code: "bad_upstream_response",
    });
  });
});
