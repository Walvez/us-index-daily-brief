/**
 * Restore durable delivery markers into REPORT_OUTPUT_DIR before generate/send.
 *
 * Usage:
 *   npx tsx scripts/restore-delivery-ledger.ts
 *
 * Probes remote presence with a typed three-state result (present | absent |
 * error) via `git ls-remote --exit-code`. Only verified absence (exit 2) is a
 * clean skip. Missing remote, unreachable URL, auth/transport failure, or
 * indeterminate status exits nonzero before generate/send.
 *
 * When present, performs fail-closed fetch of brief-delivery with an explicit
 * refspec (refs/heads/brief-delivery:refs/remotes/origin/brief-delivery),
 * materializes markers into DELIVERY_LEDGER_DIR, then copies them into
 * REPORT_OUTPUT_DIR. Fetch/checkout/restore failure also exits nonzero.
 *
 * Test-only overrides:
 *   DELIVERY_LEDGER_REMOTE  — remote name (default origin)
 */
import "./_env";

import {
  DELIVERY_LEDGER_BRANCH,
} from "../lib/daily-brief/delivery-ledger";
import { restoreDeliveryLedgerFromRemote } from "../lib/daily-brief/delivery-ledger-git";

function main() {
  const ledgerRoot = process.env.DELIVERY_LEDGER_DIR || ".delivery-ledger";
  const reportsRoot = process.env.REPORT_OUTPUT_DIR || "daily_reports";
  const remote = process.env.DELIVERY_LEDGER_REMOTE || "origin";
  const repoRoot = process.cwd();

  const result = restoreDeliveryLedgerFromRemote({
    repoRoot,
    remote,
    ledgerDir: ledgerRoot,
    reportsRoot,
    fetchDepth: 1,
  });

  if (result.skippedAbsentRemote) {
    console.log(
      `[restore-delivery-ledger] remote ${remote} has no ${DELIVERY_LEDGER_BRANCH}; skip`,
    );
    return;
  }

  console.log(
    `[restore-delivery-ledger] restored ${result.restored.length} edition marker(s)${
      result.restored.length ? `: ${result.restored.join(", ")}` : ""
    }`,
  );
}

main();
