import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyValuation,
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
