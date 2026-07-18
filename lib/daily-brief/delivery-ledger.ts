import fs from "node:fs";
import path from "node:path";
import { editionPaths } from "./state";

/**
 * Durable delivery ledger helpers.
 *
 * After SMTP success we mark .emailed locally and immediately checkpoint the
 * same non-secret markers onto a dedicated git branch (`brief-delivery`) so a
 * later gh-pages archive publish failure cannot erase send idempotency.
 *
 * This module is filesystem-only; the workflow performs git fetch/push.
 */

export const DELIVERY_LEDGER_BRANCH = "brief-delivery";

export function deliveryLedgerEntryPaths(
  ledgerRoot: string,
  editionDate: string,
) {
  const directory = path.join(ledgerRoot, editionDate);
  return {
    directory,
    emailed: path.join(directory, ".emailed"),
    sentMeta: path.join(directory, "sent.json"),
  };
}

function atomicWrite(filePath: string, content: string): void {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filePath);
}

/**
 * Copy local post-SMTP markers into a ledger worktree directory.
 * Call only after markEditionEmailed has succeeded.
 */
export function writeDeliveryLedgerEntry(
  ledgerRoot: string,
  reportsRoot: string,
  editionDate: string,
): void {
  const source = editionPaths(reportsRoot, editionDate);
  if (!fs.existsSync(source.emailed)) {
    throw new Error(
      `cannot checkpoint delivery: missing .emailed for ${editionDate}`,
    );
  }
  const dest = deliveryLedgerEntryPaths(ledgerRoot, editionDate);
  fs.mkdirSync(dest.directory, { recursive: true });
  atomicWrite(dest.emailed, fs.readFileSync(source.emailed, "utf8"));
  if (fs.existsSync(source.sentMeta)) {
    atomicWrite(dest.sentMeta, fs.readFileSync(source.sentMeta, "utf8"));
  }
}

/**
 * Materialize ledger markers into the reports root before generate/send.
 * Returns edition dates that were restored.
 */
export function restoreDeliveryMarkersFromLedger(
  ledgerRoot: string,
  reportsRoot: string,
): string[] {
  if (!fs.existsSync(ledgerRoot)) return [];

  const restored: string[] = [];
  for (const entry of fs.readdirSync(ledgerRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const editionDate = entry.name;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editionDate)) continue;

    const ledger = deliveryLedgerEntryPaths(ledgerRoot, editionDate);
    if (!fs.existsSync(ledger.emailed)) continue;

    const dest = editionPaths(reportsRoot, editionDate);
    fs.mkdirSync(dest.directory, { recursive: true });
    // Prefer existing local markers (same run / concurrent restore) but always
    // ensure a durable ledger mark is present before any send decision.
    if (!fs.existsSync(dest.emailed)) {
      atomicWrite(dest.emailed, fs.readFileSync(ledger.emailed, "utf8"));
    }
    if (fs.existsSync(ledger.sentMeta) && !fs.existsSync(dest.sentMeta)) {
      atomicWrite(dest.sentMeta, fs.readFileSync(ledger.sentMeta, "utf8"));
    }
    restored.push(editionDate);
  }
  return restored.sort();
}

/**
 * List edition dates present in a ledger directory (have .emailed).
 */
export function listLedgerEditions(ledgerRoot: string): string[] {
  if (!fs.existsSync(ledgerRoot)) return [];
  return fs
    .readdirSync(ledgerRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .filter((name) =>
      fs.existsSync(deliveryLedgerEntryPaths(ledgerRoot, name).emailed),
    )
    .sort();
}
