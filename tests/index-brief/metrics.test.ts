import test from "node:test";
import assert from "node:assert/strict";
import { calculateMetrics } from "../../lib/index-brief/metrics";

const closes = Array.from({ length: 220 }, (_, i) => 100 + i);

test("calculates returns, drawdown, averages, and annualized volatility", () => {
  const result = calculateMetrics(closes);

  assert.equal(result.pct1Day, ((319 - 318) / 318) * 100);
  assert.equal(result.drawdown20, 0);
  assert.equal(result.sma20, 309.5);
  assert.ok(result.realizedVol20 > 0);
});

test("rejects insufficient history", () => {
  assert.throws(() => calculateMetrics([100, 101]), /at least 20/);
});

test("returns finite metrics for a constant price series", () => {
  const result = calculateMetrics(Array.from({ length: 20 }, () => 100));

  for (const value of Object.values(result)) {
    assert.ok(value === null || Number.isFinite(value));
  }
  assert.equal(result.realizedVol20, 0);
});
