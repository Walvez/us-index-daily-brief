import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decideSendability,
  isMarketFresh,
  resolveScheduleAttempt,
} from "../../lib/daily-brief/send-policy";
import {
  runDailyBrief,
  type OrchestratorDependencies,
} from "../../lib/daily-brief/orchestrator";
import {
  editionPaths,
  findLatestPublishedMarketDate,
  inspectEditionState,
  markEditionEmailed,
  writeEditionReportFiles,
} from "../../lib/daily-brief/state";
import { dailyBriefFixture, marketReportFixture } from "./fixtures";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "daily-brief-send-"));
}

const fixedNow = () => new Date("2026-06-06T02:00:00Z");

function techFetcher() {
  return {
    articlesFetcher: async () => [
      {
        id: "1",
        title: "OpenAI ships model update",
        sourceName: "OpenAI News",
        url: "https://example.com/openai",
        summary: "OpenAI 发布模型更新。",
        publishedAt: "2026-06-05T20:00:00.000Z",
      },
    ],
  };
}

function baseDeps(root: string): OrchestratorDependencies {
  return {
    now: fixedNow,
    config: {
      outputRoot: root,
      timeZone: "Asia/Taipei",
      marketEnabled: true,
      techNewsEnabled: true,
      techNewsLimit: 5,
      techNewsWindow: "24h",
      validationOnly: false,
    },
    market: {
      loadMarket: async () => marketReportFixture.market,
      loadNews: async () => [],
      loadValuation: async () => marketReportFixture.valuation,
      explain: async () => marketReportFixture.commentary,
    },
    techNews: techFetcher(),
  };
}

test("resolveScheduleAttempt maps cron and dispatch", () => {
  assert.equal(
    resolveScheduleAttempt({ BRIEF_SCHEDULE_ATTEMPT: "early" }),
    "early",
  );
  assert.equal(
    resolveScheduleAttempt({
      GITHUB_EVENT_NAME: "schedule",
      GITHUB_EVENT_SCHEDULE: "5 16 * * 1-5",
    }),
    "early",
  );
  assert.equal(
    resolveScheduleAttempt({
      GITHUB_EVENT_NAME: "schedule",
      GITHUB_EVENT_SCHEDULE: "35 16 * * 1-5",
    }),
    "early",
  );
  assert.equal(
    resolveScheduleAttempt({
      GITHUB_EVENT_NAME: "schedule",
      GITHUB_EVENT_SCHEDULE: "5 17 * * 1-5",
    }),
    "early",
  );
  assert.equal(
    resolveScheduleAttempt({
      GITHUB_EVENT_NAME: "schedule",
      GITHUB_EVENT_SCHEDULE: "35 17 * * 1-5",
    }),
    "final",
  );
  assert.equal(
    resolveScheduleAttempt({ GITHUB_EVENT_NAME: "workflow_dispatch" }),
    "manual",
  );
});

test("early attempt defers SMTP when market failed even if tech succeeded", () => {
  const report = dailyBriefFixture({
    modules: [
      {
        moduleId: "market",
        status: "failed",
        userMessage: "市场数据暂不可用",
        generatedAt: "2026-06-06T00:00:00.000Z",
      },
      {
        moduleId: "tech-news",
        status: "degraded",
        data: {
          items: [
            {
              sourceTitle: "OpenAI update",
              sourceName: "OpenAI News",
              sourceUrl: "https://example.com/openai",
              summaryStatus: "fallback",
            },
          ],
          window: "24h",
          candidateCount: 1,
        },
        generatedAt: "2026-06-06T00:00:00.000Z",
      },
    ],
  });

  const early = decideSendability(report, {
    marketEnabled: true,
    attempt: "early",
  });
  assert.equal(early.sendable, false);
  assert.equal(early.reason, "early-defer-market-failed");

  const final = decideSendability(report, {
    marketEnabled: true,
    attempt: "final",
  });
  assert.equal(final.sendable, true);
  assert.equal(final.reason, "final-tech-only-fallback");

  const manual = decideSendability(report, {
    marketEnabled: true,
    attempt: "manual",
  });
  assert.equal(manual.sendable, true);
  assert.equal(manual.reason, "manual-tech-only-fallback");
});

test("early market failure does not lock edition; later market success can send once", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Attempt 1 (early): market lag + tech ok → generate but do not treat as sendable resume lock.
  const earlyDeps = baseDeps(root);
  earlyDeps.scheduleAttempt = "early";
  earlyDeps.market = {
    loadMarket: async () => {
      throw new Error("missing core market data");
    },
  };
  const early = await runDailyBrief(earlyDeps);
  assert.equal(early.status, "generated");
  assert.equal(early.report?.modules.find((m) => m.moduleId === "market")?.status, "failed");
  assert.equal(
    early.report?.modules.find((m) => m.moduleId === "tech-news")?.status ===
      "success" ||
      early.report?.modules.find((m) => m.moduleId === "tech-news")?.status ===
        "degraded",
    true,
  );
  const earlyDecision = decideSendability(early.report!, {
    marketEnabled: true,
    attempt: "early",
  });
  assert.equal(earlyDecision.sendable, false);
  // Report written, but NOT marked sent — no .emailed.
  assert.equal(inspectEditionState(root, "2026-06-06"), "report-only");
  assert.equal(fs.existsSync(editionPaths(root, "2026-06-06").emailed), false);

  // Attempt 2 (later): market recovers → regenerate with market success and become sendable.
  const laterDeps = baseDeps(root);
  laterDeps.scheduleAttempt = "early";
  const later = await runDailyBrief(laterDeps);
  assert.equal(later.status, "generated");
  assert.equal(
    later.report?.modules.find((m) => m.moduleId === "market")?.status,
    "success",
  );
  const laterDecision = decideSendability(later.report!, {
    marketEnabled: true,
    attempt: "early",
  });
  assert.equal(laterDecision.sendable, true);
  assert.equal(laterDecision.reason, "market-ready");

  // Simulate single SMTP success + mark.
  markEditionEmailed(root, "2026-06-06", { messageId: "once" });
  assert.equal(inspectEditionState(root, "2026-06-06"), "sent");

  // Further attempts skip — edition locked after one send.
  const skip = await runDailyBrief(baseDeps(root));
  assert.equal(skip.status, "skip");
});

test("report-only tech-only from early attempt is not email-only resumed on early retry", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeEditionReportFiles(
    root,
    dailyBriefFixture({
      editionDate: "2026-06-06",
      modules: [
        {
          moduleId: "market",
          status: "failed",
          userMessage: "市场数据暂不可用",
          generatedAt: "2026-06-06T00:00:00.000Z",
        },
        {
          moduleId: "tech-news",
          status: "degraded",
          data: {
            items: [
              {
                sourceTitle: "OpenAI update",
                sourceName: "OpenAI News",
                sourceUrl: "https://example.com/openai",
                summaryStatus: "fallback",
              },
            ],
            window: "24h",
            candidateCount: 1,
          },
          generatedAt: "2026-06-06T00:00:00.000Z",
        },
      ],
    }),
  );

  const deps = baseDeps(root);
  deps.scheduleAttempt = "early";
  const result = await runDailyBrief(deps);
  // Must regenerate (not email-only) so market can recover.
  assert.equal(result.status, "generated");
  assert.equal(
    result.report?.modules.find((m) => m.moduleId === "market")?.status,
    "success",
  );
});

function marketFixtureWithDate(
  marketDate: string,
  overrides: Partial<import("../../lib/daily-brief/market-module").MarketModuleData> = {},
): import("../../lib/daily-brief/types").ModuleResult<import("../../lib/daily-brief/market-module").MarketModuleData> {
  return {
    moduleId: "market",
    status: "success",
    data: {
      ...marketReportFixture,
      report: {
        ...marketReportFixture,
        market: {
          ...marketReportFixture.market,
          marketDate,
        },
      },
      marketDate,
      isLastTradingDay: true,
      staleLabel: overrides.staleLabel ?? "最近交易日",
      editionKind: "weekday",
      ...overrides,
    },
    userMessage: overrides.staleLabel ?? "最近交易日",
    generatedAt: "2026-06-06T00:05:00.000Z",
  };
}

test("findLatestPublishedMarketDate extracts latest marketDate from prior published/sent reports and ignores un-sent current edition", (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(findLatestPublishedMarketDate(root, "2026-06-06"), undefined);

  // Write prior edition 2026-06-04 with marketDate 2026-06-03
  writeEditionReportFiles(
    root,
    dailyBriefFixture({
      editionDate: "2026-06-04",
      modules: [marketFixtureWithDate("2026-06-03")],
    }),
  );
  markEditionEmailed(root, "2026-06-04");

  // Write prior edition 2026-06-05 with marketDate 2026-06-04
  writeEditionReportFiles(
    root,
    dailyBriefFixture({
      editionDate: "2026-06-05",
      modules: [marketFixtureWithDate("2026-06-04")],
    }),
  );
  markEditionEmailed(root, "2026-06-05");

  // Write un-sent current edition 2026-06-06 with stale marketDate 2026-06-04
  writeEditionReportFiles(
    root,
    dailyBriefFixture({
      editionDate: "2026-06-06",
      modules: [marketFixtureWithDate("2026-06-04")],
    }),
  );

  // Un-sent current edition must not be counted as prior published market date
  const latest = findLatestPublishedMarketDate(root, "2026-06-06");
  assert.equal(latest, "2026-06-04");
});

test("A. early + market success, but marketDate equals prior -> defer; B. later early + marketDate updated -> sendable; C. idempotent skip after send", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Seed prior edition (2026-06-05) already sent with marketDate 2026-06-04
  writeEditionReportFiles(
    root,
    dailyBriefFixture({
      editionDate: "2026-06-05",
      modules: [marketFixtureWithDate("2026-06-04")],
    }),
  );
  markEditionEmailed(root, "2026-06-05");

  // --- Step A: Early attempt at 16:05 ET ---
  // Yahoo returns success, but marketDate is still 2026-06-04 (not yet settled).
  const earlyDeps1 = baseDeps(root);
  earlyDeps1.scheduleAttempt = "early";
  earlyDeps1.market = {
    loadMarket: async () => ({
      ...marketReportFixture.market,
      marketDate: "2026-06-04",
    }),
    loadNews: async () => [],
    loadValuation: async () => marketReportFixture.valuation,
    explain: async () => marketReportFixture.commentary,
  };

  const earlyResult1 = await runDailyBrief(earlyDeps1);
  assert.equal(earlyResult1.status, "generated");
  const market1 = earlyResult1.report?.modules.find((m) => m.moduleId === "market");
  assert.equal(market1?.status, "success");
  assert.equal((market1?.data as any)?.marketDate, "2026-06-04");
  assert.equal((market1?.data as any)?.isFresh, false);

  const decision1 = decideSendability(earlyResult1.report!, {
    marketEnabled: true,
    attempt: "early",
    latestPublishedMarketDate: "2026-06-04",
  });
  // Must defer because marketDate equals prior published marketDate
  assert.equal(decision1.sendable, false);
  assert.equal(decision1.reason, "early-defer-market-stale");

  // Edition is NOT locked (.emailed does not exist)
  assert.equal(inspectEditionState(root, "2026-06-06"), "report-only");
  assert.equal(fs.existsSync(editionPaths(root, "2026-06-06").emailed), false);

  // --- Step B: Later early attempt at 16:35 ET ---
  // Yahoo now returns fresh marketDate: 2026-06-05 (> 2026-06-04).
  const earlyDeps2 = baseDeps(root);
  earlyDeps2.scheduleAttempt = "early";
  earlyDeps2.market = {
    loadMarket: async () => ({
      ...marketReportFixture.market,
      marketDate: "2026-06-05",
    }),
    loadNews: async () => [],
    loadValuation: async () => marketReportFixture.valuation,
    explain: async () => marketReportFixture.commentary,
  };

  const earlyResult2 = await runDailyBrief(earlyDeps2);
  // Must regenerate (not resume email-only with stale data)
  assert.equal(earlyResult2.status, "generated");
  const market2 = earlyResult2.report?.modules.find((m) => m.moduleId === "market");
  assert.equal(market2?.status, "success");
  assert.equal((market2?.data as any)?.marketDate, "2026-06-05");
  assert.equal((market2?.data as any)?.isFresh, true);

  const decision2 = decideSendability(earlyResult2.report!, {
    marketEnabled: true,
    attempt: "early",
    latestPublishedMarketDate: "2026-06-04",
  });
  // Sendable now that marketDate is updated and fresh!
  assert.equal(decision2.sendable, true);
  assert.equal(decision2.reason, "market-ready");

  // --- Step C: Post-send idempotency ---
  // Simulate SMTP success
  markEditionEmailed(root, "2026-06-06");
  assert.equal(inspectEditionState(root, "2026-06-06"), "sent");

  // Subsequent runs for the same edition must skip
  const skipResult = await runDailyBrief(baseDeps(root));
  assert.equal(skipResult.status, "skip");
});

test("D. US market closed / holiday: does not disguise old marketDate as today's new market", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Seed prior edition (2026-06-05) already sent with marketDate 2026-06-04
  writeEditionReportFiles(
    root,
    dailyBriefFixture({
      editionDate: "2026-06-05",
      modules: [marketFixtureWithDate("2026-06-04")],
    }),
  );
  markEditionEmailed(root, "2026-06-05");

  // Case D1: Final attempt with tech-news enabled
  const finalDeps = baseDeps(root);
  finalDeps.scheduleAttempt = "final";
  finalDeps.market = {
    loadMarket: async () => ({
      ...marketReportFixture.market,
      marketDate: "2026-06-04", // US holiday: Yahoo still returns prior date
    }),
    loadNews: async () => [],
    loadValuation: async () => marketReportFixture.valuation,
    explain: async () => marketReportFixture.commentary,
  };

  const finalResult = await runDailyBrief(finalDeps);
  assert.equal(finalResult.status, "generated");
  const market = finalResult.report?.modules.find((m) => m.moduleId === "market");
  assert.equal((market?.data as any)?.isFresh, false);
  assert.match((market?.data as any)?.staleLabel ?? "", /美股休市/);

  // Subject must NOT claim to be a market edition
  assert.equal(finalResult.report?.subject, "2026-06-06 个人每日简报｜AI 科技");

  // Send policy allows final-tech-only-fallback
  const decision = decideSendability(finalResult.report!, {
    marketEnabled: true,
    attempt: "final",
    latestPublishedMarketDate: "2026-06-04",
  });
  assert.equal(decision.sendable, true);
  assert.equal(decision.reason, "final-tech-only-fallback");

  // Early attempt defers
  const earlyDecision = decideSendability(finalResult.report!, {
    marketEnabled: true,
    attempt: "early",
    latestPublishedMarketDate: "2026-06-04",
  });
  assert.equal(earlyDecision.sendable, false);
  assert.equal(earlyDecision.reason, "early-defer-market-stale");

  // Case D2: Market-only mode without tech news on US holiday
  // Final attempt without tech fallback does NOT send
  const finalMarketOnlyDecision = decideSendability(
    dailyBriefFixture({
      editionDate: "2026-06-06",
      modules: [market!],
    }),
    {
      marketEnabled: true,
      attempt: "final",
      latestPublishedMarketDate: "2026-06-04",
    },
  );
  assert.equal(finalMarketOnlyDecision.sendable, false);
  assert.equal(
    finalMarketOnlyDecision.reason,
    "market-stale-without-tech-fallback",
  );
});
