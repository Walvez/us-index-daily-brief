import test from "node:test";
import assert from "node:assert/strict";
import { loadMarketContext } from "../../lib/index-brief/market";
import type { TickerRawData } from "../../lib/trading/yahoo";

const TEST_TIMEOUT_MS = 10;
const silentLogger = () => {};

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

function load(
  fetcher: (symbol: string) => Promise<TickerRawData | null>,
  timeoutMs = TEST_TIMEOUT_MS,
) {
  return loadMarketContext(fetcher, { timeoutMs, logger: silentLogger });
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs = 200,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`test deadline exceeded after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("uses QQQ fallback when ^NDX is unavailable", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX") return null;
    if (symbol === "^GSPC") return coreFixture(symbol);
    if (symbol === "QQQ") return coreFixture(symbol);
    return null;
  };

  const context = await load(fetcher);

  assert.equal(context.indices[0].symbol, "QQQ");
  assert.equal(context.marketDate, "2026-06-05");
});

test("uses QQQ fallback when ^NDX fetch rejects", async () => {
  const logs: string[] = [];
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX") throw new Error("primary failed");
    if (symbol === "QQQ" || symbol === "^GSPC") return coreFixture(symbol);
    return null;
  };

  const context = await loadMarketContext(fetcher, {
    timeoutMs: TEST_TIMEOUT_MS,
    logger: (message: string) => logs.push(message),
  });

  assert.equal(context.indices[0].symbol, "QQQ");
  assert.match(logs[0], /\^NDX.*primary failed/);
});

test("uses QQQ fallback when ^NDX fetch times out", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX") {
      return new Promise<TickerRawData | null>(() => {});
    }
    if (symbol === "QQQ" || symbol === "^GSPC") return coreFixture(symbol);
    return null;
  };

  const context = await settleWithin(load(fetcher));

  assert.equal(context.indices[0].symbol, "QQQ");
});

test("uses QQQ fallback when ^NDX data is unusable", async () => {
  const unusablePrimary = [
    (raw: TickerRawData) => {
      raw.candles = raw.candles.slice(-20);
    },
    (raw: TickerRawData) => {
      raw.candles.at(-1)!.close = Number.NaN;
    },
    (raw: TickerRawData) => {
      raw.candles[0].open = 0;
    },
    (raw: TickerRawData) => {
      raw.candles[10].close = 0;
    },
  ];

  for (const makeUnusable of unusablePrimary) {
    const fetcher = async (symbol: string) => {
      if (symbol === "^NDX") {
        const raw = coreFixture(symbol);
        makeUnusable(raw);
        return raw;
      }
      if (symbol === "QQQ" || symbol === "^GSPC") return coreFixture(symbol);
      return null;
    };

    const context = await load(fetcher);

    assert.equal(context.indices[0].symbol, "QQQ");
  }
});

test("rejects mismatched core market dates", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX") return coreFixture(symbol, "2026-06-05");
    if (symbol === "^GSPC") return coreFixture(symbol, "2026-06-04");
    return null;
  };

  await assert.rejects(() => load(fetcher), /market dates differ/);
});

test("rejects missing core data", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX") return coreFixture(symbol);
    return null;
  };

  await assert.rejects(
    () => load(fetcher),
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

  const context = await load(fetcher);

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

    const context = await load(fetcher);

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

test("a hanging optional macro times out without blocking market context", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX" || symbol === "^GSPC") {
      return coreFixture(symbol);
    }
    if (symbol === "^VIX") {
      return new Promise<TickerRawData | null>(() => {});
    }
    return null;
  };

  const context = await settleWithin(load(fetcher));

  assert.equal(context.indices.length, 2);
  assert.equal(context.vix, undefined);
});

test("optional macro values must match the validated core market date", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX" || symbol === "^GSPC") {
      return coreFixture(symbol, "2026-06-05");
    }
    if (symbol === "^VIX") {
      return fixture(symbol, "2026-06-04", { latestClose: 18.5 });
    }
    if (symbol === "^TNX") {
      return fixture(symbol, "2026-06-05", { latestClose: 4.25 });
    }
    if (symbol === "DX-Y.NYB") {
      return fixture(symbol, "2026-06-06", { latestClose: 101.75 });
    }
    return null;
  };

  const context = await load(fetcher);

  assert.equal(context.vix, undefined);
  assert.equal(context.treasury10y, 4.25);
  assert.equal(context.dxy, undefined);
});

test("loads core definitions concurrently while preserving index order", async () => {
  const started = new Set<string>();
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX" || symbol === "^GSPC") {
      started.add(symbol);
      if (started.size === 2) release();
      await bothStarted;
      return coreFixture(symbol);
    }
    return null;
  };

  const context = await settleWithin(load(fetcher, 100));

  assert.deepEqual([...started].sort(), ["^GSPC", "^NDX"]);
  assert.deepEqual(
    context.indices.map(({ id }) => id),
    ["nasdaq100", "sp500"],
  );
});

test("formats an exact winter EST New York date", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX" || symbol === "^GSPC") {
      return fixture(symbol, "2026-01-14", {
        latestInstant: "2026-01-15T04:30:00.000Z",
      });
    }
    return null;
  };

  const context = await load(fetcher);

  assert.equal(context.marketDate, "2026-01-14");
});

test("formats an exact New York date after the DST boundary", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX" || symbol === "^GSPC") {
      return fixture(symbol, "2026-03-09", {
        latestInstant: "2026-03-09T04:30:00.000Z",
      });
    }
    return null;
  };

  const context = await load(fetcher);

  assert.equal(context.marketDate, "2026-03-09");
});

test("returns exactly Nasdaq 100 then S&P 500 using exact New York date keys", async () => {
  const fetcher = async (symbol: string) => {
    if (symbol === "^NDX" || symbol === "^GSPC") {
      return coreFixture(symbol);
    }
    return null;
  };

  const context = await load(fetcher);

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
