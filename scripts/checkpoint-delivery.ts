/**
 * Checkpoint delivery markers to a durable git branch immediately after SMTP.
 *
 * Usage (CI, after send-daily-brief succeeds):
 *   npx tsx scripts/checkpoint-delivery.ts YYYY-MM-DD
 *
 * Non-secret markers only (.emailed, sent.json). Never prints secrets.
 * Conflict-aware: rebases and retries push a few times.
 *
 * Test-only overrides (never used in production workflow):
 *   DELIVERY_LEDGER_REMOTE  — remote name (default origin)
 */
import "./_env";

import {
  DELIVERY_LEDGER_BRANCH,
} from "../lib/daily-brief/delivery-ledger";
import { checkpointDeliveryToRemote } from "../lib/daily-brief/delivery-ledger-git";

function main() {
  const editionDate = process.argv[2] || process.env.EDITION_DATE;
  if (!editionDate || !/^\d{4}-\d{2}-\d{2}$/.test(editionDate)) {
    throw new Error("edition date argument must be YYYY-MM-DD");
  }
  const reportsRoot = process.env.REPORT_OUTPUT_DIR || "daily_reports";
  const remote = process.env.DELIVERY_LEDGER_REMOTE || "origin";
  const repoRoot = process.cwd();

  const result = checkpointDeliveryToRemote({
    repoRoot,
    remote,
    editionDate,
    reportsRoot,
  });

  if (result.alreadyPresent) {
    console.log(
      `[checkpoint-delivery] no new markers for ${editionDate} (already present)`,
    );
    return;
  }

  console.log(
    `[checkpoint-delivery] persisted markers for ${editionDate} on ${DELIVERY_LEDGER_BRANCH}`,
  );
}

main();
