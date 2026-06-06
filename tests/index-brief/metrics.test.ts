import test from "node:test";
import assert from "node:assert/strict";
import { calculateMetrics } from "../../lib/index-brief/metrics";

const closes = Array.from({ length: 220 }, (_, i) => 100 + i);

function expectedRealizedVol20(values: number[]): number {
  const window = values.slice(-21);
  const returns = window.slice(1).map((value, index) => {
    return Math.log(value / window[index]);
  });
  const mean =
    returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const squaredDeviations = returns.map((value) => (value - mean) ** 2);
  const sampleVariance =
    squaredDeviations.reduce((sum, value) => sum + value, 0) /
    (returns.length - 1);

  return Math.sqrt(sampleVariance) * Math.sqrt(252) * 100;
}

function assertAlmostEqual(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `expected ${actual} to be within 1e-12 of ${expected}`,
  );
}

test("calculates returns, drawdown, averages, and annualized volatility", () => {
  const result = calculateMetrics(closes);

  assert.equal(result.pct1Day, ((319 - 318) / 318) * 100);
  assert.equal(result.pct5Day, ((319 - 314) / 314) * 100);
  assert.equal(result.pct20Day, ((319 - 299) / 299) * 100);
  assert.equal(result.drawdown20, 0);
  assert.equal(result.drawdown60, 0);
  assert.equal(result.drawdownAll, 0);
  assert.equal(result.sma20, 309.5);
  assert.equal(result.sma50, 294.5);
  assert.equal(result.sma200, 219.5);
  assertAlmostEqual(result.realizedVol20, expectedRealizedVol20(closes));
});

test("rejects insufficient history", () => {
  assert.throws(
    () => calculateMetrics(Array.from({ length: 20 }, () => 100)),
    /at least 21/,
  );
});

test("uses 20 intervals at the 21-close boundary", () => {
  const boundaryCloses = Array.from({ length: 21 }, (_, index) => 100 + index);
  const result = calculateMetrics(boundaryCloses);

  assert.equal(result.pct20Day, 20);
  assert.equal(result.sma50, null);
  assert.equal(result.sma200, null);
  assertAlmostEqual(
    result.realizedVol20,
    expectedRealizedVol20(boundaryCloses),
  );
});

test("calculates nonzero drawdowns from each trailing peak", () => {
  const drawdownCloses = Array.from({ length: 220 }, () => 100);
  drawdownCloses[10] = 200;
  drawdownCloses[170] = 160;
  drawdownCloses[205] = 120;
  drawdownCloses[219] = 90;

  const result = calculateMetrics(drawdownCloses);

  assert.equal(result.drawdown20, ((90 - 120) / 120) * 100);
  assert.equal(result.drawdown60, ((90 - 160) / 160) * 100);
  assert.equal(result.drawdownAll, ((90 - 200) / 200) * 100);
});

test("returns finite metrics for a constant price series", () => {
  const result = calculateMetrics(Array.from({ length: 21 }, () => 100));

  assert.ok(
    Object.values(result).every(
      (value) => value === null || Number.isFinite(value),
    ),
  );
  assert.equal(result.realizedVol20, 0);
});

test("rejects closes that are not finite and strictly positive", () => {
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalidCloses = Array.from({ length: 21 }, () => 100);
    invalidCloses[10] = invalid;

    assert.throws(() => calculateMetrics(invalidCloses), /finite positive/);
  }
});
