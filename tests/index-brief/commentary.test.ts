import test from "node:test";
import assert from "node:assert/strict";
import {
  writeCommentary,
  type CommentaryInput,
} from "../../lib/index-brief/commentary";

const input: CommentaryInput = {
  market: {
    marketDate: "2026-06-05",
    indices: [
      {
        id: "nasdaq100",
        name: "纳斯达克100",
        symbol: "^NDX",
        marketDate: "2026-06-05",
        metrics: {
          close: 22000,
          pct1Day: -1.2,
          pct5Day: -0.8,
          pct20Day: 2,
          drawdown20: -3,
          drawdown60: -5,
          drawdownAll: -5,
          sma20: 22100,
          sma50: 21500,
          sma200: 20000,
          realizedVol20: 22,
        },
      },
      {
        id: "sp500",
        name: "标普500",
        symbol: "^GSPC",
        marketDate: "2026-06-05",
        metrics: {
          close: 6100,
          pct1Day: -0.7,
          pct5Day: 0.2,
          pct20Day: 1,
          drawdown20: -2,
          drawdown60: -3,
          drawdownAll: -3,
          sma20: 6120,
          sma50: 6000,
          sma200: 5800,
          realizedVol20: 18,
        },
      },
    ],
  },
  advice: {
    level: "slightly-more",
    label: "正常定投，可按习惯略微增加",
    reasons: ["两大指数中较弱单日表现为 -1.20%"],
    highVolatility: false,
  },
  news: [
    {
      sourceId: "test",
      sourceName: "Test News",
      title: "Fed discusses interest rates",
      url: "https://example.com/fed",
      excerpt: "Officials discussed inflation.",
      publishedAt: new Date("2026-06-06T01:00:00Z"),
      category: "finance",
    },
  ],
};

test("keeps only source URLs and preserves the deterministic advice label", async () => {
  const result = await writeCommentary(input, async () => ({
    text: JSON.stringify({
      headline: "科技股承压",
      summary: "纳斯达克100跌幅较大，市场关注利率路径。",
      advice_label: "全部卖出",
      drivers: [
        {
          title: "Fed discusses interest rates",
          explanation: "利率预期可能相关。",
          url: "https://example.com/fed",
          relationship: "possibly-related",
        },
        {
          title: "Invented",
          explanation: "不存在的来源。",
          url: "https://evil.example/invented",
          relationship: "direct",
        },
      ],
    }),
    durationMs: 1,
  }));

  assert.equal(result.adviceLabel, input.advice.label);
  assert.deepEqual(result.drivers.map((driver) => driver.url), [
    "https://example.com/fed",
  ]);
});

test("falls back to a deterministic Chinese explanation when the LLM fails", async () => {
  const result = await writeCommentary(input, async () => {
    throw new Error("offline");
  });
  assert.match(result.summary, /纳斯达克100.*-1\.20%/);
  assert.equal(result.adviceLabel, input.advice.label);
  assert.equal(result.drivers[0].url, "https://example.com/fed");
});
