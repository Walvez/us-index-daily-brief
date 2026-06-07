import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyValuation,
  loadValuationContext,
  parseNasdaqValuationText,
  validateValuationFreshness,
} from "../../lib/index-brief/valuation";

const dashboardText = `
Nasdaq Global Index Investment Insights
Global Equities Last MTD % Change QTD % Change YTD % Change LTM % Change
Yield NTM P/E NTM P/E 10yr Avg. Last vs. 10yr Avg.
Nasdaq - 100 ® 28,015 2.1% 18.0% 11.0% 40.3% 0.6% 23.40 22.90 +2.2%
S&P 500 7,259 0.7% 11.2% 6.0% 28.5% 1.1% 20.73 19.09 +8.6%
Russell 2000 2,845 1.6% 14.6% 1.2% 24.80 23.21 +6.9%
Data as of 5/5/2026.
`;

test("parses both official forward-PE rows and recomputes premiums", () => {
  const snapshot = parseNasdaqValuationText(
    dashboardText,
    "https://www.nasdaq.com/docs/index/global-index-investment-insights",
  );

  assert.equal(snapshot.asOf, "2026-05-05");
  assert.deepEqual(
    snapshot.indices.map(({ id, forwardPe, tenYearAveragePe }) => ({
      id,
      forwardPe,
      tenYearAveragePe,
    })),
    [
      { id: "nasdaq100", forwardPe: 23.4, tenYearAveragePe: 22.9 },
      { id: "sp500", forwardPe: 20.73, tenYearAveragePe: 19.09 },
    ],
  );
  assert.ok(Math.abs(snapshot.indices[0].premiumPct - 2.1834) < 0.001);
});

test("skips repeated index names in PDF headers before the data rows", () => {
  const snapshot = parseNasdaqValuationText(
    dashboardText.replace(
      "Global Equities",
      "Nasdaq-100 S&P 500 Russell 2000 Global Equities",
    ),
    "official",
  );

  assert.equal(snapshot.indices[0].forwardPe, 23.4);
  assert.equal(snapshot.indices[1].forwardPe, 20.73);
});

test("uses fixed valuation-temperature boundaries", () => {
  assert.equal(classifyValuation(-10), "低于长期均值");
  assert.equal(classifyValuation(-9.99), "接近长期均值");
  assert.equal(classifyValuation(10), "接近长期均值");
  assert.equal(classifyValuation(10.01), "高于长期均值");
  assert.equal(classifyValuation(25), "高于长期均值");
  assert.equal(classifyValuation(25.01), "明显高于长期均值");
});

test("rejects incomplete or implausible valuation rows", () => {
  assert.throws(
    () => parseNasdaqValuationText("Data as of 5/5/2026. Nasdaq-100 2 1", "x"),
    /missing valuation row/,
  );
  assert.throws(
    () =>
      parseNasdaqValuationText(
        dashboardText.replace("23.40 22.90", "230.40 22.90"),
        "x",
      ),
    /plausible range/,
  );
});

test("hides data older than 45 calendar days", () => {
  const snapshot = parseNasdaqValuationText(dashboardText, "x");
  assert.equal(
    validateValuationFreshness(
      snapshot,
      new Date("2026-06-19T00:00:00Z"),
    ).status,
    "available",
  );
  assert.equal(
    validateValuationFreshness(
      snapshot,
      new Date("2026-06-20T00:00:00Z"),
    ).status,
    "unavailable",
  );
});

test("loads and validates an official document through injected adapters", async () => {
  const result = await loadValuationContext({
    now: new Date("2026-06-07T00:00:00Z"),
    fetchPdf: async () => new Uint8Array([1, 2, 3]),
    extractText: async () => dashboardText,
  });

  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.equal(result.snapshot.asOf, "2026-05-05");
  }
});

test("degrades instead of throwing when the official document is unavailable", async () => {
  const logs: string[] = [];
  const result = await loadValuationContext({
    fetchPdf: async () => {
      throw new Error("503");
    },
    logger: (message) => logs.push(message),
  });

  assert.deepEqual(result, {
    status: "unavailable",
    reason: "fetch-failed",
    message: "官方估值数据暂不可用",
  });
  assert.deepEqual(logs, ["valuation load failed: 503"]);
});
