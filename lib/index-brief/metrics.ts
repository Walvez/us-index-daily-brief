import { sma } from "../trading/indicators";
import type { MarketMetrics } from "./types";

const pct = (now: number, before: number): number =>
  ((now - before) / before) * 100;

const drawdown = (values: number[]): number =>
  pct(values.at(-1)!, Math.max(...values));

export function calculateMetrics(closes: number[]): MarketMetrics {
  if (closes.length < 21) {
    throw new Error("at least 21 closes are required");
  }
  if (closes.some((close) => !Number.isFinite(close) || close <= 0)) {
    throw new Error("closes must contain only finite positive numbers");
  }

  const close = closes.at(-1)!;
  const volatilityCloses = closes.slice(-21);
  const logReturns = volatilityCloses.slice(1).map((value, index) => {
    return Math.log(value / volatilityCloses[index]);
  });
  const mean =
    logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length;
  const variance =
    logReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, logReturns.length - 1);

  return {
    close,
    pct1Day: pct(close, closes.at(-2)!),
    pct5Day: pct(close, closes.at(-6)!),
    pct20Day: pct(close, closes.at(-21)!),
    drawdown20: drawdown(closes.slice(-20)),
    drawdown60: drawdown(closes.slice(-60)),
    drawdownAll: drawdown(closes),
    sma20: sma(closes, 20).at(-1)!,
    sma50: sma(closes, 50).at(-1) ?? null,
    sma200: sma(closes, 200).at(-1) ?? null,
    realizedVol20: Math.sqrt(variance * 252) * 100,
  };
}
