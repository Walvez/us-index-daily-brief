import test from "node:test";
import assert from "node:assert/strict";
import {
  assertUrlProvenance,
  selectTechNews,
  sourceTier,
} from "../../lib/daily-brief/tech-news/select";
import { summarizeTechNews } from "../../lib/daily-brief/tech-news/summarize";
import { runTechNewsModule } from "../../lib/daily-brief/tech-news/module";
import type { TechNewsCandidate } from "../../lib/daily-brief/tech-news/types";
import type { BriefContext } from "../../lib/daily-brief/types";
import type { SourceDef } from "../../lib/sources/types";

const now = new Date("2026-06-06T12:00:00Z");

const candidate = (
  overrides: Partial<TechNewsCandidate> = {},
): TechNewsCandidate => ({
  sourceId: "openai-news",
  sourceName: "OpenAI News",
  sourceTitle: "OpenAI ships model update",
  sourceUrl: "https://example.com/openai",
  publishedAt: "2026-06-06T08:00:00.000Z",
  factualExcerpt: "A new model release.",
  ...overrides,
});

const context: BriefContext = {
  editionDate: "2026-06-06",
  timeZone: "Asia/Taipei",
  now,
  outputRoot: "daily_reports",
  validationOnly: false,
};

test("selects recent items, dedupes URLs/titles, and caps limit", () => {
  const selected = selectTechNews(
    [
      candidate({}),
      candidate({ sourceUrl: "https://example.com/openai?utm_source=rss" }),
      candidate({
        sourceTitle: "DeepMind paper",
        sourceUrl: "https://example.com/dm",
        sourceId: "deepmind-blog",
        sourceName: "DeepMind Blog",
        publishedAt: "2026-06-06T07:00:00.000Z",
      }),
      candidate({
        sourceTitle: "Too old",
        sourceUrl: "https://example.com/old",
        publishedAt: "2026-06-04T00:00:00.000Z",
      }),
      candidate({
        sourceTitle: "Future",
        sourceUrl: "https://example.com/future",
        publishedAt: "2026-06-07T12:00:00.000Z",
      }),
      candidate({
        sourceTitle: "Bad protocol",
        sourceUrl: "javascript:alert(1)",
      }),
    ],
    { now, windowHours: 30, limit: 5 },
  );

  assert.deepEqual(
    selected.map((item) => item.sourceUrl),
    ["https://example.com/openai", "https://example.com/dm"],
  );
});

test("prefers older official over newer all-X monopoly", () => {
  const selected = selectTechNews(
    [
      candidate({
        sourceId: "attentionvc-ai",
        sourceName: "AttentionVC",
        sourceTitle: "Hot X take 1",
        sourceUrl: "https://example.com/x1",
        publishedAt: "2026-06-06T11:00:00.000Z",
      }),
      candidate({
        sourceId: "attentionvc-ai",
        sourceName: "AttentionVC",
        sourceTitle: "Hot X take 2",
        sourceUrl: "https://example.com/x2",
        publishedAt: "2026-06-06T10:50:00.000Z",
      }),
      candidate({
        sourceId: "attentionvc-ai",
        sourceName: "AttentionVC",
        sourceTitle: "Hot X take 3",
        sourceUrl: "https://example.com/x3",
        publishedAt: "2026-06-06T10:40:00.000Z",
      }),
      candidate({
        sourceId: "attentionvc-ai",
        sourceName: "AttentionVC",
        sourceTitle: "Hot X take 4",
        sourceUrl: "https://example.com/x4",
        publishedAt: "2026-06-06T10:30:00.000Z",
      }),
      candidate({
        sourceId: "openai-news",
        sourceName: "OpenAI News",
        sourceTitle: "OpenAI releases o-series update",
        sourceUrl: "https://openai.com/index/o-series",
        publishedAt: "2026-06-05T18:00:00.000Z",
      }),
    ],
    { now, windowHours: 30, limit: 5 },
  );

  assert.ok(selected.length >= 1);
  assert.equal(selected[0].sourceId, "openai-news");
  assert.ok(selected.some((item) => item.sourceId === "openai-news"));
  // Cap AttentionVC / X so it cannot fill all slots.
  const xCount = selected.filter((item) => item.sourceId === "attentionvc-ai")
    .length;
  assert.ok(xCount <= 1);
  assert.ok(selected.some((item) => sourceTier(item.sourceId) !== "x"));
});

test("filters community spam / photo chatter and caps community sources", () => {
  const selected = selectTechNews(
    [
      candidate({
        sourceId: "linuxdo",
        sourceName: "LinuxDo",
        sourceTitle: "今日厨娘图片分享",
        sourceUrl: "https://linux.do/t/cook",
        publishedAt: "2026-06-06T11:30:00.000Z",
      }),
      candidate({
        sourceId: "linuxdo",
        sourceName: "LinuxDo",
        sourceTitle: "师妹拍照日常",
        sourceUrl: "https://linux.do/t/photo",
        publishedAt: "2026-06-06T11:20:00.000Z",
      }),
      candidate({
        sourceId: "v2ex-hot",
        sourceName: "V2EX",
        sourceTitle: "求推荐服务器促销 优惠码",
        sourceUrl: "https://v2ex.com/t/server-promo",
        publishedAt: "2026-06-06T11:10:00.000Z",
      }),
      candidate({
        sourceId: "linuxdo",
        sourceName: "LinuxDo",
        sourceTitle: "本地部署 Qwen 推理优化笔记",
        sourceUrl: "https://linux.do/t/qwen",
        publishedAt: "2026-06-06T09:00:00.000Z",
      }),
      candidate({
        sourceId: "v2ex-hot",
        sourceName: "V2EX",
        sourceTitle: "讨论 Transformer KV cache",
        sourceUrl: "https://v2ex.com/t/kv",
        publishedAt: "2026-06-06T08:30:00.000Z",
      }),
      candidate({
        sourceId: "deepmind-blog",
        sourceName: "DeepMind Blog",
        sourceTitle: "New research on agent memory",
        sourceUrl: "https://deepmind.google/blog/agent-memory",
        publishedAt: "2026-06-06T07:00:00.000Z",
      }),
    ],
    { now, windowHours: 30, limit: 5 },
  );

  const titles = selected.map((item) => item.sourceTitle);
  assert.ok(!titles.some((title) => /厨娘|师妹|服务器促销/.test(title)));
  assert.ok(selected.some((item) => item.sourceId === "deepmind-blog"));
  assert.ok(
    selected.filter((item) => item.sourceId === "linuxdo").length <= 1,
  );
  assert.ok(selected.filter((item) => item.sourceId === "v2ex-hot").length <= 1);
});

test("fallback when only community tier has data still returns items", () => {
  const selected = selectTechNews(
    [
      candidate({
        sourceId: "hackernews",
        sourceName: "Hacker News",
        sourceTitle: "Show HN: tiny inference engine",
        sourceUrl: "https://news.ycombinator.com/item?id=1",
        publishedAt: "2026-06-06T10:00:00.000Z",
      }),
      candidate({
        sourceId: "hackernews",
        sourceName: "Hacker News",
        sourceTitle: "Paper: efficient attention",
        sourceUrl: "https://news.ycombinator.com/item?id=2",
        publishedAt: "2026-06-06T09:00:00.000Z",
      }),
      candidate({
        sourceId: "hackernews",
        sourceName: "Hacker News",
        sourceTitle: "Third HN item",
        sourceUrl: "https://news.ycombinator.com/item?id=3",
        publishedAt: "2026-06-06T08:00:00.000Z",
      }),
    ],
    { now, windowHours: 30, limit: 5 },
  );
  assert.ok(selected.length >= 1);
  assert.ok(selected.length <= 2); // hackernews cap
  assert.ok(selected.every((item) => item.sourceId === "hackernews"));
});

test("assertUrlProvenance rejects invented URLs", () => {
  assert.equal(
    assertUrlProvenance(
      ["https://example.com/a", "https://evil.example/x"],
      ["https://example.com/a"],
    ),
    false,
  );
  assert.equal(
    assertUrlProvenance(["https://example.com/a"], ["https://example.com/a"]),
    true,
  );
});

test("AI failure falls back to factual title/excerpt", async () => {
  const items = await summarizeTechNews([candidate()], async () => {
    throw new Error("model down");
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].summaryStatus, "fallback");
  assert.equal(items[0].sourceUrl, "https://example.com/openai");
  assert.equal(items[0].sourceTitle, "OpenAI ships model update");
  assert.equal(items[0].aiSummary, undefined);
});

test("AI summaries only keep URLs from candidates", async () => {
  const items = await summarizeTechNews([candidate()], async () => ({
    text: JSON.stringify({
      items: [
        {
          url: "https://example.com/openai",
          summary: "OpenAI 发布了模型更新。",
        },
        {
          url: "https://invented.example/nope",
          summary: "伪造链接不应出现。",
        },
      ],
    }),
    durationMs: 1,
  }));
  assert.equal(items.length, 1);
  assert.equal(items[0].summaryStatus, "generated");
  assert.equal(items[0].sourceUrl, "https://example.com/openai");
  assert.match(items[0].aiSummary ?? "", /OpenAI/);
});

test("null llm forces factual fallback even when token is present", async () => {
  const items = await summarizeTechNews([candidate()], {
    llm: null,
    env: { GITHUB_TOKEN: "test-token-not-logged" },
    defaultRunner: async () => {
      throw new Error("default runner must not run when llm is null");
    },
  });
  assert.equal(items[0].summaryStatus, "fallback");
});

test("undefined llm selects production-default runner when token exists (no live network)", async () => {
  let defaultRunnerCalls = 0;
  const items = await summarizeTechNews([candidate()], {
    // llm omitted / undefined → production default branch
    env: { GITHUB_TOKEN: "test-token-not-logged" },
    defaultRunner: async () => {
      defaultRunnerCalls += 1;
      return {
        text: JSON.stringify({
          items: [
            {
              url: "https://example.com/openai",
              summary: "OpenAI 通过默认 GitHub Models 路径生成摘要。",
            },
          ],
        }),
        durationMs: 1,
      };
    },
  });
  assert.equal(defaultRunnerCalls, 1);
  assert.equal(items[0].summaryStatus, "generated");
  assert.match(items[0].aiSummary ?? "", /GitHub Models|摘要/);
});

test("undefined llm without token falls back factually", async () => {
  const items = await summarizeTechNews([candidate()], {
    env: { GITHUB_TOKEN: "" },
    defaultRunner: async () => {
      throw new Error("must not call default runner without token");
    },
  });
  assert.equal(items[0].summaryStatus, "fallback");
});

test("tech module skipped when disabled", async () => {
  const result = await runTechNewsModule(context, {
    enabled: false,
    limit: 5,
    windowHours: 30,
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.data, undefined);
});

test("tech module degrades when all sources fail", async () => {
  const sources: SourceDef[] = [
    {
      id: "openai-news",
      name: "OpenAI News",
      type: "rss",
      url: "https://example.com/rss",
      category: "tech",
      enabled: true,
    },
  ];
  const result = await runTechNewsModule(context, {
    enabled: true,
    limit: 5,
    windowHours: 30,
    sourceDefs: sources,
    fetcher: async () => {
      throw new Error("network");
    },
  });
  assert.equal(result.status, "failed");
  assert.match(result.userMessage ?? "", /科技新闻/);
});

test("tech module succeeds with injected sources and no LLM", async () => {
  const sources: SourceDef[] = [
    {
      id: "openai-news",
      name: "OpenAI News",
      type: "rss",
      url: "https://example.com/rss",
      category: "tech",
      enabled: true,
    },
  ];
  const result = await runTechNewsModule(context, {
    enabled: true,
    limit: 5,
    windowHours: 30,
    sourceDefs: sources,
    llm: null,
    fetcher: async () => [
      {
        sourceId: "openai-news",
        title: "OpenAI ships model update",
        url: "https://example.com/openai",
        excerpt: "A new model release.",
        publishedAt: new Date("2026-06-06T08:00:00Z"),
        category: "tech",
      },
    ],
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.data?.items.length, 1);
  assert.equal(result.data?.items[0].summaryStatus, "fallback");
});
