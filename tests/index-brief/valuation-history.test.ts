import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendValuationSnapshot,
  readValuationHistory,
} from "../../lib/index-brief/valuation-history";
import { parseNasdaqValuationText } from "../../lib/index-brief/valuation";

const text = `
Global Equities Last MTD % Change QTD % Change YTD % Change LTM % Change
Dividend Yield NTM P/E NTM P/E 10yr Avg. Last vs. 10yr Avg.
Nasdaq-100 28,015 2.1% 18.0% 11.0% 40.3% 0.6% 23.40 22.90 +2.2%
S&P 500 7,259 0.7% 11.2% 6.0% 28.5% 1.1% 20.73 19.09 +8.6%
Russell 2000 2,845 1.6% 14.6% 1.2% 24.80 23.21 +6.9%
Data as of 5/5/2026.
`;

test("stores one snapshot per official data date", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "valuation-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const snapshot = parseNasdaqValuationText(text, "official");
  appendValuationSnapshot(root, snapshot);
  appendValuationSnapshot(root, snapshot);

  assert.equal(readValuationHistory(root).length, 1);
  assert.equal(
    fs.readdirSync(root).some((name) => name.endsWith(".tmp")),
    false,
  );
});
