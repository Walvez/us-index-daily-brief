import test from "node:test";
import assert from "node:assert/strict";
import { sma } from "../lib/trading/indicators";

test("upstream indicator utilities are importable", () => {
  assert.deepEqual(sma([1, 2, 3], 2), [1.5, 2.5]);
});
