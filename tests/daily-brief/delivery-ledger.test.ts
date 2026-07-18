import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DELIVERY_LEDGER_BRANCH,
  listLedgerEditions,
  restoreDeliveryMarkersFromLedger,
  writeDeliveryLedgerEntry,
} from "../../lib/daily-brief/delivery-ledger";
import {
  editionPaths,
  inspectEditionState,
  markEditionEmailed,
  writeEditionReportFiles,
} from "../../lib/daily-brief/state";
import { dailyBriefFixture } from "./fixtures";

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("ledger write after SMTP markers and restore into empty reports root", (t) => {
  const reports = tempRoot("brief-reports-");
  const ledger = tempRoot("brief-ledger-");
  t.after(() => {
    fs.rmSync(reports, { recursive: true, force: true });
    fs.rmSync(ledger, { recursive: true, force: true });
  });

  writeEditionReportFiles(reports, dailyBriefFixture({ editionDate: "2026-06-06" }));
  // Never mark before SMTP success — simulate post-SMTP mark then checkpoint.
  markEditionEmailed(reports, "2026-06-06", { messageId: "msg-ledger" });
  writeDeliveryLedgerEntry(ledger, reports, "2026-06-06");

  assert.deepEqual(listLedgerEditions(ledger), ["2026-06-06"]);

  // Simulate next run: archive missing (gh-pages failed) but ledger survives.
  const nextReports = tempRoot("brief-reports-next-");
  t.after(() => fs.rmSync(nextReports, { recursive: true, force: true }));
  const restored = restoreDeliveryMarkersFromLedger(ledger, nextReports);
  assert.deepEqual(restored, ["2026-06-06"]);
  assert.equal(inspectEditionState(nextReports, "2026-06-06"), "sent");
  assert.equal(
    fs.readFileSync(editionPaths(nextReports, "2026-06-06").emailed, "utf8").includes("T"),
    true,
  );
  const meta = JSON.parse(
    fs.readFileSync(editionPaths(nextReports, "2026-06-06").sentMeta, "utf8"),
  );
  assert.equal(meta.messageId, "msg-ledger");
});

test("writeDeliveryLedgerEntry refuses missing local .emailed (no pre-SMTP mark)", (t) => {
  const reports = tempRoot("brief-reports-");
  const ledger = tempRoot("brief-ledger-");
  t.after(() => {
    fs.rmSync(reports, { recursive: true, force: true });
    fs.rmSync(ledger, { recursive: true, force: true });
  });
  writeEditionReportFiles(reports, dailyBriefFixture({ editionDate: "2026-06-06" }));
  assert.throws(
    () => writeDeliveryLedgerEntry(ledger, reports, "2026-06-06"),
    /missing \.emailed/,
  );
});

test("DELIVERY_LEDGER_BRANCH is dedicated and non-secret", () => {
  assert.equal(DELIVERY_LEDGER_BRANCH, "brief-delivery");
  assert.doesNotMatch(DELIVERY_LEDGER_BRANCH, /secret|password|token/i);
});
