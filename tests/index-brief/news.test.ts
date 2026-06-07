import test from "node:test";
import assert from "node:assert/strict";
import { selectRelevantNews, type MarketNews } from "../../lib/index-brief/news";

const now = new Date("2026-06-06T12:00:00Z");

const article = (overrides: Partial<MarketNews>): MarketNews => ({
  sourceId: "test",
  sourceName: "Test",
  title: "Federal Reserve holds interest rates",
  url: "https://example.com/fed-rate",
  excerpt: "The Fed discussed inflation.",
  publishedAt: new Date("2026-06-06T08:00:00Z"),
  category: "finance",
  ...overrides,
});

test("keeps recent market-moving stories and removes duplicates", () => {
  const selected = selectRelevantNews(
    [
      article({}),
      article({ url: "https://example.com/fed-rate?utm_source=rss" }),
      article({
        title: "Nvidia lifts the Nasdaq",
        url: "https://example.com/nvidia",
        publishedAt: new Date("2026-06-06T07:00:00Z"),
      }),
      article({
        title: "Local sports result",
        url: "https://example.com/sports",
        excerpt: "A team won its weekend match.",
      }),
      article({
        title: "Old S&P 500 story",
        url: "https://example.com/old",
        publishedAt: new Date("2026-06-04T00:00:00Z"),
      }),
    ],
    now,
  );

  assert.deepEqual(
    selected.map((item) => item.url),
    ["https://example.com/fed-rate", "https://example.com/nvidia"],
  );
});

test("sorts newest first and caps the result", () => {
  const input = Array.from({ length: 15 }, (_, index) =>
    article({
      title: `Nasdaq market update ${index}`,
      url: `https://example.com/${index}`,
      publishedAt: new Date(now.getTime() - index * 60_000),
    }),
  );
  const selected = selectRelevantNews(input, now);
  assert.equal(selected.length, 12);
  assert.equal(selected[0].url, "https://example.com/0");
});

test("rejects invalid URLs and future timestamps", () => {
  const selected = selectRelevantNews(
    [
      article({ url: "javascript:alert(1)" }),
      article({ publishedAt: new Date("2026-06-07T12:00:00Z") }),
    ],
    now,
  );
  assert.deepEqual(selected, []);
});
