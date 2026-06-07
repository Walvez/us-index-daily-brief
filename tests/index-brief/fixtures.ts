import type { IndexBriefReport } from "../../lib/index-brief/render";

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
