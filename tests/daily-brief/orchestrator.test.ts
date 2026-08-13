import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "daily-brief-test-"));
}

const fixedNow = () => new Date("2026-06-06T02:00:00Z");

function baseDeps(root: string): OrchestratorDependencies {
  return {
    now: fixedNow,
    config: {
      outputRoot: root,
      timeZone: "Asia/Taipei",
      marketEnabled: true,
      techNewsEnabled: false,
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
  };
}

test("edition-date idempotency: skips when .emailed exists", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const report = dailyBriefFixture({ editionDate: "2026-06-06" });
  writeEditionReportFiles(root, report);
  markEditionEmailed(root, "2026-06-06");

  const result = await runDailyBrief(baseDeps(root));
  assert.equal(result.status, "skip");
  assert.equal(result.editionDate, "2026-06-06");
  assert.equal(inspectEditionState(root, "2026-06-06"), "sent");
});

test("email-only resumes when report exists without .emailed", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeEditionReportFiles(root, dailyBriefFixture({ editionDate: "2026-06-06" }));

  const result = await runDailyBrief(baseDeps(root));
  assert.equal(result.status, "email-only");
  assert.equal(inspectEditionState(root, "2026-06-06"), "report-only");
});

test("market-only compatibility generates edition report", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = await runDailyBrief(baseDeps(root));
  assert.equal(result.status, "generated");
  assert.equal(result.editionDate, "2026-06-06");
  const paths = editionPaths(root, "2026-06-06");
  assert.equal(fs.existsSync(paths.json), true);
  assert.equal(fs.existsSync(paths.emailHtml), true);
  assert.equal(inspectEditionState(root, "2026-06-06"), "report-only");

  const saved = JSON.parse(fs.readFileSync(paths.json, "utf8"));
  assert.equal(saved.version, 1);
  const market = saved.modules.find(
    (module: { moduleId: string }) => module.moduleId === "market",
  );
  const tech = saved.modules.find(
    (module: { moduleId: string }) => module.moduleId === "tech-news",
  );
  assert.equal(market.status, "success");
  assert.equal(tech.status, "skipped");
  assert.equal(
    market.data.report.advice.label,
    "正常定投，可按习惯略微增加",
  );
});

test("modules fail independently: market failure does not throw", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const deps = baseDeps(root);
  deps.config = { ...deps.config, techNewsEnabled: true };
  deps.market = {
    loadMarket: async () => {
      throw new Error("missing core market data");
    },
  };
  deps.techNews = {
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

  const result = await runDailyBrief(deps);
  assert.equal(result.status, "generated");
  const market = result.report?.modules.find((m) => m.moduleId === "market");
  const tech = result.report?.modules.find((m) => m.moduleId === "tech-news");
  assert.equal(market?.status, "failed");
  assert.ok(
    tech?.status === "success" || tech?.status === "degraded",
    `expected tech success/degraded, got ${tech?.status}`,
  );
});

test("tech source failure does not block market module", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const deps = baseDeps(root);
  deps.config = { ...deps.config, techNewsEnabled: true };
  deps.techNews = {
    articlesFetcher: async () => {
      throw new Error("source down");
    },
  };

  const result = await runDailyBrief(deps);
  assert.equal(result.status, "generated");
  const market = result.report?.modules.find((m) => m.moduleId === "market");
  const tech = result.report?.modules.find((m) => m.moduleId === "tech-news");
  assert.equal(market?.status, "success");
  assert.equal(tech?.status, "failed");
  assert.equal(fs.existsSync(editionPaths(root, "2026-06-06").emailHtml), true);
});

test("mark emailed only via explicit API after send simulation", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeEditionReportFiles(root, dailyBriefFixture({ editionDate: "2026-06-06" }));
  assert.equal(inspectEditionState(root, "2026-06-06"), "report-only");
  markEditionEmailed(root, "2026-06-06", { messageId: "msg-1" });
  assert.equal(inspectEditionState(root, "2026-06-06"), "sent");
  const meta = JSON.parse(
    fs.readFileSync(editionPaths(root, "2026-06-06").sentMeta, "utf8"),
  );
  assert.equal(meta.messageId, "msg-1");
});

test("regenerates when prior report had failed market (retry after data lag)", async (t) => {
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
          status: "skipped",
          userMessage: "科技新闻模块未启用",
          generatedAt: "2026-06-06T00:00:00.000Z",
        },
      ],
    }),
  );

  const result = await runDailyBrief(baseDeps(root));
  assert.equal(result.status, "generated");
  const market = result.report?.modules.find((m) => m.moduleId === "market");
  assert.equal(market?.status, "success");
});
