import test from "node:test";
import assert from "node:assert/strict";
import { loadMarketContext } from "../../lib/index-brief/market";
import type { TickerRawData } from "../../lib/trading/yahoo";

type FixtureOptions = {
  latestClose?: number;
  latestInstant?: string;
};

function fixture(
  symbol: string,
  marketDate: string,
  options: FixtureOptions = {},
): TickerRawData {
  const latest = new Date(
    options.latestInstant ?? `${marketDate}T16:00:00-04:00`,
  );
  const latestClose = options.latestClose ?? 319;
  const candles = Array.from({ length: 220 }, (_, index) => {
    const date = new Date(latest);
    date.setUTCDate(date.getUTCDate() - (219 - index));
    const close = latestClose * (0.5 + (0.5 * index) / 219);

    return {
      date,
      open: close * 0.995,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_000_000,
    };
  });

  return {
    symbol,
    currency: "USD",
    exchangeName: "TEST",
    regularMarketPrice: latestClose + 1_000,
    fiftyTwoWeekHigh: latestClose,
    fiftyTwoWeekLow: candles[0].close,
    candles,
  };
}

function coreFixture(symbol: string, marketDate = "2026-06-05"): TickerRawData {
  return fixture(symbol, marketDate, {
    latestInstant: `${marketDate}T20:30:00-04:00`,
  });
}

test("uses QQQ fallback when ^NDX is unavailable", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX") return null;
    if (symbol === "^GSPC") return coreFixture(symbol);
    if (symbol === "QQQ") return coreFixture(symbol);
    return null;
  };

  const context = await loadMarketContext(fetcher);

  assert.equal(context.indices[0].symbol, "QQQ");
  assert.equal(context.marketDate, "2026-06-05");
});

test("rejects mismatched core market dates", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX") return coreFixture(symbol, "2026-06-05");
    if (symbol === "^GSPC") return coreFixture(symbol, "2026-06-04");
    return null;
  };

  await assert.rejects(() => loadMarketContext(fetcher), /market dates differ/);
});

test("rejects missing core data", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX") return coreFixture(symbol);
    return null;
  };

  await assert.rejects(
    () => loadMarketContext(fetcher),
    /missing core market data/i,
  );
});

test("prefers each primary symbol when it is available", async () => {
  const calls: string[] = [];
  const fetcher = async (symbol: string) => {
    calls.push(symbol);
    if (symbol === "^NDX" || symbol === "^GSPC") {
      return coreFixture(symbol);
    }
    return null;
  };

  const context = await loadMarketContext(fetcher);

  assert.deepEqual(
    context.indices.map((index) => index.symbol),
    ["^NDX", "^GSPC"],
  );
  assert.ok(!calls.includes("QQQ"));
  assert.ok(!calls.includes("SPY"));
});

test("optional macro failures do not invalidate core data and successes are exposed", async () => {
  const optionalSymbols = ["^VIX", "^TNX", "DX-Y.NYB"] as const;

  for (const failedSymbol of optionalSymbols) {
    const fetcher = async (symbol: string) => {
      if (symbol === "^NDX" || symbol === "^GSPC") {
        return coreFixture(symbol);
      }
      if (symbol === failedSymbol) {
        throw new Error(`failed ${symbol}`);
      }
      if (symbol === "^VIX") {
        return fixture(symbol, "2026-06-05", { latestClose: 18.5 });
      }
      if (symbol === "^TNX") {
        return fixture(symbol, "2026-06-05", { latestClose: 4.25 });
      }
      if (symbol === "DX-Y.NYB") {
        return fixture(symbol, "2026-06-05", { latestClose: 101.75 });
      }
      return null;
    };

    const context = await loadMarketContext(fetcher);

    assert.equal(context.indices.length, 2);
    assert.equal(context.vix, failedSymbol === "^VIX" ? undefined : 18.5);
    assert.equal(
      context.treasury10y,
      failedSymbol === "^TNX" ? undefined : 4.25,
    );
    assert.equal(
      context.dxy,
      failedSymbol === "DX-Y.NYB" ? undefined : 101.75,
    );
  }
});

test("returns exactly Nasdaq 100 then S&P 500 using exact New York date keys", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX" || symbol === "^GSPC") {
      return coreFixture(symbol);
    }
    return null;
  };

  const context = await loadMarketContext(fetcher);

  assert.equal(context.marketDate, "2026-06-05");
  assert.equal(context.indices.length, 2);
  assert.deepEqual(
    context.indices.map(({ id, marketDate }) => ({
      id,
      marketDate,
    })),
    [
      {
        id: "nasdaq100",
        marketDate: "2026-06-05",
      },
      {
        id: "sp500",
        marketDate: "2026-06-05",
      },
    ],
  );
});
