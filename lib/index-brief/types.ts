export type IndexId = "nasdaq100" | "sp500";
export type AdviceLevel = "normal" | "slightly-more" | "notably-more";

export interface MarketMetrics {
  close: number;
  pct1Day: number;
  pct5Day: number;
  pct20Day: number;
  drawdown20: number;
  drawdown60: number;
  drawdownAll: number;
  sma20: number;
  sma50: number | null;
  sma200: number | null;
  realizedVol20: number;
}

export interface IndexSnapshot {
  id: IndexId;
  name: string;
  symbol: string;
  marketDate: string;
  metrics: MarketMetrics;
}

export interface MarketContext {
  marketDate: string;
  indices: IndexSnapshot[];
  vix?: number;
  treasury10y?: number;
  dxy?: number;
}

export interface AdviceResult {
  level: AdviceLevel;
  label: string;
  reasons: string[];
  highVolatility: boolean;
}

export type ValuationTemperature =
  | "低于长期均值"
  | "接近长期均值"
  | "高于长期均值"
  | "明显高于长期均值";

export interface IndexValuation {
  id: IndexId;
  forwardPe: number;
  tenYearAveragePe: number;
  premiumPct: number;
  temperature: ValuationTemperature;
}

export interface ValuationSnapshot {
  asOf: string;
  sourceUrl: string;
  indices: IndexValuation[];
}

export type ValuationContext =
  | { status: "available"; snapshot: ValuationSnapshot }
  | {
      status: "unavailable";
      reason: "fetch-failed" | "invalid-data" | "stale";
      message: string;
    };
