import fs from "node:fs";
import path from "node:path";
import type { DailyBriefReport } from "./types";
import { renderEmailHtml, renderFullHtml } from "./render";

export type ReportState = "missing" | "report-only" | "sent";

export function editionPaths(root: string, editionDate: string) {
  const directory = path.join(root, editionDate);
  const base = path.join(directory, editionDate);
  return {
    directory,
    json: `${base}.json`,
    html: `${base}.html`,
    emailHtml: `${base}-email.html`,
    emailed: path.join(directory, ".emailed"),
    /** Optional structured send marker (JSON). */
    sentMeta: path.join(directory, "sent.json"),
  };
}

/**
 * Legacy index-brief paths keyed by marketDate.
 * Kept for read-only migration checks and historical archives.
 */
export function legacyMarketPaths(root: string, marketDate: string) {
  const directory = path.join(root, marketDate);
  return {
    directory,
    emailed: path.join(directory, ".emailed"),
    emailHtml: path.join(directory, `${marketDate}-email.html`),
    json: path.join(directory, `${marketDate}.json`),
  };
}

export function inspectEditionState(
  root: string,
  editionDate: string,
): ReportState {
  const paths = editionPaths(root, editionDate);
  if (fs.existsSync(paths.emailed)) return "sent";
  if (
    fs.existsSync(paths.json) &&
    fs.existsSync(paths.html) &&
    fs.existsSync(paths.emailHtml)
  ) {
    return "report-only";
  }
  return "missing";
}

/**
 * Detect a legacy market-date send that already covered the same calendar day
 * under the old index-brief layout. Used only when the edition directory is
 * still missing so we do not double-send on the first day after migration when
 * editionDate happened to equal marketDate.
 */
export function inspectLegacyMarketSent(
  root: string,
  marketDate: string,
): boolean {
  return fs.existsSync(legacyMarketPaths(root, marketDate).emailed);
}

function atomicWrite(filePath: string, content: string): void {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filePath);
}

export function writeEditionReportFiles(
  root: string,
  report: DailyBriefReport,
): void {
  const paths = editionPaths(root, report.editionDate);
  fs.mkdirSync(paths.directory, { recursive: true });
  atomicWrite(paths.json, JSON.stringify(report, null, 2));
  atomicWrite(paths.html, renderFullHtml(report));
  atomicWrite(paths.emailHtml, renderEmailHtml(report));
}

export function markEditionEmailed(
  root: string,
  editionDate: string,
  meta: { messageId?: string; sentAt?: string } = {},
): void {
  const paths = editionPaths(root, editionDate);
  if (!fs.existsSync(paths.emailHtml)) {
    throw new Error(`email report is missing for edition ${editionDate}`);
  }
  const sentAt = meta.sentAt ?? new Date().toISOString();
  atomicWrite(paths.emailed, `${sentAt}\n`);
  atomicWrite(
    paths.sentMeta,
    `${JSON.stringify(
      {
        editionDate,
        sentAt,
        messageId: meta.messageId ?? null,
      },
      null,
      2,
    )}\n`,
  );
}

export function readEditionEmailHtml(root: string, editionDate: string): string {
  const filePath = editionPaths(root, editionDate).emailHtml;
  if (!fs.existsSync(filePath)) {
    throw new Error(`email report is missing for edition ${editionDate}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

export function readEditionReport(
  root: string,
  editionDate: string,
): DailyBriefReport {
  const filePath = editionPaths(root, editionDate).json;
  if (!fs.existsSync(filePath)) {
    throw new Error(`report json is missing for edition ${editionDate}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as DailyBriefReport;
}

/**
 * Extract marketDate from a parsed report object.
 * Handles both DailyBriefReport (version 1) and legacy IndexBriefReport.
 */
export function extractReportMarketDate(content: unknown): string | undefined {
  if (!content || typeof content !== "object") return undefined;
  const report = content as Record<string, unknown>;

  // DailyBriefReport (version 1)
  if (Array.isArray(report.modules)) {
    const marketModule = report.modules.find(
      (m: unknown) =>
        (m as { moduleId?: string })?.moduleId === "market",
    ) as
      | {
          status?: string;
          data?: {
            marketDate?: string;
            report?: { market?: { marketDate?: string } };
          };
        }
      | undefined;

    if (
      marketModule &&
      (marketModule.status === "success" || marketModule.status === "degraded")
    ) {
      const date =
        marketModule.data?.marketDate ??
        marketModule.data?.report?.market?.marketDate;
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return date;
      }
    }
    return undefined;
  }

  // Legacy IndexBriefReport
  if (report.market && typeof report.market === "object") {
    const date = (report.market as { marketDate?: string }).marketDate;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
  }

  return undefined;
}

/**
 * Find the most recent marketDate among already published/archived or sent editions.
 *
 * Scans outputRoot subdirectories (YYYY-MM-DD):
 * - If currentEditionDate is provided:
 *   - The current edition directory (dir === currentEditionDate) is only considered
 *     if it was already sent (.emailed exists). An un-sent in-flight report for
 *     today is NOT a prior published edition.
 *   - Future dates (dir > currentEditionDate) are ignored.
 * - Extracts marketDate from <dir>/<dir>.json.
 * - Also supports legacy market directories where dir was marketDate and had .emailed.
 *
 * Returns the latest (lexicographically max) valid marketDate string, or undefined if none found.
 */
export function findLatestPublishedMarketDate(
  root: string,
  currentEditionDate?: string,
): string | undefined {
  if (!fs.existsSync(root)) return undefined;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const marketDates: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = entry.name;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dir)) continue;

    // Ignore future dirs if currentEditionDate is set
    if (currentEditionDate && dir > currentEditionDate) {
      continue;
    }

    // For current edition date, ignore unless it was already sent (.emailed exists)
    if (currentEditionDate && dir === currentEditionDate) {
      const emailedPath = path.join(root, dir, ".emailed");
      if (!fs.existsSync(emailedPath)) {
        continue;
      }
    }

    // Try reading <dir>/<dir>.json
    const jsonPath = path.join(root, dir, `${dir}.json`);
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        const mDate = extractReportMarketDate(raw);
        if (mDate) {
          marketDates.push(mDate);
          continue;
        }
      } catch {
        // ignore malformed JSON
      }
    }

    // Check legacy market layout where dir was marketDate and had .emailed
    const legacyEmailed = path.join(root, dir, ".emailed");
    if (fs.existsSync(legacyEmailed)) {
      marketDates.push(dir);
    }
  }

  if (marketDates.length === 0) return undefined;
  marketDates.sort();
  return marketDates[marketDates.length - 1];
}
