import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIndexBrief, type RunDependencies } from "../../lib/index-brief/run";
import {
  inspectState,
  markEmailed,
  reportPaths,
  writeReportFiles,
} from "../../lib/index-brief/state";
import { readValuationHistory } from "../../lib/index-brief/valuation-history";
import { reportFixture } from "./fixtures";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "index-brief-test-"));
}

function dependencies(root: string): RunDependencies {
  return {
    outputRoot: root,
    now: () => new Date("2026-06-06T02:00:00Z"),
    loadMarket: async () => reportFixture.market,
    loadNews: async () => [],
    loadValuation: async () => reportFixture.valuation,
    explain: async () => reportFixture.commentary,
  };
}

test("skips a market date that already has a sent marker", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeReportFiles(root, reportFixture);
  markEmailed(root, reportFixture.market.marketDate);

  const result = await runIndexBrief(dependencies(root));
  assert.deepEqual(result, {
    status: "skip",
    marketDate: "2026-06-05",
    reportDir: reportPaths(root, "2026-06-05").directory,
  });
});

test("reuses a generated report when email previously failed", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeReportFiles(root, reportFixture);

  const result = await runIndexBrief(dependencies(root));
  assert.equal(result.status, "email-only");
  assert.equal(inspectState(root, "2026-06-05"), "report-only");
});

test("generates report files for a new market session", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = await runIndexBrief(dependencies(root));
  const paths = reportPaths(root, "2026-06-05");
  assert.equal(result.status, "generated");
  assert.equal(inspectState(root, "2026-06-05"), "report-only");
  assert.equal(fs.existsSync(paths.json), true);
  assert.equal(fs.existsSync(paths.html), true);
  assert.equal(fs.existsSync(paths.emailHtml), true);
  assert.equal(readValuationHistory(root).length, 1);
});

test("does not create a normal report when core data is missing", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const deps = dependencies(root);
  deps.loadMarket = async () => {
    throw new Error("missing core market data");
  };
  await assert.rejects(() => runIndexBrief(deps), /missing core market/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("writes report files atomically without temporary leftovers", (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeReportFiles(root, reportFixture);
  const directory = reportPaths(root, "2026-06-05").directory;
  assert.equal(
    fs.readdirSync(directory).some((name) => name.endsWith(".tmp")),
    false,
  );
});
