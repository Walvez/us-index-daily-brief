import test from "node:test";
import assert from "node:assert/strict";
import {
  renderEmailHtml,
  renderFullHtml,
  type IndexBriefReport,
} from "../../lib/index-brief/render";

export const reportFixture: IndexBriefReport = {
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
    vix: 19.2,
  },
  advice: {
    level: "slightly-more",
    label: "正常定投，可按习惯略微增加",
    reasons: ["两大指数中较弱单日表现为 -1.20%"],
    highVolatility: false,
  },
  commentary: {
    headline: "科技股承压",
    summary: "利率预期可能影响成长股估值。",
    adviceLabel: "正常定投，可按习惯略微增加",
    drivers: [
      {
        title: "Fed <statement>",
        explanation: "利率路径仍有不确定性。",
        url: "https://example.com/fed?x=1&y=2",
        relationship: "possibly-related",
      },
    ],
  },
  generatedAt: "2026-06-06T00:05:00.000Z",
};

test("renders a single-column mobile email with source links and caveats", () => {
  const html = renderEmailHtml(reportFixture, {
    reportUrl: "https://example.github.io/brief/2026-06-05/2026-06-05.html",
  });
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /max-width:\s*680px/);
  assert.match(html, /正常定投，可按习惯略微增加/);
  assert.match(html, /T\+2/);
  assert.match(html, /汇率/);
  assert.match(html, /限购/);
  assert.match(html, /查看完整报告/);
  assert.doesNotMatch(html, /position:\s*fixed/);
});

test("escapes external text and attributes", () => {
  const html = renderEmailHtml(reportFixture);
  assert.match(html, /Fed &lt;statement&gt;/);
  assert.match(html, /x=1&amp;y=2/);
  assert.doesNotMatch(html, /Fed <statement>/);
});

test("renders a full document suitable for GitHub Pages", () => {
  const html = renderFullHtml(reportFixture);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /美股指数每日简报/);
  assert.match(html, /2026-06-05/);
});
