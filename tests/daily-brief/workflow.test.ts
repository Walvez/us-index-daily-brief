import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL("../../.github/workflows/index-brief.yml", import.meta.url),
  "utf8",
);

function stepIndex(namePattern: RegExp): number {
  const match = workflow.match(
    new RegExp(`- name:\\s*${namePattern.source}`, "i"),
  );
  assert.ok(match, `expected step matching ${namePattern}`);
  return match.index ?? -1;
}

test("workflow runs unified daily-brief pipeline with safe retries", () => {
  assert.match(workflow, /npm run daily-brief/);
  assert.match(workflow, /npm run send-daily-brief/);
  assert.match(workflow, /edition_date/);
  assert.match(workflow, /BRIEF_MODULES:\s*market,tech-news/);
  assert.match(workflow, /TECH_NEWS_ENABLED:\s*"true"/);
  assert.match(workflow, /REPORT_TZ:\s*Asia\/Taipei/);
  assert.match(workflow, /cron: "5 16 \* \* 1-5"/);
  assert.match(workflow, /cron: "35 16 \* \* 1-5"/);
  assert.match(workflow, /cron: "5 17 \* \* 1-5"/);
  assert.match(workflow, /cron: "35 17 \* \* 1-5"/);
  assert.match(workflow, /timezone: "America\/New_York"/);
  assert.match(workflow, /validation_only/);
  assert.match(workflow, /models:\s*read/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /gh-pages/);
  assert.match(workflow, /GMAIL_APP_PASSWORD/);
  assert.match(workflow, /steps\.brief\.outputs\.status != 'skip'/);
  assert.match(workflow, /steps\.brief\.outputs\.sendable != 'false'/);
  assert.doesNotMatch(workflow, /printenv|echo \$\{?\{\s*secrets\./i);
});

test("workflow wires attempt-aware market retry policy", () => {
  assert.match(workflow, /Resolve schedule attempt/);
  assert.match(workflow, /attempt=early/);
  assert.match(workflow, /attempt=final/);
  assert.match(workflow, /attempt=manual/);
  assert.match(workflow, /BRIEF_SCHEDULE_ATTEMPT/);
  assert.match(workflow, /35 17 \* \* 1-5/);
});

test("workflow restores delivery ledger before generate and checkpoints after SMTP", () => {
  const restore = stepIndex(/Restore reports and delivery state/);
  const generate = stepIndex(/Generate or resume daily brief/);
  const send = stepIndex(/Send email/);
  const checkpoint = stepIndex(/Checkpoint delivery ledger after SMTP/);
  const archive = stepIndex(/Prepare private report archive/);
  const publish = stepIndex(/Persist private report and delivery state/);

  assert.ok(restore < generate, "restore before generate");
  assert.ok(generate < send, "generate before send");
  assert.ok(send < checkpoint, "send before delivery checkpoint");
  assert.ok(checkpoint < archive, "checkpoint before archive build");
  assert.ok(archive < publish, "archive before gh-pages publish");

  assert.match(workflow, /brief-delivery/);
  assert.match(workflow, /restore-delivery-ledger/);
  assert.match(workflow, /checkpoint-delivery/);
  assert.match(workflow, /steps\.send\.outcome == 'success'/);
  // Fail-closed restore: no || true on ledger checkout when remote exists.
  assert.match(workflow, /Fail-closed/);
  assert.doesNotMatch(
    workflow,
    /checkout origin\/brief-delivery -- \. \|\| true/,
  );
  // Archive publish must not be the only durability path.
  assert.match(workflow, /Irreducible window/);
});

test("validation mode fails enabled market failure and checks structure", () => {
  assert.match(workflow, /个人每日简报/);
  assert.match(workflow, /DailyBriefReport version 1/);
  assert.match(workflow, /valuation stale/);
  assert.match(workflow, /Stale public report link/);
  assert.match(workflow, /enabled market module status=/);
  assert.match(workflow, /validation_only must fail/);
  assert.doesNotMatch(workflow, /npm run index-brief/);
  assert.doesNotMatch(workflow, /npm run send-index-brief/);
});
