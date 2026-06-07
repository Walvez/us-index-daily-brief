import fs from "node:fs";
import path from "node:path";
import type { IndexBriefReport } from "./render";
import { renderEmailHtml, renderFullHtml } from "./render";

export type ReportState = "missing" | "report-only" | "sent";

export function reportPaths(root: string, marketDate: string) {
  const directory = path.join(root, marketDate);
  const base = path.join(directory, marketDate);
  return {
    directory,
    json: `${base}.json`,
    html: `${base}.html`,
    emailHtml: `${base}-email.html`,
    emailed: path.join(directory, ".emailed"),
  };
}

export function inspectState(root: string, marketDate: string): ReportState {
  const paths = reportPaths(root, marketDate);
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

function atomicWrite(filePath: string, content: string): void {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filePath);
}

export function writeReportFiles(
  root: string,
  report: IndexBriefReport,
): void {
  const paths = reportPaths(root, report.market.marketDate);
  fs.mkdirSync(paths.directory, { recursive: true });
  atomicWrite(paths.json, JSON.stringify(report, null, 2));
  atomicWrite(paths.html, renderFullHtml(report));
  atomicWrite(paths.emailHtml, renderEmailHtml(report));
}

export function markEmailed(root: string, marketDate: string): void {
  const paths = reportPaths(root, marketDate);
  if (!fs.existsSync(paths.emailHtml)) {
    throw new Error(`email report is missing for ${marketDate}`);
  }
  atomicWrite(paths.emailed, `${new Date().toISOString()}\n`);
}

export function readEmailHtml(root: string, marketDate: string): string {
  const filePath = reportPaths(root, marketDate).emailHtml;
  if (!fs.existsSync(filePath)) {
    throw new Error(`email report is missing for ${marketDate}`);
  }
  return fs.readFileSync(filePath, "utf8");
}
