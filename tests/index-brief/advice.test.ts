import test from "node:test";
import assert from "node:assert/strict";
import { classifyAdvice } from "../../lib/index-brief/advice";
import type { MarketMetrics } from "../../lib/index-brief/types";

const base: MarketMetrics = {
  close: 100,
  pct1Day: 0.4,
  pct5Day: 1,
  pct20Day: 2,
  drawdown20: -1,
  drawdown60: -2,
  drawdownAll: -4,
  sma20: 99,
  sma50: 97,
  sma200: 90,
  realizedVol20: 15,
};

const pair = (
  first: Partial<MarketMetrics> = {},
  second: Partial<MarketMetrics> = {},
): MarketMetrics[] => [{ ...base, ...first }, { ...base, ...second }];

test("keeps normal contributions for an ordinary session", () => {
  const result = classifyAdvice(pair());
  assert.equal(result.level, "normal");
  assert.equal(result.label, "正常定投");
  assert.equal(result.highVolatility, false);
});

test("suggests a slight increase at the moderate decline thresholds", () => {
  assert.equal(
    classifyAdvice(pair({ pct1Day: -0.8 })).level,
    "slightly-more",
  );
  assert.equal(
    classifyAdvice(pair({ drawdown60: -4 })).level,
    "slightly-more",
  );
});

test("reserves notable wording for deeper declines and takes precedence", () => {
  const result = classifyAdvice(
    pair({ pct1Day: -0.9, drawdown60: -8 }, { pct1Day: -2 }),
  );
  assert.equal(result.level, "notably-more");
  assert.equal(result.label, "出现较明显回撤，可按原计划增加");
});

test("adds a volatility warning without changing the base level", () => {
  const result = classifyAdvice(pair({ realizedVol20: 30 }));
  assert.equal(result.level, "normal");
  assert.equal(result.highVolatility, true);
});

test("formats deterministic reasons from the weakest observations", () => {
  const result = classifyAdvice(
    pair({ pct1Day: -1.234, drawdown60: -5.678 }, { pct1Day: -0.5 }),
  );
  assert.deepEqual(result.reasons, [
    "两大指数中较弱单日表现为 -1.23%",
    "较深的60日高点回撤为 -5.68%",
  ]);
  assert.equal(result.label, "正常定投，可按习惯略微增加");
});

test("rejects missing or malformed core metrics", () => {
  assert.throws(() => classifyAdvice([]), /exactly two/);
  assert.throws(() => classifyAdvice([base]), /exactly two/);
  assert.throws(
    () => classifyAdvice(pair({ pct1Day: Number.NaN })),
    /finite/,
  );
  assert.throws(
    () => classifyAdvice(pair({ realizedVol20: Number.POSITIVE_INFINITY })),
    /finite/,
  );
});
