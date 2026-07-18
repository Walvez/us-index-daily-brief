import { buildIndexBriefReport, type BuildDependencies } from "./build";
import { loadMarketContext } from "./market";
import type { IndexBriefReport } from "./render";
import { inspectState, reportPaths, writeReportFiles } from "./state";

export interface RunDependencies extends BuildDependencies {}

export interface RunResult {
  status: "generated" | "email-only" | "skip";
  marketDate: string;
  reportDir: string;
  report?: IndexBriefReport;
}

/**
 * Legacy single-module runner kept for tests and market-only compatibility.
 * Production orchestration prefers lib/daily-brief.
 */
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

  const report = await buildIndexBriefReport({
    ...dependencies,
    outputRoot,
    now: () => now,
    loadMarket: async () => market,
  });
  writeReportFiles(outputRoot, report);
  return {
    status: "generated",
    marketDate: market.marketDate,
    reportDir: paths.directory,
    report,
  };
}
