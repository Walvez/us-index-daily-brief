import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  IndexId,
  IndexValuation,
  ValuationContext,
  ValuationSnapshot,
  ValuationTemperature,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const NASDAQ_VALUATION_URL =
  "https://www.nasdaq.com/docs/index/global-index-investment-insights";
const execFileAsync = promisify(execFile);

export interface ValuationLoadOptions {
  now?: Date;
  sourceUrl?: string;
  timeoutMs?: number;
  debug?: boolean;
  fetchPdf?: (url: string, signal: AbortSignal) => Promise<Uint8Array>;
  extractText?: (bytes: Uint8Array) => Promise<string>;
  logger?: (message: string) => void;
}

function normalize(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/Nasdaq\s*-\s*100(?:\s*®)?/gi, "Nasdaq-100")
    .replace(/\s+/g, " ")
    .trim();
}

function numberToken(value: string): number {
  return Number(value.replace(/[,%]/g, ""));
}

function valuationFromValues(
  id: IndexId,
  values: string[],
  offset: number,
): IndexValuation {
  const forwardPe = numberToken(values[offset + 6]);
  const tenYearAveragePe = numberToken(values[offset + 7]);
  if (
    !Number.isFinite(forwardPe) ||
    !Number.isFinite(tenYearAveragePe) ||
    forwardPe < 5 ||
    forwardPe > 100 ||
    tenYearAveragePe < 5 ||
    tenYearAveragePe > 100
  ) {
    throw new Error(`valuation is outside plausible range: ${id}`);
  }

  const premiumPct = (forwardPe / tenYearAveragePe - 1) * 100;
  return {
    id,
    forwardPe,
    tenYearAveragePe,
    premiumPct,
    temperature: classifyValuation(premiumPct),
  };
}

function parseGlobalEquities(text: string): IndexValuation[] {
  const header = /Last vs\. 10yr Avg\./i.exec(text);
  if (!header) throw new Error("missing valuation row: table header");

  const tail = text.slice(header.index + header[0].length);
  const end = /Russell 2000/i.exec(tail);
  if (!end) throw new Error("missing valuation row: Russell 2000");

  const tableText = tail
    .slice(0, end.index)
    .replace(/Nasdaq-100/gi, "")
    .replace(/S&P 500/gi, "");
  const values =
    tableText.match(/[+-]?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  if (values.length < 18) {
    throw new Error(
      `missing valuation table values: count=${values.length} text=${tableText.slice(0, 400)}`,
    );
  }

  return [
    valuationFromValues("nasdaq100", values, 0),
    valuationFromValues("sp500", values, 9),
  ];
}

function isoDate(month: string, day: string, year: string): string {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new Error("invalid valuation as-of date");
  }
  return date.toISOString().slice(0, 10);
}

export function classifyValuation(
  premiumPct: number,
): ValuationTemperature {
  if (premiumPct <= -10) return "低于长期均值";
  if (premiumPct <= 10) return "接近长期均值";
  if (premiumPct <= 25) return "高于长期均值";
  return "明显高于长期均值";
}

export function parseNasdaqValuationText(
  rawText: string,
  sourceUrl: string,
): ValuationSnapshot {
  const text = normalize(rawText);
  const dateMatch = /Data as of (\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
  if (!dateMatch) throw new Error("missing valuation as-of date");

  return {
    asOf: isoDate(dateMatch[1], dateMatch[2], dateMatch[3]),
    sourceUrl,
    indices: parseGlobalEquities(text),
  };
}

export function validateValuationFreshness(
  snapshot: ValuationSnapshot,
  now: Date,
): ValuationContext {
  const currentDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const ageDays =
    (currentDay - Date.parse(`${snapshot.asOf}T00:00:00Z`)) / DAY_MS;

  if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 45) {
    return {
      status: "unavailable",
      reason: "stale",
      message: "官方估值数据暂未更新",
    };
  }
  return { status: "available", snapshot };
}

async function defaultFetchPdf(
  url: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal,
    headers: { "user-agent": "us-index-daily-brief/1.0" },
  });
  if (!response.ok) throw new Error(`valuation HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function defaultExtractText(bytes: Uint8Array): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "index-valuation-"));
  const input = path.join(directory, "valuation.pdf");
  try {
    await fs.writeFile(input, bytes);
    const { stdout } = await execFileAsync("pdftotext", [input, "-"], {
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!stdout.trim()) throw new Error("valuation PDF contained no text");
    return stdout;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function loadValuationContext(
  options: ValuationLoadOptions = {},
): Promise<ValuationContext> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15_000,
  );

  let extractedText = "";
  try {
    const sourceUrl = options.sourceUrl ?? NASDAQ_VALUATION_URL;
    const bytes = await (options.fetchPdf ?? defaultFetchPdf)(
      sourceUrl,
      controller.signal,
    );
    extractedText = await (options.extractText ?? defaultExtractText)(bytes);
    const snapshot = parseNasdaqValuationText(extractedText, sourceUrl);
    return validateValuationFreshness(snapshot, options.now ?? new Date());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const excerpt = options.debug
      ? ` text=${normalize(extractedText).slice(0, 3000)}`
      : "";
    (options.logger ?? console.warn)(
      `valuation load failed: ${message}${excerpt}`,
    );
    return {
      status: "unavailable",
      reason:
        /missing|invalid|plausible|valuation row/i.test(message)
          ? "invalid-data"
          : "fetch-failed",
      message: "官方估值数据暂不可用",
    };
  } finally {
    clearTimeout(timeout);
  }
}
