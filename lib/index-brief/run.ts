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
import { inspectState, reportPaths, writeReportFiles } from "./state";
import type { MarketContext, ValuationContext } from "./types";
import { appendValuationSnapshot } from "./valuation-history";
import { loadValuationContext } from "./valuation";

export interface RunDependencies {
  outputRoot?: string;
  now?: () => Date;
  loadMarket?: () => Promise<MarketContext>;
  loadNews?: () => Promise<MarketNews[]>;
  loadValuation?: () => Promise<ValuationContext>;
  explain?: (input: CommentaryInput) => Promise<BriefCommentary>;
}

export interface RunResult {
  status: "generated" | "email-only" | "skip";
  marketDate: string;
  reportDir: string;
}

export async function runIndexBrief(
  dependencies: RunDependencies = {},
): Promise<RunResult> {
  const outputRoot = dependencies.outputRoot ?? "daily_reports";
  const now = dependencies.now?.() ?? new Date();
  const market = await (dependencies.loadMarket ?? loadMarketContext)();
  if (market.indices.length !== 2) {
    throw new Error("core market context must contain exactly two indices");
  }

  const paths = reportPaths(outputRoot, market.marketDate);
  const state = inspectState(outputRoot, market.marketDate);
  if (state === "sent") {
    return { status: "skip", marketDate: market.marketDate, reportDir: paths.directory };
  }
  if (state === "report-only") {
    return {
      status: "email-only",
      marketDate: market.marketDate,
      reportDir: paths.directory,
    };
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
  if (valuation.status === "available") {
    appendValuationSnapshot(outputRoot, valuation.snapshot);
  }
  const advice = classifyAdvice(market.indices.map((index) => index.metrics));
  const commentary = await (dependencies.explain ?? writeCommentary)({
    market,
    advice,
    news,
  });
  const report: IndexBriefReport = {
    market,
    advice,
    commentary,
    valuation,
    generatedAt: now.toISOString(),
  };
  writeReportFiles(outputRoot, report);
  return {
    status: "generated",
    marketDate: market.marketDate,
    reportDir: paths.directory,
  };
}
