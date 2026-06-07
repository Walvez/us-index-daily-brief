import type { AdviceResult, MarketMetrics } from "./types";

const LABELS: Record<AdviceResult["level"], string> = {
  normal: "正常定投",
  "slightly-more": "正常定投，可按习惯略微增加",
  "notably-more": "出现较明显回撤，可按原计划增加",
};

export function classifyAdvice(metrics: MarketMetrics[]): AdviceResult {
  if (metrics.length !== 2) {
    throw new Error("exactly two core market metrics are required");
  }

  for (const item of metrics) {
    for (const value of [
      item.pct1Day,
      item.drawdown60,
      item.realizedVol20,
    ]) {
      if (!Number.isFinite(value)) {
        throw new Error("advice inputs must contain finite values");
      }
    }
  }

  const worstDay = Math.min(...metrics.map((item) => item.pct1Day));
  const worstDrawdown = Math.min(...metrics.map((item) => item.drawdown60));
  const highVolatility =
    Math.max(...metrics.map((item) => item.realizedVol20)) >= 30;

  let level: AdviceResult["level"] = "normal";
  if (worstDay <= -2 || worstDrawdown <= -8) {
    level = "notably-more";
  } else if (worstDay <= -0.8 || worstDrawdown <= -4) {
    level = "slightly-more";
  }

  return {
    level,
    label: LABELS[level],
    reasons: [
      `两大指数中较弱单日表现为 ${worstDay.toFixed(2)}%`,
      `较深的60日高点回撤为 ${worstDrawdown.toFixed(2)}%`,
    ],
    highVolatility,
  };
}
