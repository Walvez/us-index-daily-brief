import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decideSendability,
  resolveScheduleAttempt,
} from "../../lib/daily-brief/send-policy";
import {
  runDailyBrief,
  type OrchestratorDependencies,
} from "../../lib/daily-brief/orchestrator";
import {
  editionPaths,
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
    sourceDefs: [
      {
        id: "openai-news",
        name: "OpenAI News",
        type: "rss" as const,
        url: "https://example.com/rss",
        category: "tech" as const,
        enabled: true,
      },
    ],
    fetcher: async () => [
      {
        sourceId: "openai-news",
        title: "OpenAI ships model update",
        url: "https://example.com/openai",
        excerpt: "A new model release.",
        publishedAt: new Date("2026-06-05T20:00:00Z"),
        category: "tech" as const,
      },
    ],
    llm: null as null,
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
      techNewsWindowHours: 30,
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
      GITHUB_EVENT_SCHEDULE: "5 21 * * *",
    }),
    "early",
  );
  assert.equal(
    resolveScheduleAttempt({
      GITHUB_EVENT_NAME: "schedule",
      GITHUB_EVENT_SCHEDULE: "10 22 * * *",
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
          windowHours: 30,
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
            windowHours: 30,
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
