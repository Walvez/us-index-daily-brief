import type { DailyBriefReport, ModuleResult } from "./types";
import { shouldSendReport } from "./render";

/**
 * Schedule attempt class for the single personal-daily-brief workflow.
 *
 * - early  — 16:05 / 16:35 / 17:05 America/New_York: prefer waiting for market data
 * - final  — 17:35 America/New_York: last scheduled slot; may fall back to tech-only
 * - manual — workflow_dispatch: operator-triggered; same fallback as final
 */
export type ScheduleAttempt = "early" | "final" | "manual";

export type SendDecision = {
  sendable: boolean;
  reason: string;
};

const FINAL_CRON = "35 17 * * 1-5";

/**
 * Resolve attempt from env (preferred) or GitHub schedule metadata.
 *
 * Env knobs (non-secret):
 * - BRIEF_SCHEDULE_ATTEMPT=early|final|manual
 * - GITHUB_EVENT_NAME / GITHUB_EVENT_SCHEDULE (set by Actions)
 */
export function resolveScheduleAttempt(
  env: NodeJS.ProcessEnv = process.env,
): ScheduleAttempt {
  const explicit = env.BRIEF_SCHEDULE_ATTEMPT?.trim().toLowerCase();
  if (explicit === "early" || explicit === "final" || explicit === "manual") {
    return explicit;
  }

  const eventName = env.GITHUB_EVENT_NAME?.trim();
  if (eventName === "workflow_dispatch") return "manual";
  if (eventName === "schedule") {
    const cron = env.GITHUB_EVENT_SCHEDULE?.trim();
    if (cron === FINAL_CRON) return "final";
    // 16:05, 16:35, and 17:05 America/New_York (and any other schedule) are early retries.
    return "early";
  }

  // Local / non-Actions runs behave like a deliberate final attempt so
  // operators are not blocked waiting for a later cron.
  return "manual";
}

function moduleById(
  report: DailyBriefReport,
  id: string,
): ModuleResult | undefined {
  return report.modules.find((module) => module.moduleId === id);
}

function techHasTrustworthyContent(report: DailyBriefReport): boolean {
  const tech = moduleById(report, "tech-news");
  if (!tech) return false;
  if (tech.status !== "success" && tech.status !== "degraded") return false;
  const items = (tech.data as { items?: unknown[] } | undefined)?.items;
  return Array.isArray(items) && items.length > 0;
}

function marketOk(report: DailyBriefReport): boolean {
  const market = moduleById(report, "market");
  return market?.status === "success" || market?.status === "degraded";
}

/**
 * Explicit attempt-aware send policy for the single pipeline / single email.
 *
 * When market is enabled:
 * - early attempts defer SMTP if market failed (even if tech succeeded),
 *   so later retries can still produce a market section and send once;
 * - final / manual may send tech-only when tech has trustworthy content.
 *
 * Never marks sendable before content exists; SMTP + .emailed remain
 * downstream of this decision.
 */
export function decideSendability(
  report: DailyBriefReport,
  options: {
    marketEnabled: boolean;
    attempt?: ScheduleAttempt;
  },
): SendDecision {
  const attempt = options.attempt ?? "manual";

  if (!shouldSendReport(report)) {
    return {
      sendable: false,
      reason: "no-success-or-degraded-module",
    };
  }

  if (!options.marketEnabled) {
    return { sendable: true, reason: "market-disabled-any-module" };
  }

  if (marketOk(report)) {
    return { sendable: true, reason: "market-ready" };
  }

  // Market enabled but failed / missing / skipped.
  if (attempt === "early") {
    return {
      sendable: false,
      reason: "early-defer-market-failed",
    };
  }

  // final / manual fallback: tech-only when tech content is trustworthy.
  if (techHasTrustworthyContent(report)) {
    return {
      sendable: true,
      reason:
        attempt === "final"
          ? "final-tech-only-fallback"
          : "manual-tech-only-fallback",
    };
  }

  return {
    sendable: false,
    reason: "market-failed-without-tech-fallback",
  };
}

/**
 * Whether a report-only directory is safe to resume as email-only
 * under the current attempt policy (no regeneration).
 */
export function shouldResumeEmailOnlyWithPolicy(
  report: DailyBriefReport,
  options: {
    marketEnabled: boolean;
    attempt?: ScheduleAttempt;
  },
): boolean {
  return decideSendability(report, options).sendable;
}
