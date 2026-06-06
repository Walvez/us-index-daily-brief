import { fetchTickerData, type TickerRawData } from "../trading/yahoo";
import { calculateMetrics } from "./metrics";
import type { IndexSnapshot, MarketContext } from "./types";

export type Fetcher = (
  symbol: string,
) => Promise<TickerRawData | null>;

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

async function latestValue(
  symbol: string,
  fetcher: Fetcher,
): Promise<number | undefined> {
  try {
    const raw = await fetcher(symbol);
    const close = raw?.candles.at(-1)?.close;
    return close != null && Number.isFinite(close) ? close : undefined;
  } catch {
    return undefined;
  }
}

export async function loadMarketContext(
  fetcher: Fetcher = fetchTickerData,
): Promise<MarketContext> {
  const indices: IndexSnapshot[] = [];

  for (const definition of CORE) {
    let raw: TickerRawData | null = null;
    let symbol = "";

    for (const candidate of definition.symbols) {
      raw = await fetcher(candidate);
      if (raw?.candles.length) {
        symbol = candidate;
        break;
      }
    }

    if (!raw?.candles.length) {
      throw new Error(`missing core market data: ${definition.name}`);
    }

    indices.push({
      id: definition.id,
      name: definition.name,
      symbol,
      marketDate: newYorkDateKey(raw.candles.at(-1)!.date),
      metrics: calculateMetrics(raw.candles.map(({ close }) => close)),
    });
  }

  if (new Set(indices.map(({ marketDate }) => marketDate)).size !== 1) {
    throw new Error("core market dates differ");
  }

  const [vix, treasury10y, dxy] = await Promise.all([
    latestValue("^VIX", fetcher),
    latestValue("^TNX", fetcher),
    latestValue("DX-Y.NYB", fetcher),
  ]);

  return {
    marketDate: indices[0].marketDate,
    indices,
    vix,
    treasury10y,
    dxy,
  };
}
