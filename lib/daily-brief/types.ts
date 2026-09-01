/**
 * Neutral daily-brief orchestration types.
 * Modules own their data shapes; the orchestrator only tracks status and sections.
 */

export type ModuleStatus = "success" | "degraded" | "skipped" | "failed";

export type ModuleId = "market" | "tech-news";

export interface SafeDiagnostic {
  code: string;
  message: string;
}

export interface ModuleResult<T = unknown> {
  moduleId: ModuleId;
  status: ModuleStatus;
  data?: T;
  /** Short Chinese notice for the email when status is not success. */
  userMessage?: string;
  diagnostics?: SafeDiagnostic[];
  generatedAt: string;
}

export interface BriefContext {
  editionDate: string;
  /** IANA timezone used for editionDate (e.g. Asia/Taipei). */
  timeZone: string;
  now: Date;
  outputRoot: string;
  validationOnly: boolean;
  /** Most recent marketDate that was already published or sent. */
  latestPublishedMarketDate?: string;
}

export interface DailyBriefConfig {
  timeZone: string;
  outputRoot: string;
  marketEnabled: boolean;
  techNewsEnabled: boolean;
  techNewsLimit: number;
  techNewsWindow: "24h" | "7d";
  validationOnly: boolean;
}

export interface DailyBriefReport {
  version: 1;
  editionDate: string;
  timeZone: string;
  generatedAt: string;
  modules: ModuleResult[];
  subject: string;
}

export type RunStatus = "generated" | "email-only" | "skip";

export interface OrchestratorResult {
  status: RunStatus;
  editionDate: string;
  reportDir: string;
  /** Present when status is generated (fresh report built this run). */
  report?: DailyBriefReport;
}
