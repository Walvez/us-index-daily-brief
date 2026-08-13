import type { DailyBriefConfig } from "./types";

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw == null || raw.trim() === "") return defaultValue;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return defaultValue;
}

function parseIntInRange(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw.trim() === "") return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(max, Math.max(min, n));
}

function parseTechNewsWindow(raw: string | undefined): "24h" | "7d" {
  return raw?.trim().toLowerCase() === "7d" ? "7d" : "24h";
}

/**
 * Read orchestration config from the environment.
 *
 * Defaults are production-safe:
 * - market module on
 * - tech-news off until explicitly enabled (TECH_NEWS_ENABLED=true or
 *   BRIEF_MODULES includes tech-news)
 * - Asia/Taipei for edition dating (override with REPORT_TZ)
 */
export function loadDailyBriefConfig(
  env: NodeJS.ProcessEnv = process.env,
): DailyBriefConfig {
  const modulesRaw = env.BRIEF_MODULES?.trim();
  const moduleSet = modulesRaw
    ? new Set(
        modulesRaw
          .split(",")
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean),
      )
    : null;

  const marketEnabled = moduleSet
    ? moduleSet.has("market")
    : parseBool(env.MARKET_MODULE_ENABLED, true);

  const techNewsEnabled = moduleSet
    ? moduleSet.has("tech-news") || moduleSet.has("tech")
    : parseBool(env.TECH_NEWS_ENABLED, false);

  return {
    timeZone: env.REPORT_TZ?.trim() || "Asia/Taipei",
    outputRoot: env.REPORT_OUTPUT_DIR?.trim() || "daily_reports",
    marketEnabled,
    techNewsEnabled,
    techNewsLimit: parseIntInRange(env.TECH_NEWS_LIMIT, 5, 3, 5),
    techNewsWindow: parseTechNewsWindow(env.TECH_NEWS_WINDOW),
    validationOnly: parseBool(env.VALIDATION_ONLY, false),
  };
}
