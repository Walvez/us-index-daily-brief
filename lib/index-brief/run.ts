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
import type { MarketContext } from "./types";

export interface RunDependencies {
  outputRoot?: string;
  reportBaseUrl?: string;
  now?: () => Date;
  loadMarket?: () => Promise<MarketContext>;
  loadNews?: () => Promise<MarketNews[]>;
  explain?: (input: CommentaryInput) => Promise<BriefCommentary>;
}

export interface RunResult {
  status: "generated" | "email-only" | "skip";
  marketDate: string;
  reportDir: string;
}

function reportUrl(baseUrl: string | undefined, marketDate: string) {
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/$/, "")}/${marketDate}/${marketDate}.html`;
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
    generatedAt: now.toISOString(),
  };
  writeReportFiles(
    outputRoot,
    report,
    reportUrl(dependencies.reportBaseUrl, market.marketDate),
  );
  return {
    status: "generated",
    marketDate: market.marketDate,
    reportDir: paths.directory,
  };
}
