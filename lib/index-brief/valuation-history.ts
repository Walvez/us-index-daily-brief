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
