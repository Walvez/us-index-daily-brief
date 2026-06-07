import type {
  IndexId,
  IndexValuation,
  ValuationContext,
  ValuationSnapshot,
  ValuationTemperature,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function normalize(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/Nasdaq\s*-\s*100\s*®?/gi, "Nasdaq-100")
    .replace(/\s+/g, " ")
    .trim();
}

function numberToken(value: string): number {
  return Number(value.replace(/[,%]/g, ""));
}

function parseRow(
  text: string,
  id: IndexId,
  start: RegExp,
  end: RegExp,
): IndexValuation {
  const startMatch = start.exec(text);
  if (!startMatch) throw new Error(`missing valuation row: ${id}`);

  const tail = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = end.exec(tail);
  const row = tail.slice(0, endMatch?.index ?? tail.length);
  const values = row.match(/[+-]?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  if (values.length < 9) {
    throw new Error(`missing valuation row values: ${id}`);
  }

  const forwardPe = numberToken(values[6]);
  const tenYearAveragePe = numberToken(values[7]);
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
    indices: [
      parseRow(text, "nasdaq100", /Nasdaq-100/i, /S&P 500/i),
      parseRow(text, "sp500", /S&P 500/i, /Russell 2000/i),
    ],
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
