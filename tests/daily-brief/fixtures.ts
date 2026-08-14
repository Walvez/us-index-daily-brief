import type { IndexBriefReport } from "../../lib/index-brief/render";
import type { MarketModuleData } from "../../lib/daily-brief/market-module";
import type { TechNewsModuleData } from "../../lib/daily-brief/tech-news/types";
import type { DailyBriefReport, ModuleResult } from "../../lib/daily-brief/types";

export const marketReportFixture: IndexBriefReport = {
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
    translationAvailable: true,
    drivers: [
      {
        title: "Fed <statement>",
        explanation: "利率路径仍有不确定性。",
        url: "https://example.com/fed?x=1&y=2",
        relationship: "possibly-related",
      },
    ],
  },
  valuation: {
    status: "available",
    snapshot: {
      asOf: "2026-05-05",
      sourceUrl:
        "https://www.nasdaq.com/docs/index/global-index-investment-insights",
      indices: [
        {
          id: "nasdaq100",
          forwardPe: 23.4,
          tenYearAveragePe: 22.9,
          premiumPct: 2.18,
          temperature: "接近长期均值",
        },
        {
          id: "sp500",
          forwardPe: 20.73,
          tenYearAveragePe: 19.09,
          premiumPct: 8.59,
          temperature: "接近长期均值",
        },
      ],
    },
  },
  generatedAt: "2026-06-06T00:05:00.000Z",
};

export const marketModuleDataFixture: MarketModuleData = {
  report: marketReportFixture,
  marketDate: "2026-06-05",
  isLastTradingDay: true,
  staleLabel: "最近交易日 2026-06-05（非 2026-06-06 当日收盘）",
  editionKind: "weekday",
};

export const techModuleDataFixture: TechNewsModuleData = {
  items: [
    {
      sourceTitle: "OpenAI <launch>",
      sourceName: "AI HOT",
      sourceUrl: "https://example.com/openai?x=1&y=2",
      publishedAt: "2026-06-05T18:00:00.000Z",
      summary: "OpenAI 发布产品更新。",
      summaryStatus: "curated",
    },
  ],
  window: "24h",
  candidateCount: 3,
};

export function dailyBriefFixture(
  overrides: Partial<DailyBriefReport> = {},
): DailyBriefReport {
  const marketModule: ModuleResult<MarketModuleData> = {
    moduleId: "market",
    status: "success",
    data: marketModuleDataFixture,
    userMessage: marketModuleDataFixture.staleLabel,
    generatedAt: "2026-06-06T00:05:00.000Z",
  };
  const techModule: ModuleResult<TechNewsModuleData> = {
    moduleId: "tech-news",
    status: "success",
    data: techModuleDataFixture,
    generatedAt: "2026-06-06T00:05:00.000Z",
  };
  return {
    version: 1,
    editionDate: "2026-06-06",
    timeZone: "Asia/Taipei",
    generatedAt: "2026-06-06T00:05:00.000Z",
    modules: [marketModule, techModule],
    subject: "2026-06-06 个人每日简报｜市场与 AI 科技",
    ...overrides,
  };
}
