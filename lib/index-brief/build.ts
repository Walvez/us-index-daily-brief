import { classifyAdvice } from "./advice";
import {
  writeCommentary,
  type BriefCommentary,
  type CommentaryInput,
} from "./commentary";
import { loadMarketContext } from "./market";
import {
  fetchMarketNews,
  selectRelevantNews,
  type MarketNews,
} from "./news";
import type { IndexBriefReport } from "./render";
import type { MarketContext, ValuationContext } from "./types";
import { appendValuationSnapshot } from "./valuation-history";
import { loadValuationContext } from "./valuation";

export interface BuildDependencies {
  outputRoot?: string;
  now?: () => Date;
  loadMarket?: () => Promise<MarketContext>;
  loadNews?: () => Promise<MarketNews[]>;
  loadValuation?: () => Promise<ValuationContext>;
  explain?: (input: CommentaryInput) => Promise<BriefCommentary>;
  /** When false, skip writing valuation history (orchestrator controls persistence). */
  persistValuationHistory?: boolean;
}

/**
 * Build the deterministic market report payload without consulting send-state.
 * Metrics, valuation, and classifyAdvice remain code-owned; AI only explains.
 */
export async function buildIndexBriefReport(
  dependencies: BuildDependencies = {},
): Promise<IndexBriefReport> {
  const outputRoot = dependencies.outputRoot ?? "daily_reports";
  const now = dependencies.now?.() ?? new Date();
  const market = await (dependencies.loadMarket ?? loadMarketContext)();
  if (market.indices.length !== 2) {
    throw new Error("core market context must contain exactly two indices");
  }

  const loadedNews = await (dependencies.loadNews ?? fetchMarketNews)();
  const news = selectRelevantNews(loadedNews, now);
  const valuation = await (
    dependencies.loadValuation ??
    (() =>
      loadValuationContext({
        now,
        debug: process.env.VALUATION_DEBUG === "1",
      }))
  )().catch(
    (): ValuationContext => ({
      status: "unavailable",
      reason: "fetch-failed",
      message: "官方估值数据暂不可用",
    }),
  );
  if (
    valuation.status === "available" &&
    dependencies.persistValuationHistory !== false
  ) {
    appendValuationSnapshot(outputRoot, valuation.snapshot);
  }
  const advice = classifyAdvice(market.indices.map((index) => index.metrics));
  const commentary = await (dependencies.explain ?? writeCommentary)({
    market,
    advice,
    news,
  });
  return {
    market,
    advice,
    commentary,
    valuation,
    generatedAt: now.toISOString(),
  };
}
