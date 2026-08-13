import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizedUrl,
  selectTechNews,
} from "../../lib/daily-brief/tech-news/select";
import { runTechNewsModule } from "../../lib/daily-brief/tech-news/module";
import type { TechNewsCandidate } from "../../lib/daily-brief/tech-news/types";
import type { BriefContext } from "../../lib/daily-brief/types";
import type { AihotArticle } from "../../lib/sources/aihot";

const context: BriefContext = {
  editionDate: "2026-06-06",
  timeZone: "Asia/Taipei",
  now: new Date("2026-06-06T12:00:00Z"),
  outputRoot: "daily_reports",
  validationOnly: false,
};

const candidate = (
  overrides: Partial<TechNewsCandidate> = {},
): TechNewsCandidate => ({
  sourceId: "aihot:1",
  sourceName: "AI HOT",
  sourceTitle: "OpenAI 发布模型更新",
  sourceUrl: "https://aihot.virxact.com/items/1",
  publishedAt: "2026-06-06T08:00:00.000Z",
  summary: "OpenAI 发布了新的模型更新。",
  ...overrides,
});

test("selectTechNews keeps valid items, dedupes URLs, and caps limit", () => {
  const selected = selectTechNews(
    [
      candidate({}),
      candidate({
        sourceUrl: "https://aihot.virxact.com/items/1?utm_source=rss",
      }),
      candidate({
        sourceId: "aihot:2",
        sourceTitle: "Anthropic 发布新模型",
        sourceUrl: "https://aihot.virxact.com/items/2",
      }),
      candidate({
        sourceId: "aihot:3",
        sourceTitle: "Bad protocol",
        sourceUrl: "javascript:alert(1)",
      }),
    ],
    { limit: 5 },
  );

  assert.deepEqual(
    selected.map((item) => item.sourceUrl),
    ["https://aihot.virxact.com/items/1", "https://aihot.virxact.com/items/2"],
  );
});

test("normalizedUrl strips utm params and trailing slash, rejects bad protocols", () => {
  assert.equal(
    normalizedUrl("https://example.com/a/?utm_source=rss&ref=x"),
    "https://example.com/a",
  );
  assert.equal(normalizedUrl("javascript:alert(1)"), null);
});

test("tech module skipped when disabled", async () => {
  const result = await runTechNewsModule(context, {
    enabled: false,
    limit: 5,
    window: "24h",
  });
  assert.equal(result.status, "skipped");
});

test("tech module fails when AI HOT is unavailable", async () => {
  const result = await runTechNewsModule(context, {
    enabled: true,
    limit: 5,
    window: "24h",
    articlesFetcher: async () => {
      throw new Error("network");
    },
  });
  assert.equal(result.status, "failed");
  assert.match(result.userMessage ?? "", /科技新闻/);
});

test("tech module maps AI HOT articles to curated Chinese items", async () => {
  const articles: AihotArticle[] = [
    {
      id: "1",
      title: "OpenAI 发布模型更新",
      sourceName: "OpenAI",
      url: "https://aihot.virxact.com/items/1",
      originalUrl: "https://openai.com/news",
      summary: "OpenAI 发布新模型。",
      publishedAt: "2026-06-06T08:00:00.000Z",
    },
  ];
  const result = await runTechNewsModule(context, {
    enabled: true,
    limit: 5,
    window: "24h",
    articlesFetcher: async () => articles,
  });
  assert.equal(result.status, "success");
  assert.equal(result.data?.candidateCount, 1);
  assert.equal(result.data?.window, "24h");
  assert.equal(result.data?.items.length, 1);
  assert.equal(result.data?.items[0].summaryStatus, "curated");
  assert.equal(result.data?.items[0].summary, "OpenAI 发布新模型。");
  assert.equal(result.data?.items[0].sourceName, "OpenAI");
});

test("tech item without summary falls back to link-only", async () => {
  const result = await runTechNewsModule(context, {
    enabled: true,
    limit: 5,
    window: "24h",
    articlesFetcher: async () => [
      {
        id: "1",
        title: "Anthropic 发布新模型",
        sourceName: "Anthropic",
        url: "https://aihot.virxact.com/items/1",
        publishedAt: "2026-06-06T08:00:00.000Z",
      },
    ],
  });
  assert.equal(result.status, "success");
  assert.equal(result.data?.items[0].summaryStatus, "fallback");
  assert.equal(result.data?.items[0].summary, undefined);
});
