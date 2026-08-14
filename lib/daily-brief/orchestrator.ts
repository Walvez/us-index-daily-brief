import { loadDailyBriefConfig } from "./config";
import { buildEmailSubject, editionDateFor } from "./edition";
import {
  runMarketModule,
  type MarketModuleDependencies,
} from "./market-module";
import {
  decideSendability,
  resolveScheduleAttempt,
  shouldResumeEmailOnlyWithPolicy,
  type ScheduleAttempt,
} from "./send-policy";
import {
  editionPaths,
  inspectEditionState,
  inspectLegacyMarketSent,
  readEditionReport,
  writeEditionReportFiles,
} from "./state";
import {
  runTechNewsModule,
  type TechNewsModuleOptions,
} from "./tech-news/module";
import type {
  BriefContext,
  DailyBriefConfig,
  DailyBriefReport,
  ModuleResult,
  OrchestratorResult,
} from "./types";

export interface OrchestratorDependencies {
  config?: Partial<DailyBriefConfig>;
  now?: () => Date;
  market?: MarketModuleDependencies;
  techNews?: Partial<TechNewsModuleOptions>;
  /** Override schedule attempt (tests). Defaults to env resolution. */
  scheduleAttempt?: ScheduleAttempt;
  /** Manual-only: ignore existing .emailed and regenerate the edition. */
  forceResend?: boolean;
}

function mergeConfig(
  overrides: Partial<DailyBriefConfig> | undefined,
): DailyBriefConfig {
  const base = loadDailyBriefConfig();
  return { ...base, ...overrides };
}

/**
 * Unified daily brief: resolve editionDate, run enabled modules independently,
 * render one report. Does not send mail — that stays in the send script after SMTP success.
 */
export async function runDailyBrief(
  dependencies: OrchestratorDependencies = {},
): Promise<OrchestratorResult> {
  const config = mergeConfig(dependencies.config);
  const now = dependencies.now?.() ?? new Date();
  const editionDate = editionDateFor(now, config.timeZone);
  const paths = editionPaths(config.outputRoot, editionDate);
  const attempt =
    dependencies.scheduleAttempt ?? resolveScheduleAttempt(process.env);
  const forceResend =
    dependencies.forceResend === true ||
    ["1", "true", "yes", "on"].includes(
      (process.env.BRIEF_FORCE_RESEND ?? "").trim().toLowerCase(),
    );

  const state = inspectEditionState(config.outputRoot, editionDate);
  if (state === "sent" && !forceResend) {
    return {
      status: "skip",
      editionDate,
      reportDir: paths.directory,
    };
  }
  if (state === "report-only" && !forceResend) {
    try {
      const existing = readEditionReport(config.outputRoot, editionDate);
      if (
        shouldResumeEmailOnlyWithPolicy(existing, {
          marketEnabled: config.marketEnabled,
          attempt,
        })
      ) {
        return {
          status: "email-only",
          editionDate,
          reportDir: paths.directory,
        };
      }
    } catch {
      // regenerate below
    }
  }

  const context: BriefContext = {
    editionDate,
    timeZone: config.timeZone,
    now,
    outputRoot: config.outputRoot,
    validationOnly: config.validationOnly,
  };

  const modules: ModuleResult[] = [];

  if (config.marketEnabled) {
    modules.push(await runMarketModule(context, dependencies.market));
  } else {
    modules.push({
      moduleId: "market",
      status: "skipped",
      userMessage: "市场模块未启用",
      generatedAt: now.toISOString(),
    });
  }

  // Legacy one-shot migration: if this edition dir is new but the marketDate
  // folder already has .emailed and editionDate === marketDate, skip sending
  // a pure market re-run under the same calendar key.
  const marketResult = modules.find((module) => module.moduleId === "market");
  const marketDate =
    marketResult?.status === "success" || marketResult?.status === "degraded"
      ? (marketResult.data as { marketDate?: string } | undefined)?.marketDate
      : undefined;
  if (
    marketDate &&
    marketDate === editionDate &&
    !config.techNewsEnabled &&
    inspectLegacyMarketSent(config.outputRoot, marketDate)
  ) {
    return {
      status: "skip",
      editionDate,
      reportDir: paths.directory,
    };
  }

  modules.push(
    await runTechNewsModule(context, {
      enabled: config.techNewsEnabled,
      limit: config.techNewsLimit,
      window: config.techNewsWindow,
      ...dependencies.techNews,
    }),
  );

  const activeIds = modules
    .filter((module) => module.status !== "skipped")
    .map((module) => module.moduleId);

  const report: DailyBriefReport = {
    version: 1,
    editionDate,
    timeZone: config.timeZone,
    generatedAt: now.toISOString(),
    modules,
    subject: buildEmailSubject(
      editionDate,
      activeIds.length > 0
        ? activeIds
        : modules.map((module) => module.moduleId),
    ),
  };

  // Always write diagnostic/report files so retries and archives can inspect them.
  // Sendability is decided separately (attempt-aware) by the CLI / workflow.
  writeEditionReportFiles(config.outputRoot, report);
  return {
    status: "generated",
    editionDate,
    reportDir: paths.directory,
    report,
  };
}

export function reportHasSendableContent(
  report: DailyBriefReport,
  options: {
    marketEnabled: boolean;
    attempt?: ScheduleAttempt;
  },
): boolean {
  return decideSendability(report, options).sendable;
}
