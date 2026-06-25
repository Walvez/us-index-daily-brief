import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL("../../.github/workflows/index-brief.yml", import.meta.url),
  "utf8",
);

test("validation mode allows stale valuation while keeping parser failures strict", () => {
  assert.match(workflow, /report\.valuation\.reason === "stale"/);
  assert.match(workflow, /Valuation unavailable/);
  assert.doesNotMatch(
    workflow,
    /report\.valuation\.status !== "available"\) throw new Error/,
  );
});
