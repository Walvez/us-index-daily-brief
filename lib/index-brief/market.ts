import { fetchTickerData, type TickerRawData } from "../trading/yahoo";
import { calculateMetrics } from "./metrics";
import type { IndexSnapshot, MarketContext } from "./types";

export type Fetcher = (
  symbol: string,
  signal?: AbortSignal,
) => Promise<TickerRawData | null>;

export interface MarketLoadOptions {
  timeoutMs?: number;
  logger?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const CORE = [
  {
    id: "nasdaq100" as const,
    name: "纳斯达克100",
    symbols: ["^NDX", "QQQ"],
  },
  {
    id: "sp500" as const,
    name: "标普500",
    symbols: ["^GSPC", "SPY"],
  },
];

const NEW_YORK_DATE_FORMATTER = new Intl.DateTimeFormat(
  "en-US-u-ca-gregory-nu-latn",
  {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  },
);

function newYorkDateKey(date: Date): string {
  const parts = Object.fromEntries(
    NEW_YORK_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [
      type,
      value,
    ]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(
  fetcher: Fetcher,
  symbol: string,
  timeoutMs: number,
): Promise<TickerRawData | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<TickerRawData | null>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`${symbol} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      Promise.resolve()
        .then(() => fetcher(symbol, controller.signal))
        .then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function validateCoreData(raw: TickerRawData): void {
  if (raw.candles.length < 21) {
    throw new Error("at least 21 candles are required");
  }

  for (const candle of raw.candles) {
    const prices = [candle.open, candle.high, candle.low, candle.close];
    if (prices.some((price) => !Number.isFinite(price) || price <= 0)) {
      throw new Error("candles must contain only finite positive prices");
    }
  }

  const latestDate = raw.candles.at(-1)!.date;
  if (!Number.isFinite(latestDate.getTime())) {
    throw new Error("latest candle date is invalid");
  }
}

async function loadCoreIndex(
  definition: (typeof CORE)[number],
  fetcher: Fetcher,
  timeoutMs: number,
  logger: (message: string) => void,
): Promise<IndexSnapshot> {
  for (const symbol of definition.symbols) {
    try {
      const raw = await fetchWithTimeout(fetcher, symbol, timeoutMs);
      if (!raw) throw new Error("no data returned");

      validateCoreData(raw);
      return {
        id: definition.id,
        name: definition.name,
        symbol,
        marketDate: newYorkDateKey(raw.candles.at(-1)!.date),
        metrics: calculateMetrics(raw.candles.map(({ close }) => close)),
      };
    } catch (error) {
      try {
        logger(
          `market candidate ${symbol} failed: ${describeError(error)}`,
        );
      } catch {
        // Logging must not prevent fallback to the next market candidate.
      }
    }
  }

  throw new Error(`missing core market data: ${definition.name}`);
}

async function latestValue(
  symbol: string,
  fetcher: Fetcher,
  timeoutMs: number,
  marketDate: string,
): Promise<number | undefined> {
  try {
    const raw = await fetchWithTimeout(fetcher, symbol, timeoutMs);
    const latest = raw?.candles.at(-1);
    if (
      !latest ||
      !Number.isFinite(latest.close) ||
      latest.close <= 0 ||
      !Number.isFinite(latest.date.getTime()) ||
      newYorkDateKey(latest.date) !== marketDate
    ) {
      return undefined;
    }
    return latest.close;
  } catch {
    return undefined;
  }
}

export async function loadMarketContext(
  fetcher: Fetcher = fetchTickerData,
  options: MarketLoadOptions = {},
): Promise<MarketContext> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a finite positive number");
  }
  const logger = options.logger ?? console.warn;

  const coreResults = await Promise.allSettled(
    CORE.map((definition) =>
      loadCoreIndex(definition, fetcher, timeoutMs, logger),
    ),
  );
  const failedCore = coreResults.find(
    (result) => result.status === "rejected",
  );
  if (failedCore?.status === "rejected") throw failedCore.reason;
  const indices = coreResults.map((result) => {
    if (result.status !== "fulfilled") {
      throw new Error("unreachable rejected core result");
    }
    return result.value;
  });

  if (new Set(indices.map(({ marketDate }) => marketDate)).size !== 1) {
    throw new Error("core market dates differ");
  }

  const marketDate = indices[0].marketDate;
  const [vix, treasury10y, dxy] = await Promise.all([
    latestValue("^VIX", fetcher, timeoutMs, marketDate),
    latestValue("^TNX", fetcher, timeoutMs, marketDate),
    latestValue("DX-Y.NYB", fetcher, timeoutMs, marketDate),
  ]);

  return {
    marketDate,
    indices,
    vix,
    treasury10y,
    dxy,
  };
}
