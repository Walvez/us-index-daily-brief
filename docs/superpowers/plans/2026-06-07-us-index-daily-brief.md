# US Index Daily Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cloud-run Chinese daily email that reviews the latest Nasdaq-100 and S&P 500 session, explains relevant news, and gives a conservative rule-based periodic-investment observation.

**Architecture:** Reuse DailyBrief's Yahoo Finance, RSS, and pluggable LLM infrastructure, but place the index brief in a separate `lib/index-brief` boundary. Market calculations and the recommendation level are deterministic and unit-tested; the LLM may explain the result but cannot change it. GitHub Actions runs after the US close, publishes a mobile report to GitHub Pages, emails it through Gmail SMTP, and skips weekends, holidays, and already-sent market dates.

**Tech Stack:** Node.js 20, TypeScript, `node:test`, `tsx`, Yahoo Finance chart API, RSS, existing OpenAI-compatible LLM layer, Nodemailer, GitHub Actions, GitHub Pages, Gmail SMTP.

---

## File Map

- Existing DailyBrief files copied to repository root: reusable RSS, Yahoo Finance, LLM, and static-site infrastructure.
- `lib/index-brief/types.ts`: stable data contracts shared by the index brief.
- `lib/index-brief/market.ts`: core/fallback ticker fetch and market-date validation.
- `lib/index-brief/metrics.ts`: returns, drawdowns, moving averages, and realized volatility.
- `lib/index-brief/advice.ts`: deterministic periodic-investment observation.
- `lib/index-brief/news.ts`: relevant recent-news selection and source attribution.
- `lib/index-brief/commentary.ts`: constrained LLM explanation with deterministic fallback.
- `lib/index-brief/render.ts`: mobile email and full-page HTML.
- `lib/index-brief/mail.ts`: Gmail SMTP delivery.
- `lib/index-brief/state.ts`: report/sent-marker state and duplicate prevention.
- `lib/index-brief/run.ts`: orchestration with dependency injection for tests.
- `scripts/index-brief.ts`: production CLI and GitHub output integration.
- `scripts/send-index-brief.ts`: sends an already-rendered report and records success.
- `tests/index-brief/*.test.ts`: focused unit and integration tests.
- `.github/workflows/index-brief.yml`: Beijing 08:00 cloud schedule, Pages publication, and email.
- `.agents/skills/us-index-daily-brief/SKILL.md`: Codex operational skill.

### Task 1: Import and Establish the Tested Baseline

**Files:**
- Create from upstream: `package.json`, `package-lock.json`, `tsconfig.json`, `lib/`, `scripts/`, `sources.config.json`, `LICENSE`
- Modify: `package.json`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Import the upstream source without its Git history**

```bash
git clone --depth 1 https://github.com/leiting-eric/DailyBrief.git /tmp/DailyBrief
rsync -a --exclude .git --exclude .github /tmp/DailyBrief/ ./
```

Expected: reusable DailyBrief code is present at repository root; existing `docs/` and `work_thesis_format/` are untouched.

- [ ] **Step 2: Add the test command and email dependency**

Update `package.json` scripts and dependencies:

```json
{
  "scripts": {
    "test": "tsx --test tests/**/*.test.ts",
    "typecheck": "tsc --noEmit",
    "index-brief": "tsx scripts/index-brief.ts",
    "send-index-brief": "tsx scripts/send-index-brief.ts"
  },
  "dependencies": {
    "nodemailer": "^7.0.0"
  },
  "devDependencies": {
    "@types/nodemailer": "^7.0.0"
  }
}
```

Run `npm install` to update `package-lock.json`.

- [ ] **Step 3: Write a smoke test**

```ts
// tests/smoke.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { sma } from "../lib/trading/indicators";

test("upstream indicator utilities are importable", () => {
  assert.deepEqual(sma([1, 2, 3], 2), [1.5, 2.5]);
});
```

- [ ] **Step 4: Verify the baseline**

Run:

```bash
npm test
npm run typecheck
```

Expected: smoke test passes and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json lib scripts sources.config.json LICENSE tests/smoke.test.ts
git commit -m "chore: import DailyBrief foundation"
```

### Task 2: Define Market Snapshot and Metric Calculations

**Files:**
- Create: `lib/index-brief/types.ts`
- Create: `lib/index-brief/metrics.ts`
- Test: `tests/index-brief/metrics.test.ts`

- [ ] **Step 1: Write failing metric tests**

```ts
// tests/index-brief/metrics.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { calculateMetrics } from "../../lib/index-brief/metrics";

const closes = Array.from({ length: 220 }, (_, i) => 100 + i);

test("calculates returns, drawdown, averages, and annualized volatility", () => {
  const result = calculateMetrics(closes);
  assert.equal(result.pct1Day, ((319 - 318) / 318) * 100);
  assert.equal(result.drawdown20, 0);
  assert.equal(result.sma20, 309.5);
  assert.ok(result.realizedVol20 > 0);
});

test("rejects insufficient history", () => {
  assert.throws(() => calculateMetrics([100, 101]), /at least 20/);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- tests/index-brief/metrics.test.ts`

Expected: FAIL because `lib/index-brief/metrics.ts` does not exist.

- [ ] **Step 3: Define shared types**

```ts
// lib/index-brief/types.ts
export type IndexId = "nasdaq100" | "sp500";
export type AdviceLevel = "normal" | "slightly-more" | "notably-more";

export interface MarketMetrics {
  close: number;
  pct1Day: number;
  pct5Day: number;
  pct20Day: number;
  drawdown20: number;
  drawdown60: number;
  drawdownAll: number;
  sma20: number;
  sma50: number | null;
  sma200: number | null;
  realizedVol20: number;
}

export interface IndexSnapshot {
  id: IndexId;
  name: string;
  symbol: string;
  marketDate: string;
  metrics: MarketMetrics;
}

export interface MarketContext {
  marketDate: string;
  indices: IndexSnapshot[];
  vix?: number;
  treasury10y?: number;
  dxy?: number;
}

export interface AdviceResult {
  level: AdviceLevel;
  label: string;
  reasons: string[];
  highVolatility: boolean;
}
```

- [ ] **Step 4: Implement auditable metrics**

```ts
// lib/index-brief/metrics.ts
import { sma } from "../trading/indicators";
import type { MarketMetrics } from "./types";

const pct = (now: number, before: number) => ((now - before) / before) * 100;
const drawdown = (values: number[]) => pct(values.at(-1)!, Math.max(...values));

export function calculateMetrics(closes: number[]): MarketMetrics {
  if (closes.length < 20) throw new Error("at least 20 closes are required");
  const close = closes.at(-1)!;
  const returns = closes.slice(-21).slice(1).map((value, index) =>
    Math.log(value / closes.slice(-21)[index]),
  );
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, returns.length - 1);
  return {
    close,
    pct1Day: pct(close, closes.at(-2)!),
    pct5Day: pct(close, closes.at(-6) ?? closes[0]),
    pct20Day: pct(close, closes.at(-21) ?? closes[0]),
    drawdown20: drawdown(closes.slice(-20)),
    drawdown60: drawdown(closes.slice(-60)),
    drawdownAll: drawdown(closes),
    sma20: sma(closes, 20).at(-1)!,
    sma50: sma(closes, 50).at(-1) ?? null,
    sma200: sma(closes, 200).at(-1) ?? null,
    realizedVol20: Math.sqrt(variance * 252) * 100,
  };
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/index-brief/metrics.test.ts && npm run typecheck`

Expected: PASS.

```bash
git add lib/index-brief/types.ts lib/index-brief/metrics.ts tests/index-brief/metrics.test.ts
git commit -m "feat: calculate index brief market metrics"
```

### Task 3: Fetch and Validate the Latest US Session

**Files:**
- Create: `lib/index-brief/market.ts`
- Test: `tests/index-brief/market.test.ts`

- [ ] **Step 1: Write failing tests for primary/fallback symbols and date consistency**

```ts
// tests/index-brief/market.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { loadMarketContext } from "../../lib/index-brief/market";
import type { TickerRawData } from "../../lib/trading/yahoo";

function fixture(symbol: string, marketDate: string): TickerRawData {
  const end = new Date(`${marketDate}T20:00:00-04:00`);
  const candles = Array.from({ length: 220 }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - (219 - index));
    const close = 100 + index;
    return {
      date,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000,
    };
  });
  return {
    symbol,
    currency: "USD",
    exchangeName: "TEST",
    regularMarketPrice: candles.at(-1)!.close,
    fiftyTwoWeekHigh: candles.at(-1)!.close,
    fiftyTwoWeekLow: candles[0].close,
    candles,
  };
}

test("uses ETF fallback when the primary index is unavailable", async () => {
  const fetcher = async (symbol: string) =>
    symbol === "^NDX" ? null : fixture(symbol, "2026-06-05");
  const context = await loadMarketContext(fetcher);
  assert.equal(context.indices[0].symbol, "QQQ");
});

test("rejects mismatched core market dates", async () => {
  const fetcher = async (symbol: string) =>
    fixture(symbol, symbol.includes("GSPC") ? "2026-06-04" : "2026-06-05");
  await assert.rejects(() => loadMarketContext(fetcher), /market dates differ/);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- tests/index-brief/market.test.ts`

Expected: FAIL because `loadMarketContext` is undefined.

- [ ] **Step 3: Implement core/fallback market loading**

```ts
// lib/index-brief/market.ts
import { fetchTickerData, type TickerRawData } from "../trading/yahoo";
import { calculateMetrics } from "./metrics";
import type { IndexSnapshot, MarketContext } from "./types";

type Fetcher = (symbol: string) => Promise<TickerRawData | null>;

const CORE = [
  { id: "nasdaq100" as const, name: "纳斯达克100", symbols: ["^NDX", "QQQ"] },
  { id: "sp500" as const, name: "标普500", symbols: ["^GSPC", "SPY"] },
];

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
    if (!raw) throw new Error(`missing core market data: ${definition.name}`);
    indices.push({
      id: definition.id,
      name: definition.name,
      symbol,
      marketDate: dateKey(raw.candles.at(-1)!.date),
      metrics: calculateMetrics(raw.candles.map((c) => c.close)),
    });
  }
  if (new Set(indices.map((item) => item.marketDate)).size !== 1) {
    throw new Error("core market dates differ");
  }
  return { marketDate: indices[0].marketDate, indices };
}
```

Add this helper and merge its result into the returned context so macro failures do not invalidate core index data:

```ts
async function latestValue(
  symbol: string,
  fetcher: Fetcher,
): Promise<number | undefined> {
  try {
    const raw = await fetcher(symbol);
    return raw?.candles.at(-1)?.close;
  } catch {
    return undefined;
  }
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
```

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/index-brief/market.test.ts && npm run typecheck`

Expected: primary/fallback and date-consistency tests pass.

```bash
git add lib/index-brief/market.ts tests/index-brief/market.test.ts
git commit -m "feat: load validated US index session"
```

### Task 4: Implement Conservative Periodic-Investment Rules

**Files:**
- Create: `lib/index-brief/advice.ts`
- Test: `tests/index-brief/advice.test.ts`

- [ ] **Step 1: Write table-driven failing tests**

```ts
// tests/index-brief/advice.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { classifyAdvice } from "../../lib/index-brief/advice";

const base = {
  close: 100,
  pct1Day: 0.4,
  pct5Day: 1,
  pct20Day: 2,
  drawdown20: -1,
  drawdown60: -2,
  drawdownAll: -4,
  sma20: 99,
  sma50: 97,
  sma200: 90,
  realizedVol20: 15,
};

test("keeps normal contributions for an ordinary session", () => {
  assert.equal(classifyAdvice([{ ...base }, { ...base }]).level, "normal");
});

test("suggests a slight increase after a moderate decline", () => {
  const result = classifyAdvice([
    { ...base, pct1Day: -1.2, drawdown60: -5 },
    { ...base, pct1Day: -0.9, drawdown60: -4 },
  ]);
  assert.equal(result.level, "slightly-more");
});

test("reserves notable wording for a deeper drawdown", () => {
  const result = classifyAdvice([
    { ...base, pct1Day: -2.6, drawdown60: -10 },
    { ...base, pct1Day: -2.1, drawdown60: -9 },
  ]);
  assert.equal(result.level, "notably-more");
});

test("adds a volatility warning without changing the base level", () => {
  const result = classifyAdvice([
    { ...base, realizedVol20: 40 },
    { ...base, realizedVol20: 35 },
  ]);
  assert.equal(result.level, "normal");
  assert.equal(result.highVolatility, true);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- tests/index-brief/advice.test.ts`

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Implement explicit thresholds**

```ts
// lib/index-brief/advice.ts
import type { AdviceResult, MarketMetrics } from "./types";

export function classifyAdvice(metrics: MarketMetrics[]): AdviceResult {
  const worstDay = Math.min(...metrics.map((item) => item.pct1Day));
  const worstDrawdown = Math.min(...metrics.map((item) => item.drawdown60));
  const highVolatility = Math.max(...metrics.map((item) => item.realizedVol20)) >= 30;

  let level: AdviceResult["level"] = "normal";
  if (worstDay <= -2 || worstDrawdown <= -8) level = "notably-more";
  else if (worstDay <= -0.8 || worstDrawdown <= -4) level = "slightly-more";

  const labels = {
    normal: "正常定投",
    "slightly-more": "正常定投，可按习惯略微增加",
    "notably-more": "出现较明显回撤，可按原计划增加",
  };
  return {
    level,
    label: labels[level],
    reasons: [
      `两大指数中较弱单日表现为 ${worstDay.toFixed(2)}%`,
      `较深的60日高点回撤为 ${worstDrawdown.toFixed(2)}%`,
    ],
    highVolatility,
  };
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/index-brief/advice.test.ts && npm run typecheck`

Expected: all rule scenarios pass.

```bash
git add lib/index-brief/advice.ts tests/index-brief/advice.test.ts
git commit -m "feat: add deterministic periodic investment guidance"
```

### Task 5: Select News and Generate Constrained Commentary

**Files:**
- Create: `lib/index-brief/news.ts`
- Create: `lib/index-brief/commentary.ts`
- Test: `tests/index-brief/news.test.ts`
- Test: `tests/index-brief/commentary.test.ts`

- [ ] **Step 1: Write failing news-selection tests**

```ts
test("keeps recent market-moving stories and removes duplicates", () => {
  const selected = selectRelevantNews(articles, new Date("2026-06-06T12:00:00Z"));
  assert.deepEqual(selected.map((item) => item.url), [
    "https://example.com/fed-rate",
    "https://example.com/nvidia",
  ]);
});

test("never invents a source URL", async () => {
  const result = await writeCommentary(input, fakeLlm);
  assert.ok(result.drivers.every((driver) =>
    input.news.some((article) => article.url === driver.url),
  ));
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- tests/index-brief/news.test.ts tests/index-brief/commentary.test.ts`

Expected: FAIL because selection and commentary modules do not exist.

- [ ] **Step 3: Implement deterministic news selection**

`selectRelevantNews()` must:

```ts
const KEYWORDS = [
  "federal reserve", "fed", "interest rate", "inflation", "jobs",
  "treasury", "tariff", "trade", "nasdaq", "s&p 500",
  "nvidia", "apple", "microsoft", "amazon", "alphabet", "meta", "tesla",
];
```

Filter to the prior 30 hours, match keyword against title/excerpt, deduplicate normalized URLs and titles, sort newest first, and cap at 12. Fetch only enabled finance sources plus explicitly configured Federal Reserve and major-technology feeds.

- [ ] **Step 4: Implement schema-constrained commentary**

Define:

```ts
export interface BriefCommentary {
  headline: string;
  summary: string;
  drivers: Array<{
    title: string;
    explanation: string;
    url: string;
    relationship: "direct" | "possibly-related";
  }>;
}
```

The prompt must include the deterministic `AdviceResult`, prohibit changing its label, require every URL to come from input, and distinguish facts from inferred market relationships. Validate parsed output; discard drivers whose URLs are not in the input. On LLM failure, return a deterministic Chinese summary built from market metrics and top news titles.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/index-brief/news.test.ts tests/index-brief/commentary.test.ts
npm run typecheck
```

Expected: relevance, URL allow-list, label preservation, and fallback tests pass.

```bash
git add lib/index-brief/news.ts lib/index-brief/commentary.ts tests/index-brief/news.test.ts tests/index-brief/commentary.test.ts
git commit -m "feat: explain index moves with sourced news"
```

### Task 6: Render Mobile Email and Send Through Gmail

**Files:**
- Create: `lib/index-brief/render.ts`
- Create: `lib/index-brief/mail.ts`
- Test: `tests/index-brief/render.test.ts`
- Test: `tests/index-brief/mail.test.ts`

- [ ] **Step 1: Write failing rendering and mail tests**

```ts
test("renders a single-column mobile email with source links", () => {
  const html = renderEmailHtml(report);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /max-width:\s*680px/);
  assert.match(html, /正常定投/);
  assert.doesNotMatch(html, /position:\s*fixed/);
});

test("refuses to send without SMTP configuration", async () => {
  await assert.rejects(
    () => sendBrief({ html: "<p>x</p>", subject: "x" }, {}, fakeTransport),
    /GMAIL_USER.*GMAIL_APP_PASSWORD.*REPORT_RECIPIENT/,
  );
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- tests/index-brief/render.test.ts tests/index-brief/mail.test.ts`

Expected: FAIL because rendering and mail modules do not exist.

- [ ] **Step 3: Implement email-safe rendering**

Render a `680px` maximum-width single column using table-based layout and inline styles. Include:

- market date and one-sentence conclusion;
- Nasdaq-100 and S&P 500 rows;
- advice label, reasons, and volatility warning;
- three to five sourced news drivers;
- T+2, FX, quota, NAV timing, and non-advice caveats;
- optional `REPORT_BASE_URL/<marketDate>/<marketDate>.html` link.

Escape all external text before insertion.

- [ ] **Step 4: Implement Gmail SMTP delivery**

```ts
const transport = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
});

await transport.sendMail({
  from: `美股指数日报 <${env.GMAIL_USER}>`,
  to: env.REPORT_RECIPIENT,
  subject,
  html,
});
```

Log only the message ID and recipient count. Never log credentials or the full environment.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/index-brief/render.test.ts tests/index-brief/mail.test.ts
npm run typecheck
```

Expected: rendering and mail validation tests pass.

```bash
git add lib/index-brief/render.ts lib/index-brief/mail.ts tests/index-brief/render.test.ts tests/index-brief/mail.test.ts
git commit -m "feat: render and email mobile index brief"
```

### Task 7: Orchestrate Reports and Prevent Duplicate Sends

**Files:**
- Create: `lib/index-brief/state.ts`
- Create: `lib/index-brief/run.ts`
- Create: `scripts/index-brief.ts`
- Create: `scripts/send-index-brief.ts`
- Test: `tests/index-brief/run.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing state-machine tests**

```ts
test("skips a market date that already has a sent marker", async () => {
  const result = await runIndexBrief(depsWithState("sent"));
  assert.equal(result.status, "skip");
});

test("reuses a generated report when email previously failed", async () => {
  const result = await runIndexBrief(depsWithState("report-only"));
  assert.equal(result.status, "email-only");
});

test("does not create a normal report when core data is missing", async () => {
  await assert.rejects(() => runIndexBrief(depsWithMissingCore()), /core market/);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- tests/index-brief/run.test.ts`

Expected: FAIL because the orchestration modules do not exist.

- [ ] **Step 3: Implement report state**

Use:

```text
daily_reports/<marketDate>/<marketDate>.json
daily_reports/<marketDate>/<marketDate>.html
daily_reports/<marketDate>/<marketDate>-email.html
daily_reports/<marketDate>/.emailed
```

`inspectState(marketDate)` returns `missing`, `report-only`, or `sent`. The generator writes report files atomically through a temporary file and rename. `send-index-brief.ts` creates `.emailed` only after SMTP success.

- [ ] **Step 4: Implement orchestration**

`runIndexBrief()` performs:

1. Load validated market context.
2. Inspect the latest market date.
3. Return `skip` for `sent`.
4. Return `email-only` for `report-only`.
5. Fetch and select news.
6. Classify advice deterministically.
7. Generate constrained commentary or fallback.
8. Render JSON, full HTML, and email HTML.
9. Return `generated`.

The CLI appends these outputs to `GITHUB_OUTPUT` when present:

```text
status=generated|email-only|skip
market-date=YYYY-MM-DD
report-dir=daily_reports/YYYY-MM-DD
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/index-brief/run.test.ts
npm test
npm run typecheck
```

Expected: duplicate, retry, missing-data, and full test suites pass.

```bash
git add lib/index-brief/state.ts lib/index-brief/run.ts scripts/index-brief.ts scripts/send-index-brief.ts package.json tests/index-brief/run.test.ts
git commit -m "feat: orchestrate idempotent index briefs"
```

### Task 8: Add GitHub Actions, Pages, and Configuration

**Files:**
- Create: `.github/workflows/index-brief.yml`
- Modify: `.env.example`
- Modify: `scripts/build-site.mjs`
- Create: `docs/index-brief-setup.md`

- [ ] **Step 1: Create the Beijing schedule**

Use a single off-peak schedule plus manual dispatch:

```yaml
on:
  schedule:
    - cron: "5 0 * * *" # 08:05 Asia/Shanghai
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: us-index-daily-brief
  cancel-in-progress: false
```

- [ ] **Step 2: Add restore, generate, publish, email, and marker flow**

The workflow must:

1. Restore `gh-pages` into `daily_reports/`.
2. Run `npm ci`.
3. Run `npm run index-brief` with LLM secrets and report variables.
4. Exit cleanly when output status is `skip`.
5. Build and publish Pages when status is `generated`.
6. Send email for `generated` or `email-only`.
7. Create `.emailed` only after successful email.
8. Rebuild and republish Pages so the marker persists.

Required configuration:

```yaml
env:
  REPORT_TZ: Asia/Shanghai
  REPORT_RECIPIENT: ${{ vars.REPORT_RECIPIENT }}
  REPORT_BASE_URL: ${{ vars.REPORT_BASE_URL }}
  GMAIL_USER: ${{ vars.GMAIL_USER }}
  GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
```

LLM provider keys remain GitHub Secrets. No email address or credential is committed.

- [ ] **Step 3: Document exact GitHub settings**

`docs/index-brief-setup.md` must instruct:

- enable Gmail two-step verification;
- create a Gmail application password;
- add `GMAIL_APP_PASSWORD` as a repository Secret;
- add `GMAIL_USER`, `REPORT_RECIPIENT`, `REPORT_BASE_URL`, `REPORT_TZ=Asia/Shanghai`, and LLM selector values as repository Variables;
- enable GitHub Pages from `gh-pages`;
- manually run once and inspect the sample email.

- [ ] **Step 4: Validate workflow and configuration**

Run:

```bash
npm test
npm run typecheck
git diff --check
```

Expected: all checks pass; `rg "1456176105|APP_PASSWORD=" .` finds no committed private address or password value.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/index-brief.yml .env.example scripts/build-site.mjs docs/index-brief-setup.md
git commit -m "ci: schedule and deliver index brief"
```

### Task 9: Create the Codex Operational Skill

**Files:**
- Create: `.agents/skills/us-index-daily-brief/SKILL.md`
- Create: `.agents/skills/us-index-daily-brief/agents/openai.yaml`
- Test: skill validation command

- [ ] **Step 1: Write the skill**

Use this frontmatter:

```yaml
---
name: us-index-daily-brief
description: Use when operating, diagnosing, changing, or manually running the personal Nasdaq-100 and S&P 500 daily market email workflow.
---
```

The body must cover:

- working-directory check;
- `npm run index-brief`, `npm run send-index-brief`, `npm test`, and `npm run typecheck`;
- where market rules, news selection, rendering, mail, and state live;
- diagnosis order: Actions log, core market date, report state, LLM fallback, SMTP;
- safety rules: never log secrets, never let LLM change advice level, never claim a specific fund execution price;
- setup reference to `docs/index-brief-setup.md`.

- [ ] **Step 2: Generate UI metadata**

Run:

```bash
python /Users/walve/.codex/skills/.system/skill-creator/scripts/generate_openai_yaml.py \
  .agents/skills/us-index-daily-brief \
  --interface display_name="美股指数每日简报" \
  --interface short_description="运行和维护纳指100、标普500每日复盘邮件" \
  --interface default_prompt="检查并运行美股指数每日简报，报告行情日期、生成状态和投递状态。"
```

- [ ] **Step 3: Validate the skill**

Run:

```bash
python /Users/walve/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/us-index-daily-brief
```

Expected: validation succeeds with no frontmatter or metadata errors.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm test
npm run typecheck
npm run index-brief
git diff --check
git status --short
```

Expected: tests and typecheck pass; the manual run either creates one report for the latest US session or reports an explicit network/credential limitation without exposing secrets.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/us-index-daily-brief
git commit -m "feat: add US index brief Codex skill"
```

## Deployment Acceptance

After code completion:

1. Push the feature branch to the user's GitHub repository.
2. Configure repository Variables without committing the recipient address.
3. Ask the user to enter `GMAIL_APP_PASSWORD` directly in GitHub Secrets; it should not be pasted into chat.
4. Configure one LLM provider key in GitHub Secrets.
5. Run `workflow_dispatch`.
6. Confirm the Actions run, Pages URL, mobile email layout, market date, source links, and advice label.
7. Confirm a second manual run does not send a duplicate email for the same market date.
