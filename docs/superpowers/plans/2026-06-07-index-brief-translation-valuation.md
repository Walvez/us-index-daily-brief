# Index Brief Translation and Valuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each private daily email self-contained, translate selected market news into Chinese through GitHub Models, and add official forward-PE valuation context without presenting unsupported PE percentiles.

**Architecture:** Add two optional adapters beside the existing deterministic market path: a GitHub Models commentary driver and a Nasdaq valuation loader. Both return validated domain objects or explicit degraded states, while the existing market metrics and contribution advice remain authoritative. The renderer consumes one complete report object and never emits a public-report URL.

**Tech Stack:** Node.js 20, TypeScript, `node:test`, `tsx`, native `fetch`, GitHub Models REST API, `pdfjs-dist`, GitHub Actions, Gmail SMTP.

---

## File Map

- Create `lib/index-brief/github-models.ts`: authenticated GitHub Models request with timeout and response validation.
- Create `lib/index-brief/valuation.ts`: PDF text extraction, Nasdaq dashboard parsing, freshness validation, and deterministic valuation temperature.
- Create `lib/index-brief/valuation-history.ts`: atomic, date-deduplicated valuation snapshot persistence.
- Create `tests/index-brief/github-models.test.ts`: API request, response, timeout, and failure tests.
- Create `tests/index-brief/valuation.test.ts`: parsing, validation, freshness, and classification tests.
- Create `tests/index-brief/valuation-history.test.ts`: history deduplication and atomic-write tests.
- Modify `lib/index-brief/commentary.ts`: use the injected GitHub Models driver and expose whether Chinese generation succeeded.
- Modify `lib/index-brief/render.ts`: render valuation context and remove all public-report-link behavior.
- Modify `lib/index-brief/run.ts`: load optional valuation data and persist valid fresh snapshots.
- Modify `lib/index-brief/state.ts`: write email/full HTML without a report URL.
- Modify `lib/index-brief/types.ts`: define valuation domain contracts.
- Modify `scripts/index-brief.ts`: remove `REPORT_BASE_URL` input.
- Modify `.github/workflows/index-brief.yml`: grant `models: read`, pass `GITHUB_TOKEN`, and stop building/publishing a Pages site before email.
- Modify `tests/index-brief/commentary.test.ts`, `fixtures.ts`, `render.test.ts`, and `run.test.ts`: cover the new report contract and degraded states.
- Modify `package.json` and `package-lock.json`: add PDF.js for pure-JavaScript PDF text extraction.
- Modify `docs/index-brief-setup.md` and `.agents/skills/us-index-daily-brief/SKILL.md`: document the private-email workflow and diagnostics.

### Task 1: Define and Test Valuation Semantics

**Files:**
- Modify: `lib/index-brief/types.ts`
- Create: `lib/index-brief/valuation.ts`
- Create: `tests/index-brief/valuation.test.ts`

- [ ] **Step 1: Write failing tests for parsing, classification, and freshness**

```ts
// tests/index-brief/valuation.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyValuation,
  parseNasdaqValuationText,
  validateValuationFreshness,
} from "../../lib/index-brief/valuation";

const dashboardText = `
Nasdaq Global Index Investment Insights
Global Equities Last MTD % Change QTD % Change YTD % Change LTM % Change
Yield NTM P/E NTM P/E 10yr Avg. Last vs. 10yr Avg.
Nasdaq - 100 ® 28,015 2.1% 18.0% 11.0% 40.3% 0.6% 23.40 22.90 +2.2%
S&P 500 7,259 0.7% 11.2% 6.0% 28.5% 1.1% 20.73 19.09 +8.6%
Russell 2000 2,845 1.6% 14.6% 1.2% 24.80 23.21 +6.9%
Data as of 5/5/2026.
`;

test("parses both official forward-PE rows and recomputes premiums", () => {
  const snapshot = parseNasdaqValuationText(
    dashboardText,
    "https://www.nasdaq.com/docs/index/global-index-investment-insights",
  );
  assert.equal(snapshot.asOf, "2026-05-05");
  assert.deepEqual(
    snapshot.indices.map(({ id, forwardPe, tenYearAveragePe }) => ({
      id,
      forwardPe,
      tenYearAveragePe,
    })),
    [
      { id: "nasdaq100", forwardPe: 23.4, tenYearAveragePe: 22.9 },
      { id: "sp500", forwardPe: 20.73, tenYearAveragePe: 19.09 },
    ],
  );
  assert.ok(Math.abs(snapshot.indices[0].premiumPct - 2.1834) < 0.001);
});

test("uses fixed valuation-temperature boundaries", () => {
  assert.equal(classifyValuation(-10), "低于长期均值");
  assert.equal(classifyValuation(-9.99), "接近长期均值");
  assert.equal(classifyValuation(10), "接近长期均值");
  assert.equal(classifyValuation(10.01), "高于长期均值");
  assert.equal(classifyValuation(25), "高于长期均值");
  assert.equal(classifyValuation(25.01), "明显高于长期均值");
});

test("rejects incomplete or implausible valuation rows", () => {
  assert.throws(
    () => parseNasdaqValuationText("Data as of 5/5/2026. Nasdaq-100 2 1", "x"),
    /missing valuation row/,
  );
  assert.throws(
    () =>
      parseNasdaqValuationText(
        dashboardText.replace("23.40 22.90", "230.40 22.90"),
        "x",
      ),
    /plausible range/,
  );
});

test("hides data older than 45 calendar days", () => {
  const snapshot = parseNasdaqValuationText(dashboardText, "x");
  assert.equal(
    validateValuationFreshness(snapshot, new Date("2026-06-19T00:00:00Z")).status,
    "available",
  );
  assert.equal(
    validateValuationFreshness(snapshot, new Date("2026-06-20T00:00:00Z")).status,
    "unavailable",
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test tests/index-brief/valuation.test.ts`

Expected: FAIL because `lib/index-brief/valuation.ts` and valuation types do not exist.

- [ ] **Step 3: Add valuation contracts**

Append to `lib/index-brief/types.ts`:

```ts
export type ValuationTemperature =
  | "低于长期均值"
  | "接近长期均值"
  | "高于长期均值"
  | "明显高于长期均值";

export interface IndexValuation {
  id: IndexId;
  forwardPe: number;
  tenYearAveragePe: number;
  premiumPct: number;
  temperature: ValuationTemperature;
}

export interface ValuationSnapshot {
  asOf: string;
  sourceUrl: string;
  indices: IndexValuation[];
}

export type ValuationContext =
  | { status: "available"; snapshot: ValuationSnapshot }
  | {
      status: "unavailable";
      reason: "fetch-failed" | "invalid-data" | "stale";
      message: string;
    };
```

- [ ] **Step 4: Implement the pure valuation parser and rules**

Create `lib/index-brief/valuation.ts` with these exported pure functions before adding network access:

```ts
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
  if (values.length < 9) throw new Error(`missing valuation row values: ${id}`);

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

  const premiumPct = ((forwardPe / tenYearAveragePe) - 1) * 100;
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

export function classifyValuation(premiumPct: number): ValuationTemperature {
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
  const ageDays =
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      Date.parse(`${snapshot.asOf}T00:00:00Z`)) /
    DAY_MS;
  if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 45) {
    return {
      status: "unavailable",
      reason: "stale",
      message: "官方估值数据暂未更新",
    };
  }
  return { status: "available", snapshot };
}
```

- [ ] **Step 5: Run the focused tests and commit**

Run: `npx tsx --test tests/index-brief/valuation.test.ts && npm run typecheck`

Expected: valuation tests PASS and TypeScript reports no errors.

```bash
git add lib/index-brief/types.ts lib/index-brief/valuation.ts tests/index-brief/valuation.test.ts
git commit -m "feat: define index valuation semantics"
```

### Task 2: Load the Official PDF and Persist Unique Snapshots

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `lib/index-brief/valuation.ts`
- Create: `lib/index-brief/valuation-history.ts`
- Modify: `tests/index-brief/valuation.test.ts`
- Create: `tests/index-brief/valuation-history.test.ts`

- [ ] **Step 1: Install PDF.js**

Run: `npm install pdfjs-dist@5.4.149`

Expected: `package.json` and `package-lock.json` include `pdfjs-dist`.

- [ ] **Step 2: Write failing loader and history tests**

Add to `tests/index-brief/valuation.test.ts`:

```ts
import { loadValuationContext } from "../../lib/index-brief/valuation";

test("loads and validates a Nasdaq PDF through injected adapters", async () => {
  const result = await loadValuationContext({
    now: new Date("2026-06-07T00:00:00Z"),
    fetchPdf: async () => new Uint8Array([1, 2, 3]),
    extractText: async () => dashboardText,
  });
  assert.equal(result.status, "available");
  if (result.status === "available") assert.equal(result.snapshot.asOf, "2026-05-05");
});

test("degrades instead of throwing when the official document is unavailable", async () => {
  const result = await loadValuationContext({
    fetchPdf: async () => {
      throw new Error("503");
    },
  });
  assert.deepEqual(result, {
    status: "unavailable",
    reason: "fetch-failed",
    message: "官方估值数据暂不可用",
  });
});
```

Create `tests/index-brief/valuation-history.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendValuationSnapshot,
  readValuationHistory,
} from "../../lib/index-brief/valuation-history";
import { parseNasdaqValuationText } from "../../lib/index-brief/valuation";

const text = `Nasdaq-100 28,015 2.1% 18.0% 11.0% 40.3% 0.6% 23.40 22.90 +2.2%
S&P 500 7,259 0.7% 11.2% 6.0% 28.5% 1.1% 20.73 19.09 +8.6%
Russell 2000 2,845 1.6% 14.6% 1.2% 24.80 23.21 +6.9%
Data as of 5/5/2026.`;

test("stores one snapshot per official data date", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "valuation-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = parseNasdaqValuationText(text, "official");
  appendValuationSnapshot(root, snapshot);
  appendValuationSnapshot(root, snapshot);
  assert.equal(readValuationHistory(root).length, 1);
  assert.equal(
    fs.readdirSync(root).some((name) => name.endsWith(".tmp")),
    false,
  );
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npx tsx --test tests/index-brief/valuation.test.ts tests/index-brief/valuation-history.test.ts
```

Expected: FAIL because the loader and history module are missing.

- [ ] **Step 4: Add PDF download and extraction**

Append to `lib/index-brief/valuation.ts`:

```ts
const NASDAQ_VALUATION_URL =
  "https://www.nasdaq.com/docs/index/global-index-investment-insights";

export interface ValuationLoadOptions {
  now?: Date;
  sourceUrl?: string;
  timeoutMs?: number;
  fetchPdf?: (url: string, signal: AbortSignal) => Promise<Uint8Array>;
  extractText?: (bytes: Uint8Array) => Promise<string>;
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
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      );
    }
  } finally {
    await document.destroy();
  }
  return pages.join("\n");
}

export async function loadValuationContext(
  options: ValuationLoadOptions = {},
): Promise<ValuationContext> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15_000,
  );
  try {
    const sourceUrl = options.sourceUrl ?? NASDAQ_VALUATION_URL;
    const bytes = await (options.fetchPdf ?? defaultFetchPdf)(
      sourceUrl,
      controller.signal,
    );
    const text = await (options.extractText ?? defaultExtractText)(bytes);
    const snapshot = parseNasdaqValuationText(text, sourceUrl);
    return validateValuationFreshness(snapshot, options.now ?? new Date());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
```

- [ ] **Step 5: Implement atomic date-deduplicated history**

Create `lib/index-brief/valuation-history.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import type { ValuationSnapshot } from "./types";

const FILE_NAME = "valuation-history.json";

function historyPath(root: string): string {
  return path.join(root, FILE_NAME);
}

export function readValuationHistory(root: string): ValuationSnapshot[] {
  const file = historyPath(root);
  if (!fs.existsSync(file)) return [];
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(value)) throw new Error("invalid valuation history");
  return value as ValuationSnapshot[];
}

export function appendValuationSnapshot(
  root: string,
  snapshot: ValuationSnapshot,
): void {
  fs.mkdirSync(root, { recursive: true });
  const history = readValuationHistory(root);
  const next = [
    ...history.filter((item) => item.asOf !== snapshot.asOf),
    snapshot,
  ].sort((a, b) => a.asOf.localeCompare(b.asOf));
  const file = historyPath(root);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npx tsx --test tests/index-brief/valuation.test.ts tests/index-brief/valuation-history.test.ts
npm run typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

```bash
git add package.json package-lock.json lib/index-brief/valuation.ts lib/index-brief/valuation-history.ts tests/index-brief/valuation.test.ts tests/index-brief/valuation-history.test.ts
git commit -m "feat: load and retain official index valuations"
```

### Task 3: Add a GitHub Models Commentary Driver

**Files:**
- Create: `lib/index-brief/github-models.ts`
- Create: `tests/index-brief/github-models.test.ts`
- Modify: `lib/index-brief/commentary.ts`
- Modify: `tests/index-brief/commentary.test.ts`

- [ ] **Step 1: Write failing API-driver tests**

Create `tests/index-brief/github-models.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { runGithubModels } from "../../lib/index-brief/github-models";

test("calls GitHub Models with the workflow token", async () => {
  let authorization = "";
  const result = await runGithubModels(
    { systemPrompt: "中文", userPrompt: "翻译", timeoutMs: 1000 },
    {
      env: {
        GITHUB_TOKEN: "test-token",
        GITHUB_MODELS_MODEL: "openai/gpt-4o",
      },
      fetcher: async (_url, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );
  assert.equal(authorization, "Bearer test-token");
  assert.equal(result.text, "{\"ok\":true}");
});

test("rejects missing credentials and empty model output", async () => {
  await assert.rejects(
    () => runGithubModels({ systemPrompt: "x", userPrompt: "y" }, { env: {} }),
    /GITHUB_TOKEN/,
  );
  await assert.rejects(
    () =>
      runGithubModels(
        { systemPrompt: "x", userPrompt: "y" },
        {
          env: { GITHUB_TOKEN: "x" },
          fetcher: async () =>
            new Response(JSON.stringify({ choices: [] }), { status: 200 }),
        },
      ),
    /empty response/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test tests/index-brief/github-models.test.ts`

Expected: FAIL because `lib/index-brief/github-models.ts` does not exist.

- [ ] **Step 3: Implement the narrow GitHub Models adapter**

Create `lib/index-brief/github-models.ts`:

```ts
import type { LlmRunOptions, LlmRunResult } from "../ai/llm";

interface GithubModelsDependencies {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
}

export async function runGithubModels(
  options: LlmRunOptions,
  dependencies: GithubModelsDependencies = {},
): Promise<LlmRunResult> {
  const env = dependencies.env ?? process.env;
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_TOKEN is required for GitHub Models");
  const model = env.GITHUB_MODELS_MODEL?.trim() || "openai/gpt-4o";
  const controller = new AbortController();
  const started = Date.now();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 120_000,
  );
  try {
    const response = await (dependencies.fetcher ?? fetch)(
      "https://models.github.ai/inference/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-github-api-version": "2026-03-10",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 3000,
          messages: [
            { role: "system", content: options.systemPrompt },
            { role: "user", content: options.userPrompt },
          ],
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub Models HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("GitHub Models returned an empty response");
    return { text, durationMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Make commentary Chinese-first with an explicit degraded flag**

In `lib/index-brief/commentary.ts`:

```ts
import { runGithubModels } from "./github-models";

export interface BriefCommentary {
  headline: string;
  summary: string;
  adviceLabel: string;
  drivers: CommentaryDriver[];
  translationAvailable: boolean;
}
```

Set `translationAvailable: false` in `fallbackCommentary`. Change the default driver:

```ts
export async function writeCommentary(
  input: CommentaryInput,
  llm: CommentaryLlm = runGithubModels,
): Promise<BriefCommentary> {
```

Strengthen the system prompt and successful return:

```ts
systemPrompt:
  "你是克制的中文美股指数复盘编辑。headline、summary、每条 driver.title 和 driver.explanation 必须使用简体中文；公司名和指数缩写可以保留英文。只解释输入数据，不预测下一交易日。必须区分直接事实与可能相关因素。不得修改 advice.label，不得生成输入之外的链接。输出单一 JSON 对象。",
```

```ts
return {
  headline: parsed.headline,
  summary: parsed.summary,
  adviceLabel: input.advice.label,
  drivers,
  translationAvailable: true,
};
```

Update fallback driver explanations to start with `中文翻译暂不可用：` while retaining original titles and URLs.

- [ ] **Step 5: Update and run commentary tests**

In `tests/index-brief/commentary.test.ts`, assert:

```ts
assert.equal(result.translationAvailable, true);
```

For the failing-driver test, assert:

```ts
assert.equal(result.translationAvailable, false);
assert.match(result.drivers[0].explanation, /中文翻译暂不可用/);
```

Run:

```bash
npx tsx --test tests/index-brief/github-models.test.ts tests/index-brief/commentary.test.ts
npm run typecheck
```

Expected: focused tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/index-brief/github-models.ts lib/index-brief/commentary.ts tests/index-brief/github-models.test.ts tests/index-brief/commentary.test.ts
git commit -m "feat: translate index commentary with GitHub Models"
```

### Task 4: Integrate Valuation and Make the Email Self-Contained

**Files:**
- Modify: `lib/index-brief/render.ts`
- Modify: `lib/index-brief/run.ts`
- Modify: `lib/index-brief/state.ts`
- Modify: `scripts/index-brief.ts`
- Modify: `tests/index-brief/fixtures.ts`
- Modify: `tests/index-brief/render.test.ts`
- Modify: `tests/index-brief/run.test.ts`

- [ ] **Step 1: Write failing report/render/orchestration tests**

Update the fixture to include:

```ts
valuation: {
  status: "available",
  snapshot: {
    asOf: "2026-05-05",
    sourceUrl:
      "https://www.nasdaq.com/docs/index/global-index-investment-insights",
    indices: [
      {
        id: "nasdaq100",
        forwardPe: 23.4,
        tenYearAveragePe: 22.9,
        premiumPct: 2.18,
        temperature: "接近长期均值",
      },
      {
        id: "sp500",
        forwardPe: 20.73,
        tenYearAveragePe: 19.09,
        premiumPct: 8.59,
        temperature: "接近长期均值",
      },
    ],
  },
},
```

Replace the public-link assertion in `tests/index-brief/render.test.ts`:

```ts
const html = renderEmailHtml(reportFixture);
assert.match(html, /估值观察/);
assert.match(html, /预期 PE/);
assert.match(html, /2026-05-05/);
assert.doesNotMatch(html, /查看完整报告|github\.io|REPORT_BASE_URL/);
```

Add a degraded valuation test:

```ts
test("renders an unavailable valuation notice without stale numbers", () => {
  const html = renderEmailHtml({
    ...reportFixture,
    valuation: {
      status: "unavailable",
      reason: "stale",
      message: "官方估值数据暂未更新",
    },
  });
  assert.match(html, /官方估值数据暂未更新/);
  assert.doesNotMatch(html, /23\.40/);
});
```

In `tests/index-brief/run.test.ts`, inject `loadValuation` and verify a valid snapshot is written once to `valuation-history.json`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx tsx --test tests/index-brief/render.test.ts tests/index-brief/run.test.ts
```

Expected: FAIL because the report contract and renderer do not yet contain valuation data.

- [ ] **Step 3: Extend the report and orchestration contracts**

In `lib/index-brief/render.ts`:

```ts
import type {
  AdviceResult,
  MarketContext,
  ValuationContext,
} from "./types";

export interface IndexBriefReport {
  market: MarketContext;
  advice: AdviceResult;
  commentary: BriefCommentary;
  valuation: ValuationContext;
  generatedAt: string;
}
```

Delete `RenderOptions`, `reportUrl`, `fullLink`, and all related parameters. Both render functions call `reportBody(report)`.

In `lib/index-brief/run.ts`, add dependencies:

```ts
loadValuation?: () => Promise<ValuationContext>;
```

Load valuation without allowing adapter exceptions to escape:

```ts
const valuation = await (dependencies.loadValuation ??
  (() => loadValuationContext({ now })))().catch(() => ({
  status: "unavailable" as const,
  reason: "fetch-failed" as const,
  message: "官方估值数据暂不可用",
}));
if (valuation.status === "available") {
  appendValuationSnapshot(outputRoot, valuation.snapshot);
}
```

Include `valuation` in `IndexBriefReport`, remove `reportBaseUrl`, and call `writeReportFiles(outputRoot, report)`.

- [ ] **Step 4: Render the valuation section**

Add a renderer helper in `lib/index-brief/render.ts`:

```ts
function valuationSection(report: IndexBriefReport): string {
  if (report.valuation.status === "unavailable") {
    return `<tr><td style="padding:20px 24px;border-top:1px solid #e4e7ec;">
      <h2 style="margin:0 0 10px;font-size:18px;color:#101828;">估值观察</h2>
      <p style="margin:0;color:#667085;">${escapeHtml(report.valuation.message)}</p>
    </td></tr>`;
  }
  const names = { nasdaq100: "纳斯达克100", sp500: "标普500" };
  const rows = report.valuation.snapshot.indices.map((item) => `
    <tr>
      <td style="padding:10px 6px;border-bottom:1px solid #e4e7ec;">${names[item.id]}</td>
      <td style="padding:10px 6px;border-bottom:1px solid #e4e7ec;text-align:right;">${formatNumber(item.forwardPe)}</td>
      <td style="padding:10px 6px;border-bottom:1px solid #e4e7ec;text-align:right;">${formatNumber(item.tenYearAveragePe)}</td>
      <td style="padding:10px 6px;border-bottom:1px solid #e4e7ec;text-align:right;">${item.premiumPct >= 0 ? "+" : ""}${formatNumber(item.premiumPct, 1)}%</td>
      <td style="padding:10px 6px;border-bottom:1px solid #e4e7ec;">${item.temperature}</td>
    </tr>`).join("");
  return `<tr><td style="padding:20px 24px;border-top:1px solid #e4e7ec;">
    <h2 style="margin:0 0 10px;font-size:18px;color:#101828;">估值观察</h2>
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="color:#667085;background:#f9fafb;">
        <th style="padding:8px 6px;text-align:left;">指数</th>
        <th style="padding:8px 6px;text-align:right;">预期 PE</th>
        <th style="padding:8px 6px;text-align:right;">10年均值</th>
        <th style="padding:8px 6px;text-align:right;">偏离</th>
        <th style="padding:8px 6px;text-align:left;">温度</th>
      </tr></thead><tbody>${rows}</tbody>
    </table>
    <p style="margin:10px 0 0;color:#667085;font-size:12px;">数据日期 ${escapeHtml(report.valuation.snapshot.asOf)}；估值为定期发布数据，并非昨夜实时值。PE 历史样本积累中。</p>
  </td></tr>`;
}
```

Insert `${valuationSection(report)}` between the market table and news section.

- [ ] **Step 5: Remove report URL plumbing**

Change `writeReportFiles` in `lib/index-brief/state.ts` to accept only `(root, report)`, and render email via `renderEmailHtml(report)`.

Remove this property from `scripts/index-brief.ts`:

```ts
reportBaseUrl: process.env.REPORT_BASE_URL,
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npx tsx --test tests/index-brief/render.test.ts tests/index-brief/run.test.ts
npm run typecheck
```

Expected: focused tests PASS, generated email contains valuation data, and no report link remains.

```bash
git add lib/index-brief/render.ts lib/index-brief/run.ts lib/index-brief/state.ts scripts/index-brief.ts tests/index-brief/fixtures.ts tests/index-brief/render.test.ts tests/index-brief/run.test.ts
git commit -m "feat: add valuation context to self-contained email"
```

### Task 5: Update the Cloud Workflow and Operating Documentation

**Files:**
- Modify: `.github/workflows/index-brief.yml`
- Modify: `docs/index-brief-setup.md`
- Modify: `.agents/skills/us-index-daily-brief/SKILL.md`

- [ ] **Step 1: Write the final workflow shape**

Change permissions:

```yaml
permissions:
  contents: write
  models: read
```

Change the generation environment to:

```yaml
env:
  REPORT_TZ: Asia/Shanghai
  REPORT_LOCALE: zh
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  GITHUB_MODELS_MODEL: ${{ vars.GITHUB_MODELS_MODEL || 'openai/gpt-4o' }}
```

Remove `REPORT_BASE_URL`, `LLM_BACKEND`, all external model API keys, `LLM_BASE_URL`, and `LLM_MODEL` from this workflow.

Remove both pre-email site steps:

```yaml
- name: Build site before email
- name: Publish report before email
```

Keep the post-email `build-site` and `peaceiris/actions-gh-pages` steps only as private branch persistence for reports, `valuation-history.json`, and `.emailed`. Rename them:

```yaml
- name: Prepare private report archive
- name: Persist private report and delivery state
```

- [ ] **Step 2: Update setup and diagnosis documentation**

Document these exact points in `docs/index-brief-setup.md`:

```md
- No `REPORT_BASE_URL` is required. The email is the complete report.
- GitHub Models uses the workflow's built-in `GITHUB_TOKEN`; do not create an OpenAI key.
- Optional variable: `GITHUB_MODELS_MODEL` (default `openai/gpt-4o`).
- The private `gh-pages` branch is storage only and is not a public website.
- If translation fails, look for GitHub Models HTTP status and confirm `models: read`.
- If valuation is unavailable, verify the Nasdaq document URL and the displayed `as of` date; do not manually copy stale PE values into the report.
```

Update `.agents/skills/us-index-daily-brief/SKILL.md` so diagnosis checks GitHub Models and `valuation-history.json`, and removes any implication that Pages is user-visible.

- [ ] **Step 3: Validate workflow text and commit**

Run:

```bash
rg -n "REPORT_BASE_URL|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|MINIMAX_API_KEY|ZHIPU_API_KEY|Build site before email|Publish report before email" .github/workflows/index-brief.yml
```

Expected: no matches.

Run:

```bash
rg -n "models: read|GITHUB_MODELS_MODEL|private report|完整报告" .github/workflows/index-brief.yml docs/index-brief-setup.md .agents/skills/us-index-daily-brief/SKILL.md
```

Expected: the new permission, model setting, and private-email behavior are documented.

```bash
git add .github/workflows/index-brief.yml docs/index-brief-setup.md .agents/skills/us-index-daily-brief/SKILL.md
git commit -m "ci: run translated private index brief"
```

### Task 6: Full Verification and Live Workflow Acceptance

**Files:**
- Modify only if failures reveal a defect in files already listed above.

- [ ] **Step 1: Run the complete local suite**

Run:

```bash
npm test
npm run typecheck
git diff --check
```

Expected: all tests PASS, TypeScript reports no errors, and `git diff --check` prints nothing.

- [ ] **Step 2: Confirm prohibited behavior is absent**

Run:

```bash
rg -n "查看完整报告|REPORT_BASE_URL|walvez\\.github\\.io" lib/index-brief scripts/index-brief.ts .github/workflows/index-brief.yml tests/index-brief
```

Expected: no production matches; test assertions may mention prohibited strings only inside `doesNotMatch`.

- [ ] **Step 3: Push the implementation branch**

Run:

```bash
git push origin master
```

Expected: the new commits are present in `Walvez/us-index-daily-brief`.

- [ ] **Step 4: Trigger one manual workflow run**

Run:

```bash
gh workflow run index-brief.yml --repo Walvez/us-index-daily-brief
gh run list --workflow index-brief.yml --repo Walvez/us-index-daily-brief --limit 1
```

Expected: a new queued or in-progress run appears.

- [ ] **Step 5: Watch the workflow to completion**

Run:

```bash
gh run watch RUN_ID --repo Walvez/us-index-daily-brief --exit-status
```

Expected: all generation, email, and private-persistence steps succeed. If the latest market date already has `.emailed`, temporarily verify generation through tests rather than deleting the marker or causing a duplicate email.

- [ ] **Step 6: Inspect non-secret logs and archive state**

Run:

```bash
gh run view RUN_ID --repo Walvez/us-index-daily-brief --log
git fetch origin gh-pages
git show origin/gh-pages:valuation-history.json
```

Expected: logs show either successful GitHub Models Chinese generation or an explicit fallback; the history file contains at most one record for each official `asOf` date. No token, Gmail password, or recipient credential appears in logs.

- [ ] **Step 7: User acceptance on mobile**

Ask the user to open the newly received Gmail message and confirm:

```text
1. 邮件中没有“查看完整报告”按钮。
2. 新闻标题和解释为中文，原文链接可以打开。
3. 估值区块显示预期 PE、10 年均值、偏离、温度和数据日期。
4. 邮件明确说明 PE 不是昨夜实时数据，百分位仍在积累中。
```

- [ ] **Step 8: Record final verification**

Run:

```bash
git status --short
git log -6 --oneline
```

Expected: only the pre-existing untracked `work_thesis_format/` remains; implementation commits are visible and no required work is uncommitted.
