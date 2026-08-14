import test from "node:test";
import assert from "node:assert/strict";
import {
  editionKindFor,
  editionWeekdayLabel,
} from "../../lib/daily-brief/edition";

test("editionKindFor detects weekends in Asia/Taipei", () => {
  assert.equal(editionKindFor("2026-06-06", "Asia/Taipei"), "weekend"); // Saturday
  assert.equal(editionKindFor("2026-06-07", "Asia/Taipei"), "weekend"); // Sunday
  assert.equal(editionKindFor("2026-06-08", "Asia/Taipei"), "weekday"); // Monday
});

test("editionWeekdayLabel returns Chinese labels", () => {
  assert.equal(editionWeekdayLabel("2026-06-08", "Asia/Taipei"), "星期一");
  assert.equal(editionWeekdayLabel("2026-06-06", "Asia/Taipei"), "星期六");
});
