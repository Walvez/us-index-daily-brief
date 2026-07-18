import {
  buildIndexBriefReport,
  type BuildDependencies,
} from "../index-brief/build";
import type { IndexBriefReport } from "../index-brief/render";
import type { BriefContext, ModuleResult } from "./types";

export interface MarketModuleData {
  report: IndexBriefReport;
  marketDate: string;
  /** True when marketDate differs from editionDate (last session / holiday). */
  isLastTradingDay: boolean;
  staleLabel?: string;
}

export interface MarketModuleDependencies extends BuildDependencies {}

/**
 * Market module: reuses proven index-brief calculations.
 * Does not write edition files; orchestrator owns persistence.
 */
export async function runMarketModule(
  context: BriefContext,
  dependencies: MarketModuleDependencies = {},
): Promise<ModuleResult<MarketModuleData>> {
  const generatedAt = context.now.toISOString();
  try {
    const report = await buildIndexBriefReport({
      ...dependencies,
      outputRoot: context.outputRoot,
      now: () => context.now,
      // Valuation history is appended under outputRoot (shared archive root).
      persistValuationHistory: true,
    });
    const marketDate = report.market.marketDate;
    const isLastTradingDay = marketDate !== context.editionDate;
    const staleLabel = isLastTradingDay
      ? `最近交易日 ${marketDate}（非 ${context.editionDate} 当日收盘）`
      : undefined;

    return {
      moduleId: "market",
      status: "success",
      data: {
        report,
        marketDate,
        isLastTradingDay,
        staleLabel,
      },
      userMessage: staleLabel,
      generatedAt,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "market module failed";
    return {
      moduleId: "market",
      status: "failed",
      userMessage: "市场数据暂不可用",
      diagnostics: [{ code: "market-failed", message }],
      generatedAt,
    };
  }
}
